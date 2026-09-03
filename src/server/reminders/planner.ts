import {
  REMINDER_HOUR_LOCAL,
  REMINDER_ZONE,
  reminderId,
  type Reminder,
  type ReminderChannelName,
  type ReminderKind,
} from '../../shared/interfaces/reminder';
import { leadTimeDays } from '../../shared/constants/profile-fields';
import { parseInZone } from '../integrations/hebcal/client';

/**
 * Turning three stored profile values into the rows the dispatcher sweeps.
 *
 * ## Why this is pure, and takes `now` as an argument
 *
 * A planner that read the clock itself would be untestable at exactly the
 * boundaries that matter — the day before a birthday, the 29th of February, the
 * hour a lead time expires. Every judgement here is a function of (profile, now),
 * so each of those boundaries is a test rather than a hope.
 *
 * ## Why it never throws
 *
 * The three values it reads are model-extracted free text that a user can also
 * type by hand. `birthday` may legitimately be "March, she's turning 30" — see the
 * field guidance, which explicitly permits a month or an age. An unparseable value
 * produces no row, silently, because this runs inside the extraction path of a
 * chat turn and a thrown parse error would cost the user their reply.
 */

export interface PlanRemindersInput {
  sessionId: string;
  userId: string;
  /** Stored `birthday`. Recurring; the year on it may be decades old. */
  birthday?: string | null;
  /** Stored `anniversary`. Recurring, same as the birthday. */
  anniversary?: string | null;
  /** Stored `next_occasion`, as `"YYYY-MM-DD@what it is"`. One-off. */
  nextOccasion?: string | null;
  /** Stored `reminder_lead_time`, one of `REMINDER_LEAD_OPTIONS`. */
  reminderLeadTime?: string | null;
  channel: ReminderChannelName;
  /** Where the mail goes. Absent is legal — see `Reminder.target`. */
  target?: string | null;
}

const DAY_MS = 86_400_000;

/** A calendar date pulled out of free text, with no year semantics attached. */
interface DateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * The first `YYYY-MM-DD` in a value, or nothing.
 *
 * Anchored to a four-digit year on purpose: "34B" and "1 week before" are also
 * digits, and a looser pattern would happily read a bra size as a date.
 */
