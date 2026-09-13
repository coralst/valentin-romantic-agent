import { isPlannerKind, pendingReminders, type Reminder } from '../../shared/interfaces/reminder';
import { mutedReminderKinds } from '../../shared/constants/profile-fields';
import type { StorageInterface } from '../persistence/storage-interface';
import { profileFieldValue, syncReminders } from './reminder-sync';

/**
 * Stopping a reminder, by whichever of the two mechanisms actually holds.
 *
 * ## Why this is one function and not a branch at each call site
 *
 * A reminder can be cancelled from three places — the agent's `cancel_reminder`, the
 * Cancel button on the profile page, and any future one — and the correct write
 * depends on where the row came from:
 *
 * - A **`custom`** row is his own note. Deleting it is the whole story.
 * - A **planner** row (birthday, anniversary, occasion) is *derived*. `syncReminders`
 *   rebuilds it from her profile on every edit to a reminder field, so deleting it
 *   succeeds, visibly, and then silently comes back the next time anything touches the
 *   profile. Muting the kind is the write that lasts; `reapSuperseded` then removes the
 *   armed row on the same sync.
 *
 * The first implementation of this put the branch in the client and had the route
 * refuse a planner delete with a 409. That is defensible and it was wrong in practice:
 * it duplicated the mute-merge — which has to be *additive*, or muting her birthday
 * un-mutes the anniversary he silenced last week — into every caller, and a caller
 * that got it wrong would silently widen or narrow what he hears about. One
 * implementation, server-side, is the only version of this that cannot drift.
 *
 * ## Why the mute is read back rather than passed in
 *
 * The current `reminders_muted` value is read here, from the store, rather than taken
 * as an argument. A caller passing its own copy is a caller racing another tab, and the
 * losing write silently un-mutes a kind.
 */

export type CancelAction = 'deleted' | 'muted' | 'not-found';

export interface CancelOutcome {
  action: CancelAction;
  /** The row that was cancelled, for a caller that wants to name it back. */
  reminder: Reminder | null;
  /** Every kind now muted, after the merge. Empty unless `action` is `muted`. */
  muted: readonly string[];
}

/** The profile field holding the muted kinds, as `mutedReminderKinds` parses it. */
export const MUTED_FIELD = 'reminders_muted';

/**
 * Cancel one reminder so that it stays cancelled.
 *
 * Only pending rows are candidates. A sent row is the idempotency record that stops
 * `syncReminders` re-arming the same occasion, so cancelling one would re-open a
 * reminder that has already gone out — and there is nothing left to cancel anyway.
 */
export async function cancelReminderDurably(
  storage: StorageInterface,
  sessionId: string,
  reminderId: string,
): Promise<CancelOutcome> {
  const pending = pendingReminders(await storage.getRemindersBySession(sessionId));
  const reminder = pending.find((row) => row.id === reminderId);

  if (!reminder) return { action: 'not-found', reminder: null, muted: [] };

  if (!isPlannerKind(reminder.kind)) {
    await storage.deleteReminder(sessionId, reminder.id);
    return { action: 'deleted', reminder, muted: [] };
  }

  const [manual, preferences] = await Promise.all([
    storage.getManualValues(sessionId),
    storage.getPreferencesBySession(sessionId),
  ]);
  const already = mutedReminderKinds(profileFieldValue(MUTED_FIELD, manual, preferences));
  const muted = [...new Set<string>([...already, reminder.kind])];

  await storage.setManualValue(sessionId, MUTED_FIELD, muted.join(', '));
  /*
   * The mute is only half the write.
   *
   * It stops the *next* plan from arming this kind. The row already in the table is
   * still in the due-index and would still be mailed — `reapSuperseded`, inside
   * `syncReminders`, is what removes it. Without this line the user watches the
   * reminder disappear from the page and then receives it anyway, which is the exact
   * failure this whole function exists to prevent.
   */
  await syncReminders(storage, sessionId);

  return { action: 'muted', reminder, muted };
}
