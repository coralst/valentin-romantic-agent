import type { ProfileFieldDefinition } from './profile-field-registry';

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

    const parsed = new Date(entry.value);
    if (isNaN(parsed.getTime())) continue;

    // Birthday and anniversary are annual; others are one-time
    const isAnnual = field.id === 'birthday' || field.id === 'anniversary' || field.id === 'relationship_duration';

    occasions.push({
      fieldId: field.id,
      label: field.label,
      date: parsed,
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
 * Calculate the number of days until an occasion from a reference date.
 * For annual recurrences, finds the next occurrence of that month+day.
 */
export function getDaysUntilOccasion(occasion: Occasion, referenceDate: Date = new Date()): number {
  const refYear = referenceDate.getFullYear();
  const refMonth = referenceDate.getMonth();
  const refDay = referenceDate.getDate();

  if (occasion.recurrence === 'annual') {
    const occMonth = occasion.date.getMonth();
    const occDay = occasion.date.getDate();

    // Try this year first
    let nextDate = new Date(refYear, occMonth, occDay);
    if (nextDate.getMonth() !== occMonth) {
      // Handle edge case like Feb 29 in non-leap year -> use Feb 28
      nextDate = new Date(refYear, occMonth + 1, 0);
    }

    // If already passed this year, use next year
    const today = new Date(refYear, refMonth, refDay);
    if (nextDate < today) {
      nextDate = new Date(refYear + 1, occMonth, occDay);
      if (nextDate.getMonth() !== occMonth) {
        nextDate = new Date(refYear + 1, occMonth + 1, 0);
      }
    }

    return Math.ceil((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  // One-time: days until the exact date
  const today = new Date(refYear, refMonth, refDay);
  const target = new Date(
    occasion.date.getFullYear(),
    occasion.date.getMonth(),
    occasion.date.getDate(),
  );
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
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
