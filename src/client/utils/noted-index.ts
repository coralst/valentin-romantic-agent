import type { PreferenceCategory, PreferenceWithHistory } from '../../shared/interfaces/preference';
import { DEMO_SEED_SOURCE_MESSAGE_ID } from './provenance';

/**
 * Which facts are on the record against which message, for the permanent "Noted"
 * badge under the user's own turn.
 *
 * ---
 * WHY THIS READS `preferences` AND NEVER `discovered`
 *
 * `PreferencesState` carries both, and they answer different questions.
 * `discovered` answers *"is this news?"* — it is deliberately emptied by
 * `LOAD_PREFERENCES` (`use-preferences-state.ts:139-157`) so that switching into a
 * conversation does not flash "noted" at week-old facts. This index answers
 * *"what is on the record?"*, which does not change when you reload the page.
 *
 * Reading `discovered` here would make the permanent marker vanish on reload —
 * the exact bug this file exists to fix. The two are meant to diverge: the
 * transient line announces novelty, the badge records the fact.
 *
 * Because it derives from persisted preferences, every badge is present on the
 * first paint after a reload. There is no pop-in and nothing to hydrate.
 *
 * ---
 * WHY THE JOIN WORKS AT ALL
 *
 * `sourceMessageId` used to hold the *server's* id for the user's turn while the
 * transcript rendered an optimistic copy under a locally minted uuid, so a lookup
 * keyed on it missed every time. The client now sends its uuid with the turn and
 * the server adopts it after validating it as a v4 uuid, so the transcript, the
 * DynamoDB row and the stored session copy all name the message the same way.
 *
 * Rows written before that — and rows loaded from an older session — point at a
 * server id that matches nothing in the transcript. They are not an error: they
 * simply carry no badge, which is the honest outcome for a fact whose originating
 * message cannot be identified.
 */

/** Message id → the values recorded from that message, in insertion order. */
export type NotedIndex = ReadonlyMap<string, readonly string[]>;

const EMPTY_INDEX: NotedIndex = new Map();

/**
 * Groups every known preference by the message that produced it.
 *
 * Pure and total: takes the store's `preferences` record, returns a map. Nothing
 * is filtered against the transcript here — a caller that renders per message
 * looks its own id up and gets nothing for ids it does not hold, which is the
 * same answer a pre-filter would have produced with more work.
 */
export function buildNotedIndex(
  preferences: Partial<Record<PreferenceCategory, readonly PreferenceWithHistory[]>>,
): NotedIndex {
  const index = new Map<string, string[]>();

  for (const list of Object.values(preferences)) {
    for (const preference of list ?? []) {
      const messageId = preference.sourceMessageId;
      // Seeded demo rows point at a synthetic id and were never said by anyone, so
      // a badge under them would claim a conversation that never happened.
      if (!messageId || messageId === DEMO_SEED_SOURCE_MESSAGE_ID) continue;

      const existing = index.get(messageId);
      if (existing) {
        // One message routinely teaches Valentin two unrelated things, and the
        // store is right to hold them as separate rows. The badge shows them on
        // one line rather than stacking two markers under one bubble.
        if (!existing.includes(preference.value)) existing.push(preference.value);
      } else {
        index.set(messageId, [preference.value]);
      }
    }
  }

  return index.size === 0 ? EMPTY_INDEX : index;
}
