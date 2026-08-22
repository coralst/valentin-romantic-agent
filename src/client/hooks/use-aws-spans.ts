import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToWsEvents, type ObservedWsEvent } from '../utils/ws-event-observer';
import type { AwsSpan } from '../../shared/interfaces/ws-events';
import { awsNodeIdForResource, type AwsNodeId } from '../utils/aws-architecture';

/**
 * Maximum spans retained. Matches `INSPECTOR_BUFFER_LIMIT`: the Inspector may
 * stay open for a whole rehearsal, and 100 is already far more history than is
 * readable from the back of a room.
 */
export const AWS_SPAN_BUFFER_LIMIT = 100;

/**
 * How long a measured duration stays pinned to its node. Longer than the
 * highlight itself, so the number is still readable after the flash fades —
 * a duration that vanishes with the animation is a duration nobody read.
 */
export const SPAN_DURATION_HOLD_MS = 6000;

/** A buffered span, ready to render. */
export interface AwsSpanEntry extends AwsSpan {
  /** Monotonic id — stable React key even for two identical spans. */
  id: number;
  /** Arrival time, ISO. Taken from the envelope when present. */
  timestamp: string;
  /**
   * The diagram node this span belongs to, when the resource is recognised.
   * Undefined spans still render in the feed under their own service name.
   */
  nodeId?: AwsNodeId;
}

export interface UseAwsSpansResult {
  /** Newest first. Never longer than `limit`. */
  spans: readonly AwsSpanEntry[];
  /** Most recent measured duration per node, for the duration badges. */
  durationsByNode: ReadonlyMap<AwsNodeId, number>;
  /** Spans observed since mount, including those evicted from the buffer. */
  totalObserved: number;
  clear: () => void;
}

export interface UseAwsSpansOptions {
  limit?: number;
  /** When false the hook stops observing and holds its current state. */
  enabled?: boolean;
}

/**
 * Collects `aws_span` telemetry off the existing WebSocket observation seam.
 *
 * Spans are pure enrichment: node highlighting is driven by the eight existing
 * WebSocket events, so if telemetry never fires — the seam disabled, an older
 * server, a dropped event — the diagram still animates and this hook simply
 * returns nothing. Nothing in the view may depend on a span arriving.
 */
export function useAwsSpans({
  limit = AWS_SPAN_BUFFER_LIMIT,
  enabled = true,
}: UseAwsSpansOptions = {}): UseAwsSpansResult {
  const [spans, setSpans] = useState<readonly AwsSpanEntry[]>([]);
  const [durationsByNode, setDurationsByNode] = useState<ReadonlyMap<AwsNodeId, number>>(new Map());
  const [totalObserved, setTotalObserved] = useState(0);

  const nextIdRef = useRef(0);
  const holdTimersRef = useRef<Map<AwsNodeId, ReturnType<typeof setTimeout>>>(new Map());

  const holdDuration = useCallback((nodeId: AwsNodeId, durationMs: number) => {
    const timers = holdTimersRef.current;

    setDurationsByNode((current) => new Map(current).set(nodeId, durationMs));

    const existing = timers.get(nodeId);
    if (existing) clearTimeout(existing);

    timers.set(
      nodeId,
      setTimeout(() => {
        timers.delete(nodeId);
        setDurationsByNode((current) => {
          const next = new Map(current);
          next.delete(nodeId);
          return next;
        });
      }, SPAN_DURATION_HOLD_MS),
    );
  }, []);

  const record = useCallback(
    (observed: ObservedWsEvent) => {
      if (observed.event.type !== 'aws_span') return;

      const entry = toSpanEntry(observed, nextIdRef.current);
      if (!entry) return;
      nextIdRef.current += 1;

      setSpans((current) => [entry, ...current].slice(0, limit));
      setTotalObserved((count) => count + 1);
      if (entry.nodeId) holdDuration(entry.nodeId, entry.durationMs);
    },
    [limit, holdDuration],
  );

  useEffect(() => {
    if (!enabled) return;
    return subscribeToWsEvents(record);
  }, [enabled, record]);

  useEffect(() => {
    const timers = holdTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const clear = useCallback(() => {
    setSpans([]);
  }, []);

  return { spans, durationsByNode, totalObserved, clear };
}

/**
 * Validate and shape a span off the wire.
 *
 * The payload is checked rather than cast: this arrives from the network, and a
 * malformed span must be dropped quietly instead of throwing inside a
 * subscriber. Only `operation` and the two names are required to be strings —
 * `detail` is optional and `durationMs` is coerced, because a span that is
 * merely missing its timing is still worth listing.
 */
function toSpanEntry(observed: ObservedWsEvent, id: number): AwsSpanEntry | undefined {
  const payload = observed.event.payload as Partial<AwsSpan> | undefined;
  if (!payload || typeof payload !== 'object') return undefined;

  const { resourceId, service, resourceName, operation } = payload;
  if (
    typeof resourceId !== 'string' ||
    typeof service !== 'string' ||
    typeof resourceName !== 'string' ||
    typeof operation !== 'string'
  ) {
    return undefined;
  }

  const durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : 0;

  return {
    id,
    sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : '',
    resourceId,
    service,
    resourceName,
    operation,
    durationMs,
    ok: payload.ok !== false,
    detail: typeof payload.detail === 'string' ? payload.detail : undefined,
    timestamp: observed.event.timestamp ?? new Date().toISOString(),
    nodeId: awsNodeIdForResource(resourceId),
  };
}
