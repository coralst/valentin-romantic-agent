import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatProvider } from '../../context/chat-context';
import { PreferencesProvider } from '../../context/preferences-context';
import { SessionProvider } from '../../context/session-context';
import { AppLayout } from '../AppLayout';
import { breakpoints, layout } from '../../design-system/tokens';

vi.mock('../../context/websocket-context', () => ({
  useWebSocketContext: () => ({
    sendMessage: () => {},
    connectionStatus: 'connected' as const,
    lastError: null,
  }),
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <SessionProvider>
      <ChatProvider>
        <PreferencesProvider>{ui}</PreferencesProvider>
      </ChatProvider>
    </SessionProvider>,
  );
}

/**
 * A `matchMedia` that actually answers per query, against a pretend viewport.
 *
 * `AppLayout.test.tsx`'s stub returns the same `matches` for every query, which is
 * all its cases need. The scaling behaviour is the difference between two
 * thresholds being crossed, so here the query has to be read.
 */
function stubViewportWidth(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? width <= Number(max[1]) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });
}

describe('AppLayout scaling', () => {
  beforeEach(() => {
    // Every case below opts in with its own width.
    stubViewportWidth(1400);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives the conversation list a column on a wide desktop', () => {
    stubViewportWidth(1400);
    renderWithProviders(<AppLayout />);

    expect(screen.getByTestId('app-layout').getAttribute('data-layout')).toBe('desktop');
    expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
    expect(screen.queryByTestId('session-sidebar-overlay')).not.toBeInTheDocument();
  });

  it('takes the column away below the conversation-list breakpoint', () => {
    stubViewportWidth(breakpoints.conversationList - 1);
    renderWithProviders(<AppLayout />);

    // Still the desktop shell — this is not the mobile breakpoint.
    expect(screen.getByTestId('app-layout').getAttribute('data-layout')).toBe('desktop');
    expect(screen.queryByTestId('session-sidebar')).not.toBeInTheDocument();
  });

  it('keeps the column at the conversation-list breakpoint itself', () => {
    stubViewportWidth(breakpoints.conversationList);
    renderWithProviders(<AppLayout />);

    expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
  });

  it('raises the list as an overlay from the ☰ once it has no column', async () => {
    stubViewportWidth(breakpoints.conversationList - 1);
    const user = userEvent.setup();
    renderWithProviders(<AppLayout />);

    // Without this the ☰ would be a button that does nothing at these widths:
    // there is no column left for it to toggle.
    await user.click(screen.getByTestId('sidebar-menu-button'));

    expect(screen.getByTestId('session-sidebar-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
  });

  it('still toggles the column away on a wide desktop', async () => {
    stubViewportWidth(1400);
    const user = userEvent.setup();
    renderWithProviders(<AppLayout />);

    await user.click(screen.getByTestId('sidebar-menu-button'));

    expect(screen.queryByTestId('session-sidebar')).not.toBeInTheDocument();
    // Hidden, not raised as an overlay: the width can afford the column, the user
    // simply asked for the space.
    expect(screen.queryByTestId('session-sidebar-overlay')).not.toBeInTheDocument();
  });

});

describe('the chat column measure', () => {
  beforeEach(() => {
    stubViewportWidth(1400);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('centres the header, the transcript and the composer on one measure', () => {
    renderWithProviders(<AppLayout />);

    const header = screen.getByTestId('chat-header').firstElementChild as HTMLElement;
    const transcript = screen.getByRole('log').firstElementChild as HTMLElement;
    const composer = screen.getByLabelText('Type a message').parentElement as HTMLElement;

    // All three, or they drift out of vertical alignment with each other at wide
    // widths — the name sitting alone against the left edge of a centred column.
    for (const box of [header, transcript, composer]) {
      expect(box.style.maxWidth).toBe(`${layout.chatColumnMaxWidth}px`);
      expect(box.style.marginInline).toBe('auto');
      // `marginInline: auto` distributes *unused* width, so a box with no width of
      // its own would shrink-wrap its content instead of centring the column.
      expect(box.style.width).toBe('100%');
    }
  });
});
