import type { ProfileFieldDefinition } from './profile-field-registry';
import { daysBetween, midnight } from './calendar-days';
import { atLocalMidnight, parseStoredDate } from './stored-date';

/** A dated event derived from a date-typed profile field */
export interface Occasion {
  fieldId: string;
  label: string;
  date: Date;
  recurrence: 'annual' | 'one-time';
}

/** Value holder for a profile field */
export interface FieldValueEntry {
  value: string;
}

/**
 * Derive occasions from date-typed profile fields that hold values.
 * Birthday and anniversary fields are treated as annual recurrences.
 * Other date fields are one-time by default.
 */
export function deriveOccasions(
  dateFields: ProfileFieldDefinition[],
  values: Record<string, FieldValueEntry | undefined>,
): Occasion[] {
  const occasions: Occasion[] = [];

  for (const field of dateFields) {
    const entry = values[field.id];
    if (!entry || !entry.value) continue;

    /*
     * `parseStoredDate`, not `new Date(entry.value)`.
     *
     * The old `isNaN` guard was no guard at all: `new Date('March 14')` is a valid
     * Date in 2001, and `new Date('32')` a valid one in 2032. Both sailed through
     * and became countdowns. An unreadable or day-less value is dropped here
     * instead, so the rail says nothing rather than something wrong.
     */
    const parts = parseStoredDate(entry.value);
    if (!parts) continue;

    // Birthday and anniversary are annual; others are one-time
    const isAnnual = field.id === 'birthday' || field.id === 'anniversary' || field.id === 'relationship_duration';

    /*
     * A year-less value is anchored to *this* year purely so it has a month and a
     * day to carry. Nothing downstream reads the year for an annual occasion —
     * `getNextOccurrenceDate` recomputes it — and a one-time occasion with no year
     * is not a date anyone can act on, so it is dropped.
     */
    if (!isAnnual && parts.year === null) continue;

    occasions.push({
      fieldId: field.id,
      label: field.label,
      date: atLocalMidnight(parts, parts.year ?? new Date().getFullYear()),
      recurrence: isAnnual ? 'annual' : 'one-time',
    });
  }

  return occasions;
}

/**
 * Find the next upcoming occasion from a list of occasions.
 * For annual recurrences, calculates the next occurrence of that month+day.
 * Returns null if no occasions exist.
 */
export function getNextOccasion(
  occasions: Occasion[],
  referenceDate: Date = new Date(),
): Occasion | null {
  if (occasions.length === 0) return null;

  let closest: Occasion | null = null;
  let closestDays = Infinity;

  for (const occasion of occasions) {
    const daysUntil = getDaysUntilOccasion(occasion, referenceDate);
    if (daysUntil < closestDays) {
      closestDays = daysUntil;
      closest = occasion;
    }
  }

  return closest;
}

/**
 * The date the occasion next falls on.
 *
 * Extracted from `getDaysUntilOccasion`, which used to compute this internally and
 * return only the count — so `lead-times.ts` reconstructed the date by adding the
 * count back onto today, and any error in the count became an error in the date
 * *and* its weekday. Now the date is the primary answer and the count is derived
 * from it, which is the only ordering in which the two cannot disagree.
 *
 * The annual rollover and the 29 February edge case have exactly one home here.
 */
export function getNextOccurrenceDate(
  occasion: Occasion,
  referenceDate: Date = new Date(),
): Date {
  const today = midnight(referenceDate);

  if (occasion.recurrence !== 'annual') {
    return midnight(occasion.date);
  }

  const occMonth = occasion.date.getMonth();
  const occDay = occasion.date.getDate();

  /** This month-and-day in `year`, clamped to the last of the month (29 Feb). */
  const inYear = (year: number): Date => {
    const candidate = new Date(year, occMonth, occDay);
    // A day the month does not have rolls forward, which changes the month —
    // e.g. 29 February in a common year lands on 1 March. Clamp to the 28th.
    return candidate.getMonth() === occMonth ? candidate : new Date(year, occMonth + 1, 0);
  };

  const thisYear = inYear(today.getFullYear());
  return thisYear < today ? inYear(today.getFullYear() + 1) : thisYear;
}

/**
 * Calculate the number of days until an occasion from a reference date.
 * For annual recurrences, finds the next occurrence of that month+day.
 */
export function getDaysUntilOccasion(occasion: Occasion, referenceDate: Date = new Date()): number {
  return daysBetween(referenceDate, getNextOccurrenceDate(occasion, referenceDate));
}

/**
 * Check if an occasion falls on a specific day in a given month/year.
 * For annual recurrences, checks month+day regardless of year.
 */
export function occasionFallsOnDay(
  occasion: Occasion,
  year: number,
  month: number,
  day: number,
): boolean {
  if (occasion.recurrence === 'annual') {
    return occasion.date.getMonth() === month && occasion.date.getDate() === day;
  }
  return (
    occasion.date.getFullYear() === year &&
    occasion.date.getMonth() === month &&
    occasion.date.getDate() === day
  );
}
