import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WsGateway,
  WS_CLOSE_AUTH_TIMEOUT,
  WS_CLOSE_UNAUTHENTICATED,
  type ForUserFn,
  type WsConnection,
  type WsUserServices,
} from '../ws-gateway';
import type { ServerEvent } from '../../../shared/interfaces/ws-events';
import type { AuthContext, TokenVerifier } from '../../auth/token-verifier';
import { TokenVerificationError } from '../../auth/token-verifier';

/**
 * A connection that records everything, so a test can assert on what a client
 * would actually have received — including the close code, which is the only
 * signal distinguishing "refresh your token" from "back off and retry".
 */
class FakeConnection implements WsConnection {
  sessionId: string | null = null;
  readonly sent: ServerEvent[] = [];
  closedWith: { code: number; reason: string } | null = null;
  private messageHandler: ((data: string) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(readonly id: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerEvent);
  }

  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
    this.closeHandler?.();
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  /**
   * Simulate a client frame and let the gateway's async handling settle.
   *
   * Microtask flushes rather than a `setTimeout`, so the helper still works
   * under `vi.useFakeTimers()` — which the auth-deadline tests need.
   */
  async receive(event: unknown): Promise<void> {
    this.messageHandler?.(
      typeof event === 'string' ? event : JSON.stringify(event),
    );
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }

  types(): string[] {
    return this.sent.map((e) => e.type);
  }

  last(): ServerEvent | undefined {
    return this.sent[this.sent.length - 1];
  }
}

function authFrame(token: string, sessionId?: string) {
  return {
    type: 'auth',
    payload: sessionId ? { token, sessionId } : { token },
    timestamp: new Date().toISOString(),
  };
}

/** A verifier where `token` *is* the user id, and 'bad' is always rejected */
function fakeVerifier(overrides: Partial<AuthContext> = {}): TokenVerifier {
  return {
    verify: vi.fn(async (token: string): Promise<AuthContext> => {
      if (!token || token === 'bad') {
        throw new TokenVerificationError('nope');
      }
      return {
        userId: token,
        isDemo: false,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        ...overrides,
      };
    }),
  };
}

interface Harness {
  gateway: WsGateway;
  forUser: ReturnType<typeof vi.fn>;
  /** Sessions that exist, per user */
  sessions: Map<string, Set<string>>;
  initSession: ReturnType<typeof vi.fn>;
  greetIfEmpty: ReturnType<typeof vi.fn>;
  routeEvent: ReturnType<typeof vi.fn>;
  connect(id: string): FakeConnection;
}

function harness(
  verifier: TokenVerifier = fakeVerifier(),
  authTimeoutMs = 50,
): Harness {
  const sessions = new Map<string, Set<string>>();
  let sessionCounter = 0;
  const routeEvent = vi.fn().mockResolvedValue(undefined);
  const initSession = vi.fn();
  // Default: resumed sessions already have a transcript, so no greeting. Tests
  // that care about the greeting override the implementation.
  const greetIfEmpty = vi.fn(async () => null);

  const forUser = vi.fn((userId: string): WsUserServices => {
    const owned = sessions.get(userId) ?? new Set<string>();
    sessions.set(userId, owned);

    return {
      store: {
        getSession: vi.fn(async (sessionId: string) =>
          owned.has(sessionId)
            ? ({ id: sessionId } as unknown as Awaited<
                ReturnType<WsUserServices['store']['getSession']>
              >)
            : null,
        ),
      },
      orchestrator: {
        initSession: initSession.mockImplementation(async () => {
          const sessionId = `sess-${++sessionCounter}`;
          owned.add(sessionId);
          return {
            sessionId,
            welcomeMessage: {
              id: 'welcome',
              sessionId,
              sender: 'agent' as const,
              content: 'hi',
              timestamp: new Date().toISOString(),
            },
          };
        }),
        greetIfEmpty,
      },
      eventRouter: { routeEvent },
    };
  });

  const gateway = new WsGateway({
    verifier,
    forUser: forUser as unknown as ForUserFn,
    authTimeoutMs,
  });

  return {
    gateway,
    forUser,
    sessions,
    initSession,
    greetIfEmpty,
    routeEvent,
    connect(id: string) {
      const conn = new FakeConnection(id);
      gateway.handleConnection(conn);
      return conn;
    },
  };
}

