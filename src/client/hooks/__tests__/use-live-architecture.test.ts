import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLiveArchitecture, LIVE_BEAT_LIMIT, LIVE_HIGHLIGHT_MS } from '../use-live-architecture';
import { publishInboundWsEvent, resetWsObservers } from '../../utils/ws-event-observer';
import { routeBetween } from '../../utils/aws-architecture';
import type { AwsSpan, ServerEvent } from '../../../shared/interfaces/ws-events';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

const TIMESTAMP = '2026-08-21T00:00:00.000Z';

function makeSpan(overrides: Partial<AwsSpan> = {}): ServerEvent {
  return {
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
      ...overrides,
    },
    timestamp: TIMESTAMP,
  };
}

function makePreference(overrides: Partial<PreferenceWithHistory> = {}): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'sess-1',
    category: 'music',
    key: 'genre',
    value: 'Late-night jazz',
    confidence: 0.9,
    sourceMessageId: 'msg-1',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    history: [],
    ...overrides,
  };
}

const PREFERENCE_UPDATE: ServerEvent = {
  type: 'preference_update',
  payload: { preference: makePreference(), isNew: true },
  timestamp: TIMESTAMP,
};

describe('useLiveArchitecture', () => {
  afterEach(() => {
    resetWsObservers();
    vi.useRealTimers();
  });

  it('starts with nothing', () => {
    const { result } = renderHook(() => useLiveArchitecture());
    expect(result.current.beats).toEqual([]);
    expect(result.current.litNode).toBeUndefined();
    expect(result.current.spanCount).toBe(0);
  });

  describe('spans', () => {
    it('records a span as a beat on its resource', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      expect(result.current.beats).toHaveLength(1);
      expect(result.current.litNode).toBe('dynamodb');
      expect(result.current.spanCount).toBe(1);
    });

    it('keeps the measured duration and outcome', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      expect(result.current.currentBeat?.durationMs).toBe(18);
      expect(result.current.currentBeat?.ok).toBe(true);
    });

    it('shortens the service name for the feed column', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      // 'Amazon DynamoDB' does not fit the feed's 70px service column.
      expect(result.current.currentBeat?.service).toBe('DynamoDB');
    });

    it('counts Converse calls separately, since that is the model-call number', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(
          makeSpan({ resourceId: 'bedrock', service: 'Amazon Bedrock', operation: 'Converse' }),
        );
        publishInboundWsEvent(makeSpan());
      });

      expect(result.current.spanCount).toBe(2);
      expect(result.current.modelCallCount).toBe(1);
    });

    /** Inventing a node is exactly what the computed-topology design exists to stop. */
    it('ignores a span for a resource that is not on the diagram', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(makeSpan({ resourceId: 'cognito' }));
      });

      expect(result.current.beats).toEqual([]);
      // Still counted: a span arrived, and under-reporting the span count would
      // make the drawer look quieter than the system actually is.
      expect(result.current.spanCount).toBe(1);
    });

    it('routes a span from Fargate, because that is what made the call', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      expect(result.current.currentBeat?.from).toBe('fargate');
      expect(result.current.activeHops).toEqual(routeBetween('fargate', 'dynamodb'));
    });
  });

  describe('events', () => {
    it('records a routed event as a beat', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(PREFERENCE_UPDATE);
      });

      expect(result.current.beats).toHaveLength(1);
      expect(result.current.litNode).toBe('browser');
    });

    it('treats a browser-bound event as a response', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(PREFERENCE_UPDATE);
      });

      expect(result.current.litIsResponse).toBe(true);
    });

    it('leaves an event with no measured call without a duration', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(PREFERENCE_UPDATE);
      });

      expect(result.current.currentBeat?.durationMs).toBeUndefined();
    });

    it('groups events into beats a room can follow', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(PREFERENCE_UPDATE);
      });

      expect(result.current.currentBeat?.actor).toBe('Valentin');
      expect(result.current.currentBeat?.action).toBe('learns something new');
    });

    /** This is projected, and the values are a real person's. */
    it('never carries a preference value into the detail line', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(PREFERENCE_UPDATE);
      });

      expect(result.current.currentBeat?.detail).not.toContain('Late-night jazz');
      expect(result.current.currentBeat?.detail).toContain('music');
    });

    it('skips an event with nowhere to light rather than guessing a path', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent({
          type: 'made_up_event',
          payload: {},
          timestamp: TIMESTAMP,
        } as unknown as ServerEvent);
      });

      expect(result.current.beats).toEqual([]);
    });
  });

  describe('history and highlighting', () => {
    it('keeps earlier beats as done once a new one lands', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(
          makeSpan({ resourceId: 'bedrock', service: 'Amazon Bedrock', operation: 'Converse' }),
        );
      });
      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      expect(result.current.litNode).toBe('dynamodb');
      expect(result.current.doneNodes).toContain('bedrock');
    });

    /**
     * Live traffic arrives in bursts and then stops. Without expiry the diagram
     * would freeze on the last beat and read as if it were still happening.
     */
    it('drops the highlight after the dwell but keeps the history', () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(makeSpan());
      });
      expect(result.current.litNode).toBe('dynamodb');

      act(() => {
        vi.advanceTimersByTime(LIVE_HIGHLIGHT_MS + 1);
      });

      expect(result.current.litNode).toBeUndefined();
      expect(result.current.beats).toHaveLength(1);
    });

    it('evicts the oldest beats past the limit', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        for (let i = 0; i < LIVE_BEAT_LIMIT + 5; i += 1) {
          publishInboundWsEvent(makeSpan());
        }
      });

      expect(result.current.beats).toHaveLength(LIVE_BEAT_LIMIT);
    });

    it('clears everything on request', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(makeSpan());
      });
      act(() => {
        result.current.clear();
      });

      expect(result.current.beats).toEqual([]);
      expect(result.current.spanCount).toBe(0);
      expect(result.current.litNode).toBeUndefined();
    });
  });

  describe('subscription', () => {
    it('records nothing when disabled', () => {
      const { result } = renderHook(() => useLiveArchitecture(false));

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      expect(result.current.beats).toEqual([]);
    });

    it('unsubscribes on unmount', () => {
      const { result, unmount } = renderHook(() => useLiveArchitecture());
      unmount();

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      expect(result.current.beats).toEqual([]);
    });
  });
});
