#!/usr/bin/env node

/**
 * Approval Gate Skill - Decides whether a PR may be merged in a single-account repo.
 *
 * GitHub blocks a PR author from submitting a formal APPROVE review on their own
 * PR (422 "Can not approve your own pull request"). Because every agent here acts
 * under the same account, "approval" is expressed as an approval COMMENT from the
 * master-agent carrying the token `APPROVED-BY-MASTER-AGENT`, not GitHub's formal
 * approve event.
 *
 * This module is pure and deterministic so it can be unit-tested without network
 * access. The actual GitHub reads/merges are performed by the caller (the
 * master-agent via the GitHub tools) using the decision this module returns.
 */

const APPROVAL_TOKEN = 'APPROVED-BY-MASTER-AGENT';

/**
 * The master-agent persona signature that must accompany the approval token.
 * The master-agent signs every review with the 👔 persona header (see the
 * approval-comment format in git-workflow.md). Requiring this marker prevents a
 * sub-agent — or a quoted/echoed token in some other comment — from satisfying
 * the gate simply by containing the token string.
 */
const MASTER_PERSONA = /👔\s*master\s*agent/i;

/**
 * Detect whether a body of text contains the master-agent approval token.
 * @param {string} body - a PR comment or review body
 * @returns {boolean}
 */
function hasApprovalToken(body) {
  if (typeof body !== 'string') return false;
  return body.includes(APPROVAL_TOKEN);
}

/**
 * Heuristic: does this login look like a bot / third-party reviewer (e.g. the
 * Cubic GitHub App) rather than one of our own agents? Such authors must NEVER
 * be able to open the merge gate, even if their comment quotes the token.
 * @param {string} [authorLogin]
 * @returns {boolean}
 */
function isBotAuthor(authorLogin) {
  if (typeof authorLogin !== 'string' || authorLogin === '') return false;
  const login = authorLogin.toLowerCase();
  return login.endsWith('[bot]') || login.includes('cubic');
}

/**
 * Determine whether an approval comment came from the master-agent.
 *
 * In a single-account repo the author login CANNOT distinguish the master-agent
 * from a sub-agent (everything is authored by the repo owner). So token presence
 * alone — or "authored by the owner" — is NOT sufficient: that would let any
 * sub-agent comment, or a Cubic comment quoting the token, open the gate.
 *
 * We therefore require the approval token AND one of:
 *   - an explicit, caller-verified `isMasterAgent` flag, or
 *   - the master-agent persona signature (👔 Master Agent) in the body.
 * A recognized bot/third-party author is rejected outright.
 *
 * @param {object} comment - { body, authorLogin, isMasterAgent }
 * @returns {boolean}
 */
function isMasterApprovalComment(comment) {
  if (!comment || !hasApprovalToken(comment.body)) return false;
  // Explicit, caller-verified master-agent authorship is the strongest signal.
  if (comment.isMasterAgent === true) return true;
  // A third-party reviewer (Cubic, other bots) can never approve, even if it
  // quotes the token in a summary comment. Checked before the persona heuristic
  // so a bot cannot spoof the persona string either.
  if (isBotAuthor(comment.authorLogin)) return false;
  // Otherwise require the master-agent persona signature in the body.
  if (typeof comment.body === 'string' && MASTER_PERSONA.test(comment.body)) {
    return true;
  }
  return false;
}

/**
 * Core decision: is this PR mergeable?
 *
 * @param {object} state
 * @param {string} state.ciStatus - GitHub combined status: 'success'|'pending'|'failure'|'error'
 * @param {boolean} state.prOpen - whether the PR is still open
 * @param {number} state.blockingIssues - count of unresolved ❌ blocking issues
 * @param {boolean} state.qaSignedOff - QA sign-off (only required when isUserFacing)
 * @param {boolean} state.isUserFacing - whether the change is user-facing
 * @param {Array<object>} state.comments - PR comments [{ body, authorLogin, isMasterAgent }]
 * @returns {{ mergeable: boolean, reasons: string[] }}
 */
function evaluateMergeGate(state) {
  const reasons = [];
  const s = state || {};

  if (!s.prOpen) {
    reasons.push('PR is not open (already merged or closed).');
  }
  if (s.ciStatus !== 'success') {
    reasons.push(`CI is not green (status: ${s.ciStatus ?? 'unknown'}).`);
  }
  if ((s.blockingIssues ?? 0) > 0) {
    reasons.push(`${s.blockingIssues} unresolved blocking issue(s) remain.`);
  }
  if (s.isUserFacing && s.qaSignedOff !== true) {
    reasons.push('User-facing change requires QA sign-off.');
  }

  const comments = Array.isArray(s.comments) ? s.comments : [];
  const approved = comments.some((c) => isMasterApprovalComment(c));
  if (!approved) {
    reasons.push(
      `No master-agent approval comment found (missing ${APPROVAL_TOKEN} token).`
    );
  }

  return { mergeable: reasons.length === 0, reasons };
}

/**
 * Guard against the illegal operation. Returns true if the requested review
 * event is forbidden on your own PR in a single-account repo.
 * @param {string} reviewEvent - 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES'
 * @param {boolean} authorIsCurrentUser - is the PR author the same account?
 * @returns {boolean}
 */
function isForbiddenSelfApproval(reviewEvent, authorIsCurrentUser) {
  return authorIsCurrentUser === true && reviewEvent === 'APPROVE';
}

/**
 * Build the master-agent approval comment body.
 * @param {object} opts - { ciGreen, blockingResolved, qaSignedOff }
 * @returns {string}
 */
function buildApprovalComment(opts = {}) {
  const ci = opts.ciGreen ? '✅ CI green' : '⚠️ CI not confirmed green';
  const blocking = opts.blockingResolved
    ? '✅ All ❌ blocking issues resolved'
    : '⚠️ Blocking issues outstanding';
  const qa = opts.qaSignedOff
    ? '✅ QA signed off (for user-facing changes)'
    : '➖ QA sign-off not required';
  return [
    '**👔 Master Agent** — Review Complete',
    '',
    ci,
    blocking,
    qa,
    '',
    `${APPROVAL_TOKEN} 🟢 — merging.`,
  ].join('\n');
}

// CLI usage: pass a JSON state object, prints the decision.
if (require.main === module) {
  const raw = process.argv[2];
  if (!raw) {
    console.error('Usage: node approval-gate-skill.js \'{"ciStatus":"success",...}\'');
    process.exit(1);
  }
  try {
    const decision = evaluateMergeGate(JSON.parse(raw));
    console.log(JSON.stringify(decision, null, 2));
    process.exit(decision.mergeable ? 0 : 1);
  } catch (err) {
    console.error('Invalid JSON state:', err.message);
    process.exit(2);
  }
}

module.exports = {
  APPROVAL_TOKEN,
  hasApprovalToken,
  isBotAuthor,
  isMasterApprovalComment,
  evaluateMergeGate,
  isForbiddenSelfApproval,
  buildApprovalComment,
};
