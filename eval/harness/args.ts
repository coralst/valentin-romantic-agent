/**
 * Reading the recorded arguments.
 *
 * These exist so a case can say "whatever tool it chose, the date it passed must
 * be tomorrow" without hard-coding which tool that was. Asserting on the resolved
 * absolute date rather than on the model's prose is the whole reason the recording
 * registry exists — prose can say "tomorrow" and still book the wrong day.
 */
import type { RecordedCall } from './recording-registry';

const DATE_KEY = /(^|_)date$|^check_in$|^check_out$|^when$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface DateArg {
  readonly tool: string;
  readonly key: string;
  readonly value: string;
}

/** Every date-shaped argument the model actually passed, tool and key attached. */
export function datesPassed(calls: readonly RecordedCall[]): DateArg[] {
  const found: DateArg[] = [];
  for (const call of calls) {
    for (const [key, value] of Object.entries(call.args)) {
      if (!DATE_KEY.test(key) || typeof value !== 'string') continue;
      found.push({ tool: call.name, key, value });
    }
  }
  return found;
}

/** Assert that every date passed is `expected`, or explain what was passed instead. */
export function everyDateIs(calls: readonly RecordedCall[], expected: string): true | string {
  const dates = datesPassed(calls);
  if (dates.length === 0) return 'no date argument was passed to any tool';

  const wrong = dates.filter((date) => date.value !== expected);
  if (wrong.length === 0) return true;
  return `expected every date to be ${expected}; got ${wrong
    .map((date) => `${date.tool}.${date.key}=${date.value}`)
    .join(', ')}`;
}

/** Assert every date is a real ISO calendar day — no `2026-13-01`, no free text. */
export function everyDateIsIso(calls: readonly RecordedCall[]): true | string {
  const bad = datesPassed(calls).filter((date) => {
    if (!ISO_DATE.test(date.value)) return true;
    // Round-tripping catches 2026-02-30, which the regex happily accepts.
    const parsed = new Date(`${date.value}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date.value;
  });

  if (bad.length === 0) return true;
  return `not a real YYYY-MM-DD date: ${bad
    .map((date) => `${date.tool}.${date.key}=${date.value}`)
    .join(', ')}`;
}

/** Assert no date passed is before `floor` — the "never books the past" rule. */
export function noDateBefore(calls: readonly RecordedCall[], floor: string): true | string {
  const past = datesPassed(calls).filter((date) => date.value < floor);
  if (past.length === 0) return true;
  return `passed a date before ${floor}: ${past
    .map((date) => `${date.tool}.${date.key}=${date.value}`)
    .join(', ')}`;
}

/** Shift an Israeli wall-clock date string by whole days. */
export function shiftDays(localDate: string, days: number): string {
  const at = new Date(`${localDate}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Compose several argument assertions into one, reporting every failure. */
export function all(
  ...checks: readonly ((calls: readonly RecordedCall[]) => true | string)[]
): (calls: readonly RecordedCall[]) => true | string {
  return (calls) => {
    const problems = checks.map((check) => check(calls)).filter((verdict) => verdict !== true);
    return problems.length === 0 ? true : problems.join('; ');
  };
}
