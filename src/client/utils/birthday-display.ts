/**
 * How a stored `birthday` value is allowed to be said out loud.
 *
 * The `birthday` field is a full date, but extraction routes *partial* facts into
 * it on purpose: a real run emitted `important_dates:birthday_month = "June"` and
 * `important_dates:age_turning = "32"`, and `preference-field-mapper` maps both to
 * `birthday` so the two halves of one fact can be merged rather than dropped.
 *
 * That makes the stored value untrustworthy as a date, and `new Date()` is far too
 * forgiving to notice:
 *
 *     new Date('32')   -> 1 January 2032   (an age, read as a year)
 *     new Date('2032') -> 1 January 2032   (a year, given a day and a month)
 *
 * Both are valid Dates, so an `isNaN` guard passes and the rail rendered
 * "1 January 2032" as though Valentin knew her birthday. Inventing a day and a
 * month from an age is worse than admitting the date is partial, so this module
 * formats a birthday only when the stored value genuinely carries day, month and
 * year, and otherwise hands back the value as the user said it.
 */

import { atLocalMidnight, parseStoredDate } from './stored-date';

const BIRTHDAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * Whether `value` carries a full calendar date rather than a fragment.
 *
 * Now a thin question asked of `stored-date.ts`, which is the single parser for
 * every stored date in the app. This module used to answer it alone, with a
 * four-digit-year regex, a parsed-year agreement check and a
 * `hasExplicitDayOfMonth` scan of the source text — three defences against
 * `new Date`'s habit of filling in what it was not given. All three are now
 * unnecessary because nothing here calls `new Date(string)` any more: a parse
 * either yields an explicit day, month and year, or it yields nothing.
 *
 * The contract is unchanged, and its tests are the specification.
 */
export function isFullBirthday(value: string): boolean {
  return parseStoredDate(value)?.year != null;
}

/**
 * The birthday as it should appear: a formatted date when the value is a real
 * date, otherwise the stored text verbatim.
 *
 * Returning the raw fragment is deliberate. "June (32)" is true and useful;
 * "1 January 2032" is neither.
 */
export function formatBirthdayValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parts = parseStoredDate(trimmed);
  if (parts?.year == null) return trimmed;
  return BIRTHDAY_FORMAT.format(atLocalMidnight(parts, parts.year));
}
