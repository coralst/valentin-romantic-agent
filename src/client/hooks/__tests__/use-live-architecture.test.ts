import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useLiveArchitecture,
  LIVE_BEAT_LIMIT,
  LIVE_BEAT_REST_MS,
  LIVE_QUEUE_LIMIT,
} from '../use-live-architecture';
import { publishInboundWsEvent, resetWsObservers } from '../../utils/ws-event-observer';
import { flowLegs, routeBetween } from '../../utils/aws-architecture';
import { FLOW_LEG_MS } from '../../utils/aws-demo-flows';
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

/**
 * Walk the current beat's traffic forward by `beats` legs.
 *
 * A live beat is animated leg by leg rather than arriving all at once, so
 * immediately after an event `litNode` is the *origin* and the destination is only
 * lit once the legs have been walked. One `act` per leg: the next leg's timer is
 * scheduled by an effect, which React does not run until the current update has
 * committed. Requires fake timers.
 */
function walkLegs(beats = 8) {
  for (let i = 0; i < beats; i += 1) {
    act(() => {
      vi.advanceTimersByTime(FLOW_LEG_MS);
    });
  }
}

/**
 * Wait out the whole of the current beat, so the next one in the queue takes over.
 *
 * The hold is the beat's *own* length — legs times the per-leg time — plus a rest,
 * which is the fix this file exists to pin. It used to be one fixed 2600 ms for every
 * beat, and a thirteen-leg engine B route needs 3120 ms just to walk, so the longest
 * routes in the system went blank two legs from the end. Deriving the hold from the
 * route means no route can outlast its own highlight.
 */
function finishBeat(legCount: number) {
  act(() => {
    vi.advanceTimersByTime(legCount * FLOW_LEG_MS + LIVE_BEAT_REST_MS + 1);
  });
}

/** The legs a live beat walks, so a test can name its own timings. */
function spanLegCount(from: Parameters<typeof flowLegs>[0], to: Parameters<typeof flowLegs>[1]) {
  // Spans round-trip: a span is a call that already completed, so it is drawn out
  // and back rather than stranded at the far end.
  return flowLegs(from, to, 'valentin', true).length;
}

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
      vi.useFakeTimers();
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      expect(result.current.beats).toHaveLength(1);
      expect(result.current.spanCount).toBe(1);

      // The traffic starts where it came from, walks out to where the work landed,
      // and comes home — a span is a call that has already returned, so drawing it
      // one-way would leave the traffic parked in a resource it has left.
      expect(result.current.litNode).toBe('fargate');
      walkLegs(2);
      expect(result.current.litNode).toBe('dynamodb');
      walkLegs(2);
      expect(result.current.litNode).toBe('fargate');
    });

    it('walks every leg of the route before the highlight is released', () => {
      // The defect this pins. The hold used to be one fixed span for every beat, so a
      // long route ran out of highlight mid-flight and the animation simply stopped —
      // which is what "the inspector jumps over a step" looked like from the room.
      vi.useFakeTimers();
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      const legs = spanLegCount('fargate', 'dynamodb');
      const visited: Array<string | undefined> = [];
      for (let leg = 0; leg < legs; leg += 1) {
        visited.push(result.current.litNode ?? `hop:${result.current.activeHops[0]?.segment}`);
        walkLegs(1);
      }

      // Every leg accounted for, and nothing blank in the middle.
      expect(visited).toHaveLength(legs);
      expect(visited.filter((entry) => entry === undefined)).toEqual([]);
      expect(visited).toContain('dynamodb');
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
      vi.useFakeTimers();
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      expect(result.current.currentBeat?.from).toBe('fargate');

      // One hop at a time, taken from the real route — never the whole route at
      // once, which is what used to light seven cards simultaneously.
      const route = routeBetween('fargate', 'dynamodb');
      expect(result.current.activeHops).toEqual([]);
      walkLegs(1);
      expect(result.current.activeHops).toEqual([route[0]]);
    });
  });

  describe('events', () => {
    it('records a routed event as a beat', () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(PREFERENCE_UPDATE);
      });

      expect(result.current.beats).toHaveLength(1);
      walkLegs(8);
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
    it('queues a second beat instead of seizing the highlight from the first', () => {
      /*
       * The root cause of the reported bug, stated as a test.
       *
       * Every arrival used to take the highlight immediately, restarting the walk at
       * leg 0. Live turns emit spans faster than a route takes to draw, so in a recorded
       * engine A turn sixteen events produced four completed animations — and the
       * browser's own send held the highlight for 126 ms before the next event stole it.
       * The visible symptom was traffic that teleported and never started from the
       * browser. A beat now finishes its route before the next one begins.
       */
      vi.useFakeTimers();
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(
          makeSpan({ resourceId: 'bedrock', service: 'Amazon Bedrock', operation: 'Converse' }),
        );
      });
      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      // The Bedrock beat is still the one being drawn; DynamoDB is waiting its turn.
      expect(result.current.currentBeat?.to).toBe('bedrock');
      walkLegs(2);
      expect(result.current.litNode).toBe('bedrock');
      // And its destination is not yet in the trail, which would have given away
      // where the traffic was going before it got there.
      expect(result.current.doneNodes).not.toContain('dynamodb');

      finishBeat(spanLegCount('fargate', 'bedrock'));

      expect(result.current.currentBeat?.to).toBe('dynamodb');
      expect(result.current.doneNodes).toContain('bedrock');
      walkLegs(2);
      expect(result.current.litNode).toBe('dynamodb');
    });

    it('collapses a route already waiting in the queue', () => {
      // One turn emits eight `preference_update` frames on the same path. Replaying
      // that journey eight times says nothing the first one did not, and the feed
      // still lists all eight rows.
      vi.useFakeTimers();
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        for (let i = 0; i < 8; i += 1) publishInboundWsEvent(PREFERENCE_UPDATE);
      });

      expect(result.current.beats).toHaveLength(8);
      const first = result.current.currentBeat?.key;
      // Only one animation was queued, so finishing it empties the playlist.
      finishBeat(flowLegs('dynamodb', 'browser').length);
      expect(result.current.currentBeat).toBeUndefined();
      expect(first).toBeDefined();
    });

    it('plays a burst of distinct routes in the order they arrived', () => {
      // The playlist is bounded (LIVE_QUEUE_LIMIT) so a burst cannot back up for
      // minutes, but nothing is dropped from the feed — the counters are evidence.
      vi.useFakeTimers();
      const { result } = renderHook(() => useLiveArchitecture());

      const resources = ['bedrock', 'dynamodb', 'integrations'] as const;
      expect(resources.length).toBeLessThanOrEqual(LIVE_QUEUE_LIMIT);
      act(() => {
        for (const resourceId of resources) publishInboundWsEvent(makeSpan({ resourceId }));
      });

      expect(result.current.beats).toHaveLength(3);
      for (const expected of resources) {
        expect(result.current.currentBeat?.to).toBe(expected);
        finishBeat(spanLegCount('fargate', expected));
      }
      expect(result.current.currentBeat).toBeUndefined();
    });

    it('lights one node at a time, whatever the route crossed', () => {
      // The regression this guards: a beat handed its whole route to the diagram, so
      // a single event glowed across every resource between its endpoints at once.
      vi.useFakeTimers();
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(PREFERENCE_UPDATE);
      });

      // Bounded by the route's own leg count, so the loop cannot walk off the end of
      // the beat and start asserting against an empty playlist.
      const legs = flowLegs('dynamodb', 'browser').length;
      for (let beat = 0; beat < legs; beat += 1) {
        const parked = result.current.litNode !== undefined;
        expect(result.current.activeHops.length, `beat ${beat}`).toBe(parked ? 0 : 1);
        expect(result.current.doneNodes, `beat ${beat}`).not.toContain(result.current.litNode);
        walkLegs(1);
      }
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
      walkLegs(2);
      expect(result.current.litNode).toBe('dynamodb');

      finishBeat(spanLegCount('fargate', 'dynamodb'));

      expect(result.current.litNode).toBeUndefined();
      expect(result.current.beats).toHaveLength(1);
      // And the destination is history now, not a highlight.
      expect(result.current.doneNodes).toContain('dynamodb');
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

