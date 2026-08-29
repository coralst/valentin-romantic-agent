import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MessageHistory } from '../MessageHistory';
import { LEARNED_STATUS_DWELL_MS } from '../LearnedStatus';
import { PreferencesProvider, usePreferencesContext } from '../../context/preferences-context';
import type { ChatMessage } from '../../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

function message(id: string, sender: 'agent' | 'user', content: string): ChatMessage {
  return { id, sessionId: 's1', sender, content, timestamp: new Date().toISOString() };
}

function preference(overrides: Partial<PreferenceWithHistory> = {}): PreferenceWithHistory {
  return {
    id: 'p1',
    sessionId: 's1',
    category: 'hobbies',
    key: 'favorite_sport',
    value: 'surfing',
    confidence: 1,
    // Deliberately an id that is NOT in the transcript — see the test below.
    sourceMessageId: 'server-side-id-the-client-never-saw',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    ...overrides,
  };
}

/**
 * Seeds the preferences store, then renders the transcript against it.
 *
 * `how` matters: `'live'` is a `preference_update` arriving over the socket, which
 * is a discovery and is announced; `'hydrated'` is a session being loaded, which is
 * the same rows carrying no news at all.
 */
function Harness({
  messages,
  preferences,
  how = 'live',
}: {
  messages: ChatMessage[];
  preferences: PreferenceWithHistory[];
  how?: 'live' | 'hydrated';
}) {
  const { state, dispatch } = usePreferencesContext();
  const loaded = Object.values(state.preferences).some((l) => l.length > 0);
  if (!loaded && preferences.length > 0) {
    if (how === 'hydrated') {
      dispatch({ type: 'LOAD_PREFERENCES', preferences });
    } else {
      for (const preference of preferences) dispatch({ type: 'ADD_PREFERENCE', preference });
    }
  }
  const stored = Object.values(state.preferences)
    .flat()
    .map((p) => p.value)
    .join(',');
  return (
    <>
      <MessageHistory messages={messages} />
      {/* Stands in for the profile panel: what the store still holds. */}
      <div data-testid="store-probe">{stored}</div>
    </>
  );
}

function renderHistory(
  messages: ChatMessage[],
  preferences: PreferenceWithHistory[] = [],
  how: 'live' | 'hydrated' = 'live',
) {
  return render(
    <PreferencesProvider>
      <Harness messages={messages} preferences={preferences} how={how} />
    </PreferencesProvider>,
  );
}

