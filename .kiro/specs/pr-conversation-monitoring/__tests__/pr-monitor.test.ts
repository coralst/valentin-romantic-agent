/**
 * PR Monitor Skill Tests — detection logic & concurrency-safe file keying
 *
 * Covers the workflow-review fixes:
 *   #4 Stop condition must recognize the master-agent approval COMMENT token,
 *      not only a formal GitHub APPROVE (which never happens on your own PR).
 *   #8 Marker/state/signal files must be keyed per-PR so concurrent monitors
 *      don't clobber one another.
 *   #1 New-feedback detection is real (drives the signal the handler consumes).
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error - JS skill module without type declarations
import monitor from '../../../skills/pr-monitoring/pr-monitor-skill.js';
// @ts-expect-error - JS skill module without type declarations
import gate from '../../../skills/pr-monitoring/approval-gate-skill.js';

const { hasNewFeedback, isApproved, latestTimestamp, markerFile, stateFile, signalFile, logFile, cleanup } =
  monitor;
const { buildApprovalComment } = gate;
import * as fs from 'fs';

describe('per-PR file keying (concurrency safety)', () => {
  it('produces distinct marker/state/signal paths per PR number', () => {
    expect(markerFile(42)).not.toBe(markerFile(43));
    expect(stateFile(42)).toContain('42');
    expect(signalFile(43)).toContain('43');
    // marker/state/signal for the same PR are distinct files
    const set = new Set([markerFile(42), stateFile(42), signalFile(42)]);
    expect(set.size).toBe(3);
  });

  it('exposes a per-PR log path keyed by PR number', () => {
    expect(logFile(42)).toContain('42');
    expect(logFile(42)).not.toBe(logFile(43));
  });
});

describe('cleanup removes ALL per-PR files including the log', () => {
  it('deletes marker/state/signal/log so no residue is left behind', () => {
    const pr = 987654;
    const files = [markerFile(pr), stateFile(pr), signalFile(pr), logFile(pr)];
    for (const f of files) fs.writeFileSync(f, 'x');
    cleanup(pr);
    for (const f of files) {
      expect(fs.existsSync(f), `${f} should be removed by cleanup`).toBe(false);
    }
  });
});

describe('hasNewFeedback', () => {
  it('is true when there are items and no prior watermark', () => {
    expect(hasNewFeedback([{ submittedAt: '2026-07-04T10:00:00Z' }], null)).toBe(true);
  });

  it('is false when no items exist', () => {
    expect(hasNewFeedback([], null)).toBe(false);
    expect(hasNewFeedback(undefined, null)).toBe(false);
  });

  it('is true only for items newer than the watermark', () => {
    const items = [
      { submittedAt: '2026-07-04T10:00:00Z' },
      { createdAt: '2026-07-04T12:00:00Z' },
    ];
    expect(hasNewFeedback(items, '2026-07-04T11:00:00Z')).toBe(true);
    expect(hasNewFeedback(items, '2026-07-04T13:00:00Z')).toBe(false);
  });
});

describe('isApproved — approval-comment aware (Req: #4)', () => {
  it('recognizes a master-agent approval COMMENT token as approval', () => {
    const comments = [
      {
        body: buildApprovalComment({ ciGreen: true, blockingResolved: true, qaSignedOff: true }),
        author: { login: 'coralst' },
      },
    ];
    expect(isApproved([], comments)).toBe(true);
  });

  it('does NOT treat a plain comment as approval', () => {
    const comments = [{ body: 'looks good, merging soon', author: { login: 'coralst' } }];
    expect(isApproved([], comments)).toBe(false);
  });

  it('does NOT treat a Cubic comment quoting the token as approval', () => {
    const comments = [
      {
        body: 'Cubic: master will add APPROVED-BY-MASTER-AGENT later',
        author: { login: 'cubic-dev-ai[bot]' },
      },
    ];
    expect(isApproved([], comments)).toBe(false);
  });

  it('still honors a genuine formal APPROVE review (forward-compat)', () => {
    expect(isApproved([{ state: 'APPROVED' }], [])).toBe(true);
  });
});

describe('latestTimestamp', () => {
  it('returns the most recent timestamp across mixed fields', () => {
    const items = [
      { submittedAt: '2026-07-04T10:00:00Z' },
      { createdAt: '2026-07-04T15:00:00Z' },
      { submittedAt: '2026-07-04T12:00:00Z' },
    ];
    expect(latestTimestamp(items)).toBe('2026-07-04T15:00:00Z');
  });
});
