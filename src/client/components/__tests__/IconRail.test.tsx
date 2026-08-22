import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionProvider } from '../../context/session-context';
import { ChatProvider } from '../../context/chat-context';
import { PreferencesProvider } from '../../context/preferences-context';
import { ProfileStoreProvider } from '../../context/profile-store-context';
import { IntegrationsProvider } from '../../context/integrations-context';
import { IconRail, type RailView } from '../IconRail';
import { layout, radii } from '../../design-system/tokens';

interface RenderOptions {
  orientation?: 'column' | 'row';
  activeView?: RailView | null;
  onViewChange?: (view: RailView) => void;
  onGoHome?: () => void;
  onOpenSessions?: () => void;
  isSessionsOpen?: boolean;
  onOpenIntegrations?: () => void;
  isIntegrationsOpen?: boolean;
  /**
   * Whether to wrap the rail in a real grants store. Off by default, because most
   * of these tests are about the rail and the context deliberately falls back to
   * an inert store rather than throwing.
   */
  withIntegrations?: boolean;
}

function renderRail({
  orientation = 'column',
  activeView = null,
  onViewChange,
  onGoHome,
  onOpenSessions = () => {},
  isSessionsOpen,
  onOpenIntegrations,
  isIntegrationsOpen,
  withIntegrations = false,
}: RenderOptions = {}) {
  const rail = (
    <IconRail
      orientation={orientation}
      activeView={activeView}
      onViewChange={onViewChange}
      onGoHome={onGoHome}
      onOpenSessions={onOpenSessions}
      isSessionsOpen={isSessionsOpen}
      onOpenIntegrations={onOpenIntegrations}
      isIntegrationsOpen={isIntegrationsOpen}
    />
  );
  return render(
    <SessionProvider>
      <ChatProvider>
        <PreferencesProvider>
          <ProfileStoreProvider sessionId="session-1">
            {withIntegrations ? <IntegrationsProvider>{rail}</IntegrationsProvider> : rail}
          </ProfileStoreProvider>
        </PreferencesProvider>
      </ChatProvider>
    </SessionProvider>,
  );
}

