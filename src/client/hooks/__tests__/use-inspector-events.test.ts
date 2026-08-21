import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useInspectorEvents,
  INSPECTOR_BUFFER_LIMIT,
} from '../use-inspector-events';
import {
  publishInboundWsEvent,
  publishOutboundWsEvent,
  resetWsObservers,
} from '../../utils/ws-event-observer';
import type { ServerEvent } from '../../../shared/interfaces/ws-events';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

function makePreference(
  overrides: Partial<PreferenceWithHistory> = {},
): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'sess-1',
    category: 'food',
    key: 'cuisine',
    value: 'Italian',
    confidence: 0.9,
    sourceMessageId: 'msg-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    ...overrides,
  };
}

function makePreferenceUpdate(isNew = true): ServerEvent {
  return {
    type: 'preference_update',
    payload: { preference: makePreference(), isNew },
    timestamp: new Date().toISOString(),
  };
}

function makeTypingStart(): ServerEvent {
  return {
    type: 'typing_start',
    payload: { sessionId: 'sess-1' },
    timestamp: new Date().toISOString(),
  };
}

describe('useInspectorEvents', () => {
  afterEach(() => {
    resetWsObservers();
  });

  it('starts with an empty feed', () => {
    const { result } = renderHook(() => useInspectorEvents());
    expect(result.current.events).toHaveLength(0);
    expect(result.current.totalObserved).toBe(0);
  });

  it('records an inbound preference_update event', () => {
    const { result } = renderHook(() => useInspectorEvents());

    act(() => {
      publishInboundWsEvent(makePreferenceUpdate());
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].type).toBe('preference_update');
    expect(result.current.events[0].direction).toBe('inbound');
  });

  it('describes a preference_update with its category and value', () => {
    const { result } = renderHook(() => useInspectorEvents());

    act(() => {
      publishInboundWsEvent(makePreferenceUpdate());
    });

    expect(result.current.events[0].detail).toContain('food');
    expect(result.current.events[0].detail).toContain('Italian');
  });

  it('records outbound client events', () => {
    const { result } = renderHook(() => useInspectorEvents());

    act(() => {
      publishOutboundWsEvent({
        type: 'send_message',
        payload: { sessionId: 'sess-1', content: 'She loves tulips' },
        timestamp: new Date().toISOString(),
      });
    });

    expect(result.current.events[0].direction).toBe('outbound');
    expect(result.current.events[0].detail).toContain('tulips');
  });

  it('orders the feed newest first', () => {
    const { result } = renderHook(() => useInspectorEvents());

    act(() => {
      publishInboundWsEvent(makeTypingStart());
    });
    act(() => {
      publishInboundWsEvent(makePreferenceUpdate());
    });

    expect(result.current.events[0].type).toBe('preference_update');
    expect(result.current.events[1].type).toBe('typing_start');
  });

  it('highlights the nodes an event travelled through', () => {
    const { result } = renderHook(() => useInspectorEvents());

    act(() => {
      publishInboundWsEvent(makePreferenceUpdate());
    });

    expect(result.current.activeNodes.has('preferenceExtractor')).toBe(true);
    expect(result.current.activeNodes.has('store')).toBe(true);
  });

  it('does not grow past the buffer cap', () => {
    const { result } = renderHook(() => useInspectorEvents({ limit: 5 }));

    act(() => {
      for (let i = 0; i < 20; i += 1) {
        publishInboundWsEvent(makeTypingStart());
      }
    });

    expect(result.current.events).toHaveLength(5);
    expect(result.current.totalObserved).toBe(20);
  });

  it('does not grow past the default buffer cap', () => {
    const { result } = renderHook(() => useInspectorEvents());

    act(() => {
      for (let i = 0; i < INSPECTOR_BUFFER_LIMIT + 25; i += 1) {
        publishInboundWsEvent(makeTypingStart());
      }
    });

    expect(result.current.events).toHaveLength(INSPECTOR_BUFFER_LIMIT);
  });

  it('evicts the oldest events when the cap is exceeded', () => {
    const { result } = renderHook(() => useInspectorEvents({ limit: 2 }));

    act(() => {
      publishInboundWsEvent(makeTypingStart());
    });
    act(() => {
      publishInboundWsEvent(makePreferenceUpdate());
    });
    act(() => {
      publishInboundWsEvent(makePreferenceUpdate());
    });

    expect(result.current.events).toHaveLength(2);
    expect(result.current.events.every((e) => e.type === 'preference_update')).toBe(true);
  });

  it('clear empties the feed', () => {
    const { result } = renderHook(() => useInspectorEvents());

    act(() => {
      publishInboundWsEvent(makePreferenceUpdate());
    });
    expect(result.current.events).toHaveLength(1);

    act(() => {
      result.current.clear();
    });
    expect(result.current.events).toHaveLength(0);
  });

  it('stops observing when disabled', () => {
    const { result } = renderHook(() => useInspectorEvents({ enabled: false }));

    act(() => {
      publishInboundWsEvent(makePreferenceUpdate());
    });

    expect(result.current.events).toHaveLength(0);
  });

  it('unsubscribes on unmount so events are no longer recorded', () => {
    const { result, unmount } = renderHook(() => useInspectorEvents());

    act(() => {
      publishInboundWsEvent(makePreferenceUpdate());
    });
    expect(result.current.events).toHaveLength(1);

    unmount();

    // Publishing after unmount must not throw or update state.
    expect(() => publishInboundWsEvent(makePreferenceUpdate())).not.toThrow();
    expect(result.current.events).toHaveLength(1);
  });
});
