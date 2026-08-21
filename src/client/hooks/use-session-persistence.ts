import { useCallback, useEffect, useRef } from 'react';
import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceCategory, PreferenceWithHistory } from '../../shared/interfaces/preference';
import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';
import { resolveField } from '../utils/preference-field-mapper';

/**
 * How long to wait after the last change before writing the transcript back to
 * the session store.
 *
 * Messages already arrive as complete units — `RECEIVE_MESSAGE` fires once per
 * agent reply, and the per-character reveal in `use-typewriter` is display-only
 * state that never reaches the reducer — so this is not guarding against a
 * write-per-token. What it coalesces is the *burst* at the end of a turn: a
 * single reply typically lands alongside several `preference_update` events, and
 * each one would otherwise trigger its own `localStorage` serialization of every
 * stored session. One write per settled turn instead of five or six.
 *
 * Kept short so that a switch or a reload a moment after a reply still finds the
 * transcript on disk; the explicit `flush()` on switch and unmount covers the
 * window below it.
 */
export const PERSIST_DEBOUNCE_MS = 400;

/** Flatten the category-keyed preferences record into a storable array. */
export function flattenPreferences(
  preferences: Record<PreferenceCategory, PreferenceWithHistory[]>,
): PreferenceWithHistory[] {
  const flat: PreferenceWithHistory[] = [];
  for (const category of PREFERENCE_CATEGORIES) {
    for (const preference of preferences[category] ?? []) {
      flat.push(preference);
    }
  }
  return flat;
}

/**
 * Derive the partner's name from the extracted preferences, or `undefined` when
 * no preference maps to the `partner_name` profile field.
 *
 * `undefined` is meaningful: `UPDATE_SESSION` treats it as "leave the stored
 * partnerName alone", so a name discovered earlier in the conversation survives
 * later turns that do not mention it. Returning `null` here would erase it.
 */
export function derivePartnerName(
  preferences: PreferenceWithHistory[],
): string | undefined {
  for (let i = preferences.length - 1; i >= 0; i -= 1) {
    const preference = preferences[i];
    if (resolveField(preference.category, preference.key) === 'partner_name') {
      const trimmed = preference.value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}

export interface UseSessionPersistenceOptions {
  /** Live chat transcript, as held by the chat reducer. */
  messages: ChatMessage[];
  /** Live preferences, as held by the preferences reducer. */
  preferences: Record<PreferenceCategory, PreferenceWithHistory[]>;
  /** Writes a transcript into the session with the given id. */
  persistSession: (
    id: string,
    messages: ChatMessage[],
    preferences: PreferenceWithHistory[],
    partnerName?: string | null,
  ) => void;
}

export interface UseSessionPersistenceResult {
  /**
   * Write the current transcript immediately, cancelling any pending debounced
   * write. Call this *before* replacing the live transcript — on session switch
   * and on unmount — so the outgoing conversation is not lost.
   */
  flush: () => void;
  /**
   * Declare which stored session the live transcript now belongs to. Every write
   * is tagged with this id rather than with whichever session happens to be
   * active when the timer fires.
   */
  setOwner: (id: string | null) => void;
}

/**
 * Persists the live chat transcript back into its stored session record.
 *
 * ---
 * IMPORTANT — why writes are tagged with an explicit owner id.
 *
 * The naive version of this hook reads the *currently active* session id when
 * its timer fires. That is a corruption bug waiting to happen. Switching from
 * session A to session B changes the active id immediately, but a write queued
 * while A was on screen still holds A's messages. Firing it against the new
 * active id stamps A's transcript onto B — strictly worse than the data loss it
 * was meant to fix.
 *
 * So `setOwner` records which session the transcript in hand belongs to, and
 * every write is addressed to that id. A late write lands harmlessly on A, where
 * it belongs. `use-session-persistence.test.ts` covers exactly this A/B case.
 *
 * The other half of the guard is `flush()`: because `SWITCH_SESSION` replaces
 * the transcript outright, the outgoing messages have to be written *before* the
 * switch dispatch, not after.
 */
export function useSessionPersistence({
  messages,
  preferences,
  persistSession,
}: UseSessionPersistenceOptions): UseSessionPersistenceResult {
  const ownerIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest values, so flush() can write without being re-created on every
  // keystroke (which would in turn re-run the callers' effects).
  const messagesRef = useRef(messages);
  const preferencesRef = useRef(preferences);
  const persistRef = useRef(persistSession);
  messagesRef.current = messages;
  preferencesRef.current = preferences;
  persistRef.current = persistSession;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const write = useCallback(() => {
    const ownerId = ownerIdRef.current;
    if (!ownerId) return;

    const currentMessages = messagesRef.current;
    const flatPreferences = flattenPreferences(preferencesRef.current);

    // Nothing worth recording yet. This also stops the empty transcript that
    // exists for a beat after a switch from overwriting a stored conversation.
    if (currentMessages.length === 0 && flatPreferences.length === 0) return;

    persistRef.current(
      ownerId,
      currentMessages,
      flatPreferences,
      derivePartnerName(flatPreferences),
    );
  }, []);

  const flush = useCallback(() => {
    clearTimer();
    write();
  }, [clearTimer, write]);

  const setOwner = useCallback((id: string | null) => {
    ownerIdRef.current = id;
  }, []);

  // Debounced write on every settled change to the transcript or preferences.
  useEffect(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      write();
    }, PERSIST_DEBOUNCE_MS);

    return clearTimer;
  }, [messages, preferences, clearTimer, write]);

  // A reload or tab close can land between a reply and the debounce firing.
  useEffect(() => {
    const handlePageHide = () => flush();
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      // Unmounting is the last chance to save the transcript in hand.
      flush();
    };
  }, [flush]);

  return { flush, setOwner };
}
