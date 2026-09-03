/**
 * A message Valentin owes the user at a particular minute, before a date matters.
 *
 * ## Why a stored row and not a scheduled job
 *
 * The obvious shape is "when the occasion is captured, create a timer". That means
 * the ECS task holds `scheduler:CreateSchedule`, a schedule group to manage, a
 * delete on every reschedule, and a second source of truth that can drift from the
 * profile it was derived from. A row in the table it already owns is replayable by
 * hand, survives a task replacement, and can be read by a poller at any worker
 * count.
 *
 * ## Why `dueAt` is an instant and not a date plus a rule
 *
 * The rule — "lead days before the occasion, at nine in the morning, Israel time" —
 * is applied once, at creation, and what is stored is the resulting UTC instant.
 * A dispatcher that re-derived it every sweep would have to know the user's
 * timezone, the lead time and the occasion, and would mail somebody at 03:00 the
 * first time one of those three was missing. An instant is a fact; a rule evaluated
 * later is a bug waiting for a DST boundary.
 *
 * ## Why the id is derived and not random
 *
 * The planner runs again whenever the profile changes — a corrected birthday, a
 * different lead time. With a random id each run would leave the previous reminder
 * standing and the user would get two mails about one birthday. {@link reminderId}
 * is a pure function of what the reminder is *about*, so re-planning overwrites in
 * place and moving an occasion moves its reminder.
 */

/** What a reminder is about, which decides how it is worded and how it recurs. */
export const REMINDER_KINDS = ['birthday', 'anniversary', 'occasion'] as const;

export type ReminderKind = (typeof REMINDER_KINDS)[number];

export function isReminderKind(value: unknown): value is ReminderKind {
  return typeof value === 'string' && (REMINDER_KINDS as readonly string[]).includes(value);
}

/** Where a reminder goes out. `log` is a real channel, not a placeholder. */
export type ReminderChannelName = 'log' | 'gmail';

export interface Reminder {
  /** Derived — see {@link reminderId}. Stable across a re-plan. */
  id: string;

  /**
   * The conversation this belongs to, and the one the mail links back to.
   *
   * On the row as an attribute *as well as* inside the partition key, because the
   * due-index hands the dispatcher an index row and it must know which
   * conversation to resume without parsing the key apart.
   */
  sessionId: string;

  /**
   * Whose reminder it is.
   *
   * Redundant with the partition key for a scoped read, and load-bearing for the
   * dispatcher: it sweeps the due-index across every user, and this is how it gets
   * back to the owner's partition to mark the row sent.
   */
  userId: string;

  kind: ReminderKind;

  /** The occasion's own date, `YYYY-MM-DD`. What the mail is counting down to. */
  occursOn: string;

  /**
   * When to send, as a UTC ISO instant. The only field the dispatcher orders on.
   */
  dueAt: string;

  /** Days of notice this was built with, so the body can say "a week away". */
  leadDays: number;

  /** In the user's words — "her birthday", "our anniversary", "the picnic". */
  occasion: string;

  channel: ReminderChannelName;

  /**
   * Where to send it. An email address today.
   *
   * Nullable because a reminder is worth recording even before there is anywhere
   * to send it: the log channel needs no address, and a row with no target is a
   * visible "I know about this date" rather than a silently dropped one.
   */
  target?: string | null;

  /**
   * When it went out. Null while pending, and that null is the whole index.
   *
   * Set by a conditional write, and the same write drops the row out of the
   * due-index — so a sent reminder is invisible to the poller rather than
   * filtered out of it on every sweep, for ever.
   */
  sentAt?: string | null;

  /** How many times delivery has been tried. Counts failures, not sends. */
  attempts: number;

  /** Why the last attempt failed, for the logs and for a support answer. */
  lastError?: string | null;

  createdAt: string;
}

/**
 * The hour a reminder lands, in the user's day.
 *
 * Nine in the morning: late enough not to wake anyone, early enough that "a week
 * before" still leaves a whole working day to book something.
 */
export const REMINDER_HOUR_LOCAL = 9;

/**
 * The timezone reminders are pinned to.
 *
 * One zone, hardcoded, and it should not stay that way for ever — but a wrong
 * *stored* timezone is worse than a single honest assumption, and there is no field
 * on the profile that holds one yet. `home_city` is the field that will answer this
 * (`timeZoneOf(city)` already exists in the hebcal client); until a reminder is
 * planned from it, every user of this build is in Israel and this says so out loud.
 */
export const REMINDER_ZONE = 'Asia/Jerusalem';

/**
 * The id of the reminder about one occasion.
 *
 * A pure function of the pair that identifies the *occasion*, deliberately not of
 * the lead time or the due instant: changing "a week before" to "two weeks before"
 * must move the existing reminder, not add a second one about the same birthday.
 */
export function reminderId(kind: ReminderKind, occursOn: string): string {
  return `${kind}-${occursOn}`;
}

/**
 * Reminders still waiting to go out, soonest first.
 *
 * Client-side counterpart to the dispatcher's index query, for showing the user
 * what Valentin is going to do before he does it.
 */
export function pendingReminders(reminders: readonly Reminder[]): Reminder[] {
  return reminders
    .filter((reminder) => !reminder.sentAt)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
