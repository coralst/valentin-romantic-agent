import type { Outing } from '../../shared/interfaces/outing';
import { outingHistory } from '../../shared/interfaces/outing';
import {
  REMINDER_ZONE,
  pendingReminders,
  type Reminder,
  type ReminderKind,
} from '../../shared/interfaces/reminder';
import type { Occasion } from './occasion-derivation';
import { getDaysUntilOccasion, getNextOccurrenceDate } from './occasion-derivation';
import { getActByPlan } from './lead-times';
import { midnight } from './calendar-days';

/**
 * The two of you on one axis: what is coming, and everywhere you have been.
 *
 * ## Why one derivation and not two lists
 *
 * The board used to show upcoming dates in a grid (`FourWeekCalendar`) and past
 * evenings in a flat list (`OutingHistory`), and nothing anywhere connected them
 * — so "we always go somewhere for the anniversary, and last year's place was a
 * mistake" was two separate readings. A single ordered spine makes that one
 * glance, which is the whole reason the panel wanted a timeline.
 *
 * The grid stays. It answers "what does this month look like"; this answers
 * "what happens next, and what happened before". Both read the same
 * `deriveOccasions` output, so they cannot disagree about the dates.
 *
 * ## Why a booked-but-future outing is an upcoming entry
 *
 * `OutingHistory` sorted every row by `confirmedAt` and drew them identically,
 * which put a table booked for next Friday *above* an evening you actually had —
 * under a heading reading "Where you've been", where you have not yet been. An
 * outing with `occursOn` in the future is a plan, and it belongs with the plans.
 */

/** Which half of the spine an entry falls on. */
export type TimelineSide = 'upcoming' | 'past';

/** What produced the entry, which is also what icon and tone it wears. */
export type TimelineKind = 'occasion' | 'booking' | 'outing' | 'reminder';

export interface TimelineEntry {
  /** Stable per source row, so React keys survive a re-derivation. */
  id: string;
  side: TimelineSide;
  kind: TimelineKind;
  /** "Anniversary", or the venue's name. */
  title: string;
  /** "Tel Aviv", the city on a booking — null for an occasion. */
  place?: string | null;
  /** The day it falls on, at local midnight. */
  date: Date;
  /** Signed: positive ahead of today, negative behind it, 0 today. */
  daysFromToday: number;
  /** "Thursday 10 September" — the long form, since a timeline row has the width. */
  when: string;
  /**
   * The deadline line for an occasion: "Book by 3 Sept". Null on outings, which
   * have no lead time — the booking *is* the action.
   */
  actBy?: string | null;
  /** True while the act-by date is today or behind, so the row can shout. */
  isUrgent?: boolean;
  /**
   * The outing this row came from, present on `booking` and `outing` entries.
   *
   * Carried rather than flattened because the past rows render the survey, and
   * the survey needs `rating`, `verdict` and `id` together — copying three
   * fields out would be three chances for the row and its controls to disagree
   * about which outing they belong to.
   */
  outing?: Outing;
  /**
   * When Valentin will actually mail about this — "Thursday 5 October at 08:30".
   *
   * Read off the armed row's `dueAt`, never recomputed from the occasion and a lead
   * time. The page used to derive its dates independently of the server's planner, so
   * it could show a birthday and imply a reminder that was never armed, or state a
   * notice period the row did not carry. This field is the row, or it is absent.
   *
   * Null on anything not covered by a reminder, which is how the row says so.
   */
  remindsAt?: string | null;
  /**
   * The armed row's id, so a Cancel control has something to name.
   *
   * Present on any entry with `remindsAt`, including an `occasion` entry whose date
   * merely *has* a reminder — cancelling from there is the same write as cancelling
   * the reminder's own row, because it is the same row.
   */
  reminderId?: string | null;
  /** The reminder's kind, so the UI can word "cancel" as "mute" where that is what it is. */
  reminderKind?: ReminderKind | null;
}

/** Both halves, each already in reading order. */
export interface EventTimeline {
  /** Soonest first: the next thing you have to do is the top of the list. */
  upcoming: TimelineEntry[];
  /** Most recent first, matching `outingHistory`. */
  past: TimelineEntry[];
}

const LONG_DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** Whole days between two local midnights, signed. */
function dayGap(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((midnight(to).getTime() - midnight(from).getTime()) / MS_PER_DAY);
}

/**
 * The day an outing happened or will happen, at local midnight.
 *
 * Falls back to the confirmation instant's date when nobody recorded a day —
 * the same fallback `OutingHistory.whenLabel` used, and for the same reason: a
 * row with no date still has to sit somewhere on the spine.
 */
function outingDay(outing: Outing): Date | null {
  const iso = outing.occursOn ?? outing.confirmedAt.slice(0, 10);
  const day = new Date(`${iso}T00:00:00`);
  return Number.isNaN(day.getTime()) ? null : day;
}

/**
 * Whether the evening is still ahead.
 *
 * Deliberately the same rule as `OutingHistory.hasHappened`, inverted: a row
 * with no `occursOn` counts as past, because the only thing that produces one is
 * a booking that was already confirmed.
 */
function isAhead(outing: Outing, today: Date): boolean {
  if (!outing.occursOn) return false;
  return dayGap(today, new Date(`${outing.occursOn}T00:00:00`)) > 0;
}

/**
 * Merge her dates and his bookings into one spine.
 *
 * `now` is injected rather than read so the tests can stand at a fixed day —
 * every relative label here changes daily otherwise.
 */
