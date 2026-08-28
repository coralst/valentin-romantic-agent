import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionProvider, useSessionContext } from '../../context/session-context';
import { SessionSidebar } from '../SessionSidebar';
import type { SessionData } from '../../../shared/interfaces/session';

/**
 * The sidebar reads its list from the server now, so these drive it through
 * `fetch` rather than by planting rows in localStorage. That switch is the point
 * of the change: a conversation used to exist only in the browser that started
 * it, and the stored rows never held a single message.
 */

interface Recorded {
  method: string;
  url: string;
  body: unknown;
}

let calls: Recorded[];

function serverSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    id: 'session-1',
    createdAt: new Date().toISOString(),
    endedAt: null,
    messageCount: 1,
    preferenceCount: 0,
    lastActivity: new Date().toISOString(),
    partnerName: 'Alice',
    title: null,
    ...overrides,
  };
}

/** Stand up a server holding the given sessions, and record what is asked of it */
function stubServer(sessions: SessionData[]) {
  let created = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({
        method,
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });

      const json = (body: unknown) =>
        ({ ok: true, status: 200, json: async () => body }) as Response;

      if (url === '/api/sessions') return json({ sessions });

      if (method === 'POST' && url === '/api/session') {
        created += 1;
        return json({ sessionId: `new-session-${created}` });
      }

      const detail = url.match(/^\/api\/session\/([^/]+)$/);
      if (detail) {
        const session = sessions.find((s) => s.id === detail[1]);
        if (!session) return { ok: false, status: 404 } as Response;
        if (method === 'GET') {
          return json({
            session,
            messages: [
              {
                id: 'm1',
                sessionId: session.id,
                sender: 'user',
                content: 'Hello there!',
                timestamp: new Date().toISOString(),
              },
            ],
            preferences: [],
          });
        }
        return json({ sessionId: session.id });
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    }),
  );
}

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

