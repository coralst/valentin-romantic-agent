import type { Reminder } from '../../shared/interfaces/reminder';
import { REMINDER_ZONE } from '../../shared/interfaces/reminder';
import type { ReminderIndexReader } from '../persistence/storage-interface';
import { config } from '../config';
import { logger } from '../logging';
import { buildReminderEmail } from './email-body';
import type { ReminderSender } from './sender';
import { activityFor, EMPTY_CONTEXT, type ReminderContext } from './suggestions';

/**
 * One sweep of the due-index: read what is ready, claim it, send it.
 *
 * ## Claim first, then send — and what that costs
 *
 * `markSent` is a conditional write that returns false when somebody else already
 * has the row (`ReminderIndexReader`). Two orderings are available and both lose
 * something:
 *
 * - **Send, then claim.** Never drops a reminder. But two containers sweeping the
 *   same second both see the row, both send, and only then does one of them lose
 *   the write — so the user gets two identical "her birthday is a week away" mails
 *   and the second one is unrecoverable.
 * - **Claim, then send.** Exactly one worker ever sends. But the row is already
 *   stamped `sentAt` when the channel throws, so it drops out of the index and is
 *   never retried: a failed send is a lost reminder.
 *
 * This dispatcher claims first, deliberately. A duplicate looks broken to the
 * person receiving it in a way a missing one does not — it reads as an automation
 * out of control, and there is no way to un-send it — whereas a channel that is
 * failing systematically shows up in `reminder.send_failed` within one sweep
 * interval, which is a minute, and can be replanned by hand from the stored row.
 * Note that `sender.send` is contracted to throw on failure and never to swallow,
 * so this branch is real rather than theoretical.
 *
 * On a failed send we call `recordFailure`, and it lands on the row even though the
 * claim has already stamped `sentAt`. That is deliberate on the store side: the
 * expression writes `attempts` and `lastError` and touches neither `sentAt` nor the
 * index keys, so it annotates the claim rather than undoing it. The row therefore
 * carries the reason it never arrived, and is still not retried — which is the whole
 * bargain above. A row with `sentAt` set and `attempts > 0` is the signature of a
 * dropped reminder, and it is queryable rather than only greppable in the logs.
 */

export interface DispatchSummary {
  /** Rows the index handed back for this sweep. */
  considered: number;
  sent: number;
  /** Claimed by another worker, or unaddressable. Not an error either way. */
  skipped: number;
  /** Claimed by us, then the channel threw. */
  failed: number;
}

export interface DispatchOptions {
  /**
   * How many rows one sweep will attempt.
   *
   * Bounded for the reason `dueBefore` documents: a sweep that fell behind must
   * take a slice rather than time out on the whole backlog every interval.
   */
  limit?: number;
  /** Where the app lives, for the resume link in the mail. */
  origin?: string;
  /**
   * What the mail should be *about*, resolved per row before the claim.
   *
   * Injected rather than read here because the dispatcher holds a
   * {@link ReminderIndexReader} — a cross-tenant view of the due-index and nothing
   * else — and composing a reminder needs one session's profile. Widening this
   * parameter into a full storage handle would give a sweeper that walks every user's
   * rows the ability to read every user's answers, which is a boundary worth keeping
   * even inside one process. `scheduler.ts` supplies the real resolver from a scoped
   * factory; `reminderContextFor` in `suggestions.ts` is that function.
   *
   * Called *before* `markSent`, so a slow or failing profile read costs a sweep and
   * not a claimed-but-unsent row — and it is contracted not to throw, for the same
   * reason. Absent ⇒ the mail is the date and the link, which is what it was before.
   */
  context?: (reminder: Reminder) => Promise<ReminderContext>;
}

const DEFAULT_LIMIT = 25;

/**
 * The origin the resume link points at.
 *
 * `config.publicOrigin` rather than a second read of `PUBLIC_ORIGIN`, so a mail's
 * resume link and an OAuth callback cannot disagree about which host the user is
 * on. It falls back rather than throwing there, because a wrong origin costs a
 * dead link in a mail and not a failed send.
 */
function defaultOrigin(): string {
  return config.publicOrigin;
}

