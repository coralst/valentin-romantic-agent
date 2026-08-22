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

const BIRTHDAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** A four-digit year that could plausibly be a birth year. */
const YEAR_PATTERN = /\b(1[89]\d{2}|20\d{2})\b/;

/**
 * Whether `value` carries a full calendar date rather than a fragment.
 *
 * Requires an explicit four-digit year *and* that the parsed date agrees with it.
 * The agreement check is what rejects a bare age: `new Date('32')` lands in 2032,
 * but "32" contains no four-digit year, so it never gets that far. A year on its
 * own ("1988") is rejected too — it parses to 1 January, a day and a month nobody
 * told us.
 */
export function isFullBirthday(value: string): boolean {
  const trimmed = value.trim();

  const year = YEAR_PATTERN.exec(trimmed);
  if (!year) return false;

  // A lone year, with or without surrounding punctuation, is not a date.
  const withoutYear = trimmed.replace(year[0], ' ').trim();
  if (!/[0-9]/.test(withoutYear) && !/[a-z]/i.test(withoutYear)) return false;

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return false;

  // `new Date('June 1988')` is valid and silently means the 1st. Insist the
  // parsed year is the one written down, then that a day was actually supplied.
  if (parsed.getFullYear() !== Number(year[0])) return false;

  return hasExplicitDayOfMonth(trimmed, parsed);
}

/**
 * Whether the day-of-month in `parsed` was written down rather than defaulted.
 *
 * `Date` fills a missing day with 1, which is indistinguishable from a genuine
 * first-of-the-month once parsed. So look for the number in the source text —
 * "17 June 1988" and "1988-06-17" both contain it; "June 1988" does not.
 */
function hasExplicitDayOfMonth(source: string, parsed: Date): boolean {
  const day = parsed.getDate();
  if (day !== 1) return true;

  // Day 1 is only trustworthy if a standalone "1" (or "01", "1st") appears
  // outside the year we already matched.
  const withoutYear = source.replace(YEAR_PATTERN, ' ');
  return /\b0?1(st)?\b/.test(withoutYear);
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

  if (!isFullBirthday(trimmed)) return trimmed;
  return BIRTHDAY_FORMAT.format(new Date(trimmed));
}
