/**
 * Age as the rail says it out loud.
 *
 * The mockup's header reads "born June 17th, 1988, and in her mid-thirties"
 * (option-5d-brief.html:264) — never "37". A number is a database row; a decade
 * band is how a person describes someone they know, and it is also the part that
 * is actually useful when Valentin is reaching for a suggestion. The exact
 * birthday is still shown beside it, so nothing is hidden.
 */

import { atLocalMidnight, parseStoredDate } from './stored-date';

/** Where in the decade a given age sits. */
export type AgeBand = 'early' | 'mid' | 'late';

const DECADE_WORDS: Readonly<Record<number, string>> = {
  10: 'teens',
  20: 'twenties',
  30: 'thirties',
  40: 'forties',
  50: 'fifties',
  60: 'sixties',
  70: 'seventies',
  80: 'eighties',
  90: 'nineties',
};

/** Whole years elapsed since `birthday`, or null if the date is unusable. */
export function getAge(birthday: Date, referenceDate: Date = new Date()): number | null {
  if (isNaN(birthday.getTime())) return null;

  let age = referenceDate.getFullYear() - birthday.getFullYear();
  // Not yet had this year's birthday — a month/day comparison, so no timezone
  // arithmetic can shave a year off.
  const monthDiff = referenceDate.getMonth() - birthday.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < birthday.getDate())) {
    age -= 1;
  }

  if (age < 0 || age > 120) return null;
  return age;
}

/** Which third of its decade an age falls in: 0-3 early, 4-6 mid, 7-9 late. */
export function getAgeBand(age: number): AgeBand {
  const withinDecade = age % 10;
  if (withinDecade <= 3) return 'early';
  if (withinDecade <= 6) return 'mid';
  return 'late';
}

/**
 * The phrase for a birthday, e.g. "mid-thirties".
 *
 * Returns null rather than a placeholder when the age cannot be phrased — under
 * ten has no decade word, and the caller should show nothing rather than
 * something wrong.
 */
export function getAgeBucket(birthday: Date, referenceDate: Date = new Date()): string | null {
  const age = getAge(birthday, referenceDate);
  if (age === null || age < 10) return null;

  const decade = Math.floor(age / 10) * 10;
  const word = DECADE_WORDS[decade];
  if (!word) return null;

  return `${getAgeBand(age)}-${word}`;
}

/**
 * `getAgeBucket` straight from a stored field value.
 *
 * Requires a **year**, and this is the whole point of the function.
 *
 * It used to be `new Date(value)` behind an `isNaN` guard, which is no guard: V8
 * defaults a missing year to 2001, so a stored `"March 14"` became 14 March 2001,
 * became 25 years old, became "mid-twenties" — an age the user never mentioned,
 * stated in the header as though Valentin had been told it. Inventing a fact about
 * someone's partner is the worst thing this app can do, and the sister module
 * `birthday-display.ts` already refused to do it for the date string; this is the
 * same refusal for the age.
 *
 * No year, no age. The birthday itself is still shown beside it, so nothing the
 * user actually said is hidden.
 */
export function getAgeBucketFromValue(
  value: string | null | undefined,
  referenceDate: Date = new Date(),
): string | null {
  const parts = parseStoredDate(value);
  if (!parts || parts.year === null) return null;
  return getAgeBucket(atLocalMidnight(parts, parts.year), referenceDate);
}
