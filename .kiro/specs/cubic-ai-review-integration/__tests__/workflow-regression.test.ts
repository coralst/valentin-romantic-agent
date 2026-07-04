/**
 * Workflow Automation Regression Suite — Unit Tier (Req 11, 12)
 *
 * This is the durable guardrail: it runs whenever a PR touches workflow-automation
 * content (see .github/workflows/workflow-automation-regression.yml) and asserts that
 * the two things that MUST never silently break still work:
 *   1. The multi-agent PR conversation/comment flow (parse + route findings).
 *   2. The merge gate (APPROVED-BY-MASTER-AGENT token + CI + blocking + QA).
 *
 * Deterministic, no network, no credentials. The live GitHub edge-case assertions
 * live in the self-cleaning integration tier (workflow-selftest-live.mjs).
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error - JS skill module without type declarations
import gate from '../../../skills/pr-monitoring/approval-gate-skill.js';
// @ts-expect-error - JS skill module without type declarations
import parser from '../../../skills/pr-monitoring/review-parser-skill.js';
// @ts-expect-error - JS skill module without type declarations
import formatter from '../../../skills/pr-monitoring/response-formatter-skill.js';

const {
  APPROVAL_TOKEN,
  evaluateMergeGate,
  isForbiddenSelfApproval,
  buildApprovalComment,
} = gate;

const {
  parseReview,
  classifyAuthor,
  attributeOwner,
  CUBIC_AUTHOR,
} = parser;

const { formatResponse } = formatter;

const approvedComment = () => ({
  body: buildApprovalComment({ ciGreen: true, blockingResolved: true, qaSignedOff: true }),
  authorLogin: 'coralst',
  isMasterAgent: true,
});

const greenState = () => ({
  ciStatus: 'success',
  prOpen: true,
  blockingIssues: 0,
  qaSignedOff: true,
  isUserFacing: true,
  ownerLogin: 'coralst',
  comments: [approvedComment()],
});

// ─────────────────────────────────────────────────────────────────────────────
// MERGE GATE INVARIANTS (Req 12.4–12.9)
// ─────────────────────────────────────────────────────────────────────────────
describe('merge gate must not break', () => {
  it('opens only when token + CI green + no blockers + QA signed off', () => {
    expect(evaluateMergeGate(greenState()).mergeable).toBe(true);
  });

  it('stays CLOSED when the approval token is absent', () => {
    const d = evaluateMergeGate({ ...greenState(), comments: [] });
    expect(d.mergeable).toBe(false);
    expect(d.reasons.join(' ')).toContain(APPROVAL_TOKEN);
  });

  it('stays CLOSED when CI is not green', () => {
    expect(evaluateMergeGate({ ...greenState(), ciStatus: 'pending' }).mergeable).toBe(false);
    expect(evaluateMergeGate({ ...greenState(), ciStatus: 'failure' }).mergeable).toBe(false);
  });

  it('stays CLOSED when blocking issues remain (incl. unresolved Cubic ❌)', () => {
    expect(evaluateMergeGate({ ...greenState(), blockingIssues: 1 }).mergeable).toBe(false);
  });

  it('stays CLOSED for a user-facing change without QA sign-off', () => {
    expect(evaluateMergeGate({ ...greenState(), qaSignedOff: false }).mergeable).toBe(false);
  });

  it('stays CLOSED when the PR is already closed/merged', () => {
    expect(evaluateMergeGate({ ...greenState(), prOpen: false }).mergeable).toBe(false);
  });

  it('never permits a formal self-APPROVE (GitHub 422 path)', () => {
    expect(isForbiddenSelfApproval('APPROVE', true)).toBe(true);
    expect(isForbiddenSelfApproval('COMMENT', true)).toBe(false);
    expect(isForbiddenSelfApproval('REQUEST_CHANGES', true)).toBe(false);
  });

  it('does not treat a Cubic summary/approve comment as the approval token', () => {
    const cubicComment = {
      body: '## Cubic Review\n\n✅ Looks good to me, no blocking issues.',
      authorLogin: CUBIC_AUTHOR,
      isMasterAgent: false,
    };
    const d = evaluateMergeGate({ ...greenState(), comments: [cubicComment] });
    expect(d.mergeable).toBe(false); // no master-agent token present
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSATION / COMMENT FLOW (Req 12.3, 12.8, 12.10)
// ─────────────────────────────────────────────────────────────────────────────
describe('multi-agent conversation flow must not break', () => {
  it('parses ❌/⚠️/✅ severity from a review body', () => {
    const body = [
      '❌ SQL injection risk in query builder',
      '⚠️ Consider memoizing this selector',
      '✅ Good test coverage',
      'Some general note',
    ].join('\n');
    const parsed = parseReview(body);
    expect(parsed.blocking).toHaveLength(1);
    expect(parsed.suggestions).toHaveLength(1);
    expect(parsed.positive).toHaveLength(1);
    expect(parsed.general).toHaveLength(1);
  });

  it('recognizes the Cubic author for routing (Req 4.1)', () => {
    expect(classifyAuthor(CUBIC_AUTHOR)).toBe('cubic');
    expect(classifyAuthor('cubic-dev-ai[bot]')).toBe('cubic');
    expect(classifyAuthor('coralst', { masterAgentLogin: 'coralst' })).toBe('master-agent');
  });

  it('ignores an unrecognized comment author without crashing (Req 12.10)', () => {
    expect(classifyAuthor('random-user')).toBe('unknown');
    expect(classifyAuthor(undefined)).toBe('unknown');
    expect(classifyAuthor('')).toBe('unknown');
  });

  it('attributes a finding file to the owning agent', () => {
    expect(attributeOwner('src/client/design-system/tokens.ts')).toBe('ui-designer');
    expect(attributeOwner('src/server/agent/bedrock-client.ts')).toBe('backend-dev');
    expect(attributeOwner('src/shared/interfaces/message.ts')).toBe('system-architect');
    expect(attributeOwner('e2e/tests/onboarding.spec.ts')).toBe('qa-agent');
  });

  it('routes a non-attributable finding to the master-agent (Req 4.5 / 12.8)', () => {
    // null owner => caller routes to master-agent for triage
    expect(attributeOwner('README.md')).toBeNull();
    expect(attributeOwner(undefined)).toBeNull();
  });

  it('formats an agent response as a valid GitHub comment', () => {
    const out = formatResponse('backend-dev', 'Fixed the injection by parameterizing.', {
      fixesApplied: true,
      commitCount: 2,
    });
    expect(out).toContain('🔧');
    expect(out).toContain('Backend Dev');
    expect(out.toLowerCase()).toContain('ready for re-review');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GITHUB EDGE-CASE INVARIANTS encoded as pure assertions (Req 12.9, 13.*)
// (the live tier asserts these against the real API; here we lock the intent)
// ─────────────────────────────────────────────────────────────────────────────
describe('github edge-case intent is encoded', () => {
  it('approval comment builder embeds the token the gate keys off', () => {
    const body = buildApprovalComment({ ciGreen: true, blockingResolved: true, qaSignedOff: true });
    expect(body).toContain(APPROVAL_TOKEN);
  });
});
