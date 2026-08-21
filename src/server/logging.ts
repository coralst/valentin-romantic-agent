type LogLevel = 'info' | 'warn' | 'error';

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
  const record: ServerLogRecord = { level, event, data };
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