/**
 * The occasion's calendar date as a `Date` whose *local* fields read correctly.
 *
 * `email-body.ts` formats with `getDate()`/`getMonth()`, so it wants a date in the
 * process's own calendar rather than an instant. Built from the `YYYY-MM-DD` parts
 * directly; `new Date('2026-06-12')` would be parsed as UTC midnight and render as
 * the 11th anywhere west of Greenwich.
 */
function occasionDateOf(occursOn: string): Date {
  const [year, month, day] = occursOn.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

/**
 * Days from `now` to the occasion, counted in whole local days.
 *
 * Recomputed rather than taken from `reminder.leadDays`, which is the notice the
 * row was *planned* with. If a deploy delayed this sweep by a day, `leadDays`
 * would have the mail say "a week away" about something six days off — and the
 * one thing a reminder must get right is the number in its subject line.
 */
function daysUntil(occursOn: string, now: Date): number {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [ty, tm, td] = today.split('-').map(Number);
  const [oy, om, od] = occursOn.split('-').map(Number);
  return Math.round((Date.UTC(oy, om - 1, od) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

function bodyFor(reminder: Reminder, now: Date, origin: string, context: ReminderContext) {
  return buildReminderEmail({
    occasion: reminder.occasion,
    partnerName: context.partnerName,
    // Set only on a reminder the user asked for by name, and then it is the whole
    // subject — see `ReminderEmailInput.title` for why it cannot just be `occasion`.
    title: reminder.title,
    occasionDate: occasionDateOf(reminder.occursOn),
    daysUntil: daysUntil(reminder.occursOn, now),
    /*
     * Composed before the claim by `DispatchOptions.context`, never here. With no
     * resolver this is `EMPTY_CONTEXT` and the body falls back to saying it has not
     * found anything yet, which is honest and still names the date.
     */
    activity: context.activity,
    criteria: context.criteria,
    suggestions: context.suggestions,
    ideas: context.ideas,
    timingNote: context.timingNote,
    origin,
    sessionId: reminder.sessionId,
  });
}

/** Deliver one claimed reminder. Returns whether it went out. */
async function deliver(
  reader: ReminderIndexReader,
  sender: ReminderSender,
  reminder: Reminder,
  to: string,
  now: Date,
  origin: string,
  context: ReminderContext,
): Promise<boolean> {
  try {
    await sender.send(to, bodyFor(reminder, now, origin, context));
    logger.info('reminder.sent', {
      reminderId: reminder.id,
      channel: sender.channel,
      kind: reminder.kind,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Error level, not warn: the row is already claimed, so this reminder is gone
    // and a human is the only thing that can still send it.
    logger.error('reminder.send_failed', {
      reminderId: reminder.id,
      channel: sender.channel,
      error: message,
    });
    await reader.recordFailure(reminder, message);
    return false;
  }
}

export async function dispatchDue(
  reader: ReminderIndexReader,
  sender: ReminderSender,
  now: Date,
  options?: DispatchOptions,
): Promise<DispatchSummary> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const origin = options?.origin ?? defaultOrigin();
  const due = await reader.dueBefore(now, limit);
  const summary: DispatchSummary = { considered: due.length, sent: 0, skipped: 0, failed: 0 };

  for (const reminder of due) {
    const target = reminder.target;
    // A row with no address cannot be sent to anyone. Worth having — it is a
    // visible "I know about this date" — so it is a skip and a log line, never a
    // throw that would abandon the rest of the batch.
    if (!target) {
      summary.skipped += 1;
      logger.warn('reminder.no_target', { reminderId: reminder.id, kind: reminder.kind });
      continue;
    }

    // Before the claim on purpose: this is the only step that reads another table,
    // and a claimed row whose composition hung is a reminder nobody will ever get.
    const context = options?.context
      ? await options.context(reminder)
      : { ...EMPTY_CONTEXT, activity: activityFor(reminder) };

    // The claim. False means another worker owns this send; moving on without
    // sending is the entire reason two containers are safe.
    const claimed = await reader.markSent(reminder, now);
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }

    if (await deliver(reader, sender, reminder, target, now, origin, context)) summary.sent += 1;
    else summary.failed += 1;
  }

  return summary;
}
