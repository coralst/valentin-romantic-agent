import { describe, it, expect, vi, afterEach } from 'vitest';
import { logRecordToSpan, startSpanBridge } from '../span-bridge';
import { logger, resetServerLogSubscribers, withUserScope } from '../../logging';
import { resolveBroadcastSessionId } from '../../index';
import type { AwsSpan, ServerEvent } from '../../../shared/interfaces/ws-events';
import type { ServerLogRecord } from '../../logging';
import {
  INTEGRATION_IDS,
  INTEGRATION_LABELS,
} from '../../../shared/interfaces/integrations';

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

  describe('integration.* → External APIs', () => {
    it('maps every service onto the one grouped node', () => {
      /*
       * One node, not six. Six cards do not read on a projector, so `resourceId`
       * is the node and the service goes in `resourceName` — which is what makes
       * a single node able to say "Ontopo, 412ms" out loud.
       */
      for (const id of INTEGRATION_IDS) {
        const span = logRecordToSpan(
          record(`integration.${id}`, {
            sessionId: 's-9',
            integration: id,
            operation: 'check_availability',
            durationMs: 412,
            ok: true,
          }),
        );
        expect(span).toMatchObject({
          sessionId: 's-9',
          resourceId: 'integrations',
          service: 'External APIs',
          resourceName: INTEGRATION_LABELS[id],
          operation: 'check_availability',
          durationMs: 412,
          ok: true,
        });
      }
    });

    it('carries the tool name and nothing about what was asked', () => {
      const span = logRecordToSpan(
        record('integration.gmail', {
          sessionId: 's-9',
          operation: 'propose_email',
          durationMs: 88,
        }),
      );

      /*
       * The load-bearing assertion of this whole file. A proposed email carries
       * prose about someone's partner, and the drawer is on a projector. The tool
       * name is the whole of what is safe, so there is no `detail` at all.
       */
      expect(span?.detail).toBeUndefined();
      expect(JSON.stringify(span)).not.toMatch(/@|body|recipient|message/i);
    });

    it('reports a failed call as not ok, keeping its duration', () => {
      // A visible red segment with a real number on it is the point: "Ontopo took
      // 3 seconds and failed" is the sentence the drawer exists to show.
      expect(
        logRecordToSpan(
          record('integration.ontopo', {
            sessionId: 's-9',
            operation: 'search_restaurants',
            durationMs: 3010,
            ok: false,
          }),
        ),
      ).toMatchObject({ ok: false, durationMs: 3010 });

      expect(
        logRecordToSpan(
          record('integration.ontopo', { sessionId: 's-9', durationMs: 5 }, 'error'),
        ),
      ).toMatchObject({ ok: false });
    });

    it('survives a log with no operation or duration', () => {
      // Degrades to a labelled zero-length segment rather than vanishing: a call
      // that happened and was not timed is still a call worth drawing.
      expect(
        logRecordToSpan(record('integration.hebcal', { sessionId: 's-9' })),
      ).toMatchObject({ operation: 'call', durationMs: 0 });
    });

    it('ignores an integration event for a service that is not in the union', () => {
      /*
       * The prefix match is still a closed set. A stray `integration.opentable`
       * log — a rename half-applied, say — must be dropped rather than drawn as a
       * node with an empty label.
       */
      expect(
        logRecordToSpan(record('integration.opentable', { sessionId: 's-9' })),
      ).toBeUndefined();
      expect(logRecordToSpan(record('integration.', { sessionId: 's-9' }))).toBeUndefined();
    });

    it('ignores an integration event with no session to route it to', () => {
      expect(logRecordToSpan(record('integration.ontopo', { durationMs: 5 }))).toBeUndefined();
      // `integration.failed` is a warning for CloudWatch, not a span — and it is
      // logged *alongside* the real one, so mapping it would double every failure.
      expect(
        logRecordToSpan(record('integration.failed', { sessionId: 's-9', cause: 'boom' })),
      ).toBeUndefined();
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
    const routedTo: string[] = [];
    const stop = startSpanBridge((userId, event) => {
      routedTo.push(userId);
      emitted.push(event);
    });
    return { emitted, routedTo, stop };
  }

  /**
   * Log the way production does — inside a user scope set once by `WsGateway`,
   * not stamped by hand at each call site. Going through the real seam is what
   * keeps these tests honest: if the scope stopped reaching log records, every
   * span would become unroutable in production, and this file would say so.
   */
  function logAs(userId: string, fn: () => void): void {
    withUserScope(userId, fn);
  }

  it('turns a real log call into an aws_span event', () => {
    const { emitted, stop } = bridge();

    logAs('u-1', () =>
      logger.info('preference.saved', {
        sessionId: 's-1',
        category: 'music',
        durationMs: 18,
      }),
    );

    stop();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('aws_span');
    expect((emitted[0].payload as AwsSpan).resourceId).toBe('dynamodb');
  });

  it('stamps a timestamp on the envelope', () => {
    const { emitted, stop } = bridge();
    logAs('u-1', () => logger.info('preference.saved', { sessionId: 's-1', category: 'music' }));
    stop();
    expect(Date.parse(emitted[0].timestamp)).not.toBeNaN();
  });

  /**
   * Routing needs the user as well as the session. Session ids live under a user
   * in storage, so two people can hold the same one — a session-only broadcast
   * would put one person's spans on another person's screen.
   */
  it('routes each span to the user whose work produced it', () => {
    const { routedTo, stop } = bridge();

    logAs('alice', () => logger.info('preference.saved', { sessionId: 's-1', category: 'music' }));
    logAs('bob', () =>
      logger.info('bedrock.converse', { sessionId: 's-1', operation: 'reply', durationMs: 3 }),
    );

    stop();
    expect(routedTo).toEqual(['alice', 'bob']);
  });

  /**
   * A userId stamped by the call site wins over the ambient scope. `DynamoDBStore`
   * knows its own user for certain — it is a constructor field — so it says so
   * explicitly rather than trusting whatever scope happens to be active.
   */
  it('prefers an explicitly logged userId over the ambient scope', () => {
    const { routedTo, stop } = bridge();

    logAs('scope-user', () =>
      logger.info('preference.saved', {
        sessionId: 's-1',
        category: 'music',
        userId: 'explicit-user',
      }),
    );

    stop();
    expect(routedTo).toEqual(['explicit-user']);
  });

  /**
   * The failure this guards is silence, not a crash: a span with no user cannot
   * be addressed to any connection, and inventing one would mean broadcasting a
   * measurement to whoever happened to be listening.
   */
  it('drops a span it cannot attribute to a user', () => {
    const { emitted, stop } = bridge();

    // No scope, no explicit userId — a boot-time or background log line.
    logger.info('preference.saved', { sessionId: 's-1', category: 'music' });

    stop();
    expect(emitted).toEqual([]);
  });

  /**
   * Guards the finding this design was shaped around: `resolveBroadcastSessionId`
   * reads only `payload.sessionId` and two nested spots. A span whose session
   * lived anywhere else would be dropped before reaching any client — silently,
   * with every other test still green.
   */
  it('emits spans the broadcast path can actually route', () => {
    const { emitted, stop } = bridge();

    logAs('u-1', () => {
      logger.info('preference.saved', { sessionId: 's-42', category: 'music' });
      logger.info('bedrock.converse', {
        sessionId: 's-42',
        operation: 'chat-reply',
        durationMs: 9,
      });
    });

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

    logAs('u-1', () => {
      logger.info('session.created', { sessionId: 's-1' });
      logger.error('ws.parse_failed', { reason: 'bad json' });
    });

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

    // Inside a user scope, so the emitter is actually reached — an unattributable
    // span is dropped before it, which would make this pass for the wrong reason.
    expect(() =>
      withUserScope('u-1', () =>
        logger.info('preference.saved', { sessionId: 's-1', category: 'music' }),
      ),
    ).not.toThrow();

    resetServerLogSubscribers();
  });
});