describe('IconRail', () => {
  it('keeps the logo alt text the onboarding e2e spec queries', () => {
    renderRail();
    expect(screen.getByAltText('Valentin logo')).toBeInTheDocument();
  });

  it('labels its controls for screen readers', () => {
    renderRail();
    expect(screen.getByRole('button', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Her profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open session history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Demo controls' })).toBeInTheDocument();
  });

  it('keeps the sidebar-menu-button test id on the hamburger', async () => {
    const onOpenSessions = vi.fn();
    const user = userEvent.setup();
    renderRail({ onOpenSessions });

    await user.click(screen.getByTestId('sidebar-menu-button'));
    expect(onOpenSessions).toHaveBeenCalledOnce();
  });

  /*
   * The crest used to be a plain div, and people clicked it anyway — a logo in
   * the only piece of chrome on screen reads as "home" whether or not it is
   * wired up.
   */
  describe('the crest', () => {
    it('is a real button with a name of its own', () => {
      renderRail();
      const crest = screen.getByTestId('rail-home-button');
      expect(crest.tagName).toBe('BUTTON');
      expect(screen.getByRole('button', { name: 'Valentin home' })).toBe(crest);
      // The onboarding e2e spec queries the art by its alt text.
      expect(screen.getByAltText('Valentin logo')).toBeInTheDocument();
    });

    it('goes home when pressed', async () => {
      const onGoHome = vi.fn();
      const user = userEvent.setup();
      renderRail({ onGoHome });

      await user.click(screen.getByTestId('rail-home-button'));
      expect(onGoHome).toHaveBeenCalledOnce();
    });

    it('keeps its circle: no padding, still a pill, art intact', () => {
      // A `<button>` brings a border and padding of its own, which would square
      // the crest off and shrink the 1024px art inside it.
      renderRail();
      const crest = screen.getByTestId('rail-home-button');
      expect(crest.style.padding).toBe('0px');
      expect(crest.style.borderRadius).toBe(`${radii.pill}px`);
      expect(crest.style.overflow).toBe('hidden');
      // `border: none` is set on the crest too, but jsdom's cssstyle drops the
      // `border` shorthand outright — the inline attribute comes back as
      // "padding: 0px; border-radius: 9999px;" and both `style.border` and
      // `style.borderStyle` read empty, while `getComputedStyle` reports jsdom's
      // own UA default ("2px outset buttonface"). There is nothing here to
      // assert against; the button's edge is checked in the browser instead.
      expect(crest.querySelector('img')?.style.objectFit).toBe('cover');
    });
  });

  /*
   * The ☰ is one-way on mobile (it raises an overlay) and two-way on desktop
   * (it hides and restores a column). It has to say which it is.
   */
  describe('the ☰', () => {
    it('renames itself when the caller treats it as a toggle', () => {
      renderRail({ isSessionsOpen: true });
      const button = screen.getByTestId('sidebar-menu-button');
      expect(button).toHaveAttribute('aria-label', 'Hide the conversation list');
      expect(button).toHaveAttribute('aria-expanded', 'true');
    });

    it('says "show" — and reports itself collapsed — when the list is hidden', () => {
      renderRail({ isSessionsOpen: false });
      const button = screen.getByTestId('sidebar-menu-button');
      expect(button).toHaveAttribute('aria-label', 'Show the conversation list');
      expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('stays a one-way "Open session history" when no state is passed', () => {
      renderRail();
      const button = screen.getByTestId('sidebar-menu-button');
      expect(button).toHaveAttribute('aria-label', 'Open session history');
      expect(button).not.toHaveAttribute('aria-expanded');
    });
  });

  it('reports the active view via aria-pressed when one surface is shown', () => {
    renderRail({ activeView: 'profile' });
    expect(screen.getByRole('button', { name: 'Conversation' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Her profile' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('omits aria-pressed on desktop, where both surfaces are visible at once', () => {
    renderRail({ activeView: null });
    expect(screen.getByRole('button', { name: 'Conversation' })).not.toHaveAttribute(
      'aria-pressed',
    );
  });

  it('switches view when a view button is pressed', async () => {
    const onViewChange = vi.fn();
    const user = userEvent.setup();
    renderRail({ activeView: 'chat', onViewChange });

    await user.click(screen.getByRole('button', { name: 'Her profile' }));
    expect(onViewChange).toHaveBeenCalledWith('profile');
  });

  describe('demo popover', () => {
    it('hides the demo toolbar until the gear is pressed', async () => {
      const user = userEvent.setup();
      renderRail();

      expect(screen.queryByTestId('demo-toolbar')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Demo controls' }));
      expect(screen.getByTestId('demo-toolbar')).toBeInTheDocument();
      expect(screen.getByTestId('load-demo-profile-button')).toBeInTheDocument();
    });

    it('closes on Escape', async () => {
      const user = userEvent.setup();
      renderRail();

      await user.click(screen.getByRole('button', { name: 'Demo controls' }));
      await user.keyboard('{Escape}');
      expect(screen.queryByTestId('demo-toolbar')).not.toBeInTheDocument();
    });

    it('portals the popover out of the rail so the window cannot clip it', async () => {
      // The app window sets overflow:hidden to keep its 34px radius crisp, so a
      // popover left inside the rail is sliced off at the window edge.
      const user = userEvent.setup();
      renderRail();

      await user.click(screen.getByRole('button', { name: 'Demo controls' }));
      const popover = screen.getByTestId('rail-demo-popover');
      expect(popover.closest('[data-testid="icon-rail"]')).toBeNull();
      expect(popover.style.position).toBe('fixed');
    });

    it('stays open when the popover itself is clicked', async () => {
      const user = userEvent.setup();
      renderRail();

      await user.click(screen.getByRole('button', { name: 'Demo controls' }));
      await user.click(screen.getByTestId('reset-session-button'));
      expect(screen.getByTestId('demo-toolbar')).toBeInTheDocument();
    });

    /*
     * The visual complaint the menu was rebuilt for was "four buttons in a
     * ragged 2×2 with mismatched fills". jsdom does no layout, so what is
     * assertable here is the contract that fixes it: one column, one control
     * height, and the current radii scale rather than the legacy `borderRadius`.
     */
    it('gives every control the same height and the same corner', async () => {
      const user = userEvent.setup();
      renderRail();
      await user.click(screen.getByRole('button', { name: 'Demo controls' }));

      for (const id of ['load-demo-profile-button', 'reset-session-button']) {
        const control = screen.getByTestId(id);
        expect(control.style.height).toBe(`${layout.menuControlHeight}px`);
        expect(control.style.borderRadius).toBe(`${radii.chip}px`);
      }
    });

    it('lays the menu out as one fixed-width column', async () => {
      const user = userEvent.setup();
      renderRail();
      await user.click(screen.getByRole('button', { name: 'Demo controls' }));

      const toolbar = screen.getByTestId('demo-toolbar');
      expect(toolbar.style.flexDirection).toBe('column');
      expect(toolbar.style.alignItems).toBe('stretch');

      const menu = toolbar.parentElement?.parentElement;
      expect(menu?.style.width).toBe(`${layout.menuWidth}px`);
    });

    it('groups the demo controls under a heading', async () => {
      const user = userEvent.setup();
      renderRail();
      await user.click(screen.getByRole('button', { name: 'Demo controls' }));
      expect(screen.getByText('Demo controls')).toBeInTheDocument();
    });

    /*
     * `UserChip` renders nothing without an AuthProvider — as in this file. The
     * heading and the divider belong to the menu rather than to the chip, so
     * they must not be left stranded above an empty group.
     */
    it('omits the identity group when there is nobody signed in', async () => {
      const user = userEvent.setup();
      renderRail();
      await user.click(screen.getByRole('button', { name: 'Demo controls' }));

      expect(screen.queryByText('Signed in as')).not.toBeInTheDocument();
      expect(screen.getByTestId('rail-demo-popover').querySelector('hr')).toBeNull();
    });

    it('closes on an outside click', async () => {
      const user = userEvent.setup();
      renderRail();

      await user.click(screen.getByRole('button', { name: 'Demo controls' }));
      await user.click(document.body);
      expect(screen.queryByTestId('demo-toolbar')).not.toBeInTheDocument();
    });
  });

  /*
   * The rail's glyphs are legible once you know the app and opaque on first
   * sight, and this is the first thing a visitor looks at. The bands are the
   * cheapest fix; they are decoration to a screen reader, which already hears
   * every button's own name.
   */
  describe('the band labels', () => {
    it('groups the vertical rail into talk / know / act', () => {
      renderRail({ orientation: 'column' });
      for (const label of ['talk', 'know', 'act']) {
        const band = screen.getByText(label);
        expect(band).toHaveAttribute('aria-hidden', 'true');
      }
    });

    it('drops them on the 56px mobile strip, which has no vertical room', () => {
      renderRail({ orientation: 'row' });
      expect(screen.queryByText('talk')).not.toBeInTheDocument();
      expect(screen.queryByText('act')).not.toBeInTheDocument();
    });
  });

  describe('the integrations button', () => {
    it('is drawn on both orientations, so the rail does not shift under the cursor', () => {
      renderRail({ orientation: 'column' });
      expect(screen.getByTestId('rail-integrations-button')).toBeInTheDocument();
      cleanup();
      renderRail({ orientation: 'row' });
      expect(screen.getByTestId('rail-integrations-button')).toBeInTheDocument();
    });

    it('raises the panel when pressed', async () => {
      const onOpenIntegrations = vi.fn();
      const user = userEvent.setup();
      renderRail({ onOpenIntegrations });

      await user.click(screen.getByTestId('rail-integrations-button'));
      expect(onOpenIntegrations).toHaveBeenCalledOnce();
    });

    it('reports whether the panel is up', () => {
      renderRail({ isIntegrationsOpen: true });
      expect(screen.getByTestId('rail-integrations-button')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });

    /* The fallback store grants nothing, which is the safe direction to fail in. */
    it('shows no badge with nothing connected, and is named plainly', () => {
      renderRail({ withIntegrations: true });
      expect(screen.queryByTestId('rail-integrations-badge')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Integrations' })).toBeInTheDocument();
    });

    it('counts the grants in the badge, and spells the count out in its name', () => {
      localStorage.setItem(
        'valentin_integrations_v1',
        JSON.stringify({
          version: 1,
          grants: {
            flowers: { capUsd: 80, grantedAt: '2026-02-14T09:00:00.000Z' },
            calendar: { capUsd: null, grantedAt: '2026-02-14T09:00:00.000Z' },
          },
        }),
      );
      renderRail({ withIntegrations: true });

      expect(screen.getByTestId('rail-integrations-badge')).toHaveTextContent('2');
      expect(
        screen.getByRole('button', { name: 'Integrations, 2 connected' }),
      ).toBeInTheDocument();
      localStorage.clear();
    });
  });

  it('renders as a horizontal strip when asked for the mobile orientation', () => {
    renderRail({ orientation: 'row' });
    const rail = screen.getByTestId('icon-rail');
    expect(rail.getAttribute('data-orientation')).toBe('row');
    expect(rail.style.flexDirection).toBe('row');
  });
});
