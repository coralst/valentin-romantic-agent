import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLiveArchitecture, LIVE_BEAT_LIMIT, LIVE_HIGHLIGHT_MS } from '../use-live-architecture';
import { publishInboundWsEvent, resetWsObservers } from '../../utils/ws-event-observer';
import { routeBetween } from '../../utils/aws-architecture';
import { FLOW_ACTION, FLOW_LEG_MS } from '../../utils/aws-demo-flows';
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
 * Walk the current beat's traffic from its origin to its destination.
 *
 * A live beat is animated hop by hop rather than arriving all at once, so
 * immediately after an event `litNode` is the *origin* and the destination is only
 * lit once the legs have been walked. One `act` per beat: the next beat's timer is
 * scheduled by an effect, which React does not run until the current update has
 * committed. Requires fake timers.
 */
function walkToArrival(beats = 8) {
  for (let i = 0; i < beats; i += 1) {
    act(() => {
      vi.advanceTimersByTime(FLOW_LEG_MS);
    });
  }
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

      // The traffic starts where it came from and walks to where the work landed.
      expect(result.current.litNode).toBe('fargate');
      walkToArrival();
      expect(result.current.litNode).toBe('dynamodb');
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
      // `useLiveArchitecture()` defaults to engine A, so that is the tree the hook
      // routed on and the tree this expectation must be built from.
      const route = routeBetween('fargate', 'dynamodb', 'valentin');
      expect(result.current.activeHops).toEqual([]);
      walkToArrival(1);
      expect(result.current.activeHops).toEqual([route[0]]);
    });

    /*
     * The captions the drawer's whole claim to be a log rests on.
     *
     * Every one of these rows is a `PutItem` or a `Converse` on the same resource
     * with a near-identical duration, and the feed used to caption each pair
     * identically — both model calls as "thinks", both table writes as "learns
     * something new". `operation` and `detail` are the only fields that separate
     * them, so these are the assertions that keep a row from claiming to be a call
     * it was not.
     */
    describe('captions', () => {
      function actionFor(overrides: Partial<AwsSpan>): string | undefined {
        const { result } = renderHook(() => useLiveArchitecture());
        act(() => {
          publishInboundWsEvent(makeSpan(overrides));
        });
        return result.current.currentBeat?.action;
      }

      it('tells the reply call from the extraction pass', () => {
        const bedrock = { resourceId: 'bedrock', service: 'Amazon Bedrock', operation: 'Converse' };

        expect(actionFor({ ...bedrock, detail: 'chat-reply' })).toBe(FLOW_ACTION.writesTheReply);
        expect(actionFor({ ...bedrock, detail: 'extract-preferences' })).toBe(
          FLOW_ACTION.extractsAPreference,
        );
      });

      /**
       * The one that was wrong on every single turn.
       *
       * Tools are on, so the call that composes almost every reply is `chat-tools` —
       * and captioning that "picks a tool" told a room a tool had been chosen on
       * turns that used none. Only the stop reason separates the two, so only the
       * suffix may caption it.
       */
      it('tells a tool-loop call that replied from one that asked for a tool', () => {
        const bedrock = { resourceId: 'bedrock', service: 'Amazon Bedrock', operation: 'Converse' };

        expect(actionFor({ ...bedrock, detail: 'chat-tools' })).toBe(FLOW_ACTION.writesTheReply);
        expect(actionFor({ ...bedrock, detail: 'chat-tools · tool_use' })).toBe(
          FLOW_ACTION.picksATool,
        );
        // The scripted flows spell it on `chat-reply`, so that has to read the same.
        expect(actionFor({ ...bedrock, detail: 'chat-reply · tool_use' })).toBe(
          FLOW_ACTION.picksATool,
        );
      });

      /**
       * The trap in the fix above.
       *
       * Extraction is a forced tool call, so it reports `tool_use` on every
       * successful pass. Reading the outcome ahead of the purpose captioned it "picks
       * a tool" — the bridge does not mark it, and this asserts the client would
       * still be right if it did.
       */
      it('does not read a forced tool call as the model choosing a tool', () => {
        const bedrock = { resourceId: 'bedrock', service: 'Amazon Bedrock', operation: 'Converse' };

        expect(actionFor({ ...bedrock, detail: 'extract-preferences · tool_use' })).toBe(
          FLOW_ACTION.extractsAPreference,
        );
      });

      it('says a model call happened without naming which, when the detail is unknown', () => {
        expect(
          actionFor({ resourceId: 'bedrock', service: 'Amazon Bedrock', operation: 'Converse', detail: 'something-new' }),
        ).toBe(FLOW_ACTION.callsTheModel);
      });

      it('tells a preference write from a transcript write', () => {
        expect(actionFor({ detail: 'PREF#music' })).toBe(FLOW_ACTION.savesAPreference);
        expect(actionFor({ detail: 'MSG#user' })).toBe(FLOW_ACTION.savesTheConversation);
        expect(actionFor({ detail: 'MSG#agent' })).toBe(FLOW_ACTION.savesTheConversation);
      });

      it('tells a read of the table from a write to it', () => {
        expect(actionFor({ operation: 'Query', detail: '' })).toBe(FLOW_ACTION.readsWhatItKnows);
      });

      it('does not guess at a preference for a write it cannot place', () => {
        expect(actionFor({ detail: 'SOMETHING#else' })).toBe(FLOW_ACTION.isWorking);
      });

      it('separates AgentCore Memory storing from recalling', () => {
        const memory = { resourceId: 'agentcore-memory', service: 'AgentCore Memory' };

        expect(actionFor({ ...memory, operation: 'CreateEvent' })).toBe(FLOW_ACTION.storesAMemory);
        expect(actionFor({ ...memory, operation: 'ListMemoryRecords' })).toBe(
          FLOW_ACTION.recallsWhatItKnows,
        );
      });
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
      walkToArrival();
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
      // The frame that moves the profile panel, captioned as that and not as the
      // learning itself — the learning was the Converse call and the write, both
      // of which arrive as their own spans with their own captions.
      expect(result.current.currentBeat?.action).toBe(FLOW_ACTION.showsTheNewPreference);
    });

    /**
     * The typing indicator is not the reply.
     *
     * `typing_start` is a frame that switches on three animated dots, sent before
     * the server calls Bedrock at all. It used to caption as "writes a reply",
     * which put a group on the feed claiming the reply was being composed while no
     * model call had yet been made — and made it read as a duplicate of the group
     * the real Converse span produces a moment later.
     */
    it('captions the typing indicator as the dots, not as the reply', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent({
          type: 'typing_start',
          payload: { sessionId: 'sess-1' },
          timestamp: TIMESTAMP,
        });
      });

      expect(result.current.currentBeat?.action).toBe(FLOW_ACTION.startsTypingDots);

      act(() => {
        publishInboundWsEvent({
          type: 'typing_stop',
          payload: { sessionId: 'sess-1' },
          timestamp: TIMESTAMP,
        });
      });

      expect(result.current.currentBeat?.action).toBe(FLOW_ACTION.stopsTypingDots);
    });

    it('captions the reply frame as a delivery, since composing it was the model call', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent({
          type: 'agent_message',
          payload: {
            message: {
              id: 'msg-2',
              sessionId: 'sess-1',
              sender: 'agent',
              content: 'Late-night jazz it is.',
              timestamp: TIMESTAMP,
            },
          },
          timestamp: TIMESTAMP,
        });
      });

      expect(result.current.currentBeat?.action).toBe(FLOW_ACTION.deliversTheReply);
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

  /**
   * One real turn, read top to bottom, as the feed shows it.
   *
   * This is the case the per-caption tests above cannot cover: the defect was never a
   * single wrong word, it was that a turn produced *repeats* — two groups reading
   * "writes a reply" of which the first was the typing indicator, then two reading
   * "thinks" for two different model calls, then one "learns something new" covering
   * both the write and the frame that displayed it. A presenter pointing at the feed
   * could not say which row was which, and this is the assertion that says they can.
   *
   * The sequence is the real one: the server sends the typing frame *before* it calls
   * Bedrock, saves both sides of the transcript, and runs extraction as a second
   * Converse call after the reply is already on screen.
   */
  describe('a whole turn', () => {
    it('captions every beat distinctly, in the order they happen', () => {
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent({
          type: 'send_message',
          payload: { sessionId: 'sess-1', content: 'She loves late-night jazz' },
          timestamp: TIMESTAMP,
        } as unknown as ServerEvent);
        publishInboundWsEvent({
          type: 'typing_start',
          payload: { sessionId: 'sess-1' },
          timestamp: TIMESTAMP,
        });
        publishInboundWsEvent(makeSpan({ detail: 'MSG#user', durationMs: 7 }));
        // `chat-tools`, not `chat-reply`: tools are on, so this is the call the real
        // build makes to compose an answer — and it is the one that used to caption
        // as "picks a tool".
        publishInboundWsEvent(
          makeSpan({
            resourceId: 'bedrock',
            service: 'Amazon Bedrock',
            operation: 'Converse',
            detail: 'chat-tools',
            durationMs: 412,
          }),
        );
        publishInboundWsEvent(makeSpan({ detail: 'MSG#agent', durationMs: 9 }));
        publishInboundWsEvent({
          type: 'agent_message',
          payload: {
            message: {
              id: 'msg-2',
              sessionId: 'sess-1',
              sender: 'agent',
              content: 'Noted.',
              timestamp: TIMESTAMP,
            },
          },
          timestamp: TIMESTAMP,
        });
        publishInboundWsEvent({
          type: 'typing_stop',
          payload: { sessionId: 'sess-1' },
          timestamp: TIMESTAMP,
        });
        publishInboundWsEvent(
          makeSpan({
            resourceId: 'bedrock',
            service: 'Amazon Bedrock',
            operation: 'Converse',
            detail: 'extract-preferences',
            durationMs: 380,
          }),
        );
        publishInboundWsEvent(makeSpan({ detail: 'PREF#music' }));
        publishInboundWsEvent(PREFERENCE_UPDATE);
      });

      expect(result.current.beats.map((beat) => beat.action)).toEqual([
        FLOW_ACTION.sendsAMessage,
        FLOW_ACTION.startsTypingDots,
        FLOW_ACTION.savesTheConversation,
        FLOW_ACTION.writesTheReply,
        FLOW_ACTION.savesTheConversation,
        FLOW_ACTION.deliversTheReply,
        FLOW_ACTION.stopsTypingDots,
        FLOW_ACTION.extractsAPreference,
        FLOW_ACTION.savesAPreference,
        FLOW_ACTION.showsTheNewPreference,
      ]);
    });
  });

  describe('history and highlighting', () => {
    it('keeps earlier beats as done once a new one lands', () => {
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
      walkToArrival();

      expect(result.current.litNode).toBe('dynamodb');
      expect(result.current.doneNodes).toContain('bedrock');
    });

    it('lights one node at a time, whatever the route crossed', () => {
      // The regression this guards: a beat handed its whole route to the diagram, so
      // a single event glowed across every resource between its endpoints at once.
      vi.useFakeTimers();
      const { result } = renderHook(() => useLiveArchitecture());

      act(() => {
        publishInboundWsEvent(PREFERENCE_UPDATE);
      });

      for (let beat = 0; beat < 8; beat += 1) {
        const parked = result.current.litNode !== undefined;
        expect(result.current.activeHops.length, `beat ${beat}`).toBe(parked ? 0 : 1);
        expect(result.current.doneNodes, `beat ${beat}`).not.toContain(result.current.litNode);
        walkToArrival(1);
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
      walkToArrival();
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
