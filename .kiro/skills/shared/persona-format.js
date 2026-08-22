#!/usr/bin/env node

/**
 * Persona header format — THE single JS matcher.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MIRRORED IN PYTHON: scripts/persona_format.py
 * Both implementations are driven by the SAME fixture file,
 * .kiro/skills/shared/persona-fixtures.json, and both ship a `--selfcheck` that
 * replays every case in it. If you change the pattern here, change it there and
 * run both self-checks. The fixture is the contract.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS MODULE EXISTS
 *
 * Three call sites used to parse persona headers independently, with three
 * different degrees of leniency:
 *   - the `AGENTS[*].persona` regexes in turn-router-skill.js
 *   - `MASTER_PERSONA` in approval-gate-skill.js
 *   - `PERSONA_SIGNATURES` in scripts/generate-agent-graph.py
 * They drifted, and the format drifted under them across four eras, leaving 19
 * of 93 historical PR comments unattributable. Worse, the old
 * `MASTER_PERSONA = /👔\s*master\s*agent/i` matched the emoji ANYWHERE in the
 * body, so a bare `APPROVED-BY-MASTER-AGENT` comment that merely *mentioned*
 * the persona could open the merge gate — PRs 63-66 merged that way.
 *
 * THE CANONICAL FORM (the only form accepted going forward):
 *
 *     **<emoji> <Persona>** — <subject>
 *
 * TWO MODES, deliberately:
 *
 *   strict  — the live workflow. The approval gate and turn router use this.
 *             Only the canonical form attributes an author. Everything else has
 *             NO author, which means it cannot open the merge gate and cannot
 *             satisfy a routing hand-off. This is the security-relevant path:
 *             being lenient here is what let PRs 63-66 self-merge.
 *
 *   lenient — strict PLUS the historical drift eras, for BACKFILL ONLY: reading
 *             attribution off comments that were already written and can never
 *             be rewritten (the contribution graph). Recognizing a legacy format
 *             for a read-only historical chart costs nothing; accepting it at the
 *             merge gate costs correctness. Hence the split rather than one
 *             permissive regex used everywhere.
 *
 * HOW EACH DRIFT ERA IS HANDLED (19 comments, all verified against the live API):
 *
 *   1. PRs 57-58 — `**Master Agent** --- Code Review` (emoji dropped, ASCII
 *      dashes). 8 comments. recognize-for-backfill, reject-going-forward. The
 *      persona name is unambiguous, so backfill is safe; but accepting a
 *      bold-name-only header going forward would let ordinary prose like
 *      `**Frontend Dev** should look at this` attribute a turn to someone who
 *      never spoke.
 *
 *   2. PRs 61-62 — `## Review: Architecture Lead` (heading form, and role
 *      ALIASES: "Architecture Lead", "Backend Developer", "Master Approval",
 *      "Architect"). 6 comments. recognize-for-backfill, reject-going-forward.
 *      Aliases are resolved by an explicit table, not by fuzzy matching — a
 *      guessing matcher is how drift became invisible in the first place.
 *
 *   3. PRs 63-66 — bare `APPROVED-BY-MASTER-AGENT` with NO persona header.
 *      4 comments. REJECTED IN BOTH MODES. This is the one era we do not
 *      rehabilitate. These four comments are exactly the failure this module
 *      exists to prevent: `isMasterApprovalComment()` should have rejected them
 *      and did not, and all four merged anyway. Backfilling them would launder
 *      a real gate bypass into a clean-looking graph. They stay unattributed,
 *      and the graph should show them as unattributed — that is the honest
 *      record. (This is why `lenient` is not simply "match anything plausible".)
 *
 *   4. PRs 49-50 — no header at all (`Workflow verification successful …`).
 *      2 comments, both throwaway verification PRs. REJECTED IN BOTH MODES:
 *      there is no signal to recover, lenient or otherwise.
 *
 *   Net: of the 19 unattributable comments, 14 become attributable for backfill
 *   (eras 1-2) and 6 stay unattributable on purpose (eras 3-4 — 4 gate-bypass
 *   approvals plus 2 headerless notes). None of the 19 becomes acceptable at
 *   the merge gate.
 *
 * Pure, dependency-light (one JSON read at load), offline, unit-testable.
 */

