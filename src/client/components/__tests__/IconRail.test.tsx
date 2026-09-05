import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionProvider } from '../../context/session-context';
import { ChatProvider } from '../../context/chat-context';
import { PreferencesProvider } from '../../context/preferences-context';
import { ProfileStoreProvider } from '../../context/profile-store-context';
import { IntegrationsProvider } from '../../context/integrations-context';
import { IconRail } from '../IconRail';
import { ArchitectureEngineProvider } from '../../context/architecture-engine-context';
import { layout, radii } from '../../design-system/tokens';

interface RenderOptions {
  orientation?: 'column' | 'row';
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
    expect(screen.getByRole('button', { name: 'Open session history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Demo controls' })).toBeInTheDocument();
  });

  /*
   * Her profile is reached by clicking *her* — the portrait at the top of the
   * brief — not by a heart in the chrome. This is the assertion that keeps the
   * second door from creeping back in.
   */
  it('has no profile button: her portrait is the way into her profile', () => {
    renderRail();
    expect(screen.queryByTestId('rail-profile-button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Her profile' })).not.toBeInTheDocument();
    expect(screen.getByTestId('icon-rail').textContent).not.toContain('\u2665');
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

  /*
   * The \u25c6 is gone, in both orientations.
   *
   * It was a third control answering to a name two others already own: the crest
   * above it is "home" from any surface, and on mobile `MobileNav` has its own chat
   * tab. Asserted rather than merely deleted because the rail is where every future
   * "add a button for X" lands, and the reason this particular one went is not
   * visible from the file that no longer contains it.
   */
  it('has no \u25c6 view switch, the crest and the mobile tabs owning that job', () => {
    renderRail({ orientation: 'column' });
    expect(screen.queryByTestId('rail-chat-button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conversation' })).not.toBeInTheDocument();
    cleanup();

    renderRail({ orientation: 'row' });
    expect(screen.queryByTestId('rail-chat-button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conversation' })).not.toBeInTheDocument();
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

    /*
     * Which way the menu grows is a function of where the ⚙ is, and the ⚙ moved:
     * with no `flex: 1` spacer left in the rail every button is top-anchored, so a
     * menu that grew *upwards* from it ran off the top of the window and covered the
     * conversation list's wordmark row — architecture toggle included, which made
     * that button unclickable whenever the demo menu was open.
     *
     * jsdom reports a zero-sized rect for the gear, so the numbers here are all 0
     * and worth nothing. The assertable part is the *direction*: the column menu is
     * placed by its top edge, never its bottom.
     */
    it('grows downwards from the gear, which is top-anchored in the rail', async () => {
      const user = userEvent.setup();
      renderRail({ orientation: 'column' });

      await user.click(screen.getByRole('button', { name: 'Demo controls' }));
      const popover = screen.getByTestId('rail-demo-popover');
      expect(popover.style.top).not.toBe('');
      expect(popover.style.bottom).toBe('');
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
   * The band labels are gone too.
   *
   * They existed to explain four opaque glyphs to a first-time visitor. Two of
   * those glyphs (◆, ♥) have since been removed, which left three eyebrows titling
   * groups of one — a taxonomy costing more vertical room than the buttons it
   * organised, on the surface where a presenter most needs the rail to hold still.
   */
  describe('the band labels', () => {
    it('titles nothing, in either orientation', () => {
      for (const orientation of ['column', 'row'] as const) {
        renderRail({ orientation });
        for (const label of ['talk', 'know', 'act', 'show']) {
          expect(screen.queryByText(label)).not.toBeInTheDocument();
        }
        cleanup();
      }
    });

    // Her profile opens from her portrait in the brief, never from the rail.
    it('has no ♥, so nothing wants a "know" group', () => {
      renderRail({ orientation: 'column' });
      expect(screen.queryByTestId('rail-profile-button')).not.toBeInTheDocument();
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
            // Catalogue ids, because `loadGrants` drops anything the catalogue no
            // longer offers — a stale id here would count zero and the badge would
            // agree with itself while testing nothing.
            wolt: { capUsd: null, grantedAt: '2026-02-14T09:00:00.000Z' },
            'google-calendar': { capUsd: null, grantedAt: '2026-02-14T09:00:00.000Z' },
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

  describe('the engine switch', () => {
    /**
     * With the provider, because the point of the control is that it *changes*
     * something. `renderRail` deliberately leaves the provider out, which covers
     * the other half: the rail still renders standalone in every other test here.
     */
    function renderWithEngine(orientation: 'column' | 'row' = 'column') {
      return render(
        <SessionProvider>
          <ChatProvider>
            <PreferencesProvider>
              <ProfileStoreProvider sessionId="session-1">
                <ArchitectureEngineProvider>
                  <IconRail orientation={orientation} onOpenSessions={() => {}} />
                </ArchitectureEngineProvider>
              </ProfileStoreProvider>
            </PreferencesProvider>
          </ChatProvider>
        </SessionProvider>,
      );
    }

    it('offers both engines, and calls the hand-written one glue code', () => {
      renderWithEngine();
      expect(screen.getByTestId('rail-engine-valentin')).toHaveTextContent('Glue code');
      expect(screen.getByTestId('rail-engine-agentcore')).toHaveTextContent('AgentCore');
    });

    it('starts on engine A', () => {
      renderWithEngine();
      expect(screen.getByTestId('rail-engine-valentin')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('rail-engine-agentcore')).toHaveAttribute('aria-pressed', 'false');
    });

    it('moves the selection when the other engine is picked', async () => {
      const user = userEvent.setup();
      renderWithEngine();

      await user.click(screen.getByTestId('rail-engine-agentcore'));

      expect(screen.getByTestId('rail-engine-agentcore')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('rail-engine-valentin')).toHaveAttribute('aria-pressed', 'false');
    });

    it('sits at the foot of the rail, just above the gear', () => {
      // The placement is the request, so it is asserted rather than eyeballed:
      // DOM order after the menu button and before the gear, which on a column
      // rail whose spacer has already pushed both down is the bottom-left corner.
      renderWithEngine();
      const rail = screen.getByTestId('icon-rail');
      const order = Array.from(rail.querySelectorAll('[data-testid]')).map((el) =>
        el.getAttribute('data-testid'),
      );

      expect(order.indexOf('rail-engine-switch')).toBeGreaterThan(
        order.indexOf('sidebar-menu-button'),
      );
      expect(order.indexOf('rail-engine-switch')).toBeLessThan(order.indexOf('rail-demo-button'));
    });

    it("follows the rail's axis, stacking on desktop and lying flat on mobile", () => {
      const { unmount } = renderWithEngine('column');
      expect(screen.getByTestId('rail-engine-switch').style.flexDirection).toBe('column');
      unmount();

      renderWithEngine('row');
      expect(screen.getByTestId('rail-engine-switch').style.flexDirection).toBe('row');
    });

    it('renders inertly without a provider, so standalone tests need not wrap it', () => {
      renderRail();
      expect(screen.getByTestId('rail-engine-valentin')).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('renders as a horizontal strip when asked for the mobile orientation', () => {
    renderRail({ orientation: 'row' });
    const rail = screen.getByTestId('icon-rail');
    expect(rail.getAttribute('data-orientation')).toBe('row');
    expect(rail.style.flexDirection).toBe('row');
  });
});
