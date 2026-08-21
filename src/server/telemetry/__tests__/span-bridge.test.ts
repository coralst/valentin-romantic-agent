import { describe, it, expect, vi, afterEach } from 'vitest';
import { logRecordToSpan, startSpanBridge } from '../span-bridge';
import { logger, resetServerLogSubscribers } from '../../logging';
import { resolveBroadcastSessionId } from '../../index';
import type { AwsSpan, ServerEvent } from '../../../shared/interfaces/ws-events';
import type { ServerLogRecord } from '../../logging';

function record(
  event: string,
  data?: Record<string, unknown>,
  level: ServerLogRecord['level'] = 'info',
): ServerLogRecord {
  return { level, event, data };
}

describe('logRecordToSpan', () => {
  describe('preference.saved → DynamoDB', () => {
    const saved = record('preference.saved', {
      sessionId: 's-1',
      category: 'music',
      key: 'genre',
      durationMs: 18,
    });

    it('maps to the dynamodb node with the real table name', () => {
      const span = logRecordToSpan(saved);
      expect(span).toMatchObject({
        sessionId: 's-1',
        resourceId: 'dynamodb',
        service: 'Amazon DynamoDB',
        resourceName: 'ValentinTable-dev',
        operation: 'PutItem',
        durationMs: 18,
        ok: true,
      });
    });

    /**
     * The whole privacy contract in one assertion. The store logs `key` and
     * `category` but never the value, and the bridge must not widen that — this
     * ends up on a projector, and the values are a real person's.
     */
    it('carries the sort key, never a value', () => {
      const span = logRecordToSpan(
        record('preference.saved', {
          sessionId: 's-1',
          category: 'music',
          key: 'genre',
          value: 'Late-night jazz',
          durationMs: 18,
        }),
      );

      expect(span?.detail).toBe('PREF#music');
      expect(JSON.stringify(span)).not.toContain('Late-night jazz');
    });

    it('survives a save logged without a duration', () => {
      const span = logRecordToSpan(
        record('preference.saved', { sessionId: 's-1', category: 'music' }),
      );
      expect(span?.durationMs).toBe(0);
    });

    it('omits the detail when no category was logged', () => {
      const span = logRecordToSpan(record('preference.saved', { sessionId: 's-1' }));
      expect(span?.detail).toBeUndefined();
    });

    it('reports not-ok when the save was logged as an error', () => {
      const span = logRecordToSpan(
        record('preference.saved', { sessionId: 's-1', category: 'music' }, 'error'),
      );
      expect(span?.ok).toBe(false);
    });
  });

  describe('bedrock.converse → Bedrock', () => {
    it('maps to the bedrock node, counting as a model call', () => {
      const span = logRecordToSpan(
        record('bedrock.converse', {
          sessionId: 's-2',
          operation: 'chat-reply',
          modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
          durationMs: 412,
          ok: true,
        }),
      );

      expect(span).toMatchObject({
        sessionId: 's-2',
        resourceId: 'bedrock',
        service: 'Amazon Bedrock',
        resourceName: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        // The client counts model calls by `operation === 'Converse'`; which of
        // the two Converse calls it was belongs in `detail`.
        operation: 'Converse',
        durationMs: 412,
        ok: true,
        detail: 'chat-reply',
      });
    });

    it('distinguishes the preference-extraction call in its detail', () => {
      const span = logRecordToSpan(
        record('bedrock.converse', {
          sessionId: 's-2',
          operation: 'extract-preferences',
          durationMs: 380,
          ok: true,
        }),
      );
      expect(span?.detail).toBe('extract-preferences');
      expect(span?.operation).toBe('Converse');
    });

    /**
     * A Converse call that took four seconds and *then* threw is the most
     * useful thing to see on stage, and exactly what a success-only wrapper
     * hides.
     */
    it('keeps a failed call, with its duration and ok:false', () => {
      const span = logRecordToSpan(
        record('bedrock.converse', {
          sessionId: 's-2',
          operation: 'chat-reply',
          durationMs: 4001,
          ok: false,
        }),
      );
      expect(span).toMatchObject({ ok: false, durationMs: 4001 });
    });
  });

  describe('what it refuses to map', () => {
    /**
     * The bridge must never need to know every call site to stay correct.
     * Unrecognised events are ignored, so adding a log line elsewhere cannot
     * produce a garbage span.
     */
    it('ignores unrecognised events', () => {
      expect(logRecordToSpan(record('session.created', { sessionId: 's-1' }))).toBeUndefined();
      expect(logRecordToSpan(record('storage.initialized', { backend: 'memory' }))).toBeUndefined();
    });

    it('ignores a record with no data at all', () => {
      expect(logRecordToSpan(record('preference.saved'))).toBeUndefined();
      expect(logRecordToSpan(record('bedrock.converse'))).toBeUndefined();
    });

    /**
     * A span with no session cannot be routed to any client — the broadcast
     * path drops it. Better to not manufacture one than to emit into the void.
     */
    it('ignores a record whose sessionId is missing or the wrong type', () => {
      expect(logRecordToSpan(record('preference.saved', { category: 'music' }))).toBeUndefined();
      expect(logRecordToSpan(record('bedrock.converse', { sessionId: 42, durationMs: 1 }))).toBeUndefined();
    });

    it('ignores a converse record with no measured duration', () => {
      expect(
        logRecordToSpan(record('bedrock.converse', { sessionId: 's-2', ok: true })),
      ).toBeUndefined();
    });
  });
});

