import { useCallback, useEffect } from 'react';
import { useChatContext } from '../context/chat-context';

/**
 * Where the preference lives between visits.
 *
 * App-wide rather than per-session, unlike the profile store's keys: turning
 * reasoning on, switching conversation and finding it off again is the surprising
 * outcome, and the setting describes how the user wants to watch Valentin work
 * rather than anything about one conversation.
 */
export const SHOW_THINKING_STORAGE_KEY = 'valentin.showThinking';

/**
 * Read the stored preference, defaulting to off.
 *
 * Everything that is not exactly `'true'` is off, and any storage failure is off —
 * a private-mode browser, a disabled-storage policy or a hand-edited value must not
 * be able to switch a mode that costs thinking tokens and retunes the persona voice
 * to `temperature: 1`. The defensive shape is `use-profile-store.ts`'s.
 */
export function readStoredShowThinking(): boolean {
  try {
    return localStorage.getItem(SHOW_THINKING_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Persist the preference; a failure costs the memory, never the toggle. */
function storeShowThinking(showThinking: boolean): void {
  try {
    localStorage.setItem(SHOW_THINKING_STORAGE_KEY, showThinking ? 'true' : 'false');
  } catch {
    // Storage unavailable. The toggle still works for this session, which is the
    // half of the behaviour the user is looking at.
  }
}

/**
 * The reasoning toggle, restored on mount and remembered on change.
 *
 * The value itself lives in `ChatState` rather than in this hook, so `handleSubmit`
 * reads it from the same place it reads `inputValue` — the alternative is a second
 * source of truth for something that has to be attached to an outgoing frame.
 */
export function useShowThinking(): {
  showThinking: boolean;
  setShowThinking: (next: boolean) => void;
} {
  const { state, dispatch } = useChatContext();

  useEffect(() => {
    const stored = readStoredShowThinking();
    // Only when it is on: the reducer starts off, so dispatching `false` here would
    // be a no-op render on every mount.
    if (stored) dispatch({ type: 'SET_SHOW_THINKING', showThinking: true });
  }, [dispatch]);

  const setShowThinking = useCallback(
    (next: boolean) => {
      dispatch({ type: 'SET_SHOW_THINKING', showThinking: next });
      storeShowThinking(next);
    },
    [dispatch],
  );

  return { showThinking: state.showThinking, setShowThinking };
}