const fs = require('fs');
const path = require('path');

const FIXTURE_PATH = path.join(__dirname, 'persona-fixtures.json');

/** @type {{canonicalForm: string, agents: Record<string, {name: string, emoji: string, graphKey: string, label: string}>, cases: Array<object>}} */
const FIXTURES = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

/** Canonical agent table, keyed by the agent handle used throughout the skills. */
const AGENTS = FIXTURES.agents;

/** Agent handles, in declaration order. */
const AGENT_KEYS = Object.keys(AGENTS);

/** The documented canonical header form, for error messages. */
const CANONICAL_FORM = FIXTURES.canonicalForm;

/**
 * Persona display name (lowercased, whitespace-collapsed) -> agent handle.
 * Exact names only — the canonical form.
 */
const NAME_TO_KEY = new Map(
  AGENT_KEYS.map((key) => [AGENTS[key].name.toLowerCase(), key])
);

/**
 * Historical role ALIASES used by the `## Review:` era (PRs 61-62). Explicit
 * table, deliberately not fuzzy: every entry here is a string that actually
 * appeared in this repo's comment history.
 */
const LEGACY_ALIASES = new Map([
  ['architecture lead', 'system-architect'],
  ['architect', 'system-architect'],
  ['backend developer', 'backend-dev'],
  ['frontend developer', 'frontend-dev'],
  ['master approval', 'master-agent'],
  ['master', 'master-agent'],
  ['designer', 'ui-designer'],
  ['qa', 'qa-agent'],
]);

/**
 * Emoji run: pictographic characters plus the variation selector / ZWJ that
 * ride along with them (🏗️ is 🏗 + U+FE0F; the repo history contains both).
 * Matching a RUN rather than a single code point keeps ⚛️ and 🏗️ working
 * without hard-coding each persona's byte sequence.
 */
const EMOJI_RUN = '[\\p{Extended_Pictographic}\\uFE0E\\uFE0F\\u200D]+';

/**
 * CANONICAL: `**<emoji> <Persona>** …` at the start of a line.
 * The persona name is captured loosely and resolved against NAME_TO_KEY, so an
 * unknown name fails closed rather than matching a prefix of a known one.
 */
const CANONICAL_RE = new RegExp(
  `^\\*\\*\\s*${EMOJI_RUN}\\s*([A-Za-z][A-Za-z .'-]*?)\\s*\\*\\*`,
  'u'
);

/** DRIFT 1: `**<Persona>** …` — bold name, no emoji (PRs 57-58). */
const NO_EMOJI_RE = /^\*\*\s*([A-Za-z][A-Za-z .'-]*?)\s*\*\*/u;

/** DRIFT 2: `## Review: <Role>` — heading form (PRs 61-62). */
const REVIEW_HEADING_RE = /^#{1,6}\s*Review:\s*(.+?)\s*$/u;

/**
 * Strip fenced code blocks so a quoted EXAMPLE of the canonical header (as in
 * documentation, or a review that shows an agent the format) is not mistaken
 * for a real signature.
 * @param {string} text
 * @returns {string}
 */
function stripFencedBlocks(text) {
  return text.replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[ \t]*$/gm, '');
}

/**
 * Resolve a captured persona/role string to an agent handle.
 * @param {string} raw
 * @param {boolean} allowAliases - permit the PRs 61-62 role aliases
 * @returns {string|null}
 */
function resolveName(raw, allowAliases) {
  if (typeof raw !== 'string') return null;
  // Drop a trailing parenthetical: "Master (Initial Review)" -> "Master".
  const cleaned = raw
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!cleaned) return null;
  const exact = NAME_TO_KEY.get(cleaned);
  if (exact) return exact;
  if (allowAliases) {
    const alias = LEGACY_ALIASES.get(cleaned);
    if (alias) return alias;
  }
  return null;
}