function findDate(value: string | null | undefined): DateParts | null {
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const [, y, mo, d] = match;
  const parts = { year: Number(y), month: Number(mo), day: Number(d) };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null;
  return parts;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function ymd(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The calendar date `now` falls on, in the zone reminders are pinned to. */
function localToday(now: Date): DateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

function isOnOrAfter(candidate: DateParts, floor: DateParts): boolean {
  return (
    ymd(candidate.year, candidate.month, candidate.day) >= ymd(floor.year, floor.month, floor.day)
  );
}

/**
 * The next time a recurring date comes round, at or after today.
 *
 * A birthday is stored with the year she was born, so the stored value is almost
 * always in the past and using it as-is would produce a reminder that was due in
 * 1994. Only the month and day recur; the year is replaced.
 */
function nextOccurrence(date: DateParts, today: DateParts): string {
  for (let year = today.year; year <= today.year + 1; year += 1) {
    const day = clampToMonth(year, date.month, date.day);
    const candidate = { year, month: date.month, day };
    if (isOnOrAfter(candidate, today)) return ymd(year, date.month, day);
  }
  // Unreachable: a month/day pair always recurs within the next twelve months.
  return ymd(today.year + 1, date.month, clampToMonth(today.year + 1, date.month, date.day));
}

/**
 * 29 February observed on the 28th in a common year.
 *
 * The alternative — skipping the year — means someone born on a leap day is
 * reminded about her birthday every fourth year, which is a worse answer than
 * being a day early. The 1st of March would also be defensible; the 28th is
 * chosen because it is still February, which is how people say the date.
 */
function clampToMonth(year: number, month: number, day: number): number {
  if (month === 2 && day === 29 && !isLeapYear(year)) return 28;
  return day;
}

/**
 * The instant a reminder should go out: `leadDays` before the occasion, at
 * {@link REMINDER_HOUR_LOCAL} in {@link REMINDER_ZONE}.
 *
 * The subtraction is done on the calendar date and the hour is pinned afterwards,
 * via `parseInZone`. Subtracting `leadDays * 86_400_000` from an instant instead
 * would drift by an hour across an Israeli DST transition and mail somebody at
 * 08:00 — `parseInZone` exists precisely because that arithmetic is not
 * interchangeable.
 */
function dueInstant(occursOn: string, leadDays: number): Date | null {
  const occasionNoon = parseInZone(occursOn, REMINDER_ZONE);
  if (!occasionNoon) return null;
  const shifted = new Date(occasionNoon.getTime() - leadDays * DAY_MS);
  const wall = new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
  const hour = String(REMINDER_HOUR_LOCAL).padStart(2, '0');
  return parseInZone(`${wall}T${hour}:00`, REMINDER_ZONE);
}

function buildReminder(
  input: PlanRemindersInput,
  kind: ReminderKind,
  occursOn: string,
  occasion: string,
  now: Date,
): Reminder | null {
  const leadDays = leadTimeDays(input.reminderLeadTime);
  const dueAt = dueInstant(occursOn, leadDays);
  if (!dueAt) return null;

  /*
   * A send moment that has already gone produces nothing.
   *
   * With a week's notice and a birthday three days away the reminder was due four
   * days ago. Storing it anyway means the next sweep — within the minute — mails
   * "her birthday is a week away" on a day when it is not, and does so at whatever
   * hour the profile happened to be edited. There is no useful reminder left to
   * send here; the honest output is none.
   */
  if (dueAt.getTime() <= now.getTime()) return null;

  return {
    // Derived, never random, so re-planning a corrected date overwrites in place.
    id: reminderId(kind, occursOn),
    sessionId: input.sessionId,
    userId: input.userId,
    kind,
    occursOn,
    dueAt: dueAt.toISOString(),
    leadDays,
    occasion,
    channel: input.channel,
    target: input.target ?? null,
    sentAt: null,
    attempts: 0,
    lastError: null,
    createdAt: now.toISOString(),
  };
}

/** How the mail refers to a recurring occasion, in the user's own idiom. */
const RECURRING_WORDING: Readonly<Record<'birthday' | 'anniversary', string>> = {
  birthday: 'birthday',
  anniversary: 'anniversary',
};

function planRecurring(
  input: PlanRemindersInput,
  kind: 'birthday' | 'anniversary',
  value: string | null | undefined,
  today: DateParts,
  now: Date,
): Reminder | null {
  const parsed = findDate(value);
  if (!parsed) return null;
  return buildReminder(input, kind, nextOccurrence(parsed, today), RECURRING_WORDING[kind], now);
}

function planOccasion(input: PlanRemindersInput, today: DateParts, now: Date): Reminder | null {
  const raw = input.nextOccasion?.trim();
  const parsed = findDate(raw);
  if (!raw || !parsed) return null;

  /*
   * `next_occasion` does not recur.
   *
   * It is stored as `YYYY-MM-DD@what it is` and it names one specific evening. If
   * that date has passed, projecting it a year forward the way a birthday is
   * projected would invent an event — there is no second promotion dinner — so a
   * past occasion yields nothing at all.
   */
  const occursOn = ymd(parsed.year, parsed.month, parsed.day);
  if (!isOnOrAfter(parsed, today)) return null;

  // The text after `@` is the user's own words for it. A value with no `@` is
  // still a usable date; it just has no description, so fall back to a neutral one
  // rather than dropping a real occasion over a missing separator.
  const described = raw.slice(raw.indexOf('@') + 1).trim();
  const occasion = raw.includes('@') && described.length > 0 ? described : 'the date you are planning';
  return buildReminder(input, 'occasion', occursOn, occasion, now);
}

/**
 * Every reminder the stored profile implies, soonest first.
 *
 * At most three rows: one per date-bearing field. Callers persist them with
 * `saveReminder`, whose id-keyed write makes re-planning idempotent.
 */
export function planReminders(input: PlanRemindersInput, now: Date): Reminder[] {
  const today = localToday(now);
  const planned = [
    planRecurring(input, 'birthday', input.birthday, today, now),
    planRecurring(input, 'anniversary', input.anniversary, today, now),
    planOccasion(input, today, now),
  ];
  return planned
    .filter((reminder): reminder is Reminder => reminder !== null)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