export function buildEventTimeline({
  occasions,
  outings,
  reminders = [],
  now = new Date(),
}: {
  occasions: Occasion[];
  outings: readonly Outing[];
  /**
   * The reminders actually armed on the server, pending ones included and sent ones
   * harmless — {@link pendingReminders} filters them here rather than at the call site
   * so every caller gets the same answer about what "armed" means.
   */
  reminders?: readonly Reminder[];
  now?: Date;
}): EventTimeline {
  const today = midnight(now);
  const upcoming: TimelineEntry[] = [];
  const past: TimelineEntry[] = [];

  const armed = pendingReminders(reminders);
  /*
   * Which reminders already have a row of their own to hang off.
   *
   * A birthday reminder and the birthday occasion are the same date said twice, so the
   * reminder annotates the occasion rather than sitting beside it as a near-duplicate
   * row. Only `birthday` and `anniversary` can pair up: `next_occasion` is not a
   * date-typed profile field, so an `occasion` reminder has no occasion row to join and
   * falls through to a row of its own, as every `custom` one does.
   */
  const pairedTo = new Map<string, Reminder>();
  for (const reminder of armed) {
    if (reminder.kind === 'birthday' || reminder.kind === 'anniversary') {
      pairedTo.set(reminder.kind, reminder);
    }
  }

  for (const occasion of occasions) {
    const date = getNextOccurrenceDate(occasion, now);
    const plan = getActByPlan(occasion, now);
    const reminder = pairedTo.get(occasion.fieldId);
    upcoming.push({
      id: `occasion:${occasion.fieldId}`,
      side: 'upcoming',
      kind: 'occasion',
      title: occasion.label,
      date,
      daysFromToday: getDaysUntilOccasion(occasion, now),
      when: LONG_DAY.format(date),
      actBy: plan.label,
      isUrgent: plan.isOverdue,
      remindsAt: reminder ? describeSendMoment(reminder.dueAt) : null,
      reminderId: reminder?.id ?? null,
      reminderKind: reminder?.kind ?? null,
    });
  }

  /*
   * The reminders with nothing else on the page representing them.
   *
   * An errand — "call the florist" — exists only as a reminder row, so without this it
   * appeared nowhere at all: he could ask Valentin to remind him, be told it was set,
   * and then find no trace of it on the profile page. The date drawn is `occursOn`, the
   * thing itself, with the send moment carried alongside; a row placed at `dueAt` would
   * put "call the florist" a week before the day the florist is wanted.
   */
  for (const reminder of armed) {
    if (pairedTo.get(reminder.kind) === reminder) continue;

    const date = midnight(new Date(`${reminder.occursOn}T00:00:00`));
    if (Number.isNaN(date.getTime())) continue;

    const gap = dayGap(today, date);
    // A reminder about a day already gone is spent, whether or not it was sent — the
    // spine's past half is for evenings that happened, not for notices about them.
    if (gap < 0) continue;

    upcoming.push({
      id: `reminder:${reminder.id}`,
      side: 'upcoming',
      kind: 'reminder',
      title: reminder.title?.trim() || reminder.occasion,
      date,
      daysFromToday: gap,
      when: LONG_DAY.format(date),
      remindsAt: describeSendMoment(reminder.dueAt),
      reminderId: reminder.id,
      reminderKind: reminder.kind,
    });
  }

  for (const outing of outingHistory(outings)) {
    const date = outingDay(outing);
    if (!date) continue;

    const ahead = isAhead(outing, today);
    const entry: TimelineEntry = {
      id: `outing:${outing.id}`,
      side: ahead ? 'upcoming' : 'past',
      kind: ahead ? 'booking' : 'outing',
      title: outing.venueName,
      place: outing.city ?? null,
      date,
      daysFromToday: dayGap(today, date),
      when: LONG_DAY.format(date),
      outing,
    };

    if (ahead) upcoming.push(entry);
    else past.push(entry);
  }

  // Soonest first ahead of today; `past` is already newest-first out of
  // `outingHistory`, but sorted explicitly so a row dated by `confirmedAt`
  // fallback still lands in date order rather than confirmation order.
  upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());
  past.sort((a, b) => b.date.getTime() - a.date.getTime());

  return { upcoming, past };
}

/**
 * The moment a reminder goes out, as his own calendar reads it.
 *
 * Formatted in {@link REMINDER_ZONE} rather than the browser's zone, because that is
 * the clock the mail is actually pinned to: `dueAt` is 08:30 in Israel, and rendering
 * it for a viewer in London would promise 06:30 for half the year and 05:30 for the
 * other. The zone is not named in the string — for the one user this is built for it
 * is his own, and "08:30 Israel time" on his own screen reads as a machine talking.
 */
function describeSendMoment(dueAt: string): string {
  const at = new Date(dueAt);
  if (Number.isNaN(at.getTime())) return '';

  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: REMINDER_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(at);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: REMINDER_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);

  return `${day} at ${time}`;
}

/**
 * How a row says when it is, relative to today.
 *
 * Words for the near days and a count past that: "tomorrow" is what someone
 * would say, and "in 43 days" is what they would say instead of naming a
 * Wednesday in October.
 */
export function relativeDayLabel(daysFromToday: number): string {
  if (daysFromToday === 0) return 'today';
  if (daysFromToday === 1) return 'tomorrow';
  if (daysFromToday === -1) return 'yesterday';
  if (daysFromToday > 1) return `in ${daysFromToday} days`;

  const ago = Math.abs(daysFromToday);
  if (ago < 14) return `${ago} days ago`;
  if (ago < 60) return `${Math.round(ago / 7)} weeks ago`;
  return `${Math.round(ago / 30)} months ago`;
}
