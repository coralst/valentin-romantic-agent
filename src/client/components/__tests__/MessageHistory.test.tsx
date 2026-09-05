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
    renderHistory([message('m1', 'user', 'She surfs'), message('m2', 'agent', 'Noted.')], [
      preference({ id: 'p1', value: 'surfing', sourceMessageId: 'm1' }),
    ]);

    act(() => {
      vi.advanceTimersByTime(LEARNED_STATUS_DWELL_MS);
    });

    expect(screen.queryByTestId('learned-status')).not.toBeInTheDocument();
    expect(screen.getByTestId('store-probe').textContent).toBe('surfing');
    // And the transcript still says so. The transient going is the moment ending,
    // not the record being thrown away — which is what it used to mean.
    expect(screen.getByTestId('noted-badge-values').textContent).toBe('surfing');
  });

  /**
   * Once said, stay said. The transcript re-renders on every keystroke in the
   * composer and on every streamed token of Valentin's reply; if any of those
   * re-raised the announcement the line would never actually clear.
   */
  it('does not re-announce a discovery it has already announced', () => {
    const transcript = [message('m1', 'user', 'She surfs'), message('m2', 'agent', 'Noted.')];
    const { rerender } = renderHistory(transcript, [
      preference({ id: 'p1', value: 'surfing', sourceMessageId: 'm1' }),
    ]);

    act(() => {
      vi.advanceTimersByTime(LEARNED_STATUS_DWELL_MS);
    });
    rerender(
      <PreferencesProvider>
        <Harness messages={transcript} preferences={[]} />
      </PreferencesProvider>,
    );

    expect(screen.queryByTestId('learned-status')).not.toBeInTheDocument();
    // The badge is not an announcement, so re-rendering it is not re-announcing.
    // It is silent by construction — no live region — precisely so it can persist.
    expect(screen.getByTestId('noted-badge-values').textContent).toBe('surfing');
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

  /**
   * The other half of the split, and the single most important test in the change:
   * this is exactly where "announcing novelty" and "recording the fact" diverge.
   *
   * `LOAD_PREFERENCES` empties `discovered` on purpose, so the transient stays
   * silent (above). The badge is derived from `preferences` instead, so it is
   * present on the first paint after a hard reload — which is the whole ask: the
   * mark must survive the conversation moving on, and survive the page going away.
   */
  it('still marks the message a loaded fact came from', () => {
    renderHistory(
      [message('m1', 'user', 'She surfs'), message('m2', 'agent', 'Noted.')],
      [preference({ id: 'p1', value: 'surfing', sourceMessageId: 'm1' })],
      'hydrated',
    );

    expect(screen.queryByTestId('learned-status')).not.toBeInTheDocument();
    expect(screen.getByTestId('noted-badge-values').textContent).toBe('surfing');
  });

  describe('the permanent marker', () => {
    it('waits until its message is no longer the tail', () => {
      // Mid-turn the user's message is the tail and the transient is covering it.
      // Two markers saying the same thing at once is what the delay prevents.
      renderHistory([message('m1', 'user', 'She surfs')], [
        preference({ id: 'p1', value: 'surfing', sourceMessageId: 'm1' }),
      ]);

      expect(screen.queryByTestId('noted-badge')).not.toBeInTheDocument();
      expect(screen.getByTestId('learned-status')).toBeInTheDocument();
    });

    it('appears once the reply lands', () => {
      const { rerender } = renderHistory([message('m1', 'user', 'She surfs')], [
        preference({ id: 'p1', value: 'surfing', sourceMessageId: 'm1' }),
      ]);

      rerender(
        <PreferencesProvider>
          <Harness
            messages={[message('m1', 'user', 'She surfs'), message('m2', 'agent', 'Noted.')]}
            preferences={[]}
          />
        </PreferencesProvider>,
      );

      expect(screen.getByTestId('noted-badge-values').textContent).toBe('surfing');
    });

    it('marks nothing under a message that taught Valentin nothing', () => {
      renderHistory(
        [message('m1', 'user', 'Hello'), message('m2', 'agent', 'Hi')],
        [preference({ id: 'p1', value: 'surfing', sourceMessageId: 'some-other-message' })],
        'hydrated',
      );

      expect(screen.queryByTestId('noted-badge')).not.toBeInTheDocument();
    });

    it('puts two facts from one message on one marker', () => {
      renderHistory(
        [message('m1', 'user', 'She surfs and dances'), message('m2', 'agent', 'Noted.')],
        [
          preference({ id: 'p1', value: 'surfing', sourceMessageId: 'm1' }),
          preference({ id: 'p2', value: 'salsa dancing', sourceMessageId: 'm1' }),
        ],
        'hydrated',
      );

      expect(screen.getAllByTestId('noted-badge')).toHaveLength(1);
      expect(screen.getByTestId('noted-badge-values').textContent).toBe(
        'surfing · salsa dancing',
      );
    });
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

  /**
   * THE USER'S REPRO: "the gradual typing of last message when enter to it … (the
   * behavior is good as reaction to you send something)".
   *
   * "Newest agent message" was the whole condition for the reveal, and it is true
   * of a conversation being opened as much as of a reply arriving — so entering
   * one re-typed Valentin's last line at the user, which reads as the app
   * rewriting what he had already said. Which of the two it is cannot be read off
   * the message; it comes from `ChatState.liveMessageIds`.
   */
  describe('the reveal on the newest reply', () => {
    /** The presentational span — the one the typewriter drives. */
    function revealed(): string {
      const bubbles = screen.getAllByTestId('message-bubble');
      const last = bubbles[bubbles.length - 1];
      return last.querySelector('[aria-hidden="true"]')?.textContent ?? '';
    }

    const line = 'A reply long enough that a re-type would be unmistakable.';

    it('does not replay it for a transcript that was loaded', () => {
      // No live ids at all: this is the entry case, whatever the timestamps say.
      render(
        <PreferencesProvider>
          <MessageHistory messages={[message('entry-user', 'user', 'Hi'), message('entry-agent', 'agent', line)]} />
        </PreferencesProvider>,
      );

      expect(revealed()).toBe(line);
    });

    it('still plays it for a reply that just arrived', () => {
      render(
        <PreferencesProvider>
          <MessageHistory
            messages={[message('live-user', 'user', 'Hi'), message('live-agent', 'agent', line)]}
            liveMessageIds={new Set(['live-agent'])}
          />
        </PreferencesProvider>,
      );

      // Mid-reveal, so the presentational text is still empty — the behaviour the
      // user explicitly asked to keep for messages sent in front of them.
      expect(revealed()).toBe('');
    });

    it('leaves an older reply alone even while a new one is revealing', () => {
      render(
        <PreferencesProvider>
          <MessageHistory
            messages={[
              message('earlier-agent', 'agent', 'Said earlier.'),
              message('newest-agent', 'agent', line),
            ]}
            liveMessageIds={new Set(['newest-agent'])}
          />
        </PreferencesProvider>,
      );

      const first = screen.getAllByTestId('message-bubble')[0];
      expect(first.querySelector('[aria-hidden="true"]')?.textContent).toBe('Said earlier.');
    });
  });
});
