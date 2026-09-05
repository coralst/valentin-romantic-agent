/**
 * Case shape and the checker that runs one.
 *
 * Expectations are machine-checkable by construction: a case says which tool must
 * have been called and asserts over the *recorded arguments*, never over the
 * model's prose alone. Prose assertions exist, but only as `replyRejects` — the
 * claims that are wrong no matter how they are phrased.
 *
 * `UNPROVEN` is a first-class outcome. A case that could not run because a
 * provider was down or a credential was missing is not a pass, and reporting it as
 * one is the specific dishonesty `scripts/prove-integrations.mts` was written to
 * avoid.
 */
import type { KnownFact } from '../../src/server/agent/prompts';
import type { RecordedCall } from './recording-registry';
import type { TurnOutcome } from './live-agent';

export type Status = 'PASS' | 'FAIL' | 'UNPROVEN';

export interface CaseContext {
  /** The instant the case claimed it was, in Asia/Jerusalem wall clock. */
  readonly nowLocalDate: string;
  readonly now: Date;
}

export interface Expectation {
  /** At least one of these tools must have been called. */
  readonly calledTool?: readonly string[];
  /** None of these may have been called. */
  readonly neverCalled?: readonly string[];
  /** Assert over the recorded arguments. Return true, or a string explaining the failure. */
  readonly args?: (calls: readonly RecordedCall[], ctx: CaseContext) => true | string;
  /** The reply must match each of these. */
  readonly replyMatches?: readonly RegExp[];
  /** The reply must match none of these. */
  readonly replyRejects?: readonly RegExp[];
  /** Ceiling on wall-clock time for the whole case. */
  readonly maxMs?: number;
  /** An independent check against reality. */
  readonly oracle?: (outcome: TurnOutcome, ctx: CaseContext) => Promise<true | string>;
}

export interface EvalCase {
  readonly id: string;
  readonly group: string;
  readonly severity: 'high' | 'medium' | 'low';
  /** Why this case exists — copied into the report so a finding explains itself. */
  readonly why: string;
  readonly turns: readonly string[];
  readonly facts?: readonly KnownFact[];
  /** Choose the instant, relative to real now. Kept within ±36h — see live-agent. */
  readonly at?: (real: Date) => Date;
  readonly expect: Expectation;
}

export interface Finding {
  readonly id: string;
  readonly group: string;
  readonly severity: string;
  readonly status: Status;
  readonly why: string;
  readonly detail: string;
  readonly reply: string;
  readonly calls: readonly RecordedCall[];
  readonly ms: number;
}

/** The standing claims that are false unless a confirm actually went through. */
export const CLAIMED_DONE =
  /\b(?:is booked|are booked|have booked|has been booked|is reserved|table is held|i(?:'ve| have) sent|has been sent|saved to (?:your|her) library|added to your calendar|is on your calendar|playlist is (?:created|saved|ready in))\b/i;

/** Check one already-run outcome against its expectations. */
export async function check(
  testCase: EvalCase,
  outcome: TurnOutcome,
  ctx: CaseContext,
): Promise<{ status: Status; detail: string }> {
  const problems: string[] = [];
  const names = outcome.calls.map((call) => call.name);

  if (testCase.expect.calledTool) {
    const hit = testCase.expect.calledTool.some((name) => names.includes(name));
    if (!hit) {
      problems.push(
        `expected one of [${testCase.expect.calledTool.join(', ')}] to be called; called [${
          names.join(', ') || 'nothing'
        }]`,
      );
    }
  }

  for (const name of testCase.expect.neverCalled ?? []) {
    if (names.includes(name)) problems.push(`${name} must not have been called`);
  }

  if (testCase.expect.args) {
    const verdict = testCase.expect.args(outcome.calls, ctx);
    if (verdict !== true) problems.push(verdict);
  }

  for (const pattern of testCase.expect.replyMatches ?? []) {
    if (!pattern.test(outcome.reply)) problems.push(`reply does not match ${pattern}`);
  }

  for (const pattern of testCase.expect.replyRejects ?? []) {
    const match = pattern.exec(outcome.reply);
    if (match) problems.push(`reply contains "${match[0]}" (matched ${pattern})`);
  }

  if (testCase.expect.maxMs && outcome.ms > testCase.expect.maxMs) {
    problems.push(`took ${outcome.ms}ms, over the ${testCase.expect.maxMs}ms budget`);
  }

  if (testCase.expect.oracle) {
    try {
      const verdict = await testCase.expect.oracle(outcome, ctx);
      if (verdict !== true) problems.push(`oracle: ${verdict}`);
    } catch (err) {
      // A provider that cannot be reached proves nothing either way.
      return {
        status: 'UNPROVEN',
        detail: `oracle unavailable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return problems.length === 0
    ? { status: 'PASS', detail: '' }
    : { status: 'FAIL', detail: problems.join('; ') };
}
