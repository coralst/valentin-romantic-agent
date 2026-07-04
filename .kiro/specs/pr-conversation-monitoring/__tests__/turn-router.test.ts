/**
 * Turn Router Tests — deterministic orchestrator-led routing.
 *
 * Validates the determinism layer that makes the control-flow hand-offs reliable
 * without depending on GitHub events:
 *   - multi-agent tagging (master can tag 2+ agents → fan-out)
 *   - stall detection (a non-terminal comment that tags nobody is invalid)
 *   - terminal recognition (master approval comment ends the loop)
 *   - merge backstop (master has the last word, no one left hanging, CI green)
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error - JS skill module without type declarations
import router from '../../../skills/pr-monitoring/turn-router-skill.js';
// @ts-expect-error - JS skill module without type declarations
import gate from '../../../skills/pr-monitoring/approval-gate-skill.js';

const {
  extractMentions,
  identifyAuthorPersona,
  parseTurn,
  lastWordIsMaster,
  allTaggedResponded,
  evaluateConversationGate,
} = router;
const { buildApprovalComment } = gate;

const masterReview = (mentions: string) =>
  `**👔 Master Agent** — Code Review\n\nLooks close.\n\n❌ Fix validation.\n${mentions}`;

describe('extractMentions', () => {
  it('extracts known agent handles, de-duplicated and order-preserved', () => {
    const { mentions, unknown } = extractMentions('ping @backend-dev and @qa-agent and @backend-dev again');
    expect(mentions).toEqual(['backend-dev', 'qa-agent']);
    expect(unknown).toEqual([]);
  });

  it('reports unknown handles instead of dropping them', () => {
    const { mentions, unknown } = extractMentions('@frontend-dev @nobody-here');
    expect(mentions).toEqual(['frontend-dev']);
    expect(unknown).toEqual(['nobody-here']);
  });
});

describe('identifyAuthorPersona', () => {
  it('recognizes each persona header', () => {
    expect(identifyAuthorPersona('**👔 Master Agent** — hi')).toBe('master-agent');
    expect(identifyAuthorPersona('**🔧 Backend Dev** — hi')).toBe('backend-dev');
    expect(identifyAuthorPersona('**🧪 QA Agent** — hi')).toBe('qa-agent');
  });

  it('returns null when there is no persona header', () => {
    expect(identifyAuthorPersona('just a plain note')).toBeNull();
  });
});

describe('parseTurn — multi-agent tagging', () => {
  it('routes to TWO agents when the master tags both', () => {
    const t = parseTurn({ body: masterReview('@backend-dev @qa-agent — please address.') });
    expect(t.author).toBe('master-agent');
    expect(t.nextActors).toEqual(['backend-dev', 'qa-agent']);
    expect(t.valid).toBe(true);
    expect(t.terminal).toBe(false);
  });

  it('drops a self-mention from nextActors', () => {
    const t = parseTurn({ body: '**🔧 Backend Dev** — done, over to @master-agent (not @backend-dev)' });
    expect(t.author).toBe('backend-dev');
    expect(t.nextActors).toEqual(['master-agent']);
  });

  it('flags a stall: non-terminal comment tagging nobody', () => {
    const t = parseTurn({ body: '**🔧 Backend Dev** — pushed a fix.' });
    expect(t.valid).toBe(false);
    expect(t.problems.join(' ')).toMatch(/stall/i);
  });

  it('flags unknown mentions', () => {
    const t = parseTurn({ body: masterReview('@backend-dev @designer') });
    expect(t.unknownMentions).toEqual(['designer']);
    expect(t.valid).toBe(false);
  });

  it('recognizes a terminal master approval comment (no tag required)', () => {
    const t = parseTurn({ body: buildApprovalComment({ ciGreen: true, blockingResolved: true, qaSignedOff: true }), authorLogin: 'coralst' });
    expect(t.isMaster).toBe(true);
    expect(t.isApproval).toBe(true);
    expect(t.terminal).toBe(true);
    expect(t.valid).toBe(true);
    expect(t.nextActors).toEqual([]);
  });
});

describe('lastWordIsMaster', () => {
  it('is true when the final comment is the master', () => {
    const comments = [
      { body: '**🔧 Backend Dev** — done, @master-agent' },
      { body: buildApprovalComment({ ciGreen: true, blockingResolved: true, qaSignedOff: true }) },
    ];
    expect(lastWordIsMaster(comments)).toBe(true);
  });

  it('is false when a sub-agent has the last word', () => {
    const comments = [
      { body: '**👔 Master Agent** — @backend-dev please fix' },
      { body: '**🔧 Backend Dev** — fixed, @master-agent' },
    ];
    expect(lastWordIsMaster(comments)).toBe(false);
  });
});

describe('allTaggedResponded', () => {
  it('ok when every tagged agent later replies', () => {
    const comments = [
      { body: '**👔 Master Agent** — @backend-dev @qa-agent go' },
      { body: '**🔧 Backend Dev** — done @master-agent' },
      { body: '**🧪 QA Agent** — signed off @master-agent' },
    ];
    expect(allTaggedResponded(comments)).toEqual({ ok: true, awaiting: [] });
  });

  it('reports agents left hanging', () => {
    const comments = [
      { body: '**👔 Master Agent** — @backend-dev @qa-agent go' },
      { body: '**🔧 Backend Dev** — done @master-agent' },
    ];
    const r = allTaggedResponded(comments);
    expect(r.ok).toBe(false);
    expect(r.awaiting).toEqual(['qa-agent']);
  });
});

describe('evaluateConversationGate (merge backstop)', () => {
  const goodThread = () => [
    { body: '**👔 Master Agent** — @backend-dev fix validation' },
    { body: '**🔧 Backend Dev** — fixed in abc1234 @master-agent' },
    { body: buildApprovalComment({ ciGreen: true, blockingResolved: true, qaSignedOff: true }), authorLogin: 'coralst' },
  ];

  it('is mergeable when master closes last, nobody hanging, CI green', () => {
    const d = evaluateConversationGate({ comments: goodThread(), ciGreen: true, blockingIssues: 0 });
    expect(d.mergeable).toBe(true);
  });

  it('blocks when a sub-agent has the last word', () => {
    const comments = goodThread().slice(0, 2);
    const d = evaluateConversationGate({ comments, ciGreen: true, blockingIssues: 0 });
    expect(d.mergeable).toBe(false);
    expect(d.reasons.join(' ')).toMatch(/last comment is not the master/i);
  });

  it('blocks when CI is not green', () => {
    const d = evaluateConversationGate({ comments: goodThread(), ciGreen: false, blockingIssues: 0 });
    expect(d.mergeable).toBe(false);
  });

  it('blocks when a tagged agent never replied', () => {
    const comments = [
      { body: '**👔 Master Agent** — @backend-dev @qa-agent go' },
      { body: '**🔧 Backend Dev** — done @master-agent' },
      { body: buildApprovalComment({ ciGreen: true, blockingResolved: true, qaSignedOff: true }), authorLogin: 'coralst' },
    ];
    const d = evaluateConversationGate({ comments, ciGreen: true, blockingIssues: 0 });
    expect(d.mergeable).toBe(false);
    expect(d.reasons.join(' ')).toMatch(/qa-agent/);
  });
});
