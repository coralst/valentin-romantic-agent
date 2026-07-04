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
 * Detect whether a body of text contains the master-agent approval token.
 * @param {string} body - a PR comment or review body
 * @returns {boolean}
 */
function hasApprovalToken(body) {
  if (typeof body !== 'string') return false;
  return body.includes(APPROVAL_TOKEN);
}

/**
 * Determine whether an approval comment came from the master-agent.
 * The master-agent signs comments with the "Master Agent" persona. We accept
 * either the persona signature or an explicit authorIsMasterAgent flag.
 * @param {object} comment - { body, authorLogin, isMasterAgent }
 * @param {string} [ownerLogin] - the single account login (author of all comments)
 * @returns {boolean}
 */
function isMasterApprovalComment(comment, ownerLogin) {
  if (!comment || !hasApprovalToken(comment.body)) return false;
  // In a single-account repo the author login is always the owner, so we
  // identify the master-agent by its persona signature in the body, or an
  // explicit flag set by the caller.
  if (comment.isMasterAgent === true) return true;
  if (typeof comment.body === 'string' && /master agent/i.test(comment.body)) {
    return true;
  }
  // Fallback: if an ownerLogin is provided and matches, the token alone is
  // sufficient (only the master-agent is instructed to post it).
  if (ownerLogin && comment.authorLogin === ownerLogin) return true;
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
 * @param {string} [state.ownerLogin] - the single account login
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
  const approved = comments.some((c) => isMasterApprovalComment(c, s.ownerLogin));
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
  isMasterApprovalComment,
  evaluateMergeGate,
  isForbiddenSelfApproval,
  buildApprovalComment,
};