beforeEach(() => {
  localStorage.clear();
  calls = [];
  stubServer([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SessionSidebar', () => {
  describe('Desktop — expanded', () => {
    it('renders the sidebar with session-sidebar test id', () => {
      renderSidebar(false);
      expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
    });

    /*
     * Queried inside `waitFor` rather than with `findByTestId`, because `await
     * findBy…` resolves with a *node* and only then asserts on it. Between those
     * two steps React is free to commit again, and the empty state is exactly the
     * kind of thing a later commit replaces — leaving the assertion holding a
     * node that is no longer in the document. That gap made this the one flaky
     * test in the suite. Re-querying on every poll closes it.
     */
    it('shows empty state when the account has no conversations', async () => {
      renderSidebar(false);
      await waitFor(() => {
        expect(screen.getByTestId('session-empty-state')).toBeInTheDocument();
        expect(screen.getByText(/No conversations yet/)).toBeInTheDocument();
      });
    });

    it('says it is loading rather than claiming there is nothing', async () => {
      // The empty state and "not fetched yet" look identical if you skip this,
      // and telling someone they have no history when they do is the worst
      // possible first impression.
      renderSidebar(false);

      expect(screen.getByTestId('session-list-loading')).toBeInTheDocument();
      await screen.findByTestId('session-empty-state');
    });

    it('renders the conversations the server returned', async () => {
      stubServer([serverSession()]);
      renderSidebar(false);

      expect(await screen.findByText('Alice')).toBeInTheDocument();
    });

    it('shows "New conversation" for sessions without a partner name', async () => {
      stubServer([serverSession({ partnerName: null })]);
      renderSidebar(false);

      expect(await screen.findByText('New conversation')).toBeInTheDocument();
    });

    it('opens the first conversation with its transcript already loaded', async () => {
      // The transcript has to arrive *before* the session becomes active:
      // SessionSyncer reacts to the id changing and reads whatever messages are
      // present at that instant.
      stubServer([serverSession()]);
      renderSidebar(false);

      await screen.findByText('Alice');
      expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
        'GET /api/sessions',
        'GET /api/session/session-1',
      ]);
    });

    it('creates the session on the server when New chat is clicked', async () => {
      const user = userEvent.setup();
      renderSidebar(false);
      await screen.findByTestId('session-empty-state');

      await user.click(screen.getByRole('button', { name: 'New chat' }));

      expect(await screen.findByTestId('session-entry')).toBeInTheDocument();
      expect(screen.getByText('New conversation')).toBeInTheDocument();
      expect(calls).toContainEqual({
        method: 'POST',
        url: '/api/session',
        body: undefined,
      });
    });

    /**
     * Empty "New conversation" rows used to pile up: the button POSTed on every
     * click, and an abandoned blank conversation stayed in the list forever with
     * nothing to distinguish it from the next one. Two blank conversations are
     * indistinguishable by definition, so the second click hands back the first.
     */
    it('reuses the conversation on screen when it is still blank', async () => {
      const user = userEvent.setup();
      renderSidebar(false);
      await screen.findByTestId('session-empty-state');

      await user.click(screen.getByRole('button', { name: 'New chat' }));
      await screen.findByTestId('session-entry');
      await user.click(screen.getByRole('button', { name: 'New chat' }));
      await user.click(screen.getByRole('button', { name: 'New chat' }));

      expect(screen.getAllByTestId('session-entry')).toHaveLength(1);
      expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/session')).toHaveLength(1);
    });

    it('still starts a new conversation once the current one has been used', async () => {
      const user = userEvent.setup();
      // messageCount 1, and its transcript holds a message the user sent — so
      // this is a conversation, not a blank waiting to be reused.
      stubServer([serverSession()]);
      renderSidebar(false);

      await screen.findByText('Alice');
      await user.click(screen.getByRole('button', { name: 'New chat' }));

      await waitFor(() => expect(screen.getAllByTestId('session-entry')).toHaveLength(2));
      expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/session')).toHaveLength(1);
    });

    it('carries the Valentin wordmark', () => {
      renderSidebar(false);
      expect(screen.getByRole('heading', { name: 'Valentin' })).toBeInTheDocument();
      expect(screen.getByText('Romantic Agent')).toBeInTheDocument();
    });

    it('carries the architecture toggle', () => {
      renderSidebar(false);
      expect(screen.getByTestId('architecture-toggle')).toBeInTheDocument();
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

    it('keeps the architecture toggle despite a stale collapsed flag', () => {
      localStorage.setItem('valentin_sidebar_collapsed', 'true');
      renderSidebar(false);
      expect(screen.getByTestId('architecture-toggle')).toBeInTheDocument();
    });
  });

  describe('Desktop — session interactions', () => {
    it('deletes a session on the server as well as in the list', async () => {
      const user = userEvent.setup();
      stubServer([
        serverSession({ id: 'to-delete', partnerName: 'DeleteMe' }),
        serverSession({
          id: 'to-keep',
          partnerName: 'KeepMe',
          lastActivity: new Date(Date.now() - 10_000).toISOString(),
        }),
      ]);
      renderSidebar(false);

      expect(await screen.findByText('DeleteMe')).toBeInTheDocument();
      await user.click(screen.getAllByTestId('delete-session-button')[0]);

      expect(screen.queryByText('DeleteMe')).not.toBeInTheDocument();
      expect(screen.getByText('KeepMe')).toBeInTheDocument();
      await waitFor(() =>
        expect(calls).toContainEqual({
          method: 'DELETE',
          url: '/api/session/to-delete',
          body: undefined,
        }),
      );
    });

    it('renames a session and persists the new title', async () => {
      // Without the PATCH this reverts on the next reload, which is worse than
      // not offering rename at all.
      const user = userEvent.setup();
      stubServer([serverSession({ id: 'to-rename', partnerName: 'Alice' })]);
      renderSidebar(false);

      await user.click(await screen.findByTestId('rename-session-button'));
      const input = screen.getByTestId('rename-session-input');
      await user.clear(input);
      await user.type(input, 'Birthday ideas{Enter}');

      expect(screen.getByText('Birthday ideas')).toBeInTheDocument();
      await waitFor(() =>
        expect(calls).toContainEqual({
          method: 'PATCH',
          url: '/api/session/to-rename',
          body: { title: 'Birthday ideas' },
        }),
      );
    });

    it('cancels a rename on Escape, leaving the title unchanged', async () => {
      const user = userEvent.setup();
      stubServer([serverSession({ id: 'to-rename', partnerName: 'Alice' })]);
      renderSidebar(false);

      await user.click(await screen.findByTestId('rename-session-button'));
      const input = screen.getByTestId('rename-session-input');
      await user.clear(input);
      await user.type(input, 'Discarded{Escape}');

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByText('Discarded')).not.toBeInTheDocument();
      expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    });
  });

  describe('conversations left in this browser', () => {
    it('clears them and says so once', async () => {
      // They were never worth importing — the old store held titles and empty
      // transcripts. Saying nothing would look like the history was lost.
      localStorage.setItem(
        'valentin_sessions',
        JSON.stringify([{ id: 'old-a' }, { id: 'old-b' }]),
      );
      renderSidebar(false);

      const notice = await screen.findByTestId('session-notice');
      expect(notice.textContent).toContain('2 conversations');
      expect(localStorage.getItem('valentin_sessions')).toBeNull();
    });

    it('dismisses the notice when asked', async () => {
      localStorage.setItem('valentin_sessions', JSON.stringify([{ id: 'old-a' }]));
      const user = userEvent.setup();
      renderSidebar(false);

      await screen.findByTestId('session-notice');
      await user.click(screen.getByRole('button', { name: 'Dismiss' }));

      expect(screen.queryByTestId('session-notice')).toBeNull();
    });
  });

  describe('when the list cannot be fetched', () => {
    it('says so instead of showing an empty history', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      renderSidebar(false);

      expect((await screen.findByTestId('session-error')).textContent).toContain(
        "Couldn't load your conversations",
      );
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