describe('startSpanBridge', () => {
  afterEach(() => {
    resetServerLogSubscribers();
    vi.restoreAllMocks();
  });

  function bridge() {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const emitted: ServerEvent[] = [];
    const stop = startSpanBridge((event) => emitted.push(event));
    return { emitted, stop };
  }

  it('turns a real log call into an aws_span event', () => {
    const { emitted, stop } = bridge();

    logger.info('preference.saved', { sessionId: 's-1', category: 'music', durationMs: 18 });

    stop();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('aws_span');
    expect((emitted[0].payload as AwsSpan).resourceId).toBe('dynamodb');
  });

  it('stamps a timestamp on the envelope', () => {
    const { emitted, stop } = bridge();
    logger.info('preference.saved', { sessionId: 's-1', category: 'music' });
    stop();
    expect(Date.parse(emitted[0].timestamp)).not.toBeNaN();
  });

  /**
   * Guards the finding this design was shaped around: `resolveBroadcastSessionId`
   * reads only `payload.sessionId` and two nested spots. A span whose session
   * lived anywhere else would be dropped before reaching any client — silently,
   * with every other test still green.
   */
  it('emits spans the broadcast path can actually route', () => {
    const { emitted, stop } = bridge();

    logger.info('preference.saved', { sessionId: 's-42', category: 'music' });
    logger.info('bedrock.converse', { sessionId: 's-42', operation: 'chat-reply', durationMs: 9 });

    stop();
    expect(emitted).toHaveLength(2);
    for (const event of emitted) {
      expect(
        resolveBroadcastSessionId(event.payload as Record<string, unknown>),
      ).toBe('s-42');
    }
  });

  it('emits nothing for logs that are not AWS calls', () => {
    const { emitted, stop } = bridge();

    logger.info('session.created', { sessionId: 's-1' });
    logger.error('ws.parse_failed', { reason: 'bad json' });

    stop();
    expect(emitted).toEqual([]);
  });

  it('stops emitting once unsubscribed', () => {
    const { emitted, stop } = bridge();

    stop();
    logger.info('preference.saved', { sessionId: 's-1', category: 'music' });

    expect(emitted).toEqual([]);
  });

  /**
   * The bridge is an observer. If the emitter throws — a closed socket, say —
   * the log call it was watching must still have succeeded, and the request
   * that logged must not fail because telemetry did.
   */
  it('cannot break the log call it observes', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    startSpanBridge(() => {
      throw new Error('socket closed');
    });

    expect(() =>
      logger.info('preference.saved', { sessionId: 's-1', category: 'music' }),
    ).not.toThrow();

    resetServerLogSubscribers();
  });
});
