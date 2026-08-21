import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createRemoteSession,
  deleteRemoteSession,
  fetchSessionDetail,
  fetchSessions,
  renameRemoteSession,
  toStoredSession,
} from '../session-api';
import { clearTokenSession, setTokenSession } from '../../auth/token-store';
import type { SessionData } from '../../../shared/interfaces/session';

function serverSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    id: 'abc',
    createdAt: '2026-08-01T09:00:00.000Z',
    endedAt: null,
    messageCount: 4,
    preferenceCount: 2,
    lastActivity: '2026-08-02T09:00:00.000Z',
    partnerName: 'Mirabel',
    title: null,
    ...overrides,
  };
}

function ok(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);
}

beforeEach(() => {
  clearTokenSession();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toStoredSession', () => {
  it('orders on lastActivity, falling back to when the session was made', () => {
    expect(toStoredSession(serverSession()).lastActivity).toBe(
      '2026-08-02T09:00:00.000Z',
    );
    expect(
      toStoredSession(serverSession({ lastActivity: undefined })).lastActivity,
    ).toBe('2026-08-01T09:00:00.000Z');
  });

  it('leaves the transcript empty in the list', () => {
    // Ten rows show a title, a time and a count. Fetching ten transcripts to
    // render that would be gratuitous; switchSession fills one in on demand.
    const stored = toStoredSession(serverSession());

    expect(stored.messages).toEqual([]);
    expect(stored.preferences).toEqual([]);
    expect(stored.messageCount).toBe(4);
  });
});

describe('fetchSessions', () => {
  it('carries the bearer token, so the server knows whose list to send', async () => {
    setTokenSession({
      accessToken: 'the-token',
      refreshToken: null,
      expiresAt: Date.now() + 3_600_000,
    });
    const fetchMock = ok({ sessions: [serverSession()] });
    vi.stubGlobal('fetch', fetchMock);

    const sessions = await fetchSessions();

    expect(sessions.map((s) => s.id)).toEqual(['abc']);
    const headers = new Headers(
      (fetchMock.mock.calls[0][1] as RequestInit).headers,
    );
    expect(headers.get('Authorization')).toBe('Bearer the-token');
  });

  it('reports a presentable message on a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    await expect(fetchSessions()).rejects.toThrow(/session expired/);
  });
});

describe('fetchSessionDetail', () => {
  it('returns the transcript and profile together', async () => {
    // One round trip, because they share the session's storage partition and
    // this is the interaction that has to feel instant.
    vi.stubGlobal(
      'fetch',
      ok({
        session: serverSession(),
        messages: [{ id: 'm1', content: 'hello' }],
        preferences: [{ id: 'p1' }],
      }),
    );

    const detail = await fetchSessionDetail('abc');

    expect(detail.messages).toHaveLength(1);
    expect(detail.preferences).toHaveLength(1);
    expect(detail.partnerName).toBe('Mirabel');
  });

  it('escapes the id rather than pasting it into a path', async () => {
    const fetchMock = ok({
      session: serverSession(),
      messages: [],
      preferences: [],
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchSessionDetail('a/../b');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/session/a%2F..%2Fb');
  });
});

describe('createRemoteSession', () => {
  it('takes the id from the server rather than minting one locally', async () => {
    // The old store generated its own uuid, so the sidebar's ids and the
    // server's had nothing to do with each other.
    vi.stubGlobal('fetch', ok({ sessionId: 'server-made' }));

    const session = await createRemoteSession();

    expect(session.id).toBe('server-made');
    expect(session.messages).toEqual([]);
  });
});

describe('renameRemoteSession / deleteRemoteSession', () => {
  it('sends the title as JSON', async () => {
    const fetchMock = ok({});
    vi.stubGlobal('fetch', fetchMock);

    await renameRemoteSession('abc', 'Anniversary');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Anniversary' });
  });

  it('throws a presentable message when a delete is refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(deleteRemoteSession('abc')).rejects.toThrow(/isn't there/);
  });
});
