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
   * The drawer is a 424px absolute strip pinned to the bottom of the window —
   * which is exactly where the composer is. Opening it used to make the composer
   * unclickable, breaking the drawer's whole contract ("not a dialog, no focus
   * trap, composer stays typable") just as effectively as a modal would.
   *
   * jsdom performs no layout, so `toBeVisible()` and a focus assertion both pass
   * whether or not something is painted on top. Only running the real app caught
   * this — a Playwright click timed out with the drawer's subtree named as the
   * element intercepting pointer events. What is assertable here is the contract
   * that fixed it: the layout reserves the space rather than letting the drawer
   * cover it. The geometry itself is checked by the rehearsal script.
   *
   * The reservation is the *window frame's* padding, because the strip spans every
   * column — so the assertion reads it there rather than off one column's wrapper.
   */
  describe('AppLayout — space reserved for the architecture drawer', () => {
    function reservedSpace(): number {
      const frame = screen.getByTestId('app-window');
      return Number(frame.getAttribute('data-bottom-inset'));
    }

    /**
     * Give the window room for the whole drawer.
     *
     * The reservation is clamped against the viewport height now, and jsdom's window
     * is 768px tall — short enough that the clamp binds. Tests about the *full*
     * height therefore have to say how tall the screen is, or they are really tests
     * about the clamp.
     */
    function withTallViewport(height = 1200) {
      Object.defineProperty(window, 'innerHeight', {
        value: height,
        writable: true,
        configurable: true,
      });
    }

    it('reserves only the bar while the drawer is closed', () => {
      renderWithProviders(<AppLayout />);
      expect(reservedSpace()).toBe(REOPEN_BAR_HEIGHT);
    });

    it('reserves the full drawer height once opened, when the window can afford it', async () => {
      withTallViewport();
      const user = userEvent.setup();
      renderWithProviders(<AppLayout />);

      await user.click(screen.getByTestId('architecture-toggle'));

      expect(reservedSpace()).toBe(DRAWER_HEIGHT);
    });

    /*
     * The reservation is `paddingBottom` on the frame, so every column pays it at
     * once. Unclamped at 454px on a 900px screen that left each track ~418px — and
     * the brief rail's chip strip and nudge are `flex: none`, so the whole loss came
     * out of its scroll region and opening the drawer buried half the rail.
     */
    it('gives up its own height rather than starving the shell on a short window', async () => {
      withTallViewport(760);
      const user = userEvent.setup();
      renderWithProviders(<AppLayout />);

      await user.click(screen.getByTestId('architecture-toggle'));

      const reserved = reservedSpace();
      expect(reserved).toBeLessThan(DRAWER_HEIGHT);
      // Whatever it takes, the shell keeps a usable amount.
      expect(760 - reserved).toBeGreaterThanOrEqual(400);
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

      expect(reservedSpace()).toBeGreaterThan(REOPEN_BAR_HEIGHT);
    });

    /**
     * The layout and the drawer must not drift apart: the numbers live next to the
     * heights they come from, so a change to one cannot silently leave the other
     * reserving the wrong amount.
     */
    /*
     * `reservedDrawerSpace` is now just "open or closed?" — the height it reserves is
     * whatever the drawer's shared sizing state says, so that the panel and the hole
     * it sits in cannot disagree. The clamping lives with the height, in
     * `use-drawer-height.test.ts`.
     */
    it('reserves whatever height the drawer reports', () => {
      expect(reservedDrawerSpace(true, 300)).toBe(300);
      expect(reservedDrawerSpace(true)).toBe(DRAWER_HEIGHT);
    });

    it('leaves the bar alone when closed, whatever the height', () => {
      expect(reservedDrawerSpace(false, 300)).toBe(REOPEN_BAR_HEIGHT);
      expect(reservedDrawerSpace(false, 4000)).toBe(REOPEN_BAR_HEIGHT);
    });

    /**
     * The bar has to be one unbroken line across the whole bottom edge, which
     * means it cannot live inside a column: anchored to the chat/brief tracks it
     * began somewhere in the middle of the frame, stopping short of the icon rail
     * and the conversation list. The assertable form of "full width" in a
     * layout-free DOM is *where it is mounted* — the window's footer strip, which
     * spans the frame rather than a track.
     */
    it('mounts the drawer in the window footer, not inside a column', () => {
      renderWithProviders(<AppLayout />);

      const footer = screen.getByTestId('app-window-footer');
      expect(footer).toContainElement(screen.getByTestId('architecture-reopen-bar'));
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

    /*
     * "I can't press on the chats and go back to main."
     *
     * The panel covers every column except the rail, and the rail's navigation used
     * to act on the shell *underneath* it: the crest went home behind the overlay,
     * the ☰ resized a hidden column. Live-looking buttons with no visible effect,
     * which makes the panel read as a trap — the only exits were the 32px × in the
     * far corner and Escape.
     *
     * Asserted per button rather than once, because each is wired through a
     * different handler (`goHome`, the two `onOpenSessions` closures) and it was
     * adding one of them and not the others that produced the bug in the first
     * place. The list used to include the ◆; that button has been removed from the
     * rail, and the crest below covers the same escape.
     */
    it('gets out of the way when the rail navigates somewhere', async () => {
      currentMatches = false; // desktop
      const user = userEvent.setup();
      renderWithProviders(<AppLayout />);

      for (const exit of ['rail-home-button', 'sidebar-menu-button']) {
        await user.click(screen.getByTestId('rail-integrations-button'));
        expect(screen.getByTestId('integrations-panel')).toBeInTheDocument();

        await user.click(screen.getByTestId(exit));
        expect(screen.queryByTestId('integrations-panel')).not.toBeInTheDocument();
      }
    });

    it('gets out of the way from the mobile strip too', async () => {
      currentMatches = true; // mobile
      const user = userEvent.setup();
      renderWithProviders(<AppLayout />);

      await user.click(screen.getByTestId('rail-integrations-button'));
      expect(screen.getByTestId('integrations-panel')).toBeInTheDocument();

      // On a phone this matters more, not less: the panel covers the tab bar as well
      // as the content, so the strip's crest is the only way back to the
      // conversation — it routes through `changePanel('chat')`, which is exactly
      // what the removed ◆ used to do.
      await user.click(screen.getByTestId('rail-home-button'));
      expect(screen.queryByTestId('integrations-panel')).not.toBeInTheDocument();
    });
  });
});
