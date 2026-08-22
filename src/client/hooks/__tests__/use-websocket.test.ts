import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { getBackoffDelay, dispatchServerEvent, useWebSocket } from '../use-websocket';
import {
  subscribeToWsEvents,
  resetWsObservers,
  type ObservedWsEvent,
} from '../../utils/ws-event-observer';
import type { ServerEvent } from '../../../shared/interfaces/ws-events';
import type { ChatAction } from '../use-chat-state';
import type { PreferencesAction } from '../use-preferences-state';

describe('getBackoffDelay', () => {
  it('returns 1000ms for attempt 0', () => {
    expect(getBackoffDelay(0)).toBe(1000);
  });

  it('returns 2000ms for attempt 1', () => {
    expect(getBackoffDelay(1)).toBe(2000);
  });

  it('returns 4000ms for attempt 2', () => {
    expect(getBackoffDelay(2)).toBe(4000);
  });

  it('caps at 30000ms for high attempt numbers', () => {
    expect(getBackoffDelay(10)).toBe(30000);
    expect(getBackoffDelay(20)).toBe(30000);
  });
});

describe('dispatchServerEvent', () => {
  let chatDispatch: ReturnType<typeof vi.fn>;
  let preferencesDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    chatDispatch = vi.fn();
    preferencesDispatch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches SESSION_INIT to chatDispatch on session_init event', () => {
    const event: ServerEvent = {
      type: 'session_init',
      payload: {
        sessionId: 'sess-1',
        welcomeMessage: {
          id: 'msg-1',
          sessionId: 'sess-1',
          sender: 'agent',
          content: 'Hello!',
          timestamp: new Date().toISOString(),
        },
      },
      timestamp: new Date().toISOString(),
    };

    dispatchServerEvent(event, chatDispatch, preferencesDispatch);

    expect(chatDispatch).toHaveBeenCalledWith({
      type: 'SESSION_INIT',
      sessionId: 'sess-1',
      welcomeMessage: event.payload.welcomeMessage,
    });
    expect(preferencesDispatch).not.toHaveBeenCalled();
  });

  it('dispatches RECEIVE_MESSAGE to chatDispatch on agent_message event', () => {
    const msg = {
      id: 'msg-2',
      sessionId: 'sess-1',
      sender: 'agent' as const,
      content: 'How can I help?',
      timestamp: new Date().toISOString(),
    };
    const event: ServerEvent = {
      type: 'agent_message',
      payload: { message: msg },
      timestamp: new Date().toISOString(),
    };

    dispatchServerEvent(event, chatDispatch, preferencesDispatch);

    expect(chatDispatch).toHaveBeenCalledWith({ type: 'RECEIVE_MESSAGE', message: msg });
  });

  it('dispatches SET_TYPING true on typing_start event', () => {
    const event: ServerEvent = {
      type: 'typing_start',
      payload: { sessionId: 'sess-1' },
      timestamp: new Date().toISOString(),
    };

    dispatchServerEvent(event, chatDispatch, preferencesDispatch);

    expect(chatDispatch).toHaveBeenCalledWith({ type: 'SET_TYPING', isTyping: true });
  });

  it('dispatches SET_TYPING false on typing_stop event', () => {
    const event: ServerEvent = {
      type: 'typing_stop',
      payload: { sessionId: 'sess-1' },
      timestamp: new Date().toISOString(),
    };

    dispatchServerEvent(event, chatDispatch, preferencesDispatch);

    expect(chatDispatch).toHaveBeenCalledWith({ type: 'SET_TYPING', isTyping: false });
  });

  it('dispatches ADD_PREFERENCE to preferencesDispatch when isNew is true', () => {
    const pref = {
      id: 'pref-1',
      sessionId: 'sess-1',
      category: 'food' as const,
      key: 'cuisine',
      value: 'Italian',
      confidence: 0.9,
      sourceMessageId: 'msg-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    };
    const event: ServerEvent = {
      type: 'preference_update',
      payload: { preference: pref, isNew: true },
      timestamp: new Date().toISOString(),
    };

    dispatchServerEvent(event, chatDispatch, preferencesDispatch);

    expect(preferencesDispatch).toHaveBeenCalledWith({ type: 'ADD_PREFERENCE', preference: pref });
    expect(chatDispatch).not.toHaveBeenCalled();
  });

  it('dispatches UPDATE_PREFERENCE to preferencesDispatch when isNew is false', () => {
    const pref = {
      id: 'pref-1',
      sessionId: 'sess-1',
      category: 'music' as const,
      key: 'genre',
      value: 'Jazz',
      confidence: 0.85,
      sourceMessageId: 'msg-2',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{ previousValue: 'Rock', changedAt: new Date().toISOString(), sourceMessageId: 'msg-1' }],
    };
    const event: ServerEvent = {
      type: 'preference_update',
      payload: { preference: pref, isNew: false },
      timestamp: new Date().toISOString(),
    };

    dispatchServerEvent(event, chatDispatch, preferencesDispatch);

    expect(preferencesDispatch).toHaveBeenCalledWith({ type: 'UPDATE_PREFERENCE', preference: pref });
  });

  it('dispatches SET_CONNECTION on connection_status event', () => {
    const event: ServerEvent = {
      type: 'connection_status',
      payload: { status: 'reconnecting' },
      timestamp: new Date().toISOString(),
    };

    dispatchServerEvent(event, chatDispatch, preferencesDispatch);

    expect(chatDispatch).toHaveBeenCalledWith({ type: 'SET_CONNECTION', status: 'reconnecting' });
  });

  it('does not dispatch on pong event', () => {
    const event: ServerEvent = {
      type: 'pong',
      payload: {},
      timestamp: new Date().toISOString(),
    };

    dispatchServerEvent(event, chatDispatch, preferencesDispatch);

    expect(chatDispatch).not.toHaveBeenCalled();
    expect(preferencesDispatch).not.toHaveBeenCalled();
  });
});

