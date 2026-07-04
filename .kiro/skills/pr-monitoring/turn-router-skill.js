#!/usr/bin/env node

/**
 * Turn Router Skill — deterministic routing for the orchestrator-led PR loop.
 *
 * The multi-agent PR conversation is driven by the master-agent calling
 * sub-agents via invokeSubAgent (control layer). This skill is the DETERMINISM
 * layer: given a PR comment (or the whole thread) it decides, without any LLM
 * judgement, who must speak next and whether the thread is in a valid state.
 *
 * It is consumed by two hooks:
 *   - postToolUse (after a comment is posted): parse the comment, route to the
 *     tagged agent(s), or recognize a terminal master closing comment.
 *   - preToolUse (before a merge): assert the master has the last word, carries
 *     the approval token, and left no tagged sub-agent without a reply.
 *
 * Pure and dependency-light (only the approval-gate skill, itself pure) so it is
 * unit-testable offline and runs in the regression unit tier.
 */

const gate = require('./approval-gate-skill.js');

/** Canonical sub-agents and the master, with their GitHub @-handles and personas. */
const AGENTS = {
  'master-agent': { handle: 'master-agent', persona: /👔\s*master\s*agent/i, isMaster: true },
  'system-architect': { handle: 'system-architect', persona: /🏗️?\s*system\s*architect/i },
  'frontend-dev': { handle: 'frontend-dev', persona: /⚛️?\s*frontend\s*dev/i },
  'backend-dev': { handle: 'backend-dev', persona: /🔧\s*backend\s*dev/i },
  'ui-designer': { handle: 'ui-designer', persona: /🎨\s*ui\s*designer/i },
  'qa-agent': { handle: 'qa-agent', persona: /🧪\s*qa\s*agent/i },
};

const KNOWN_HANDLES = Object.keys(AGENTS);

/**
 * Extract @-mentions that resolve to known agents. De-duplicated, order-preserved.
 * Unknown @handles are reported separately so the router can flag protocol errors
 * without silently dropping a typo'd tag.
 * @param {string} body
 * @returns {{ mentions: string[], unknown: string[] }}
 */
function extractMentions(body) {
  if (typeof body !== 'string') return { mentions: [], unknown: [] };
  const mentions = [];
  const unknown = [];
  const re = /@([a-z0-9][a-z0-9-]*)/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const handle = m[1].toLowerCase();
    if (KNOWN_HANDLES.includes(handle)) {
      if (!mentions.includes(handle)) mentions.push(handle);
    } else if (!unknown.includes(handle)) {
      unknown.push(handle);
    }
  }
  return { mentions, unknown };
}

/**
 * Identify the persona that authored a comment from its header signature.
 * @param {string} body
 * @returns {string|null} agent key, or null if no recognized persona
 */
function identifyAuthorPersona(body) {
  if (typeof body !== 'string') return null;
  for (const [key, def] of Object.entries(AGENTS)) {
    if (def.persona.test(body)) return key;
  }
  return null;
}

/**
 * Parse a single comment into a routing decision.
 *
 * @param {object} comment - { body, authorLogin }
 * @returns {{
 *   author: string|null,           // persona that wrote it
 *   isMaster: boolean,
 *   isApproval: boolean,           // master closing comment w/ token
 *   nextActors: string[],          // agents that must speak next (multi-agent!)
 *   unknownMentions: string[],
 *   terminal: boolean,             // a valid master approval => thread may end
 *   valid: boolean,
 *   problems: string[]
 * }}
 */
