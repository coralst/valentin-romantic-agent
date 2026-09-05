import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ShowThinkingToggle,
  SHOW_THINKING_LABEL,
  SHOW_THINKING_HINT,
} from '../ShowThinkingToggle';
import { ChatProvider, useChatContext } from '../../context/chat-context';
import { SHOW_THINKING_STORAGE_KEY } from '../../hooks/use-show-thinking';

/** Reports what the next `send_message` would actually carry. */
function ThinkingProbe() {
  const { state } = useChatContext();
  return <span data-testid="probe">{state.showThinking ? 'on' : 'off'}</span>;
}

function renderToggle() {
  return render(
    <ChatProvider>
      <ShowThinkingToggle />
      <ThinkingProbe />
    </ChatProvider>,
  );
}

describe('ShowThinkingToggle', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts off, because thinking retunes the voice and costs tokens', () => {
    renderToggle();

    expect(screen.getByTestId('show-thinking-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('probe')).toHaveTextContent('off');
  });

  it('is a pressable button with a stable name', () => {
    renderToggle();

    const button = screen.getByRole('button', { name: new RegExp(SHOW_THINKING_LABEL) });
    expect(button).toHaveAttribute('type', 'button');
  });

  it('turns reasoning on for the next message', async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByTestId('show-thinking-toggle'));

    expect(screen.getByTestId('show-thinking-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('probe')).toHaveTextContent('on');
    expect(localStorage.getItem(SHOW_THINKING_STORAGE_KEY)).toBe('true');
  });

  it('turns it back off again', async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByTestId('show-thinking-toggle'));
    await user.click(screen.getByTestId('show-thinking-toggle'));

    expect(screen.getByTestId('probe')).toHaveTextContent('off');
    expect(localStorage.getItem(SHOW_THINKING_STORAGE_KEY)).toBe('false');
  });

  it('restores the preference on the next visit', () => {
    localStorage.setItem(SHOW_THINKING_STORAGE_KEY, 'true');

    renderToggle();

    expect(screen.getByTestId('show-thinking-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('probe')).toHaveTextContent('on');
  });

  it('stays off when the stored value is not a boolean', () => {
    localStorage.setItem(SHOW_THINKING_STORAGE_KEY, '{"showThinking":true}');

    renderToggle();

    // A hand-edited or half-written value must not be able to switch a mode that
    // spends thinking tokens and retunes the persona voice.
    expect(screen.getByTestId('probe')).toHaveTextContent('off');
  });

  it('still works when storage is unavailable', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    renderToggle();

    await user.click(screen.getByTestId('show-thinking-toggle'));

    // A private-mode browser costs the memory, never the toggle.
    expect(screen.getByTestId('probe')).toHaveTextContent('on');
  });

  it('says out loud that it applies to the next message', () => {
    renderToggle();

    const hint = screen.getByTestId('show-thinking-hint');
    expect(hint).toHaveTextContent(SHOW_THINKING_HINT);
    // Reasoning is requested per turn and never stored, so nothing can be filled
    // in behind the user — the description is what stops that reading as a bug.
    expect(screen.getByTestId('show-thinking-toggle')).toHaveAttribute(
      'aria-describedby',
      hint.id,
    );
  });
});
