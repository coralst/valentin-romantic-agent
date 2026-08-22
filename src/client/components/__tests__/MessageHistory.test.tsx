import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageHistory } from '../MessageHistory';
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

/** Seeds the preferences store, then renders the transcript against it. */
function Harness({
  messages,
  preferences,
}: {
  messages: ChatMessage[];
  preferences: PreferenceWithHistory[];
}) {
  const { state, dispatch } = usePreferencesContext();
  const loaded = Object.values(state.preferences).some((l) => l.length > 0);
  if (!loaded && preferences.length > 0) {
    dispatch({ type: 'LOAD_PREFERENCES', preferences });
  }
  return <MessageHistory messages={messages} />;
}

function renderHistory(messages: ChatMessage[], preferences: PreferenceWithHistory[] = []) {
  return render(
    <PreferencesProvider>
      <Harness messages={messages} preferences={preferences} />
    </PreferencesProvider>,
  );
}

describe('MessageHistory', () => {
  it('renders a bubble per message', () => {
    renderHistory([message('m1', 'agent', 'Hello'), message('m2', 'user', 'Hi')]);
    expect(screen.getAllByTestId('message-bubble')).toHaveLength(2);
  });

  /**
   * Regression: chips were originally keyed off `Preference.sourceMessageId`,
   * which is the *server's* id for the user's message. The transcript renders
   * the optimistic client copy under a locally generated uuid, so the ids never
   * matched and no chip ever appeared in the real app despite the store being
   * correctly populated. Chips must show even when sourceMessageId is unknown.
   */
  it('shows a chip whose sourceMessageId matches no rendered message', () => {
    renderHistory([message('m1', 'agent', 'Hello'), message('m2', 'user', 'She surfs')], [
      preference(),
    ]);

    const chips = screen.getAllByTestId('learned-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('surfing');
  });

  it('pins the chip to the end of the transcript', () => {
    renderHistory([message('m1', 'agent', 'Hello'), message('m2', 'user', 'She surfs')], [
      preference(),
    ]);

    // The chip is a sibling of the last message's bubble, so it reads as a note
    // on the latest exchange rather than floating at the top of the log.
    const bubbles = screen.getAllByTestId('message-bubble');
    const chip = screen.getByTestId('learned-chip');
    expect(bubbles[bubbles.length - 1].parentElement).toBe(chip.parentElement);
  });

  it('renders one chip per discovery', () => {
    renderHistory([message('m1', 'user', 'She surfs and dances')], [
      preference({ id: 'p1', value: 'surfing' }),
      preference({ id: 'p2', value: 'salsa dancing' }),
    ]);
    expect(screen.getAllByTestId('learned-chip')).toHaveLength(2);
  });

  it('hides a dismissed chip without dropping the others', async () => {
    const user = userEvent.setup();
    renderHistory([message('m1', 'user', 'She surfs and dances')], [
      preference({ id: 'p1', value: 'surfing' }),
      preference({ id: 'p2', value: 'salsa dancing' }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Dismiss surfing' }));

    const remaining = screen.getAllByTestId('learned-chip');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].textContent).toContain('salsa dancing');
  });

  it('renders no chips when nothing has been discovered', () => {
    renderHistory([message('m1', 'agent', 'Hello')]);
    expect(screen.queryByTestId('learned-chip')).not.toBeInTheDocument();
  });
});
