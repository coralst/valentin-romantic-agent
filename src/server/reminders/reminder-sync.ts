import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import type { ReminderChannelName } from '../../shared/interfaces/reminder';
import type { StorageInterface } from '../persistence/storage-interface';
import { config } from '../config';
import { logger } from '../logging';
import { planReminders } from './planner';

/**
 * The bridge between "a date landed on the profile" and "a row exists to sweep".
 *
 * A free function rather than a method on `PreferenceExtractor`, following
 * `recordOuting`: the extractor is one caller, not the owner. The panel's manual
 * edits (`setManualValue`) and the demo seed both change exactly the same five
 * values, and each of them is one call to this away from planning reminders too.
 * It also keeps the "must never fail the turn" rule below visible instead of
 * buried among the extractor's private helpers.
 */

/**
 * The profile fields a reminder is derived from.
 *
 * The gate, not documentation: re-planning is two reads and up to four writes, and
 * the overwhelming majority of turns ("she loves Italian") touch none of these. A
 * sync on every extraction would put that cost on every message for nothing.
 */
export const REMINDER_SOURCE_FIELDS: readonly string[] = [
  'birthday',
  'anniversary',
  'next_occasion',
  'reminder_lead_time',
  'notify_email',
];

/** Whether anything just written to the profile changes what should be reminded. */
export function touchesReminders(
  writtenFieldIds: readonly (string | null | undefined)[],
): boolean {
  return writtenFieldIds.some(
    (fieldId) => !!fieldId && REMINDER_SOURCE_FIELDS.includes(fieldId),
  );
}

/**
 * `config.reminders.channel` is an env string, so it can say anything.
 *
 * Narrowed the same way `resolveSender` narrows it — unknown falls back to `log`
 * rather than throwing — so the row records the channel that will actually carry
 * it instead of a name nothing can send on.
 */
function plannedChannel(name: string | undefined): ReminderChannelName {
  return name === 'gmail' ? 'gmail' : 'log';
}

/**
 * The value the user would see for one field: their own correction first.
 *
 * Same precedence as the profile store on screen (`manualValues[f] ??
 * discoveredValues[f]`), and it matters more here than it does there. Someone who
 * fixed the model's guess at her birthday by hand must be reminded on the date
 * they typed; mailing them on the guess is worse than not mailing them at all.
 *
 * Exported because it now has a second caller — `emailSession` in
 * `api/http-routes.ts` resolves `notify_email` the same way to decide where to post
 * a conversation. A third private copy of this two-line precedence is exactly how
 * one of the paths ends up quietly mailing the inferred address after the user
 * corrected it, so there is one implementation and it lives next to the reminder
 * planner that established the rule.
 */
export function profileFieldValue(
  fieldId: string,
  manual: Record<string, string>,
  preferences: readonly PreferenceWithHistory[],
): string | null {
  const inferred = preferences.find((pref) => (pref.fieldId ?? pref.key) === fieldId);
  return manual[fieldId] ?? inferred?.value ?? null;
}

/**
 * Re-derive this session's reminder rows from its current profile.
 *
 * ## Why this swallows its own failures
 *
 * It runs inside a chat turn, after the preference it depends on has already been
 * persisted. A throttled table here must cost a reminder row and a log line, not
 * the user's reply — the same trade `recordOuting` makes, for the same reason. So
 * every failure path logs `reminder.sync_failed` and returns.
 */
export async function syncReminders(
  storage: StorageInterface,
  sessionId: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    const [preferences, manual, existing] = await Promise.all([
      storage.getPreferencesBySession(sessionId),
      storage.getManualValues(sessionId),
      storage.getRemindersBySession(sessionId),
    ]);

    const value = (fieldId: string): string | null =>
      profileFieldValue(fieldId, manual, preferences);

    const planned = planReminders(
      {
        sessionId,
        // Stamped by the store from its own scope on the way in — see
        // `saveReminder` in both stores, which overwrite whatever a caller passes
        // so a row can never claim an owner other than the partition it sits in.
        // There is no userId in scope here and inventing one would only be a lie
        // the store then corrects.
        userId: '',
        birthday: value('birthday'),
        anniversary: value('anniversary'),
        nextOccasion: value('next_occasion'),
        reminderLeadTime: value('reminder_lead_time'),
        channel: plannedChannel(config.reminders.channel),
        target: value('notify_email'),
      },
      now,
    );

    for (const reminder of planned) {
      await storage.saveReminder(sessionId, reminder);
    }
    await reapSuperseded(storage, sessionId, existing, planned.map((r) => r.id));
  } catch (cause) {
    logger.warn('reminder.sync_failed', {
      sessionId,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * Delete the pending rows this plan no longer contains.
 *
 * `saveReminder` being id-keyed handles the easy half: a changed lead time
 * rewrites the same row, because the id is derived from the occasion and not from
 * the due instant. The hard half is a *moved* occasion. Change `next_occasion`
 * from the 12th to the 20th and the id changes with the date, so the write above
 * adds `occasion-2026-03-20` and leaves `occasion-2026-03-12` sitting in the
 * due-index, still pending, still going to be mailed about an evening that is not
 * happening.
 *
 * A sent row is never touched. It is history, and the dispatcher's whole
 * idempotency argument rests on `sentAt` being the record that this reminder has
 * gone out: delete it and the next re-plan is free to recreate the identical row
 * and mail the same person about the same birthday twice.
 */
async function reapSuperseded(
  storage: StorageInterface,
  sessionId: string,
  existing: readonly { id: string; sentAt?: string | null }[],
  plannedIds: readonly string[],
): Promise<void> {
  for (const row of existing) {
    if (row.sentAt || plannedIds.includes(row.id)) continue;
    await storage.deleteReminder(sessionId, row.id);
  }
}