function parseTurn(comment) {
  const body = comment && comment.body;
  const author = identifyAuthorPersona(body);
  const isMaster = author === 'master-agent';
  const { mentions, unknown } = extractMentions(body || '');
  const isApproval = gate.isMasterApprovalComment({
    body,
    authorLogin: comment && comment.authorLogin,
  });

  // The author never needs to reply to their own tag of themselves.
  const nextActors = mentions.filter((h) => h !== author);

  const problems = [];
  if (!author) {
    problems.push('Comment has no recognized persona header (e.g. "**👔 Master Agent**").');
  }
  if (unknown.length) {
    problems.push(`Tags unknown handle(s): ${unknown.map((u) => '@' + u).join(', ')}.`);
  }

  const terminal = isApproval && isMaster;

  // A non-terminal comment MUST hand off to someone; otherwise the loop stalls
  // (exactly the trigger bug we are eliminating). A terminal master comment is
  // allowed to tag no one.
  if (!terminal && nextActors.length === 0) {
    problems.push(
      'Non-terminal comment tags no next actor — the conversation would stall. ' +
        'Tag the agent(s) who must respond, or (master only) post the closing comment.'
    );
  }

  return {
    author,
    isMaster,
    isApproval,
    nextActors,
    unknownMentions: unknown,
    terminal,
    valid: problems.length === 0,
    problems,
  };
}

/**
 * Is the most recent comment a valid master closing comment? Used by the merge
 * backstop to guarantee the master always has the last word.
 * @param {Array<object>} comments - chronological [{ body, authorLogin }]
 * @returns {boolean}
 */
function lastWordIsMaster(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return false;
  const last = comments[comments.length - 1];
  const parsed = parseTurn(last);
  return parsed.isMaster === true;
}

/**
 * Verify every sub-agent the master (or anyone) tagged has a subsequent comment
 * authored by that agent — i.e. nobody was left hanging. Order matters: a reply
 * only counts if it appears AFTER the tag.
 * @param {Array<object>} comments - chronological [{ body, authorLogin }]
 * @returns {{ ok: boolean, awaiting: string[] }}
 */
function allTaggedResponded(comments) {
  if (!Array.isArray(comments)) return { ok: true, awaiting: [] };
  const awaiting = new Set();
  for (const c of comments) {
    const author = identifyAuthorPersona(c && c.body);
    // Anyone who just spoke satisfies an outstanding tag for them.
    if (author) awaiting.delete(author);
    const { mentions } = extractMentions((c && c.body) || '');
    for (const h of mentions) {
      // The master is the loop driver and always speaks last, so a tag pointing
      // back at it is not an outstanding hand-off — only sub-agents can be
      // "left hanging".
      if (h !== author && h !== 'master-agent') awaiting.add(h);
    }
  }
  return { ok: awaiting.size === 0, awaiting: [...awaiting] };
}

/**
 * Merge-readiness gate for the preToolUse backstop. Combines the conversation
 * shape checks with the CI signal.
 * @param {object} state - { comments, ciGreen, blockingIssues }
 * @returns {{ mergeable: boolean, reasons: string[] }}
 */
function evaluateConversationGate(state) {
  const s = state || {};
  const comments = Array.isArray(s.comments) ? s.comments : [];
  const reasons = [];

  if (!lastWordIsMaster(comments)) {
    reasons.push('The last comment is not the master-agent — master must post the closing comment.');
  }
  const last = comments[comments.length - 1];
  if (!last || !gate.isMasterApprovalComment({ body: last.body, authorLogin: last.authorLogin })) {
    reasons.push('The closing comment does not carry a valid APPROVED-BY-MASTER-AGENT token.');
  }
  const tagged = allTaggedResponded(comments);
  if (!tagged.ok) {
    reasons.push(`Tagged agent(s) have not replied: ${tagged.awaiting.map((a) => '@' + a).join(', ')}.`);
  }
  if (s.ciGreen !== true) {
    reasons.push('CI is not green.');
  }
  if ((s.blockingIssues ?? 0) > 0) {
    reasons.push(`${s.blockingIssues} unresolved blocking issue(s) remain.`);
  }

  return { mergeable: reasons.length === 0, reasons };
}

// CLI: node turn-router-skill.js '<comment body>'  → prints the routing decision.
if (require.main === module) {
  const body = process.argv[2];
  if (!body) {
    console.error("Usage: node turn-router-skill.js '<comment body>'");
    process.exit(1);
  }
  console.log(JSON.stringify(parseTurn({ body }), null, 2));
}

module.exports = {
  AGENTS,
  KNOWN_HANDLES,
  extractMentions,
  identifyAuthorPersona,
  parseTurn,
  lastWordIsMaster,
  allTaggedResponded,
  evaluateConversationGate,
};
