import { useCallback, useEffect, useRef, useState } from 'react';
import {
  subscribeToWsEvents,
  type ObservedWsEvent,
  type WsDirection,
} from '../utils/ws-event-observer';
import {
  nodesForEventType,
  describeEvent,
  labelForEventType,
  type ArchitectureNodeId,
} from '../utils/inspector-architecture';

/**
 * Maximum events retained in the feed.
 *
 * The buffer is bounded because the Inspector may stay mounted for an entire
 * rehearsal or conference session while heartbeats arrive every 30s. 100 is
 * far more history than is readable on a projector, while keeping retained
 * payloads trivially small.
 */
export const INSPECTOR_BUFFER_LIMIT = 100;

/**
 * How long a node stays highlighted after its event arrives. Deliberately
 * generous: on a projector, a flash shorter than this reads as noise rather
 * than as "this component just did something".
 */
export const NODE_HIGHLIGHT_MS = 1800;

/** A single entry in the Inspector's event feed. */
export interface InspectorEvent {
  /** Monotonic id — stable React key, unique even for identical events. */
  id: number;
  type: string;
  /** Human-readable event name. */
  label: string;
  /** Short "what happened" detail line, may be empty. */
  detail: string;
  direction: WsDirection;
  /** ISO timestamp from the event envelope, or arrival time as a fallback. */
  timestamp: string;
  /** Nodes this event travelled through. */
  nodes: readonly ArchitectureNodeId[];
}

/** Result of the Inspector event hook. */
export interface UseInspectorEventsResult {
  /** Newest event first. Never longer than `limit`. */
  events: readonly InspectorEvent[];
  /** Node ids currently highlighted. */
  activeNodes: ReadonlySet<ArchitectureNodeId>;
  /** Total events observed since mount, including those evicted from the buffer. */
  totalObserved: number;
  /** Empty the feed. */
  clear: () => void;
}

/** Options for the Inspector event hook. */
export interface UseInspectorEventsOptions {
  /** Max retained events. Defaults to `INSPECTOR_BUFFER_LIMIT`. */
  limit?: number;
  /** When false, the hook stops observing and holds its current state. */
  enabled?: boolean;
}

/**
 * Observes live WebSocket traffic for the Valentin Inspector.
 *
 * Taps the existing connection via the shared observation seam — it never
 * opens a socket of its own. Events land in a bounded ring buffer so a long
 * demo session cannot grow memory without limit.
 */
export function useInspectorEvents({
  limit = INSPECTOR_BUFFER_LIMIT,
  enabled = true,
}: UseInspectorEventsOptions = {}): UseInspectorEventsResult {
  const [events, setEvents] = useState<readonly InspectorEvent[]>([]);
  const [activeNodes, setActiveNodes] = useState<ReadonlySet<ArchitectureNodeId>>(new Set());
  const [totalObserved, setTotalObserved] = useState(0);

  const nextIdRef = useRef(0);
  const highlightTimersRef = useRef<Map<ArchitectureNodeId, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const highlightNodes = useCallback((nodes: readonly ArchitectureNodeId[]) => {
    if (nodes.length === 0) return;
    const timers = highlightTimersRef.current;

    setActiveNodes((current) => new Set([...current, ...nodes]));

    for (const node of nodes) {
      const existing = timers.get(node);
      if (existing) clearTimeout(existing);

      timers.set(
        node,
        setTimeout(() => {
          timers.delete(node);
          setActiveNodes((current) => {
            const next = new Set(current);
            next.delete(node);
            return next;
          });
        }, NODE_HIGHLIGHT_MS),
      );
    }
  }, []);

  const record = useCallback(
    (observed: ObservedWsEvent) => {
      const entry = toInspectorEvent(observed, nextIdRef.current);
      nextIdRef.current += 1;

      setEvents((current) => [entry, ...current].slice(0, limit));
      setTotalObserved((count) => count + 1);
      highlightNodes(entry.nodes);
    },
    [limit, highlightNodes],
  );

  useEffect(() => {
    if (!enabled) return;
    return subscribeToWsEvents(record);
  }, [enabled, record]);

  // Clear pending highlight timers on unmount.
  useEffect(() => {
    const timers = highlightTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const clear = useCallback(() => {
    setEvents([]);
  }, []);

  return { events, activeNodes, totalObserved, clear };
}

/** Map an observed WebSocket event onto a feed entry. */
function toInspectorEvent(observed: ObservedWsEvent, id: number): InspectorEvent {
  const { event, direction } = observed;
  return {
    id,
    type: event.type,
    label: labelForEventType(event.type),
    detail: describeEvent(event),
    direction,
    timestamp: event.timestamp ?? new Date().toISOString(),
    nodes: nodesForEventType(event.type),
  };
}
