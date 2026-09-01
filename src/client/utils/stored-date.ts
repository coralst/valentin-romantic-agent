/**
 * The one place a stored date-ish string is turned into calendar parts.
 *
 * ## Why this exists
 *
 * A `birthday` or `anniversary` field holds whatever the user said, and
 * extraction routes *partial* facts into it on purpose — see the long note in
 * `birthday-display.ts`. Four modules used to each call `new Date(value)` on that
 * string and then read the result back with different getters and different
 * rounding. For a stored `"March 14"` the rail simultaneously claimed:
 *
 *   - "March 14"          (the header, correct)
 *   - "Monday 15 March"   (`NextUp`, a day late and the wrong weekday)
 *   - "13 Mar"            (`PinnedEveryYear`, a day early)
 *
 * Three renderings of one fact, none of which agreed, plus an invented
 * "mid-twenties" — because `new Date('March 14')` is a *valid* Date in 2001, so
 * every `isNaN` guard in the codebase waved it through.
 *
 * `new Date(string)` is the bug. It is permissive by specification: it fills in a
 * year you did not give, reads an age as a year, and its output is local or UTC
 * depending on the input's shape. So this module never calls it. It matches the
 * shapes we actually store, and returns `null` for anything it cannot read
 * unambiguously — which is the honest answer, and lets each caller decide whether
 * a partial date is still worth showing.
 */

/**
 * A calendar date as the user gave it, with no gaps filled in.
 *
 * `year` is null when they never said one ("her birthday is March 14"). That is a
 * real state and the reason this type exists rather than a `Date`: a `Date` cannot
 * represent "the 14th of March, year unspecified" without inventing a year, and
 * inventing one is what produced the age nobody was told.
 */
export interface DateParts {
  /** Four-digit year, or null when the value carries no year. */
  year: number | null;
  /** 0-based, like `Date.prototype.getMonth`. */
  month: number;
  /** 1-based day of the month. */
  day: number;
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

/** ISO first: `1990-06-17`, with or without a time part hanging off it. */
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/;

/**
 * A month name or its three-letter abbreviation, as a capture group body.
 *
 * "Sept" is spelled out because it is the one abbreviation people write with four
 * letters, and dropping it would silently reject "Sept 18" — a value the demo
 * fixtures themselves use.
 */
const MONTH_WORD = `(${MONTH_NAMES.map((name) => `${name}|${name.slice(0, 3)}`).join('|')}|sept)`;

/** `14 March`, `14th March 1990`. */
const DAY_FIRST = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_WORD}\\b(?:\\s*,?\\s*(\\d{4}))?$`, 'i');

/** `March 14`, `March 14th, 1990`. */
const MONTH_FIRST = new RegExp(`^${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*(\\d{4}))?$`, 'i');

/** Days in a month, given a year when we have one. February is the only tricky one. */
function daysInMonth(month: number, year: number | null): number {
  if (month !== 1) return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
  // Without a year, allow the 29th: "her birthday is 29 February" is a real thing
  // to say, and rejecting it would lose the fact entirely.
  if (year === null) return 29;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return isLeap ? 29 : 28;
}

/** The month index for a name or abbreviation, or -1. */
function monthFromWord(word: string): number {
  const lower = word.toLowerCase();
  return MONTH_NAMES.findIndex((name) => name === lower || name.slice(0, 3) === lower.slice(0, 3));
}

function build(year: number | null, month: number, day: number): DateParts | null {
  if (month < 0 || month > 11) return null;
  if (day < 1 || day > daysInMonth(month, year)) return null;
  return { year, month, day };
}

/**
 * The calendar parts of a stored value, or null when it does not carry an
 * unambiguous month *and* day.
 *
 * Deliberately rejected, because each one used to render as a confident date:
 *
 *     parseStoredDate('32')          -> null  (an age; `new Date` said 2032)
 *     parseStoredDate('1988')        -> null  (a year; `new Date` said 1 January)
 *     parseStoredDate('June 1988')   -> null  (no day; `new Date` said the 1st)
 *     parseStoredDate('next Friday') -> null
 *
 * Accepted, with `year: null` where none was given:
 *
 *     parseStoredDate('1990-06-17')  -> { year: 1990, month: 5, day: 17 }
 *     parseStoredDate('March 14')    -> { year: null, month: 2, day: 14 }
 *     parseStoredDate('2 October')   -> { year: null, month: 9, day: 2 }
 */
export function parseStoredDate(value: string | null | undefined): DateParts | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const iso = ISO_PATTERN.exec(trimmed);
  if (iso) {
    return build(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const dayFirst = DAY_FIRST.exec(trimmed);
  if (dayFirst) {
    return build(
      dayFirst[3] ? Number(dayFirst[3]) : null,
      monthFromWord(dayFirst[2]),
      Number(dayFirst[1]),
    );
  }

  const monthFirst = MONTH_FIRST.exec(trimmed);
  if (monthFirst) {
    return build(
      monthFirst[3] ? Number(monthFirst[3]) : null,
      monthFromWord(monthFirst[1]),
      Number(monthFirst[2]),
    );
  }

  return null;
}

/** Whether the value carries a full date — day, month *and* year. */
export function hasFullDate(value: string | null | undefined): boolean {
  return parseStoredDate(value)?.year != null;
}

/**
 * The parts as a real `Date` at local midnight, in the year you name.
 *
 * Local, not UTC, because every countdown in the app compares against the user's
 * own "today". Mixing the two is what made one surface read the 13th and another
 * the 15th of the same March.
 */
export function atLocalMidnight(parts: DateParts, year: number): Date {
  return new Date(year, parts.month, parts.day);
}
