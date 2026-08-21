import type { ClientEvent, ServerEvent } from '../../shared/interfaces/ws-events';

/**
 * A passive observation seam over the single existing WebSocket connection.
 *
 * The transport layer (`use-websocket`) publishes every event it sends or
 * receives here; observers (currently the Valentin Inspector) subscribe. This
 * exists so diagnostics can watch real traffic WITHOUT opening a second
 * WebSocket connection and without the transport needing to know who is
 * watching.
 *
 * Publishing is intentionally fire-and-forget: a throwing observer must never
 * break message delivery to the app.
 */

/** Direction of travel for an observed event, relative to the browser. */
export type WsDirection = 'inbound' | 'outbound';

/** A single observed WebSocket event. */
export interface ObservedWsEvent {
  direction: WsDirection;
  event: ServerEvent | ClientEvent;
}

/** Receives observed events. Must not throw; throws are swallowed. */
export type WsObserver = (observed: ObservedWsEvent) => void;

const observers = new Set<WsObserver>();

/**
 * Register an observer. Returns an unsubscribe function — callers are
 * responsible for invoking it (e.g. from a `useEffect` cleanup) so that
 * unmounted consumers do not leak.
 */
export function subscribeToWsEvents(observer: WsObserver): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

/** Publish a server→client event to all observers. */
export function publishInboundWsEvent(event: ServerEvent): void {
  notify({ direction: 'inbound', event });
}

/** Publish a client→server event to all observers. */
export function publishOutboundWsEvent(event: ClientEvent): void {
  notify({ direction: 'outbound', event });
}

/** Remove all observers. Test helper — keeps module state from leaking. */
export function resetWsObservers(): void {
  observers.clear();
}

function notify(observed: ObservedWsEvent): void {
  for (const observer of observers) {
    try {
      observer(observed);
    } catch {
      // An observer is a passive watcher; never let it break the transport.
    }
  }
}