/**
 * The three `publish*WsEvent` call sites in `use-websocket.ts` had no coverage at
 * all. That is the dangerous kind of gap: break the seam and the architecture
 * drawer goes permanently silent while every other test in the suite stays
 * green, because nothing else in the app subscribes to it.
 *
 * These drive the hook through a fake socket rather than testing the pure
 * helpers, since the publishing happens in the socket callbacks.
 */
describe('WebSocket observation seam', () => {
  /** Minimal stand-in for the browser WebSocket, with hooks to drive it. */
  class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    static readonly OPEN = 1;

    readyState = FakeWebSocket.OPEN;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(public url: string) {
      FakeWebSocket.instances.push(this);
    }

    send(data: string) {
      this.sent.push(data);
    }

    close() {
      this.readyState = 3;
    }

    /** Deliver a server→client frame, as the real socket would. */
    receive(event: unknown) {
      this.onmessage?.({ data: JSON.stringify(event) });
    }
  }

  let observed: ObservedWsEvent[];

  /** The frame the server sends once it has accepted the `auth` frame. */
  function authOk() {
    return { type: 'auth_ok', payload: {}, timestamp: new Date().toISOString() };
  }

  /**
   * The frame the server sends when it minted the session itself — which is also
   * how the client learns which session the connection is bound to.
   */
  function sessionInit(sessionId: string) {
    return {
      type: 'session_init',
      payload: {
        sessionId,
        welcomeMessage: {
          id: 'm-welcome',
          sessionId,
          sender: 'agent',
          content: 'Tell me about her.',
          timestamp: new Date().toISOString(),
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Renders the hook and drives the socket to the state a turn can be sent in.
   *
   * That state is `auth_ok`, not `open` — the gateway closes the connection on any
   * pre-auth event, so the hook holds sends until it arrives. Tests that want the
   * unauthenticated window pass `{ authenticate: false }`.
   */
  function renderSocket(
    sessionId: string | null = 'sess-1',
    { authenticate = true }: { authenticate?: boolean } = {},
  ) {
    /*
     * Both dispatches are hoisted out of the render callback deliberately.
     *
     * They are `connect`'s dependencies, so a fresh `vi.fn()` per render makes the
     * hook tear down and rebuild the socket on every state change — including the
     * one `auth_ok` causes, which would then land on an abandoned socket. The real
     * app passes `useReducer` dispatches, which are stable.
     */
    const chatDispatch = vi.fn();
    const preferencesDispatch = vi.fn();
    const result = renderHook(() =>
      useWebSocket({
        chatDispatch,
        preferencesDispatch,
        sessionId,
        url: 'ws://localhost:3001/ws',
      }),
    );
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket.onopen?.();
    });
    if (authenticate) {
      act(() => {
        socket.receive(authOk());
        // Binds the connection to this session, as the mint path does on the wire.
        // Without it the hook holds turns, because it will not send into a
        // connection bound to some other session.
        if (sessionId) socket.receive(sessionInit(sessionId));
      });
      // Not traffic under test in most cases: drop the frames the handshake itself
      // published so assertions can count from zero.
      observed = observed.filter(
        (o) => o.event.type !== 'auth_ok' && o.event.type !== 'session_init',
      );
    }
    return { ...result, socket, chatDispatch };
  }

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    observed = [];
    subscribeToWsEvents((event) => observed.push(event));
  });

  afterEach(() => {
    resetWsObservers();
    vi.unstubAllGlobals();
  });

  it('publishes an inbound event to subscribers', () => {
    const { socket } = renderSocket();

    act(() => {
      socket.receive({
        type: 'typing_start',
        payload: { sessionId: 'sess-1' },
        timestamp: new Date().toISOString(),
      });
    });

    expect(observed).toHaveLength(1);
    expect(observed[0].direction).toBe('inbound');
    expect(observed[0].event.type).toBe('typing_start');
  });

  it('publishes an outbound send to subscribers', () => {
    const { result } = renderSocket();

    act(() => {
      result.current.sendMessage('She loves pottery.');
    });

    const outbound = observed.filter((o) => o.direction === 'outbound');
    expect(outbound).toHaveLength(1);
    expect(outbound[0].event.type).toBe('send_message');
  });

  /**
   * `aws_span` has no case in `dispatchServerEvent`'s switch and no `default`,
   * so it reaches the drawer purely because publishing happens *before* the
   * dispatch. Adding a `default: throw` upstream would break the drawer, and
   * this is the test that would catch it.
   */
  it('publishes aws_span even though no reducer handles it', () => {
    const { socket } = renderSocket();

    act(() => {
      socket.receive({
        type: 'aws_span',
        payload: {
          sessionId: 'sess-1',
          resourceId: 'dynamodb',
          service: 'Amazon DynamoDB',
          resourceName: 'ValentinTable-dev',
          operation: 'PutItem',
          durationMs: 18,
          ok: true,
          detail: 'PREF#music',
        },
        timestamp: new Date().toISOString(),
      });
    });

    expect(observed).toHaveLength(1);
    expect(observed[0].event.type).toBe('aws_span');
  });

  it('publishes before dispatching, so a reducer throw cannot hide traffic', () => {
    // Throws only on the action under test: `onopen` also dispatches
    // (SET_CONNECTION), outside the message handler's try, so a dispatch that
    // throws unconditionally blows up during connect and never reaches the
    // assertion.
    const throwingDispatch = vi.fn((action: ChatAction) => {
      if (action.type === 'SET_TYPING') throw new Error('reducer exploded');
    });
    renderHook(() =>
      useWebSocket({
        chatDispatch: throwingDispatch,
        preferencesDispatch: vi.fn(),
        sessionId: 'sess-1',
        url: 'ws://localhost:3001/ws',
      }),
    );
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket.onopen?.();
    });

    act(() => {
      socket.receive({
        type: 'typing_start',
        payload: { sessionId: 'sess-1' },
        timestamp: new Date().toISOString(),
      });
    });

    expect(observed).toHaveLength(1);
  });

  it('does not publish a malformed frame', () => {
    const { socket } = renderSocket();

    act(() => {
      socket.onmessage?.({ data: 'not json at all' });
    });

    expect(observed).toEqual([]);
  });

  /**
   * A throwing observer must never break message delivery — the drawer is a
   * diagnostic, and a diagnostic that can take the chat down is worse than none.
   */
  it('delivers messages even when an observer throws', () => {
    resetWsObservers();
    subscribeToWsEvents(() => {
      throw new Error('observer exploded');
    });
    const chatDispatch = vi.fn();
    renderHook(() =>
      useWebSocket({
        chatDispatch,
        preferencesDispatch: vi.fn(),
        sessionId: 'sess-1',
        url: 'ws://localhost:3001/ws',
      }),
    );
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket.onopen?.();
    });

    act(() => {
      socket.receive({
        type: 'typing_start',
        payload: { sessionId: 'sess-1' },
        timestamp: new Date().toISOString(),
      });
    });

    expect(chatDispatch).toHaveBeenCalledWith({ type: 'SET_TYPING', isTyping: true });
  });

  /**
   * The window between `onopen` and `auth_ok`.
   *
   * `onopen` cannot send the `auth` frame synchronously — it awaits
   * `getAccessToken()`, which may go to the network — and the gateway *closes the
   * connection* on any event that arrives before auth. So a turn sent in that
   * window is not merely refused: it is lost, and the socket is torn down with it.
   * In production this cost roughly half of all first turns, which is what pushed
   * the guided intro onto its scripted fallback.
   */
  describe('the pre-auth window', () => {
    /** Frames the hook itself put on the wire, ignoring the auth handshake. */
    function turns(socket: { sent: string[] }) {
      return socket.sent
        .map((raw) => JSON.parse(raw) as { type: string; payload?: { content?: string } })
        .filter((f) => f.type !== 'auth');
    }

    it('does not report connected until auth_ok', () => {
      const { result, socket, chatDispatch } = renderSocket('sess-1', {
        authenticate: false,
      });

      expect(result.current.connectionStatus).toBe('disconnected');

      act(() => {
        socket.receive(authOk());
      });

      expect(result.current.connectionStatus).toBe('connected');
      expect(chatDispatch).toHaveBeenCalledWith({
        type: 'SET_CONNECTION',
        status: 'connected',
      });
    });

    it('holds a turn sent before auth_ok instead of putting it on the wire', () => {
      const { result, socket } = renderSocket('sess-1', { authenticate: false });

      act(() => {
        result.current.sendMessage('She loves white peonies.');
      });

      expect(turns(socket)).toEqual([]);
      // Nor is it published: the inspector would otherwise show a turn the server
      // never saw.
      expect(observed.filter((o) => o.direction === 'outbound')).toEqual([]);
    });

    it('flushes held turns in order once auth_ok arrives', () => {
      const { result, socket } = renderSocket('sess-1', { authenticate: false });

      act(() => {
        result.current.sendMessage('first');
        result.current.sendMessage('second');
      });

      act(() => {
        socket.receive(authOk());
      });

      expect(turns(socket).map((f) => f.payload?.content)).toEqual(['first', 'second']);
    });

    it('flushes each held turn exactly once across two auth_ok frames', () => {
      // A reconnect delivers a second `auth_ok`; the queue must already be empty
      // or the presenter's turn is sent twice and answered twice.
      const { result, socket } = renderSocket('sess-1', { authenticate: false });

      act(() => {
        result.current.sendMessage('only once');
      });
      act(() => {
        socket.receive(authOk());
      });
      act(() => {
        socket.receive(authOk());
      });

      expect(turns(socket)).toHaveLength(1);
    });

    it('sends straight through once authenticated', () => {
      const { result, socket } = renderSocket();

      act(() => {
        result.current.sendMessage('She loves white peonies.');
      });

      expect(turns(socket)).toHaveLength(1);
      expect(observed.filter((o) => o.direction === 'outbound')).toHaveLength(1);
    });

    it('suppresses the heartbeat until auth_ok', () => {
      vi.useFakeTimers();
      try {
        const { socket } = renderSocket('sess-1', { authenticate: false });

        act(() => {
          vi.advanceTimersByTime(90_000);
        });
        // A ping is an ordinary event to the gateway, so one landing early would
        // close the connection the heartbeat exists to keep alive.
        expect(turns(socket)).toEqual([]);

        act(() => {
          socket.receive(authOk());
        });
        act(() => {
          vi.advanceTimersByTime(30_000);
        });

        expect(turns(socket).map((f) => f.type)).toEqual(['ping']);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  /**
   * Which session the connection is bound to.
   *
   * The gateway binds a connection to one session at auth time and answers
   * 'SESSION_MISMATCH' to a `send_message` naming any other. The socket outlives
   * session switches on purpose, so the client has to notice the drift and rebind.
   * It drifted on the first page load in production: the socket opened before
   * `/api/demo/login`'s session reached chat state, the server minted its own, and
   * every turn after that was refused with the app looking perfectly connected —
   * leaving the minted session behind as an empty row in the sidebar. The hook now
   * refuses to connect until the app names a session, so the frame always carries
   * one and the gateway only ever *resumes*; these tests hold that line.
   */
  describe('session binding', () => {
    /** Renders with a session that the test can change, as a switch does. */
    function renderSwitchable(initial: string | null) {
      const chatDispatch = vi.fn();
      const preferencesDispatch = vi.fn();
      const view = renderHook(
        ({ sessionId }: { sessionId: string | null }) =>
          useWebSocket({
            chatDispatch,
            preferencesDispatch,
            sessionId,
            url: 'ws://localhost:3001/ws',
          }),
        { initialProps: { sessionId: initial } },
      );
      return view;
    }

    /** Drive one socket to bound-and-authenticated, as a resume does. */
    function handshake(socket: FakeWebSocket, sessionId: string) {
      act(() => {
        socket.onopen?.();
      });
      act(() => {
        socket.receive(authOk());
        socket.receive(sessionInit(sessionId));
      });
    }

    /**
     * REGRESSION GUARD for the pile of empty conversations on a fresh account.
     *
     * A socket that authenticates with no session id is asking the gateway to mint
     * one, and this hook used to do exactly that on mount — before
     * `GET /api/sessions` had answered. Every page load therefore left an orphan
     * session behind, which showed up as an empty "New conversation" row on the
     * next load. Remove the `hasSession` gate and this goes red.
     */
    it('does not open a socket before the app has a session to resume', () => {
      renderSwitchable(null);

      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('opens one socket as soon as a session arrives, naming it', async () => {
      const view = renderSwitchable(null);
      view.rerender({ sessionId: 'demo-session' });

      expect(FakeWebSocket.instances).toHaveLength(1);
      const socket = FakeWebSocket.instances[0];
      // The auth frame waits on the token, so it goes out a microtask later.
      await act(async () => {
        socket.onopen?.();
      });

      const frame = JSON.parse(socket.sent[0] ?? '{}') as {
        type: string;
        payload: { sessionId?: string | null };
      };
      expect(frame.type).toBe('auth');
      // Never null: a null id is the gateway's cue to mint a session nobody asked for.
      expect(frame.payload.sessionId).toBe('demo-session');
    });

    it('reconnects when the app moves to a session the socket is not bound to', () => {
      const view = renderSwitchable('sess-1');
      handshake(FakeWebSocket.instances[0], 'sess-1');
      expect(FakeWebSocket.instances).toHaveLength(1);

      view.rerender({ sessionId: 'demo-session' });

      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    /**
     * Deleting the last conversation used to leave the socket bound to a session
     * that no longer existed, so the next turn was refused as a mismatch.
     */
    it('drops the socket when the app is left with no session', () => {
      const view = renderSwitchable('sess-1');
      handshake(FakeWebSocket.instances[0], 'sess-1');

      view.rerender({ sessionId: null });

      // 3 === CLOSED
      expect(FakeWebSocket.instances[0].readyState).toBe(3);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('does not reconnect when the app names the session it is already bound to', () => {
      const view = renderSwitchable('sess-1');
      handshake(FakeWebSocket.instances[0], 'sess-1');

      view.rerender({ sessionId: 'sess-1' });

      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('does not reconnect before the auth frame has claimed a session', () => {
      // The socket is open but has not authenticated, so the frame still to go out
      // will carry the current session — reconnecting would be pure churn.
      const view = renderSwitchable('sess-1');
      view.rerender({ sessionId: 'demo-session' });

      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('delivers a turn typed during the rebind to the rebound socket', () => {
      const view = renderSwitchable('sess-1');
      handshake(FakeWebSocket.instances[0], 'sess-1');

      view.rerender({ sessionId: 'demo-session' });
      const rebound = FakeWebSocket.instances[1];

      act(() => {
        view.result.current.sendMessage('She loves white peonies.');
      });
      // Held, not sent: the new socket has not authenticated yet.
      expect(rebound.sent).toEqual([]);

      handshake(rebound, 'demo-session');

      const sent = rebound.sent
        .map((raw) => JSON.parse(raw) as { type: string; payload: { sessionId?: string } })
        .filter((f) => f.type === 'send_message');
      expect(sent).toHaveLength(1);
      expect(sent[0].payload.sessionId).toBe('demo-session');
    });

    it('drops a held turn addressed to a session the rebound socket left behind', () => {
      const view = renderSwitchable('sess-old');
      // Never authenticated, so the turn is held with the old session on it.
      act(() => {
        view.result.current.sendMessage('for the old session');
      });

      view.rerender({ sessionId: 'sess-new' });
      const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
      handshake(socket, 'sess-new');

      const sent = socket.sent
        .map((raw) => JSON.parse(raw) as { type: string })
        .filter((f) => f.type === 'send_message');
      // A SESSION_MISMATCH error for a turn the room has moved on from is worse
      // than the turn quietly not being replayed.
      expect(sent).toEqual([]);
    });
  });
});