/**
 * Identify the persona that authored a comment body.
 *
 * @param {string|undefined|null} body - the full comment body
 * @param {object} [opts]
 * @param {'strict'|'lenient'} [opts.mode='strict'] - see the module header.
 *   'strict' for any gate/routing decision; 'lenient' only to backfill history.
 * @returns {string|null} agent handle (e.g. 'master-agent'), or null when the
 *   body carries no recognized persona header.
 */
function identifyPersona(body, opts = {}) {
  if (typeof body !== 'string' || body.trim() === '') return null;
  const lenient = opts.mode === 'lenient';

  // Only the first few lines count: a signature sits at the top of a comment.
  // Scanning the whole body is what let a mere MENTION of a persona satisfy the
  // old gate.
  const lines = stripFencedBlocks(body)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .slice(0, 4);

  for (const line of lines) {
    const canonical = CANONICAL_RE.exec(line);
    if (canonical) {
      const key = resolveName(canonical[1], false);
      if (key) return key;
      // A bold-emoji header naming someone we don't know is a protocol error,
      // not an invitation to keep looking further down the comment.
      return null;
    }
    if (lenient) {
      const noEmoji = NO_EMOJI_RE.exec(line);
      if (noEmoji) {
        const key = resolveName(noEmoji[1], false);
        if (key) return key;
      }
      const heading = REVIEW_HEADING_RE.exec(line);
      if (heading) {
        const key = resolveName(heading[1], true);
        if (key) return key;
      }
    }
  }
  return null;
}

/**
 * Is this body signed by a specific agent, under the strict canonical form?
 * @param {string|undefined|null} body
 * @param {string} agentKey - e.g. 'master-agent'
 * @returns {boolean}
 */
function isSignedBy(body, agentKey) {
  return identifyPersona(body, { mode: 'strict' }) === agentKey;
}

/**
 * Build a canonical header line. The single place the format is WRITTEN, so
 * writers and readers cannot disagree.
 * @param {string} agentKey
 * @param {string} [subject]
 * @returns {string}
 */
function formatHeader(agentKey, subject) {
  const def = AGENTS[agentKey];
  if (!def) throw new Error(`Unknown agent key: ${agentKey}`);
  const head = `**${def.emoji} ${def.name}**`;
  return subject ? `${head} — ${subject}` : head;
}

/** Map an agent handle to the short key the contribution graph uses. */
function graphKeyFor(agentKey) {
  return AGENTS[agentKey] ? AGENTS[agentKey].graphKey : null;
}

/**
 * Replay every fixture case in both modes. Shared with the Python mirror.
 * @returns {{ passed: number, failures: string[] }}
 */
function selfCheck() {
  const failures = [];
  let passed = 0;
  for (const c of FIXTURES.cases) {
    for (const mode of ['strict', 'lenient']) {
      const expected = c[mode] === undefined ? null : c[mode];
      const actual = identifyPersona(c.header, { mode });
      if (actual !== expected) {
        failures.push(
          `[${mode}] ${c.name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
        );
      } else {
        passed += 1;
      }
    }
  }
  return { passed, failures };
}

// CLI: `--selfcheck` replays the fixture; otherwise identify a body.
if (require.main === module) {
  if (process.argv.includes('--selfcheck')) {
    const { passed, failures } = selfCheck();
    if (failures.length) {
      console.error(`persona-format selfcheck FAILED (${failures.length}):`);
      failures.forEach((f) => console.error('  ' + f));
      process.exit(1);
    }
    console.log(`persona-format selfcheck OK — ${passed} assertions`);
    process.exit(0);
  }
  const body = process.argv[2];
  if (!body) {
    console.error('Usage: node persona-format.js [--selfcheck] "<comment body>"');
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        strict: identifyPersona(body, { mode: 'strict' }),
        lenient: identifyPersona(body, { mode: 'lenient' }),
      },
      null,
      2
    )
  );
}

module.exports = {
  AGENTS,
  AGENT_KEYS,
  CANONICAL_FORM,
  CANONICAL_RE,
  LEGACY_ALIASES,
  FIXTURE_PATH,
  identifyPersona,
  isSignedBy,
  formatHeader,
  graphKeyFor,
  selfCheck,
};
