import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionProvider, useSessionContext } from '../../context/session-context';
import { SessionSidebar } from '../SessionSidebar';
import type { StoredSession } from '../../hooks/use-session-store';

function renderSidebar(isMobile = false) {
  return render(
    <SessionProvider>
      <SessionSidebar isMobile={isMobile} />
    </SessionProvider>,
  );
}

/**
 * Stand-in for the header's hamburger, which lives in `AppLayout` rather than in
 * the sidebar — so a test rendering the sidebar alone has no way to open the
 * mobile overlay without it. Nothing covered that surface before this.
 */
function MobileOpener() {
  const { setSidebarOpen } = useSessionContext();
  return (
    <button type="button" onClick={() => setSidebarOpen(true)}>
      Open session history
    </button>
  );
}

async function renderMobileSidebarOpen(user: ReturnType<typeof userEvent.setup>) {
  render(
    <SessionProvider>
      <MobileOpener />
      <SessionSidebar isMobile={true} />
    </SessionProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Open session history' }));
}

function makeMockSession(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id: 'session-1',
    title: null,
    partnerName: 'Alice',
    messages: [
      { id: 'm1', sessionId: 'session-1', sender: 'user', content: 'Hello there!', timestamp: new Date().toISOString() },
    ],
    preferences: [],
    lastActivity: new Date().toISOString(),
    messageCount: 1,
    ...overrides,
  };
}

