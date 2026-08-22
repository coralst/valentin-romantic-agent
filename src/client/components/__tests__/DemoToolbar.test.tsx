import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { SessionProvider } from '../../context/session-context';
import { ChatProvider } from '../../context/chat-context';
import { PreferencesProvider } from '../../context/preferences-context';
import { ProfileStoreProvider } from '../../context/profile-store-context';
import { DemoToolbar } from '../DemoToolbar';
import type { StoredSession } from '../../hooks/use-session-store';

function renderToolbar(children?: React.ReactNode) {
  return render(
    <SessionProvider>
      <ChatProvider>
        <PreferencesProvider>
          <ProfileStoreProvider sessionId="session-1">
            <DemoToolbar>{children}</DemoToolbar>
          </ProfileStoreProvider>
        </PreferencesProvider>
      </ChatProvider>
    </SessionProvider>,
  );
}

function makeStoredSession(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id: 'session-1',
    title: null,
    partnerName: 'Alice',
    messages: [],
    preferences: [],
    lastActivity: new Date().toISOString(),
    messageCount: 0,
    ...overrides,
  };
}

/** Build a fetch mock that answers the seed + preferences calls */
function mockSuccessfulSeed(preferenceCount = 18) {
  return vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/seed')) {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ sessionId: 'seeded-session', preferenceCount }),
      } as Response);
    }
    if (url.endsWith('/preferences')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ preferences: [] }),
      } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
  });
}

describe('DemoToolbar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders both demo controls', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderToolbar();
    expect(screen.getByRole('button', { name: 'Load demo profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });

  it('exposes the controls as a labelled group', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderToolbar();
    expect(screen.getByRole('group', { name: 'Demo controls' })).toBeInTheDocument();
  });

  it('renders extra controls passed as children', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderToolbar(<button type="button">Extra control</button>);
    expect(screen.getByRole('button', { name: 'Extra control' })).toBeInTheDocument();
  });

  // The architecture toggle used to live here. It moved to the sidebar so it is
  // reachable from every screen rather than only wherever this toolbar renders;
  // see `SessionSidebar.test.tsx`. Asserted as an absence so the toggle cannot
  // quietly come back and end up existing twice.
  it('does not own the architecture toggle', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderToolbar();
    expect(screen.queryByTestId('architecture-toggle')).not.toBeInTheDocument();
  });

  describe('Load demo profile', () => {
    it('POSTs to the seed endpoint', async () => {
      const user = userEvent.setup();
      const fetchMock = mockSuccessfulSeed();
      vi.stubGlobal('fetch', fetchMock);
      renderToolbar();

      await user.click(screen.getByRole('button', { name: 'Load demo profile' }));

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/session/seed',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('announces the loaded profile with its preference count', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('fetch', mockSuccessfulSeed(18));
      renderToolbar();

      await user.click(screen.getByRole('button', { name: 'Load demo profile' }));

      expect(screen.getByTestId('demo-toolbar-status')).toHaveTextContent(
        'Demo profile loaded — 18 preferences',
      );
      expect(screen.getByTestId('demo-toolbar-live-region')).toHaveTextContent(
        'Demo profile loaded — 18 preferences',
      );
    });

    it('can be activated from the keyboard', async () => {
      const user = userEvent.setup();
      const fetchMock = mockSuccessfulSeed();
      vi.stubGlobal('fetch', fetchMock);
      renderToolbar();

      screen.getByRole('button', { name: 'Load demo profile' }).focus();
      await user.keyboard('{Enter}');

      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/session/seed')),
      ).toBe(true);
    });

    it('brings the seeded session to the foreground', async () => {
      // A pre-existing session starts out active, so the seeded one has to
      // displace it for the demo profile to actually be on screen.
      localStorage.setItem('valentin_sessions', JSON.stringify([makeStoredSession()]));
      const user = userEvent.setup();
      vi.stubGlobal('fetch', mockSuccessfulSeed());
      renderToolbar();

      await user.click(screen.getByRole('button', { name: 'Load demo profile' }));

      // Reset targets the active session — proof of which session is in front.
      await user.click(screen.getByRole('button', { name: 'Reset' }));

      expect(fetch).toHaveBeenCalledWith(
        '/api/session/seeded-session/reset',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('surfaces a message when the seed endpoint is missing', async () => {
      const user = userEvent.setup();
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response),
        ),
      );
      renderToolbar();

      await user.click(screen.getByRole('button', { name: 'Load demo profile' }));

      expect(screen.getByTestId('demo-toolbar-status')).toHaveTextContent(
        "Couldn't load the demo profile — the demo endpoint is not available yet.",
      );
    });

    it('surfaces a message when the network fails', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
      renderToolbar();

      await user.click(screen.getByRole('button', { name: 'Load demo profile' }));

      expect(screen.getByTestId('demo-toolbar-status')).toHaveTextContent(
        "Couldn't load the demo profile — network down.",
      );
    });

    it('re-enables the controls after a failure', async () => {
      const user = userEvent.setup();
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as Response),
        ),
      );
      renderToolbar();

      await user.click(screen.getByRole('button', { name: 'Load demo profile' }));

      expect(screen.getByRole('button', { name: 'Load demo profile' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();
    });
  });

  describe('Reset', () => {
    it('POSTs to the reset endpoint for the active session', async () => {
      localStorage.setItem('valentin_sessions', JSON.stringify([makeStoredSession()]));
      const user = userEvent.setup();
      const fetchMock = vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response),
      );
      vi.stubGlobal('fetch', fetchMock);
      renderToolbar();

      await user.click(screen.getByRole('button', { name: 'Reset' }));

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/session/session-1/reset',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('announces the reset outcome', async () => {
      localStorage.setItem('valentin_sessions', JSON.stringify([makeStoredSession()]));
      const user = userEvent.setup();
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response),
        ),
      );
      renderToolbar();

      await user.click(screen.getByRole('button', { name: 'Reset' }));

      expect(screen.getByTestId('demo-toolbar-live-region')).toHaveTextContent('Session reset');
    });

    it('can be activated from the keyboard', async () => {
      localStorage.setItem('valentin_sessions', JSON.stringify([makeStoredSession()]));
      const user = userEvent.setup();
      const fetchMock = vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response),
      );
      vi.stubGlobal('fetch', fetchMock);
      renderToolbar();

      screen.getByRole('button', { name: 'Reset' }).focus();
      await user.keyboard('{Enter}');

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/session/session-1/reset',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('surfaces a message when the session is unknown to the server', async () => {
      localStorage.setItem('valentin_sessions', JSON.stringify([makeStoredSession()]));
      const user = userEvent.setup();
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response),
        ),
      );
      renderToolbar();

      await user.click(screen.getByRole('button', { name: 'Reset' }));

      expect(screen.getByTestId('demo-toolbar-status')).toHaveTextContent(
        "Couldn't reset the session — the demo endpoint is not available yet.",
      );
    });

    it('does not call the server when there is no active session', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      renderToolbar();

      await user.click(screen.getByRole('button', { name: 'Reset' }));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByTestId('demo-toolbar-status')).toHaveTextContent(
        'Nothing to reset yet — no active session.',
      );
    });
  });
});
