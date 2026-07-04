/**
 * Approval Gate Tests — Single-Account Merge Approval
 *
 * Proves the fix for the merge-stall bug: in a single-account repo, GitHub blocks
 * a PR author from formally approving their own PR. Approval is instead expressed
 * as a master-agent comment carrying the `APPROVED-BY-MASTER-AGENT` token, and the
 * merge gate keys off that token — not GitHub's formal approval state.
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error - JS skill module without type declarations
import gate from '../../../skills/pr-monitoring/approval-gate-skill.js';

const {
  APPROVAL_TOKEN,
  hasApprovalToken,
  isMasterApprovalComment,
  evaluateMergeGate,
  isForbiddenSelfApproval,
  buildApprovalComment,
} = gate;

const greenState = () => ({
  ciStatus: 'success',
  prOpen: true,
  blockingIssues: 0,
  qaSignedOff: true,
  isUserFacing: true,
  ownerLogin: 'coralst',
  comments: [
    { body: buildApprovalComment({ ciGreen: true, blockingResolved: true, qaSignedOff: true }), authorLogin: 'coralst', isMasterAgent: true },
  ],
});

describe('token detection', () => {
  it('detects the approval token in a body', () => {
    expect(hasApprovalToken(`stuff ${APPROVAL_TOKEN} more`)).toBe(true);
  });

  it('returns false when token absent', () => {
    expect(hasApprovalToken('looks good, merging')).toBe(false);
  });

  it('returns false for non-string input', () => {
    expect(hasApprovalToken(undefined)).toBe(false);
    expect(hasApprovalToken(null)).toBe(false);
  });
});

describe('master-agent approval comment identification', () => {
  it('accepts a comment with token + master agent persona', () => {
    const c = { body: `**👔 Master Agent** — done\n${APPROVAL_TOKEN}` };
    expect(isMasterApprovalComment(c)).toBe(true);
  });

  it('accepts a comment with token + explicit flag', () => {
    const c = { body: APPROVAL_TOKEN, isMasterAgent: true };
    expect(isMasterApprovalComment(c)).toBe(true);
  });

  it('rejects a comment without the token even from master agent', () => {
    const c = { body: '**👔 Master Agent** — looks great', isMasterAgent: true };
    expect(isMasterApprovalComment(c)).toBe(false);
  });
});

describe('forbidden self-approval guard', () => {
  it('flags a formal APPROVE on your own PR as forbidden', () => {
    expect(isForbiddenSelfApproval('APPROVE', true)).toBe(true);
  });

  it('allows a COMMENT review on your own PR', () => {
    expect(isForbiddenSelfApproval('COMMENT', true)).toBe(false);
  });

  it('allows APPROVE when the author is a different account', () => {
    expect(isForbiddenSelfApproval('APPROVE', false)).toBe(false);
  });
});

describe('merge gate decision', () => {
  it('is mergeable when CI green, no blockers, QA signed off, and approval comment present', () => {
    const decision = evaluateMergeGate(greenState());
    expect(decision.mergeable).toBe(true);
    expect(decision.reasons).toHaveLength(0);
  });

  it('is NOT mergeable when the approval comment is missing (the original stall)', () => {
    const state = { ...greenState(), comments: [] };
    const decision = evaluateMergeGate(state);
    expect(decision.mergeable).toBe(false);
    expect(decision.reasons.join(' ')).toContain(APPROVAL_TOKEN);
  });

  it('is NOT mergeable when CI is not green', () => {
    const decision = evaluateMergeGate({ ...greenState(), ciStatus: 'failure' });
    expect(decision.mergeable).toBe(false);
    expect(decision.reasons.join(' ').toLowerCase()).toContain('ci');
  });

  it('is NOT mergeable when blocking issues remain', () => {
    const decision = evaluateMergeGate({ ...greenState(), blockingIssues: 2 });
    expect(decision.mergeable).toBe(false);
    expect(decision.reasons.join(' ')).toContain('blocking');
  });

  it('is NOT mergeable when a user-facing change lacks QA sign-off', () => {
    const decision = evaluateMergeGate({ ...greenState(), qaSignedOff: false });
    expect(decision.mergeable).toBe(false);
    expect(decision.reasons.join(' ')).toContain('QA');
  });

  it('does NOT require QA sign-off for non-user-facing changes', () => {
    const decision = evaluateMergeGate({ ...greenState(), isUserFacing: false, qaSignedOff: false });
    expect(decision.mergeable).toBe(true);
  });

  it('is NOT mergeable when the PR is already closed', () => {
    const decision = evaluateMergeGate({ ...greenState(), prOpen: false });
    expect(decision.mergeable).toBe(false);
  });
});

describe('approval comment builder', () => {
  it('embeds the token so the gate recognizes its own output', () => {
    const body = buildApprovalComment({ ciGreen: true, blockingResolved: true, qaSignedOff: true });
    expect(hasApprovalToken(body)).toBe(true);
    expect(isMasterApprovalComment({ body })).toBe(true);
  });
});
