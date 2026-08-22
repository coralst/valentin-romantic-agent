import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatProvider } from '../../context/chat-context';
import { PreferencesProvider } from '../../context/preferences-context';
import { SessionProvider } from '../../context/session-context';
import { AppLayout } from '../AppLayout';
import {
  DRAWER_HEIGHT,
  REOPEN_BAR_HEIGHT,
  reservedDrawerSpace,
} from '../LiveArchitectureDrawer';

// Mock the websocket-context so ChatPanel can render without a real WS
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

describe('AppLayout', () => {
  let matchMediaListeners: Array<(e: MediaQueryListEvent) => void>;
  let currentMatches: boolean;

  beforeEach(() => {
    matchMediaListeners = [];
    currentMatches = false;

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: currentMatches,
      media: query,
      addEventListener: (_: string, handler: (e: MediaQueryListEvent) => void) => {
        matchMediaListeners.push(handler);
      },
      removeEventListener: (_: string, handler: (e: MediaQueryListEvent) => void) => {
        matchMediaListeners = matchMediaListeners.filter((h) => h !== handler);
      },
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders dual-panel layout at desktop width', () => {
    currentMatches = false; // desktop
    renderWithProviders(<AppLayout />);
    const layout = screen.getByTestId('app-layout');
    expect(layout.getAttribute('data-layout')).toBe('desktop');
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.getByTestId('partner-profile-panel')).toBeInTheDocument();
  });

  it('renders MobileNav at mobile width', () => {
    currentMatches = true; // mobile
    renderWithProviders(<AppLayout />);
    const layout = screen.getByTestId('app-layout');
    expect(layout.getAttribute('data-layout')).toBe('mobile');
    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument();
  });

  it('toggles between chat and profile on mobile', async () => {
    currentMatches = true;
    const user = userEvent.setup();
    renderWithProviders(<AppLayout />);

    // Default is chat
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('partner-profile-panel')).not.toBeInTheDocument();

    // Switch to profile
    await user.click(screen.getByRole('tab', { name: 'Profile' }));
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('partner-profile-panel')).toBeInTheDocument();

    // Switch back to chat
    await user.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });

  /**
   * The drawer is a 424px absolute overlay pinned to the bottom of the content
   * area — which is exactly where the composer is. Opening it used to make the
   * composer unclickable, breaking the drawer's whole contract ("not a dialog, no
   * focus trap, composer stays typable") just as effectively as a modal would.
   *
   * jsdom performs no layout, so `toBeVisible()` and a focus assertion both pass
   * whether or not something is painted on top. Only running the real app caught
   * this — a Playwright click timed out with the drawer's subtree named as the
   * element intercepting pointer events. What is assertable here is the contract
   * that fixed it: the layout reserves the space rather than letting the drawer
   * cover it. The geometry itself is checked by the rehearsal script.
   */
  describe('AppLayout — space reserved for the architecture drawer', () => {
    function reservedSpace(): number {
      const area = document.querySelector('[data-drawer-reserved]');
      return Number(area?.getAttribute('data-drawer-reserved'));
    }

    it('reserves only the reopen bar while the drawer is closed', () => {
      renderWithProviders(<AppLayout />);
      expect(reservedSpace()).toBe(REOPEN_BAR_HEIGHT);
    });

    it('reserves the full drawer height once opened', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AppLayout />);

      await user.click(screen.getByTestId('architecture-toggle'));

      expect(reservedSpace()).toBe(DRAWER_HEIGHT);
    });

    it('gives the space back when the drawer is hidden again', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AppLayout />);

      await user.click(screen.getByTestId('architecture-toggle'));
      await user.click(screen.getByTestId('architecture-toggle'));

      expect(reservedSpace()).toBe(REOPEN_BAR_HEIGHT);
    });

    /**
     * On mobile the composer is nearly the whole screen, so occlusion matters
     * more here, not less. The toggle lives in the sidebar, which on mobile is a
     * closed overlay — so it has to be opened through the hamburger first, the
     * same route a user takes.
     */
    it('reserves the space on mobile too, where the composer is all there is', async () => {
      currentMatches = true;
      const user = userEvent.setup();
      renderWithProviders(<AppLayout />);

      expect(reservedSpace()).toBe(REOPEN_BAR_HEIGHT);

      await user.click(screen.getByTestId('sidebar-menu-button'));
      await user.click(screen.getByTestId('architecture-toggle'));

      expect(reservedSpace()).toBe(DRAWER_HEIGHT);
    });

    /**
     * The layout and the drawer must not drift apart: the numbers live next to the
     * heights they come from, so a change to one cannot silently leave the other
     * reserving the wrong amount.
     */
    it('derives the reserved amount from the drawer itself', () => {
      expect(reservedDrawerSpace(true)).toBe(DRAWER_HEIGHT);
      expect(reservedDrawerSpace(false)).toBe(REOPEN_BAR_HEIGHT);
    });
  });

  describe('the integrations panel', () => {
    it('is reachable from the desktop rail and closes again', async () => {
      currentMatches = false; // desktop
      const user = userEvent.setup();
      renderWithProviders(<AppLayout />);

      expect(screen.queryByTestId('integrations-panel')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('rail-integrations-button'));
      expect(screen.getByTestId('integrations-panel')).toBeInTheDocument();

      // The rail stays live behind the panel, so the same button puts it away.
      await user.click(screen.getByTestId('rail-integrations-button'));
      expect(screen.queryByTestId('integrations-panel')).not.toBeInTheDocument();
    });

    it('is reachable from the mobile strip', async () => {
      currentMatches = true; // mobile
      const user = userEvent.setup();
      renderWithProviders(<AppLayout />);

      await user.click(screen.getByTestId('rail-integrations-button'));
      expect(screen.getByTestId('integrations-panel')).toBeInTheDocument();
      // Cards, not the fan: a 375px canvas cannot hold a hub and eight nodes.
      expect(screen.getByTestId('integrations-list')).toBeInTheDocument();
    });

    /*
     * The panel is an absolute overlay precisely so that opening it cannot
     * reshuffle the shell. The first version spanned grid tracks instead, which
     * made grid auto-placement skip those cells and pushed the conversation list
     * out of the window entirely.
     */
    it('leaves the shell it covers intact', async () => {
      currentMatches = false; // desktop
      const user = userEvent.setup();
      renderWithProviders(<AppLayout />);

      await user.click(screen.getByTestId('rail-integrations-button'));

      expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
      expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
      expect(screen.getByTestId('partner-profile-panel')).toBeInTheDocument();
    });
  });
});