describe('WsGateway authentication', () => {
  it('opens a fresh session and announces it', async () => {
    const h = harness();
    const conn = h.connect('c1');

    await conn.receive(authFrame('alice'));

    expect(conn.types()).toEqual(['auth_ok', 'session_init']);
    expect(conn.sessionId).toBe('sess-1');
    expect(h.forUser).toHaveBeenCalledWith('alice');
    expect(conn.closedWith).toBeNull();
  });

  it('reports whether the caller is the demo account', async () => {
    const h = harness(fakeVerifier({ isDemo: true }));
    const conn = h.connect('c1');

    await conn.receive(authFrame('demo-user'));

    expect(conn.sent[0]).toMatchObject({
      type: 'auth_ok',
      payload: { userId: 'demo-user', isDemo: true },
    });
  });

  it('closes 4401 on an unverifiable token', async () => {
    const h = harness();
    const conn = h.connect('c1');

    await conn.receive(authFrame('bad'));

    expect(conn.closedWith?.code).toBe(WS_CLOSE_UNAUTHENTICATED);
    expect(h.forUser).not.toHaveBeenCalled();
  });

  it('closes 4401 when any other event arrives first', async () => {
    const h = harness();
    const conn = h.connect('c1');

    await conn.receive({
      type: 'send_message',
      payload: { sessionId: 'sess-1', content: 'hello' },
      timestamp: new Date().toISOString(),
    });

    expect(conn.closedWith?.code).toBe(WS_CLOSE_UNAUTHENTICATED);
    expect(h.routeEvent).not.toHaveBeenCalled();
  });

  it('closes 4408 when no auth frame arrives in time', async () => {
    vi.useFakeTimers();
    try {
      const h = harness(fakeVerifier(), 5_000);
      const conn = h.connect('c1');

      expect(conn.closedWith).toBeNull();
      vi.advanceTimersByTime(5_000);

      expect(conn.closedWith?.code).toBe(WS_CLOSE_AUTH_TIMEOUT);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not close an authenticated connection when the deadline passes', async () => {
    vi.useFakeTimers();
    try {
      const h = harness(fakeVerifier(), 5_000);
      const conn = h.connect('c1');

      await conn.receive(authFrame('alice'));
      vi.advanceTimersByTime(10_000);

      expect(conn.closedWith).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a second auth frame', async () => {
    const h = harness();
    const conn = h.connect('c1');

    await conn.receive(authFrame('alice'));
    await conn.receive(authFrame('bob'));

    expect(conn.last()).toMatchObject({
      type: 'error',
      payload: { code: 'ALREADY_AUTHENTICATED' },
    });
    // Crucially, still Alice's connection.
    expect(h.forUser).toHaveBeenCalledTimes(1);
  });

  it('reports a parse error without closing', async () => {
    const h = harness();
    const conn = h.connect('c1');

    await conn.receive('not json');

    expect(conn.last()).toMatchObject({
      type: 'error',
      payload: { code: 'PARSE_ERROR' },
    });
    expect(conn.closedWith).toBeNull();
  });
});

describe('WsGateway session resume', () => {
  it('rebinds to an existing session without minting a new one', async () => {
    const h = harness();

    const first = h.connect('c1');
    await first.receive(authFrame('alice'));
    const sessionId = first.sessionId!;

    const reconnect = h.connect('c2');
    await reconnect.receive(authFrame('alice', sessionId));

    expect(reconnect.sessionId).toBe(sessionId);
    expect(reconnect.types()).toEqual(['auth_ok']);
    // A reconnect that mints a session orphans the conversation it resumed from.
    expect(h.initSession).toHaveBeenCalledTimes(1);
  });

  /**
   * A resumed session that has never been spoken in still deserves a greeting.
   *
   * A conversation created anywhere other than `initSession` — demo login seeding,
   * `POST /api/session`, the client opening the first one for a new account —
   * arrived with an empty transcript, so the visitor met a blank screen and had to
   * open the conversation themselves.
   */
  it('greets a resumed session that has no messages yet', async () => {
    const h = harness();
    const first = h.connect('c1');
    await first.receive(authFrame('alice'));
    const sessionId = first.sessionId!;

    h.greetIfEmpty.mockImplementationOnce(async () => ({
      id: 'greeting',
      sessionId,
      sender: 'agent' as const,
      content: "Hello! I'm Valentin.",
      timestamp: new Date().toISOString(),
    }));

    const conn = h.connect('c2');
    await conn.receive(authFrame('alice', sessionId));

    expect(h.greetIfEmpty).toHaveBeenCalledWith(sessionId);
    // `session_init` rather than `agent_message`: the client's SESSION_INIT is the
    // idempotent one, so a second socket saying the same thing cannot double the
    // greeting in the transcript.
    expect(conn.types()).toEqual(['auth_ok', 'session_init']);
    expect(conn.last()).toMatchObject({
      type: 'session_init',
      payload: { sessionId, welcomeMessage: { sender: 'agent' } },
    });
    // Still a resume, not a mint.
    expect(h.initSession).toHaveBeenCalledTimes(1);
  });

  it('refuses an unknown session id instead of silently minting one', async () => {
    const h = harness();
    const conn = h.connect('c1');

    await conn.receive(authFrame('alice', 'sess-does-not-exist'));

    expect(conn.last()).toMatchObject({
      type: 'error',
      payload: { code: 'SESSION_NOT_FOUND' },
    });
    expect(conn.sessionId).toBeNull();
    expect(h.initSession).not.toHaveBeenCalled();
  });

  it("refuses another user's session id — the read simply misses", async () => {
    const h = harness();

    const aliceConn = h.connect('c1');
    await aliceConn.receive(authFrame('alice'));
    const aliceSession = aliceConn.sessionId!;

    const bobConn = h.connect('c2');
    await bobConn.receive(authFrame('bob', aliceSession));

    expect(bobConn.last()).toMatchObject({
      type: 'error',
      payload: { code: 'SESSION_NOT_FOUND' },
    });
    expect(bobConn.sessionId).toBeNull();
  });
});

describe('WsGateway event routing', () => {
  let h: Harness;
  let conn: FakeConnection;

  beforeEach(async () => {
    h = harness();
    conn = h.connect('c1');
    await conn.receive(authFrame('alice'));
    h.routeEvent.mockClear();
  });

  it('routes a send_message for the bound session', async () => {
    await conn.receive({
      type: 'send_message',
      payload: { sessionId: conn.sessionId, content: 'hello' },
      timestamp: new Date().toISOString(),
    });

    expect(h.routeEvent).toHaveBeenCalledWith('send_message', {
      sessionId: conn.sessionId,
      content: 'hello',
    });
  });

  it('rejects a send_message naming a different session', async () => {
    await conn.receive({
      type: 'send_message',
      payload: { sessionId: 'someone-elses-session', content: 'hello' },
      timestamp: new Date().toISOString(),
    });

    expect(h.routeEvent).not.toHaveBeenCalled();
    expect(conn.last()).toMatchObject({
      type: 'error',
      payload: { code: 'SESSION_MISMATCH' },
    });
  });

  it('does not let a client payload rebind the connection', async () => {
    // The bug this replaces: the gateway assigned conn.sessionId from
    // payload.sessionId, so any client could bind to any session id and then
    // receive that session's agent output.
    await conn.receive({
      type: 'send_message',
      payload: { sessionId: 'hijack-target', content: 'hello' },
      timestamp: new Date().toISOString(),
    });

    expect(conn.sessionId).not.toBe('hijack-target');
  });

  it('surfaces a router failure as an error event', async () => {
    h.routeEvent.mockRejectedValueOnce(new Error('orchestrator exploded'));

    await conn.receive({
      type: 'send_message',
      payload: { sessionId: conn.sessionId, content: 'hello' },
      timestamp: new Date().toISOString(),
    });

    expect(conn.last()).toMatchObject({
      type: 'error',
      payload: { code: 'INTERNAL_ERROR', message: 'orchestrator exploded' },
    });
  });

  it('closes 4401 once the token has expired', async () => {
    const expired = harness({
      verify: async (token: string) => ({
        userId: token,
        isDemo: false,
        // Already past — no timer involved, the check happens per event.
        expiresAt: Math.floor(Date.now() / 1000) - 1,
      }),
    });
    const stale = expired.connect('c9');
    await stale.receive(authFrame('alice'));

    await stale.receive({
      type: 'ping',
      payload: {},
      timestamp: new Date().toISOString(),
    });

    expect(stale.closedWith?.code).toBe(WS_CLOSE_UNAUTHENTICATED);
    expect(expired.routeEvent).not.toHaveBeenCalled();
  });
});

describe('WsGateway broadcast', () => {
  it('reaches every connection of that user bound to that session', async () => {
    const h = harness();
    const a = h.connect('c1');
    await a.receive(authFrame('alice'));
    const sessionId = a.sessionId!;

    const b = h.connect('c2');
    await b.receive(authFrame('alice', sessionId));

    const event: ServerEvent = {
      type: 'typing_start',
      payload: { sessionId },
      timestamp: new Date().toISOString(),
    };
    h.gateway.broadcastToSession('alice', sessionId, event);

    expect(a.types()).toContain('typing_start');
    expect(b.types()).toContain('typing_start');
  });

  it('does not reach another user holding the same session id', async () => {
    // Two users may legitimately hold the same session id, since the user is
    // part of the storage key. A broadcast keyed on sessionId alone would leak.
    const h = harness();

    const alice = h.connect('c1');
    await alice.receive(authFrame('alice'));

    const bob = h.connect('c2');
    await bob.receive(authFrame('bob'));

    // Force the collision the real key schema permits.
    bob.sessionId = alice.sessionId;
    const before = bob.sent.length;

    h.gateway.broadcastToSession('alice', alice.sessionId!, {
      type: 'agent_message',
      payload: {
        message: {
          id: 'm1',
          sessionId: alice.sessionId!,
          sender: 'agent',
          content: 'private',
          timestamp: new Date().toISOString(),
        },
      },
      timestamp: new Date().toISOString(),
    });

    expect(bob.sent).toHaveLength(before);
  });

  it('never reaches an unauthenticated connection', async () => {
    const h = harness();
    const lurker = h.connect('c1');
    lurker.sessionId = 'sess-1';

    h.gateway.broadcastToSession('alice', 'sess-1', {
      type: 'typing_start',
      payload: { sessionId: 'sess-1' },
      timestamp: new Date().toISOString(),
    });

    expect(lurker.sent).toHaveLength(0);
  });
});

describe('WsGateway connection bookkeeping', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts connections and forgets closed ones', async () => {
    const a = h.connect('c1');
    h.connect('c2');
    expect(h.gateway.connectionCount).toBe(2);

    a.close(1000, 'bye');
    expect(h.gateway.connectionCount).toBe(1);
  });
});
