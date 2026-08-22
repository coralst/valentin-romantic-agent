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

  function renderSocket(sessionId: string | null = 'sess-1') {
    const result = renderHook(() =>
      useWebSocket({
        chatDispatch: vi.fn(),
        preferencesDispatch: vi.fn(),
        sessionId,
        url: 'ws://localhost:3001/ws',
      }),
    );
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket.onopen?.();
    });
    return { ...result, socket };
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
});
