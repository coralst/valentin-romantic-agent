import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionProvider } from '../../context/session-context';
import { SessionSidebar } from '../SessionSidebar';
import type { StoredSession } from '../../hooks/use-session-store';

function renderSidebar(isMobile = false) {
  return render(
    <SessionProvider>
      <SessionSidebar isMobile={isMobile} />
    </SessionProvider>,
  );
}

function makeMockSession(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id: 'session-1',
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
  });

  describe('Mobile', () => {
    it('does not render when sidebarOpen is false', () => {
      renderSidebar(true);
      expect(screen.queryByTestId('session-sidebar')).not.toBeInTheDocument();
    });
  });
});
