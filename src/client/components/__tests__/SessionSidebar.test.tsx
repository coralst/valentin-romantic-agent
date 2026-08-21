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

    it('carries the Valentin wordmark', () => {
      renderSidebar(false);
      expect(screen.getByRole('heading', { name: 'Valentin' })).toBeInTheDocument();
      expect(screen.getByText('Romantic Agent')).toBeInTheDocument();
    });
  });

  describe('Desktop — no collapsed state', () => {
    // The vitrine shell has no collapse-to-rail mode: the claret icon rail in
    // column 1 of the window now plays that role, so the sidebar is always the
    // full 226px column.
    it('offers no collapse or expand toggle', () => {
      renderSidebar(false);
      expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Expand sidebar' })).not.toBeInTheDocument();
    });

    it('stays expanded even when a collapsed flag is left in storage', () => {
      localStorage.setItem('valentin_sidebar_collapsed', 'true');
      renderSidebar(false);
      expect(screen.getByTestId('session-list')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
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
  });
});
