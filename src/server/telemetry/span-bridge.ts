import { subscribeToServerLogs, type ServerLogRecord } from '../logging';
import { config } from '../config';
import type { AwsSpan, ServerEvent } from '../../shared/interfaces/ws-events';

/**
 * Emits a server event to one user's clients. Same shape as `index.ts`'s
 * `emitFor`, curried the other way round.
 *
 * The userId is not redundant with the span's sessionId: session ids live under
 * a user in storage, so two users can hold the same one, and a session-only
 * broadcast would put one person's spans on another person's screen.
 */
export type SpanEmitter = (userId: string, event: ServerEvent) => void;

/** Read a string field, or undefined if absent or the wrong type. */
function str(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** Read a finite number field, or undefined. */
function num(data: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Translate a structured log record into a span, or undefined to ignore it.
 *
 * Only recognised events map. That asymmetry is deliberate: the server logs
 * plenty of things that are not AWS calls, and the bridge must never have to
 * know every call site in order to stay correct. Adding a span later means
 * adding a case here, not editing the code that does the work.
 *
 * `sessionId` is stamped at the **top level** of the span. `resolveBroadcastSessionId`
 * reads `payload.sessionId`, `payload.message.sessionId` and
 * `payload.preference.sessionId` and nothing else — a span that nested its
 * session anywhere else would be silently dropped, never reaching any client.
 */
export function logRecordToSpan(record: ServerLogRecord): AwsSpan | undefined {
  const { event, data } = record;

  switch (event) {
    case 'preference.saved': {
      const sessionId = str(data, 'sessionId');
      const category = str(data, 'category');
      if (!sessionId) return undefined;

      return {
        sessionId,
        resourceId: 'dynamodb',
        service: 'Amazon DynamoDB',
        resourceName: config.dynamoTableName,
        operation: 'PutItem',
        durationMs: num(data, 'durationMs') ?? 0,
        ok: record.level !== 'error',
        // The sort key, not the value. This is projected in front of a room and
        // the values are a real person's private preferences.
        detail: category ? `PREF#${category}` : undefined,
      };
    }

    case 'bedrock.converse': {
      const sessionId = str(data, 'sessionId');
      const durationMs = num(data, 'durationMs');
      if (!sessionId || durationMs === undefined) return undefined;

      return {
        sessionId,
        resourceId: 'bedrock',
        service: 'Amazon Bedrock',
        resourceName: str(data, 'modelId') ?? config.bedrockModelId,
        // The client counts model calls by `operation === 'Converse'`, so the
        // API name belongs here and the which-call-was-it goes in `detail`.
        operation: 'Converse',
        durationMs,
        ok: data?.ok !== false,
        detail: str(data, 'operation'),
      };
    }

    default:
      return undefined;
  }
}

/**
 * Bridge the server's structured logs onto the wire as `aws_span` events.
 *
 * Subscribes to the log seam rather than being called from each AWS call site.
 * `dynamodb-store.ts` already logged `preference.saved` with everything needed,
 * so DynamoDB spans cost zero edits to the store — and a refactor there cannot
 * break telemetry it does not reference.
 *
 * This is deliberately not load-bearing: remove the call and the drawer still
 * opens, still highlights from WebSocket events, and still passes its tests. It
 * adds measured durations; it is not the thing that makes the drawer work.
 *
 * Call this **once per process**, not once per connection: the returned
 * unsubscribe is the only way to detach, and a per-connection bridge that
 * discarded it would leak a subscriber per socket.
 *
 * Returns an unsubscribe function.
 */
export function startSpanBridge(emit: SpanEmitter): () => void {
  return subscribeToServerLogs((record) => {
    const span = logRecordToSpan(record);
    if (!span) return;

    // No user, nowhere to send it. `logging.ts` supplies this from the ambient
    // user scope for anything logged while serving a socket message, so a
    // missing one means the log came from outside a request — a boot-time or
    // background line, which no client is waiting on.
    const userId = str(record.data, 'userId');
    if (!userId) return;

    emit(userId, {
      type: 'aws_span',
      payload: span,
      timestamp: new Date().toISOString(),
    });
  });
}
