import type { DossierIconName } from '../components/dossier/dossier-icons';
import { daysBetween, midnight } from './calendar-days';
import { parseStoredDate } from './stored-date';

/**
 * The days that come round every year whether anyone writes them down or not.
 *
 * Distinct from `deriveOccasions`, which turns *stored* date fields into events.
 * These three are fixed: her birthday (stored, but annual and never "one-time"),
 * Valentine's, and Tu B'Av. Two of them the app knows without being told, which is
 * the point — a rail that only counts down what you have already entered cannot
 * remind you of the one you forgot.
 *
 * Tu B'Av and Valentine's share a heart, one with a Magen David in it: they are
 * the same day for the same purpose in two calendars, and giving them different
 * marks would suggest they are different kinds of occasion.
 */

export interface PinnedDate {
  id: string;
  label: string;
  icon: DossierIconName;
  /** `'12 Jun'`, or `'15 Av'` for the one that is not a Gregorian date. */
  when: string;
  /** Days from now, or null when it cannot be worked out on this platform. */
  daysUntil: number | null;
}

/** `'12 Jun'` — the part of a date you say out loud. */
function shortDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Days to the next occurrence of a month-and-day, ignoring the year.
 *
 * `month` is 0-based, like `Date.getMonth()`.
 */
export function daysUntilAnnual(month: number, day: number, now: Date = new Date()): number {
  const today = midnight(now);
  let next = new Date(today.getFullYear(), month, day);
  if (next.getTime() < today.getTime()) {
    next = new Date(today.getFullYear() + 1, month, day);
  }
  return daysBetween(today, next);
}

/**
 * The next Gregorian date on which the Hebrew date is 15 Av.
 *
 * Found by asking `Intl` what the Hebrew date is, day by day, rather than by
 * implementing the Hebrew calendar. The calendar has leap months and a molad
 * calculation behind it; a hand-rolled version would be a few hundred lines that
 * are wrong once every nineteen years, and `Intl` already ships the right answer.
 *
 * The search is bounded to the two windows Av can fall in — Tu B'Av lands in late
 * July or August in every year — so this is about sixty formats, not four hundred.
 * `null` when the platform has no Hebrew calendar data, which is a real
 * possibility on a trimmed-down ICU build; the caller drops the row rather than
 * guessing a date.
 */
export function nextTuBAv(now: Date = new Date()): Date | null {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-u-ca-hebrew', { month: 'short', day: 'numeric' });
  } catch {
    return null;
  }

  const today = midnight(now);
  // Two windows, so a search begun in September still finds next August's.
  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    // 1 July to 15 September covers every year's 15 Av with room either side.
    for (let day = 0; day <= 76; day += 1) {
      const candidate = new Date(year, 6, 1 + day);
      if (candidate.getTime() < today.getTime()) continue;
      const parts = format.formatToParts(candidate);
      const month = parts.find((part) => part.type === 'month')?.value ?? '';
      const dayOfMonth = parts.find((part) => part.type === 'day')?.value ?? '';
      if (month.startsWith('Av') && dayOfMonth === '15') return candidate;
    }
  }
  return null;
}

/**
 * The rail's "Pinned every year" block.
 *
 * Her birthday is first when it is known and dropped when it is not — an
 * annual-reminder list with "her birthday: unknown" in it is the app admitting
 * the one thing it should be asking about, in the place least likely to be acted
 * on. `WorthAsking` raises that instead.
 */
export function derivePinnedDates(
  birthdayValue: string | null,
  now: Date = new Date(),
): PinnedDate[] {
  const pinned: PinnedDate[] = [];

  if (birthdayValue) {
    /*
     * `parseStoredDate` rather than `new Date` plus UTC getters.
     *
     * The UTC getters were here to stop a bare `YYYY-MM-DD` — which parses as UTC
     * midnight — reading a day early west of Greenwich. But they only hold for that
     * one shape: `"March 14"` parses as *local* midnight, so east of Greenwich the
     * UTC getters read it back as 13 March. That is the off-by-one that made this
     * block disagree with `NextUp` about the same birthday, in the opposite
     * direction. Parsing to explicit parts removes the question of which getters to
     * use, because there is no round-trip through a Date at all.
     */
    const parts = parseStoredDate(birthdayValue);
    if (parts) {
      pinned.push({
        id: 'birthday',
        label: 'Her birthday',
        icon: 'cake',
        when: shortDate(new Date(2000, parts.month, parts.day)),
        daysUntil: daysUntilAnnual(parts.month, parts.day, now),
      });
    }
  }

  pinned.push({
    id: 'valentines',
    label: "Valentine's",
    icon: 'heart',
    when: '14 Feb',
    daysUntil: daysUntilAnnual(1, 14, now),
  });

  const tuBAv = nextTuBAv(now);
  if (tuBAv) {
    pinned.push({
      id: 'tu-bav',
      label: "Tu B'Av",
      icon: 'heart-star',
      when: '15 Av',
      daysUntil: daysBetween(now, tuBAv),
    });
  }

  return pinned;
}
