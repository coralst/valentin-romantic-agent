import type { Occasion } from './occasion-derivation';
import { getDaysUntilOccasion, getNextOccurrenceDate } from './occasion-derivation';
import { addDays } from './calendar-days';

/**
 * How far ahead each kind of occasion has to be arranged.
 *
 * This is the number a countdown cannot tell you. "12 days to the anniversary"
 * is a fact; "book by 26 Aug" is the thing you actually have to do, and it is
 * five days sooner. The rail leads with the deadline for exactly that reason
 * (option-5d-brief.html:110-122).
 *
 * The lead times are per occasion *type*, not per occasion, because what you
 * are arranging differs: an anniversary means a table someone else also wants,
 * a birthday means a parcel that has to arrive.
 */
export interface LeadTime {
  /** Days before the occasion by which the plan has to be locked in. */
  days: number;
  /** The imperative that fits what is being arranged — you book a table, you order a parcel. */
  verb: string;
  /** How `days` reads in prose, e.g. "1 week ahead". */
  ahead: string;
}

/** Lead times keyed by the profile field the occasion was derived from. */
export const OCCASION_LEAD_TIMES: Readonly<Record<string, LeadTime>> = {
  // A table for two on a specific evening competes with everyone else's plans.
  anniversary: { days: 7, verb: 'Book', ahead: '1 week ahead' },
  // A gift has to be chosen, then shipped, then arrive.
  birthday: { days: 14, verb: 'Order', ahead: '2 weeks ahead' },
  // "Together since" is a quieter marker — it wants a gesture, not a booking.
  relationship_duration: { days: 3, verb: 'Plan', ahead: '3 days ahead' },
};

/** Fallback for any dated field without its own entry above. */
export const DEFAULT_LEAD_TIME: LeadTime = { days: 3, verb: 'Plan', ahead: '3 days ahead' };

/** The lead time for an occasion's originating field. */
export function getLeadTime(fieldId: string): LeadTime {
  return OCCASION_LEAD_TIMES[fieldId] ?? DEFAULT_LEAD_TIME;
}

/**
 * The date the occasion next falls on.
 *
 * Delegates to `getNextOccurrenceDate`, so the annual rollover and the 29 February
 * edge case still have exactly one home — but the *date* is now the thing that home
 * returns. This used to be `addDays(referenceDate, getDaysUntilOccasion(...))`,
 * which reconstructed the date from the count. That made the two inseparable in the
 * wrong direction: a count that was one day out did not merely read as the wrong
 * number, it re-rendered as the wrong date *and* the wrong weekday. A Sunday
 * birthday was announced as "Monday 15 March".
 */
export function getNextOccurrence(occasion: Occasion, referenceDate: Date = new Date()): Date {
  return getNextOccurrenceDate(occasion, referenceDate);
}

/** The act-by deadline for one occasion, ready to render. */
export interface ActByPlan {
  /** e.g. "Book by 26 Aug". */
  label: string;
  /** e.g. "1 week ahead", or the nudge when the deadline has already gone. */
  ahead: string;
  /** The deadline itself. */
  date: Date;
  /** Days from the reference date to the deadline; negative once it has passed. */
  daysUntil: number;
  /** True when the deadline is today or already behind you. */
  isOverdue: boolean;
}

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/**
 * Turn an occasion into the one line the rail leads with: what to do, by when,
 * and how much runway that leaves.
 */
export function getActByPlan(occasion: Occasion, referenceDate: Date = new Date()): ActByPlan {
  const leadTime = getLeadTime(occasion.fieldId);
  const daysUntilOccasion = getDaysUntilOccasion(occasion, referenceDate);
  const daysUntil = daysUntilOccasion - leadTime.days;
  // Counted back from the occasion itself, not forward from today: the deadline is
  // "a fortnight before her birthday", and deriving it from a day count would
  // inherit any error in that count — which is how "Order by 1 Mar" drifted.
  const date = addDays(getNextOccurrenceDate(occasion, referenceDate), -leadTime.days);
  const isOverdue = daysUntil <= 0;

  return {
    label: `${leadTime.verb} by ${DAY_MONTH.format(date)}`,
    // Once the runway is gone, "1 week ahead" is a lie. Say the true thing.
    ahead: isOverdue ? 'Sooner the better' : leadTime.ahead,
    date,
    daysUntil,
    isOverdue,
  };
}
