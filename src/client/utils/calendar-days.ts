/**
 * Whole-day arithmetic, in one place, because the two ways of doing it disagree
 * twice a year.
 *
 * `pinned-dates.ts` had this right and `occasion-derivation.ts` had it wrong, so
 * the same birthday was 196 days away in one block of the rail and 198 in another.
 * The difference is the rounding:
 *
 *     const ms = nextMidnight - todayMidnight;   // 197 days *and one hour*
 *     Math.ceil(ms / DAY_MS)   // 198  ← wrong
 *     Math.round(ms / DAY_MS)  // 197  ← right
 *
 * Two local midnights 197 days apart are not 197 × 86 400 000 ms apart if a
 * daylight-saving boundary falls between them — they are an hour more, or an hour
 * less. `Math.ceil` turns that stray hour into a whole extra day; `Math.round`
 * absorbs it, and no realistic clock skew is anywhere near the ±12 hours it would
 * take to fool it.
 *
 * Local midnight rather than UTC throughout: every countdown here is measured
 * against the user's own "today", and reading one value with local getters and
 * another with UTC getters is what made one surface say the 13th of March and
 * another the 15th.
 */

const DAY_MS = 86_400_000;

/** Local midnight on the same calendar day, so a clock time cannot skew a count. */
export function midnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Whole calendar days from `from` to `to`; negative once `to` is behind `from`.
 *
 * DST-safe by construction — see the note above on why this rounds.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((midnight(to).getTime() - midnight(from).getTime()) / DAY_MS);
}

/** Whole days added to a date, at local midnight, without mutating it. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
