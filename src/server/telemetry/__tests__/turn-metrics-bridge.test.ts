import { describe, it, expect, vi, afterEach } from 'vitest';
import { logRecordToSpan, logRecordToTurnMetrics, startSpanBridge } from '../span-bridge';
import { logger, resetServerLogSubscribers, withUserScope } from '../../logging';
import { resolveBroadcastSessionId } from '../../index';
import type { ServerEvent } from '../../../shared/interfaces/ws-events';
import type { ServerLogRecord } from '../../logging';

function record(event: string, data?: Record<string, unknown>): ServerLogRecord {
  return { level: 'info', event, data };
}

const VALID_TURN = {
  sessionId: 's-1',
  engine: 'valentin',
  storeBackend: 'memory',
  modelCalls: 2,
  storeReads: 9,
  replyLatencyMs: 1240,
  ok: true,
};

afterEach(() => {
  resetServerLogSubscribers();
  vi.restoreAllMocks();
});

describe('logRecordToTurnMetrics', () => {
  it('maps a complete agent.turn line', () => {
    expect(logRecordToTurnMetrics(record('agent.turn', VALID_TURN))).toEqual({
      sessionId: 's-1',
      engine: 'valentin',
      storeBackend: 'memory',
      modelCalls: 2,
      storeReads: 9,
      replyLatencyMs: 1240,
      ok: true,
    });
  });

  it('ignores every other event', () => {
    expect(logRecordToTurnMetrics(record('bedrock.converse', VALID_TURN))).toBeUndefined();
    expect(logRecordToTurnMetrics(record('preference.saved', { sessionId: 's-1' }))).toBeUndefined();
  });

  it('is not a span, and a span is not it', () => {
    // The two mappers must stay mutually exclusive: `startSpanBridge` picks one frame
    // per record, so an event both claimed would be published twice.
    expect(logRecordToSpan(record('agent.turn', VALID_TURN))).toBeUndefined();
  });

  it('carries token counts when present and omits the keys when absent', () => {
    const withTokens = logRecordToTurnMetrics(
      record('agent.turn', { ...VALID_TURN, inputTokens: 900, outputTokens: 100 }),
    );
    expect(withTokens).toMatchObject({ inputTokens: 900, outputTokens: 100 });

    const without = logRecordToTurnMetrics(record('agent.turn', VALID_TURN));
    // Absent, not zero. The panel averages over reporting turns only, and a `0` here
    // would be counted as a turn that genuinely cost nothing.
    expect(without && 'inputTokens' in without).toBe(false);
  });

  it.each([
    ['no sessionId', { ...VALID_TURN, sessionId: undefined }],
    ['no modelCalls', { ...VALID_TURN, modelCalls: undefined }],
    ['no storeReads', { ...VALID_TURN, storeReads: undefined }],
    ['no replyLatencyMs', { ...VALID_TURN, replyLatencyMs: undefined }],
    ['an unknown engine', { ...VALID_TURN, engine: 'lambda' }],
    ['an unknown backend', { ...VALID_TURN, storeBackend: 'redis' }],
  ])('drops a malformed line with %s', (_label, data) => {
    expect(logRecordToTurnMetrics(record('agent.turn', data))).toBeUndefined();
  });
});

describe('the turn frame on the wire', () => {
  it('is emitted as turn_metrics and routes to the right session', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const emitted: ServerEvent[] = [];
    startSpanBridge((_userId, event) => emitted.push(event));

    withUserScope('u-1', () => logger.info('agent.turn', VALID_TURN));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('turn_metrics');
    // The reason `sessionId` is top-level on `TurnMetrics`: this resolver reads
    // `payload.sessionId` and silently drops anything that nests it elsewhere.
    expect(
      resolveBroadcastSessionId(emitted[0].payload as unknown as Record<string, unknown>),
    ).toBe('s-1');
  });

  it('is dropped when no user is in scope', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const emitted: ServerEvent[] = [];
    startSpanBridge((_userId, event) => emitted.push(event));

    logger.info('agent.turn', VALID_TURN);

    expect(emitted).toHaveLength(0);
  });
});

describe('bedrock.converse spans', () => {
  it('carry token usage when the log line reported it', () => {
    const span = logRecordToSpan(
      record('bedrock.converse', {
        sessionId: 's-1',
        durationMs: 900,
        operation: 'chat-reply',
        inputTokens: 3000,
        outputTokens: 400,
      }),
    );

    expect(span?.usage).toEqual({ inputTokens: 3000, outputTokens: 400 });
    expect(span?.engine).toBe('valentin');
  });

  it('carry no usage object at all when the line reported none', () => {
    const span = logRecordToSpan(
      record('bedrock.converse', { sessionId: 's-1', durationMs: 900, operation: 'chat-reply' }),
    );

    expect(span?.usage).toBeUndefined();
  });
});
