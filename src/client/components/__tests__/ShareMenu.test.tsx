import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareMenu } from '../ShareMenu';

/**
 * Handing one conversation to somebody.
 *
 * The failure paths carry the weight here, because each of the three actions fails
 * in its own way and each failure has a different honest answer: a clipboard that
 * refuses must still leave the URL somewhere it can be copied by hand, and a 409 on
 * the email route is a fixable state whose fix is named only in the server's own
 * sentence. The other load-bearing assertion is negative: the warning about a public
 * link is on screen *before* the link is minted, not after.
 */

const api = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('../../utils/api-client', () => ({
  apiPostJsonExplained: (path: string, body?: unknown) => api.post(path, body),
}));

/** Replaces `navigator.clipboard` for one test. `null` removes it entirely. */
function clipboardThat(writeText: ((text: string) => Promise<void>) | null): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

function copies(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(async () => {});
  clipboardThat(writeText);
  return writeText;
}

function refusesToCopy(): void {
  clipboardThat(async () => {
    throw new Error('Document is not focused');
  });
}

async function openMenu(): Promise<void> {
  await userEvent.click(screen.getByTestId('share-trigger'));
}

beforeEach(() => {
  api.post.mockReset();
  copies();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ShareMenu', () => {
  it('renders nothing until there is a conversation to share', () => {
    const { container } = render(<ShareMenu sessionId={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('is a closed popover until the trigger is pressed', async () => {
    render(<ShareMenu sessionId="sess-1" />);

    const trigger = screen.getByTestId('share-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('share-popover')).toBeNull();

    await openMenu();

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Share this conversation' })).toBeInTheDocument();
  });

  it('warns about a public link before one exists, not after', async () => {
    render(<ShareMenu sessionId="sess-1" />);
    await openMenu();

    expect(screen.getByTestId('share-public-warning')).toHaveTextContent(
      'Anyone holding this link can read this conversation',
    );
    expect(screen.getByTestId('share-public-warning')).toHaveTextContent('for 7 days');
    // The warning is not the consequence of having pressed the button.
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByTestId('share-public-expiry')).toBeNull();
  });

  describe('copy my link', () => {
    it('copies the resume link and says it only opens for you', async () => {
      const writeText = copies();
      render(<ShareMenu sessionId="sess-1" />);
      await openMenu();

      await userEvent.click(screen.getByTestId('share-copy-mine'));

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(writeText.mock.calls[0][0]).toContain('/?s=sess-1');
      expect(screen.getByTestId('share-outcome')).toHaveTextContent(
        'Copied. That link only opens for you.',
      );
      // No server round trip: this link is assembled locally and authorises nothing.
      expect(api.post).not.toHaveBeenCalled();
    });

    it('falls back to a pre-selected field when the clipboard refuses', async () => {
      refusesToCopy();
      render(<ShareMenu sessionId="sess-1" />);
      await openMenu();

      await userEvent.click(screen.getByTestId('share-copy-mine'));

      const field = (await screen.findByTestId('share-manual-copy')) as HTMLInputElement;
      expect(field.value).toContain('/?s=sess-1');
      expect(field).toHaveAttribute('readonly');
      // Pre-selected, so the next keystroke can be ⌘C.
      expect(field.selectionStart).toBe(0);
      expect(field.selectionEnd).toBe(field.value.length);
      expect(screen.getByTestId('share-outcome')).toHaveTextContent('copy by hand');
    });

    it('falls back on an origin with no clipboard API at all', async () => {
      clipboardThat(null);
      render(<ShareMenu sessionId="sess-1" />);
      await openMenu();

      await userEvent.click(screen.getByTestId('share-copy-mine'));

      const field = (await screen.findByTestId('share-manual-copy')) as HTMLInputElement;
      expect(field.value).toContain('/?s=sess-1');
    });
  });

  describe('create a link anyone can open', () => {
    it('mints the link, copies it, and names the day it stops working', async () => {
      const writeText = copies();
      api.post.mockResolvedValue({
        url: 'https://valentin.example/?share=tok-abc',
        expiresAt: '2026-09-10T09:00:00.000Z',
      });
      render(<ShareMenu sessionId="sess-1" />);
      await openMenu();

      await userEvent.click(screen.getByTestId('share-create-public'));

      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith('/api/session/sess-1/share', undefined),
      );
      expect(writeText).toHaveBeenCalledWith('https://valentin.example/?share=tok-abc');
      expect(screen.getByTestId('share-outcome')).toHaveTextContent('Link created and copied.');
      expect(screen.getByTestId('share-public-expiry')).toHaveTextContent('10 Sept 2026');
    });

    it('shows a pending state while the link is being minted', async () => {
      let release: (value: unknown) => void = () => {};
      api.post.mockReturnValue(new Promise((resolve) => { release = resolve; }));
      render(<ShareMenu sessionId="sess-1" />);
      await openMenu();

      await userEvent.click(screen.getByTestId('share-create-public'));

      expect(screen.getByTestId('share-create-public')).toHaveTextContent('Creating…');
      expect(screen.getByTestId('share-email')).toBeDisabled();

      await act(async () => {
        release({ url: 'https://valentin.example/?share=t', expiresAt: '2026-09-10T09:00:00.000Z' });
      });

      expect(screen.getByTestId('share-create-public')).toHaveTextContent('Create link');
    });

    it("reports the server's reason and mints nothing", async () => {
      api.post.mockRejectedValue(new Error('Sharing is not enabled on this deployment'));
      render(<ShareMenu sessionId="sess-1" />);
      await openMenu();

      await userEvent.click(screen.getByTestId('share-create-public'));

      await waitFor(() =>
        expect(screen.getByTestId('share-outcome')).toHaveTextContent(
          'Sharing is not enabled on this deployment',
        ),
      );
      expect(screen.queryByTestId('share-public-expiry')).toBeNull();
    });
  });

  describe('email it to me', () => {
    it('sends and confirms', async () => {
      api.post.mockResolvedValue(undefined);
      render(<ShareMenu sessionId="sess-1" />);
      await openMenu();

      await userEvent.click(screen.getByTestId('share-email'));

      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith('/api/session/sess-1/email', undefined),
      );
      expect(screen.getByTestId('share-outcome')).toHaveTextContent('Sent. Check your inbox.');
    });

    it("surfaces a 409 as the server's own fixable sentence", async () => {
      // What the route answers when there is no `notify_email` on the account. The
      // useful half is the part naming where to add one — a flattened status would
      // throw it away and leave the visitor retrying a call that cannot succeed.
      api.post.mockRejectedValue(
        new Error('Add an email address in the integrations panel first, then try again'),
      );
      render(<ShareMenu sessionId="sess-1" />);
      await openMenu();

      await userEvent.click(screen.getByTestId('share-email'));

      await waitFor(() =>
        expect(screen.getByTestId('share-outcome')).toHaveTextContent(
          'Add an email address in the integrations panel first',
        ),
      );
    });
  });

  describe('keyboard and focus', () => {
    it('opens from the keyboard, closes on Escape, and hands focus back', async () => {
      render(<ShareMenu sessionId="sess-1" />);
      const trigger = screen.getByTestId('share-trigger');

      trigger.focus();
      await userEvent.keyboard('{Enter}');
      expect(screen.getByTestId('share-popover')).toBeInTheDocument();

      await userEvent.keyboard('{Escape}');

      expect(screen.queryByTestId('share-popover')).toBeNull();
      expect(trigger).toHaveFocus();
    });

    it('announces every outcome through one live region', async () => {
      render(<ShareMenu sessionId="sess-1" />);
      await openMenu();

      // Mounted with the popover, before there is anything to say — a live region
      // inserted already holding its message announces nothing.
      const region = screen.getByTestId('share-outcome');
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveTextContent('');
    });
  });

  // `fireEvent` rather than `userEvent` here: `userEvent` awaits real timers of its
  // own between events, which never fire once the clock is faked.
  it('clears an outcome by itself', async () => {
    vi.useFakeTimers();
    render(<ShareMenu sessionId="sess-1" />);

    fireEvent.click(screen.getByTestId('share-trigger'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('share-copy-mine'));
    });

    expect(screen.getByTestId('share-outcome')).toHaveTextContent('Copied.');

    // A "Copied" that stays put is indistinguishable from one four actions old.
    await act(async () => {
      vi.advanceTimersByTime(7001);
    });

    expect(screen.getByTestId('share-outcome')).toHaveTextContent('');
  });
});
