import { AsyncLocalStorage } from 'node:async_hooks';

type LogLevel = 'info' | 'warn' | 'error';

/**
 * The user a log line was produced on behalf of, when one is in scope.
 *
 * Telemetry is now per-user: `broadcastToSession` needs a userId as well as a
 * sessionId, because two users may legitimately hold the same session id. Most
 * call sites can stamp their own userId, but the Bedrock client cannot — it is
 * a process singleton shared by every connection, and its `sendTimed` only ever
 * receives a sessionId. Threading a userId down to it would mean editing the
 * `BedrockClient` interface, the orchestrator and the extractor to carry a value
 * none of them otherwise needs.
 *
 * An ambient scope, set once where the user is already known, gets every log
 * line routed instead.
 */
const userScope = new AsyncLocalStorage<string>();

/**
 * Run `fn` with `userId` attached to every log record it produces.
 *
 * Set this at the point a request's user becomes known — currently one place,
 * `WsGateway`'s message handling. Async continuations inherit the scope, so an
 * await deep inside the orchestrator still logs under the right user.
 */
export function withUserScope<T>(userId: string, fn: () => T): T {
  return userScope.run(userId, fn);
}

function formatLog(level: LogLevel, event: string, data?: Record<string, unknown>): string {
  return JSON.stringify({
    level,
    timestamp: new Date().toISOString(),
    service: 'valentin-backend',
    event,
    ...data,
  });
}

/** A structured log line, as delivered to subscribers. */
export interface ServerLogRecord {
  level: LogLevel;
  event: string;
  data?: Record<string, unknown>;
}

/** Receives log records. Must not throw; throws are swallowed. */
export type ServerLogSubscriber = (record: ServerLogRecord) => void;

const subscribers = new Set<ServerLogSubscriber>();

/**
 * Observe every structured log line the server emits.
 *
 * This is the one seam the Inspector's telemetry rides on. Call sites that
 * already log — `dynamodb-store.ts` logs `preference.saved` with `{sessionId,
 * category, key}`, the Bedrock client logs its Converse calls — become the
 * source of spans without any of them being edited. That matters because a
 * large refactor is in flight on the same files; a subscriber seam here has a
 * conflict surface of one file instead of five.
 *
 * Returns an unsubscribe function.
 */
export function subscribeToServerLogs(subscriber: ServerLogSubscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

/** Remove all subscribers. Test helper — keeps module state from leaking. */
export function resetServerLogSubscribers(): void {
  subscribers.clear();
}

/**
 * Fan a record out to subscribers, after the console write.
 *
 * A subscriber is a passive observer: if one throws, the log call it was
 * watching must still have succeeded. Swallowing here is deliberate, and
 * mirrors the client's proven `ws-event-observer.ts` contract.
 */
function notify(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  if (subscribers.size === 0) return;

  // Stamped onto the in-process record only, never into `formatLog`. The userId
  // is a Cognito `sub`, and CloudWatch log groups are retained far longer and
  // read far more widely than this process's own subscribers.
  const scopedUserId = data?.userId ?? userScope.getStore();
  const record: ServerLogRecord = {
    level,
    event,
    data: scopedUserId === undefined ? data : { ...data, userId: scopedUserId },
  };

  for (const subscriber of subscribers) {
    try {
      subscriber(record);
    } catch {
      // Telemetry must never be able to break logging.
    }
  }
}

export const logger = {
  info(event: string, data?: Record<string, unknown>) {
    console.log(formatLog('info', event, data));
    notify('info', event, data);
  },
  warn(event: string, data?: Record<string, unknown>) {
    console.warn(formatLog('warn', event, data));
    notify('warn', event, data);
  },
  error(event: string, data?: Record<string, unknown>) {
    console.error(formatLog('error', event, data));
    notify('error', event, data);
  },
};