describe('MessageHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a bubble per message', () => {
    renderHistory([message('m1', 'agent', 'Hello'), message('m2', 'user', 'Hi')]);
    expect(screen.getAllByTestId('message-bubble')).toHaveLength(2);
  });

  /**
   * Regression: the announcement was originally keyed off
   * `Preference.sourceMessageId`, which is the *server's* id for the user's
   * message. The transcript renders the optimistic client copy under a locally
   * generated uuid, so the ids never matched and nothing was ever announced in
   * the real app despite the store being correctly populated. The status line
   * must show even when sourceMessageId matches no rendered message.
   */
  it('announces a discovery whose sourceMessageId matches no rendered message', () => {
    renderHistory([message('m1', 'agent', 'Hello'), message('m2', 'user', 'She surfs')], [
      preference(),
    ]);

    expect(screen.getByTestId('learned-status').textContent).toContain('surfing');
  });

  /**
   * Replaces "pins the chip to the end of the transcript". The announcement is no
   * longer a sibling of the message that produced it: it sits at the tail of the
   * transcript, below every bubble, so its arrival and its self-erasure four
   * seconds later cannot displace anything the user is reading.
   */
  it('puts the announcement at the tail of the transcript, below every bubble', () => {
    renderHistory([message('m1', 'agent', 'Hello'), message('m2', 'user', 'She surfs')], [
      preference(),
    ]);

    const slot = screen.getByTestId('learned-status-slot');
    for (const bubble of screen.getAllByTestId('message-bubble')) {
      // Node.DOCUMENT_POSITION_FOLLOWING — the slot comes after every bubble.
      expect(bubble.compareDocumentPosition(slot) & 4).toBeTruthy();
    }
  });

  /**
   * One sentence routinely teaches Valentin two unrelated things, and the server
   * is right to report them as two `preference_update` events — merging them
   * would corrupt the dossier. Two near-identical announcements read as a bug, so
   * the transcript states them on one line. This used to expect one card per
   * discovery, then one card with a row per discovery.
   */
  it('collapses the discoveries from one exchange onto a single line', () => {
    renderHistory([message('m1', 'user', 'She surfs and dances')], [
      preference({ id: 'p1', value: 'surfing' }),
      preference({ id: 'p2', value: 'salsa dancing' }),
    ]);

    expect(screen.getAllByTestId('learned-status')).toHaveLength(1);
    expect(screen.getByTestId('learned-status-values').textContent).toBe(
      'surfing · salsa dancing',
    );
  });

  /**
   * The point of the change: the transcript goes back to being nothing but the
   * conversation. The discovery itself is untouched — it is real profile data and
   * stays in the store for the profile panel to render.
   */
  it('clears the announcement without unlearning the discovery', () => {
    renderHistory([message('m1', 'user', 'She surfs')], [
      preference({ id: 'p1', value: 'surfing' }),
    ]);

    act(() => {
      vi.advanceTimersByTime(LEARNED_STATUS_DWELL_MS);
    });

    expect(screen.queryByTestId('learned-status')).not.toBeInTheDocument();
    expect(screen.getByTestId('store-probe').textContent).toBe('surfing');
  });

  /**
   * Once said, stay said. The transcript re-renders on every keystroke in the
   * composer and on every streamed token of Valentin's reply; if any of those
   * re-raised the announcement the line would never actually clear.
   */
  it('does not re-announce a discovery it has already announced', () => {
    const { rerender } = renderHistory([message('m1', 'user', 'She surfs')], [
      preference({ id: 'p1', value: 'surfing' }),
    ]);

    act(() => {
      vi.advanceTimersByTime(LEARNED_STATUS_DWELL_MS);
    });
    rerender(
      <PreferencesProvider>
        <Harness messages={[message('m1', 'user', 'She surfs')]} preferences={[]} />
      </PreferencesProvider>,
    );

    expect(screen.queryByTestId('learned-status')).not.toBeInTheDocument();
  });

  it('announces nothing when nothing has been discovered', () => {
    renderHistory([message('m1', 'agent', 'Hello')]);
    expect(screen.queryByTestId('learned-status')).not.toBeInTheDocument();
  });

  /**
   * REGRESSION GUARD: switching into a conversation must not re-announce its
   * dossier.
   *
   * The announcement used to be decided by diffing against a ref, which resets on
   * remount — and a session switch remounts the transcript, so returning to a
   * conversation flashed "✓ noted" at every fact it had ever learned. The store now
   * distinguishes a loaded row from an extracted one; this holds that line, because
   * the ref alone cannot.
   */
  it('says nothing about facts that arrived with a loaded conversation', () => {
    renderHistory(
      [message('m1', 'user', 'She surfs'), message('m2', 'agent', 'Noted.')],
      [preference({ id: 'p1', value: 'surfing' }), preference({ id: 'p2', value: 'salsa' })],
      'hydrated',
    );

    expect(screen.queryByTestId('learned-status')).not.toBeInTheDocument();
    // The facts are still there — it is the announcement that is wrong, not the data.
    expect(screen.getByTestId('store-probe').textContent).toContain('surfing');
  });
  /*
   * The transcript is at its widest exactly when it is at its shortest — a new
   * session on a wide screen with the architecture drawer open — so an unfilled
   * transcript used to render several hundred pixels of blank cream between the
   * header and the composer, which reads as a failed render rather than as a
   * conversation waiting to start.
   */
  describe('an empty transcript', () => {
    it('says what to do instead of leaving the column blank', () => {
      renderHistory([]);
      expect(screen.getByTestId('transcript-empty')).toBeInTheDocument();
    });

    it('gets out of the way as soon as anything is said', () => {
      renderHistory([message('m1', 'agent', 'Hello')]);
      expect(screen.queryByTestId('transcript-empty')).not.toBeInTheDocument();
    });
  });
});
