import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAwsSpans, AWS_SPAN_BUFFER_LIMIT, SPAN_DURATION_HOLD_MS } from '../use-aws-spans';
import { publishInboundWsEvent, resetWsObservers } from '../../utils/ws-event-observer';
import type { AwsSpan, ServerEvent } from '../../../shared/interfaces/ws-events';

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
    timestamp: new Date().toISOString(),
  };
}

/** A span with a deliberately broken payload, cast at the wire boundary only. */
function makeMalformedSpan(payload: unknown): ServerEvent {
  return { type: 'aws_span', payload, timestamp: new Date().toISOString() } as ServerEvent;
}

afterEach(() => {
  resetWsObservers();
  vi.useRealTimers();
});

describe('useAwsSpans', () => {
  it('buffers an arriving span, newest first', () => {
    const { result } = renderHook(() => useAwsSpans());

    act(() => {
      publishInboundWsEvent(makeSpan({ operation: 'PutItem' }));
      publishInboundWsEvent(makeSpan({ operation: 'Query' }));
    });

    expect(result.current.spans.map((span) => span.operation)).toEqual(['Query', 'PutItem']);
    expect(result.current.totalObserved).toBe(2);
  });

  it('resolves the diagram node for a recognised resource', () => {
    const { result } = renderHook(() => useAwsSpans());

    act(() => {
      publishInboundWsEvent(makeSpan());
    });

    expect(result.current.spans[0].nodeId).toBe('dynamodb');
    expect(result.current.durationsByNode.get('dynamodb')).toBe(18);
  });

  it('still buffers a span for an unrecognised resource, with no node', () => {
    const { result } = renderHook(() => useAwsSpans());

    act(() => {
      publishInboundWsEvent(
        makeSpan({ resourceId: 'sqs', service: 'Amazon SQS', resourceName: 'valentin-q-dev' }),
      );
    });

    expect(result.current.spans).toHaveLength(1);
    expect(result.current.spans[0].service).toBe('Amazon SQS');
    expect(result.current.spans[0].nodeId).toBeUndefined();
    expect(result.current.durationsByNode.size).toBe(0);
  });

  it('ignores non-span events', () => {
    const { result } = renderHook(() => useAwsSpans());

    act(() => {
      publishInboundWsEvent({
        type: 'typing_start',
        payload: { sessionId: 'sess-1' },
        timestamp: new Date().toISOString(),
      });
    });

    expect(result.current.spans).toHaveLength(0);
    expect(result.current.totalObserved).toBe(0);
  });

  it('drops a malformed span without throwing', () => {
    const { result } = renderHook(() => useAwsSpans());

    expect(() => {
      act(() => {
        publishInboundWsEvent(makeMalformedSpan(undefined));
        publishInboundWsEvent(makeMalformedSpan({ resourceId: 'dynamodb' }));
        publishInboundWsEvent(makeMalformedSpan({ resourceId: 42, service: 'x' }));
      });
    }).not.toThrow();

    expect(result.current.spans).toHaveLength(0);
  });

  /**
   * An untimed span is not a broken one. A Gateway tool call happens inside the
   * AgentCore Runtime and reaches the proxy only as a name in the reply, so no
   * duration was ever measured — and `0` would read to the room as a free call.
   */
  it('keeps a span with no duration, and does not invent one', () => {
    const { result } = renderHook(() => useAwsSpans());

    act(() => {
      publishInboundWsEvent(
        makeMalformedSpan({
          sessionId: 'sess-1',
          resourceId: 'bedrock',
          service: 'Amazon Bedrock',
          resourceName: 'Claude Sonnet 4.5',
          operation: 'Converse',
        }),
      );
    });

    expect(result.current.spans).toHaveLength(1);
    expect(result.current.spans[0].durationMs).toBeUndefined();
    expect(result.current.spans[0].ok).toBe(true);
  });

  it('pins no duration badge for a span it was never given a duration for', () => {
    const { result } = renderHook(() => useAwsSpans());

    act(() => {
      publishInboundWsEvent(
        makeMalformedSpan({
          sessionId: 'sess-1',
          resourceId: 'bedrock',
          service: 'Amazon Bedrock',
          resourceName: 'Claude Sonnet 4.5',
          operation: 'Converse',
        }),
      );
    });

    expect(result.current.durationsByNode.has('bedrock')).toBe(false);
  });

  it('preserves a failed span', () => {
    const { result } = renderHook(() => useAwsSpans());

    act(() => {
      publishInboundWsEvent(makeSpan({ ok: false }));
    });

    expect(result.current.spans[0].ok).toBe(false);
  });

  it('enforces the buffer cap while still counting everything observed', () => {
    const { result } = renderHook(() => useAwsSpans({ limit: 3 }));

    act(() => {
      for (let i = 0; i < 5; i += 1) {
        publishInboundWsEvent(makeSpan({ durationMs: i }));
      }
    });

    expect(result.current.spans).toHaveLength(3);
    expect(result.current.spans.map((span) => span.durationMs)).toEqual([4, 3, 2]);
    expect(result.current.totalObserved).toBe(5);
  });

  it('defaults to the shared buffer limit', () => {
    expect(AWS_SPAN_BUFFER_LIMIT).toBe(100);
  });

  it('releases a held duration after the hold window', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAwsSpans());

    act(() => {
      publishInboundWsEvent(makeSpan());
    });
    expect(result.current.durationsByNode.get('dynamodb')).toBe(18);

    act(() => {
      vi.advanceTimersByTime(SPAN_DURATION_HOLD_MS + 1);
    });

    expect(result.current.durationsByNode.has('dynamodb')).toBe(false);
    // The span itself stays in the feed; only the badge expires.
    expect(result.current.spans).toHaveLength(1);
  });

  it('keeps the latest duration when a node is called twice', () => {
    const { result } = renderHook(() => useAwsSpans());

    act(() => {
      publishInboundWsEvent(makeSpan({ durationMs: 18 }));
      publishInboundWsEvent(makeSpan({ durationMs: 24 }));
    });

    expect(result.current.durationsByNode.get('dynamodb')).toBe(24);
  });

  it('does not observe while disabled', () => {
    const { result } = renderHook(() => useAwsSpans({ enabled: false }));

    act(() => {
      publishInboundWsEvent(makeSpan());
    });

    expect(result.current.spans).toHaveLength(0);
  });

  it('clears the feed on request', () => {
    const { result } = renderHook(() => useAwsSpans());

    act(() => {
      publishInboundWsEvent(makeSpan());
    });
    act(() => {
      result.current.clear();
    });

    expect(result.current.spans).toHaveLength(0);
    // totalObserved is a session counter, not a buffer length.
    expect(result.current.totalObserved).toBe(1);
  });

  it('stops observing after unmount', () => {
    const { result, unmount } = renderHook(() => useAwsSpans());
    unmount();

    expect(() => {
      act(() => {
        publishInboundWsEvent(makeSpan());
      });
    }).not.toThrow();
    expect(result.current.spans).toHaveLength(0);
  });
});
