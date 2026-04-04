import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getBackoffDelay, dispatchServerEvent } from '../use-websocket';
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