/*
 * The heartbeat is transport, not architecture.
 *
 * `use-websocket.ts` pings every 30 seconds and the server answers, and both halves
 * were routed into beats on purpose ("Browser keeps the socket alive"). So an idle
 * tab accrued two beats a minute for ever, and the drawer's counter — the number the
 * demo points at — read "23 events" of which every single one was `Proxy → ping`. It
 * measured how long the tab had been open.
 */
describe('useLiveArchitecture — keepalives are not events', () => {
  afterEach(() => {
    resetWsObservers();
  });

  /** A bare server event of the given type. Cast because the union is per-type. */
  const beat = (type: string) =>
    ({
      type,
      payload: {},
      timestamp: '2026-08-29T17:00:00.000Z',
    }) as unknown as Parameters<typeof publishInboundWsEvent>[0];

  it('records no beat for a ping', () => {
    const { result } = renderHook(() => useLiveArchitecture());

    act(() => {
      publishInboundWsEvent(beat('ping'));
    });

    expect(result.current.beats).toEqual([]);
  });

  it('records no beat for a pong', () => {
    const { result } = renderHook(() => useLiveArchitecture());

    act(() => {
      publishInboundWsEvent(beat('pong'));
    });

    expect(result.current.beats).toEqual([]);
  });

  it('stays empty however long the socket is kept alive', () => {
    const { result } = renderHook(() => useLiveArchitecture());

    act(() => {
      for (let i = 0; i < 20; i += 1) {
        publishInboundWsEvent(beat('ping'));
        publishInboundWsEvent(beat('pong'));
      }
    });

    expect(result.current.beats).toHaveLength(0);
  });

  it('still records the events that are real work', () => {
    // The guard must drop the heartbeat without dropping anything else.
    const { result } = renderHook(() => useLiveArchitecture());

    act(() => {
      publishInboundWsEvent(beat('ping'));
      publishInboundWsEvent(beat('preference_update'));
      publishInboundWsEvent(beat('pong'));
    });

    expect(result.current.beats).toHaveLength(1);
    expect(result.current.beats[0].operation).toBe('preference_update');
  });
});
