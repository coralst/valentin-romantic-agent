import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionProvider } from '../../context/session-context';
import { ChatProvider } from '../../context/chat-context';
import { PreferencesProvider } from '../../context/preferences-context';
import { ProfileStoreProvider } from '../../context/profile-store-context';
import { IconRail, type RailView } from '../IconRail';

interface RenderOptions {
  orientation?: 'column' | 'row';
  activeView?: RailView | null;
  onViewChange?: (view: RailView) => void;
  onOpenSessions?: () => void;
}

function renderRail({
  orientation = 'column',
  activeView = null,
  onViewChange,
  onOpenSessions = () => {},
}: RenderOptions = {}) {
  return render(
    <SessionProvider>
      <ChatProvider>
        <PreferencesProvider>
          <ProfileStoreProvider sessionId="session-1">
            <IconRail
              orientation={orientation}
              activeView={activeView}
              onViewChange={onViewChange}
              onOpenSessions={onOpenSessions}
            />
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

    it('closes on an outside click', async () => {
      const user = userEvent.setup();
      renderRail();

      await user.click(screen.getByRole('button', { name: 'Demo controls' }));
      await user.click(document.body);
      expect(screen.queryByTestId('demo-toolbar')).not.toBeInTheDocument();
    });
  });

  it('renders as a horizontal strip when asked for the mobile orientation', () => {
    renderRail({ orientation: 'row' });
    const rail = screen.getByTestId('icon-rail');
    expect(rail.getAttribute('data-orientation')).toBe('row');
    expect(rail.style.flexDirection).toBe('row');
  });
});