describe('SessionSidebar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('Desktop — expanded', () => {
    it('renders the sidebar with session-sidebar test id', () => {
      renderSidebar(false);
      expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
    });

    it('shows empty state when no sessions exist', () => {
      renderSidebar(false);
      expect(screen.getByTestId('session-empty-state')).toBeInTheDocument();
      expect(screen.getByText(/No conversations yet/)).toBeInTheDocument();
    });

    it('renders session entries when sessions exist', () => {
      const sessions: StoredSession[] = [makeMockSession()];
      localStorage.setItem('valentin_sessions', JSON.stringify(sessions));
      renderSidebar(false);
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('shows "New conversation" for sessions without partnerName', () => {
      const sessions: StoredSession[] = [makeMockSession({ partnerName: null })];
      localStorage.setItem('valentin_sessions', JSON.stringify(sessions));
      renderSidebar(false);
      expect(screen.getByText('New conversation')).toBeInTheDocument();
    });

    it('creates new session when New chat button is clicked', async () => {
      const user = userEvent.setup();
      renderSidebar(false);
      const newChatBtn = screen.getByRole('button', { name: 'New chat' });
      await user.click(newChatBtn);
      // After clicking new chat, a session entry should appear
      expect(screen.getByTestId('session-entry')).toBeInTheDocument();
      expect(screen.getByText('New conversation')).toBeInTheDocument();
    });

    it('shows collapse toggle button', () => {
      renderSidebar(false);
      expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
    });

    it('carries the architecture toggle', () => {
      renderSidebar(false);
      expect(screen.getByTestId('architecture-toggle')).toBeInTheDocument();
    });
  });

  describe('Desktop — collapsed rail', () => {
    it('renders collapsed sidebar when sidebarCollapsed is stored', () => {
      localStorage.setItem('valentin_sidebar_collapsed', 'true');
      renderSidebar(false);
      const sidebar = screen.getByTestId('session-sidebar');
      expect(sidebar.getAttribute('data-collapsed')).toBe('true');
    });

    it('shows expand toggle button in collapsed state', () => {
      localStorage.setItem('valentin_sidebar_collapsed', 'true');
      renderSidebar(false);
      expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    });

    it('toggles between expanded and collapsed on toggle click', async () => {
      const user = userEvent.setup();
      renderSidebar(false);
      // Start expanded
      expect(screen.getByTestId('session-sidebar').getAttribute('data-collapsed')).toBe('false');
      // Collapse
      await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
      expect(screen.getByTestId('session-sidebar').getAttribute('data-collapsed')).toBe('true');
      // Expand
      await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
      expect(screen.getByTestId('session-sidebar').getAttribute('data-collapsed')).toBe('false');
    });

    it('keeps the architecture toggle on the rail', () => {
      localStorage.setItem('valentin_sidebar_collapsed', 'true');
      renderSidebar(false);
      expect(screen.getByTestId('architecture-toggle')).toBeInTheDocument();
    });

    /**
     * The point of putting it in the sidebar rather than the demo toolbar: the
     * drawer is reachable from every screen. Surviving the collapse is the case
     * that would be easiest to lose.
     */
    it('keeps the architecture toggle across a collapse', async () => {
      const user = userEvent.setup();
      renderSidebar(false);

      expect(screen.getByTestId('architecture-toggle')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
      expect(screen.getByTestId('architecture-toggle')).toBeInTheDocument();
    });
  });

  describe('Desktop — session interactions', () => {
    it('deletes a session when delete button is clicked', async () => {
      const user = userEvent.setup();
      const sessions: StoredSession[] = [
        makeMockSession({ id: 'to-delete', partnerName: 'DeleteMe' }),
        makeMockSession({ id: 'to-keep', partnerName: 'KeepMe', lastActivity: new Date(Date.now() - 10000).toISOString() }),
      ];
      localStorage.setItem('valentin_sessions', JSON.stringify(sessions));
      renderSidebar(false);

      expect(screen.getByText('DeleteMe')).toBeInTheDocument();
      const deleteBtn = screen.getAllByTestId('delete-session-button')[0];
      await user.click(deleteBtn);
      expect(screen.queryByText('DeleteMe')).not.toBeInTheDocument();
      expect(screen.getByText('KeepMe')).toBeInTheDocument();
    });

    it('renames a session via the rename button and input', async () => {
      const user = userEvent.setup();
      const sessions: StoredSession[] = [makeMockSession({ id: 'to-rename', partnerName: 'Alice' })];
      localStorage.setItem('valentin_sessions', JSON.stringify(sessions));
      renderSidebar(false);

      await user.click(screen.getByTestId('rename-session-button'));
      const input = screen.getByTestId('rename-session-input');
      await user.clear(input);
      await user.type(input, 'Birthday ideas{Enter}');

      expect(screen.getByText('Birthday ideas')).toBeInTheDocument();
      const stored = JSON.parse(localStorage.getItem('valentin_sessions')!);
      expect(stored[0].title).toBe('Birthday ideas');
    });

    it('cancels a rename on Escape, leaving the title unchanged', async () => {
      const user = userEvent.setup();
      const sessions: StoredSession[] = [makeMockSession({ id: 'to-rename', partnerName: 'Alice' })];
      localStorage.setItem('valentin_sessions', JSON.stringify(sessions));
      renderSidebar(false);

      await user.click(screen.getByTestId('rename-session-button'));
      const input = screen.getByTestId('rename-session-input');
      await user.clear(input);
      await user.type(input, 'Discarded{Escape}');

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByText('Discarded')).not.toBeInTheDocument();
    });
  });

  describe('Mobile', () => {
    it('does not render when sidebarOpen is false', () => {
      renderSidebar(true);
      expect(screen.queryByTestId('session-sidebar')).not.toBeInTheDocument();
    });

    it('renders as an overlay once opened', async () => {
      const user = userEvent.setup();
      await renderMobileSidebarOpen(user);
      expect(screen.getByTestId('session-sidebar-overlay')).toBeInTheDocument();
      expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
    });

    it('carries the architecture toggle in the overlay too', async () => {
      const user = userEvent.setup();
      await renderMobileSidebarOpen(user);
      expect(screen.getByTestId('architecture-toggle')).toBeInTheDocument();
    });

    it('still offers New chat and Close beside it, unambiguously', async () => {
      const user = userEvent.setup();
      await renderMobileSidebarOpen(user);

      // The architecture toggle's name must not collide with these: the sidebar's
      // own tests query by name, and a third overlapping name breaks them.
      expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close sidebar' })).toBeInTheDocument();
    });
  });
});
