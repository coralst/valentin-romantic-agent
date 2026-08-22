/**
 * Age as the rail says it out loud.
 *
 * The mockup's header reads "born June 17th, 1988, and in her mid-thirties"
 * (option-5d-brief.html:264) — never "37". A number is a database row; a decade
 * band is how a person describes someone they know, and it is also the part that
 * is actually useful when Valentin is reaching for a suggestion. The exact
 * birthday is still shown beside it, so nothing is hidden.
 */

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

/** `getAgeBucket` straight from a stored field value (an ISO or parseable date). */
export function getAgeBucketFromValue(
  value: string | null | undefined,
  referenceDate: Date = new Date(),
): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return null;
  return getAgeBucket(parsed, referenceDate);
}
