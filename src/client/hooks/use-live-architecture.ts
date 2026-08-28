import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToWsEvents, type ObservedWsEvent } from '../utils/ws-event-observer';
import {
  awsNodeIdForResource,
  describeAwsEvent,
  routeBetween,
  type AwsHop,
  type AwsNodeId,
} from '../utils/aws-architecture';
import type { AwsCategory } from '../utils/aws-diagram-layout';
import type { AwsSpan } from '../../shared/interfaces/ws-events';

/**
 * Real traffic, shaped exactly like a demo step.
 *
 * The point of this hook is that its output is interchangeable with
 * `frameForStep`'s: the drawer feeds live beats and scripted beats through the
 * same diagram and the same feed. Live mode therefore cannot drift into a
 * different picture from demo mode, because there is only one picture.
 */

/** One thing that happened, live. */
export interface LiveBeat {
  key: string;
  from: AwsNodeId;
  to: AwsNodeId;
  /** Short service name for the feed's 70px column. */
  service: string;
  operation: string;
  /** Category or sort key only — never a preference value. */
  detail: string;
  category: AwsCategory;
  /** Measured, when a span reported one. */
  durationMs?: number;
  ok?: boolean;
  actor: string;
  action: string;
}

export const LIVE_BEAT_LIMIT = 60;

/**
 * How long the most recent beat stays lit.
 *
 * Live traffic arrives in bursts and then stops; without this the diagram would
 * freeze on whatever happened last and read as though it were still happening.
 */
export const LIVE_HIGHLIGHT_MS = 2600;

export interface UseLiveArchitectureResult {
  /** Oldest first, so the feed can group in the order things happened. */
  beats: readonly LiveBeat[];
  /** The beat currently lit, or undefined once the highlight has expired. */
  currentBeat?: LiveBeat;
  litNode?: AwsNodeId;
  litIsResponse: boolean;
  passNodes: readonly AwsNodeId[];
  doneNodes: readonly AwsNodeId[];
  activeHops: readonly AwsHop[];
  /** Number of `aws_span` events seen — the honest "spans" count for the feed. */
  spanCount: number;
  /** Number of Bedrock Converse calls seen. */
  modelCallCount: number;
  clear: () => void;
}

/**
 * Who is acting, per event type.
 *
 * Groups the feed into beats a room can follow — "Valentin learns something new"
 * rather than eight rows of event names. Unknown types fall through to a generic
 * group instead of being dropped: a renamed server event should degrade to a
 * plain row, not vanish.
 */
const EVENT_STORY: Readonly<Record<string, { actor: string; action: string }>> = {
  session_init: { actor: 'User', action: 'opens the app' },
  connection_status: { actor: 'User', action: 'opens the app' },
  send_message: { actor: 'User', action: 'sends a message in chat' },
  typing_start: { actor: 'Valentin', action: 'writes a reply' },
  typing_stop: { actor: 'Valentin', action: 'writes a reply' },
  agent_message: { actor: 'Valentin', action: 'writes a reply' },
  preference_update: { actor: 'Valentin', action: 'learns something new' },
  ping: { actor: 'Browser', action: 'keeps the socket alive' },
  pong: { actor: 'Browser', action: 'keeps the socket alive' },
  error: { actor: 'System', action: 'reports a problem' },
  // Two halves of one beat, and the actor changes hands between them — which is
  // the sentence the drawer exists to show a room. Valentin only ever offers.
  action_proposal: { actor: 'Valentin', action: 'offers something to confirm' },
  confirm_action: { actor: 'User', action: 'confirms it' },
};

const EVENT_CATEGORY: Readonly<Record<string, AwsCategory>> = {
  agent_message: 'ml',
  preference_update: 'database',
  action_proposal: 'external',
  confirm_action: 'external',
};

/** Where a span's work happened, and where it was called from. */
const SPAN_CATEGORY: Readonly<Record<string, AwsCategory>> = {
  bedrock: 'ml',
  dynamodb: 'database',
  fargate: 'compute',
  s3: 'storage',
  integrations: 'external',
};

/**
 * What Valentin was doing, per span target. Anything unmapped reads as "thinks",
 * which is true of Bedrock and harmless for the rest.
 *
 * "asks the outside world" rather than "books a table": a span is a call, and at
 * this point in the flow nothing has been booked — the Confirm press is a
 * separate beat. Naming it otherwise on a projector would claim an authority the
 * agent does not have.
 */
const SPAN_ACTION: Readonly<Record<string, string>> = {
  dynamodb: 'learns something new',
  integrations: 'asks the outside world',
};

/** Short names for the feed. `Amazon DynamoDB` does not fit 70px. */
function shortService(service: string): string {
  return service
    .replace(/^Amazon /, '')
    .replace(/^AWS /, '')
    .replace('Application Load Balancer', 'ALB')
    .replace('ECS · AWS Fargate', 'Fargate');
}

/** Where each event type's work lands, mirroring `EVENT_ROUTES`. */
const EVENT_ENDPOINTS: Readonly<Record<string, { from: AwsNodeId; to: AwsNodeId }>> = {
  session_init: { from: 'dynamodb', to: 'browser' },
  send_message: { from: 'browser', to: 'fargate' },
  typing_start: { from: 'fargate', to: 'browser' },
  typing_stop: { from: 'fargate', to: 'browser' },
  agent_message: { from: 'bedrock', to: 'browser' },
  preference_update: { from: 'dynamodb', to: 'browser' },
  connection_status: { from: 'browser', to: 'alb' },
  error: { from: 'fargate', to: 'browser' },
  ping: { from: 'browser', to: 'fargate' },
  pong: { from: 'fargate', to: 'browser' },
  action_proposal: { from: 'integrations', to: 'browser' },
  confirm_action: { from: 'browser', to: 'integrations' },
};

function beatFromEvent(observed: ObservedWsEvent, key: string): LiveBeat | undefined {
  const { event } = observed;
  const endpoints = EVENT_ENDPOINTS[event.type];
  // An unrouted event has nowhere to light. It is skipped rather than guessed at:
  // inventing a path is exactly what the computed-topology design exists to stop.
  if (!endpoints) return undefined;

  const story = EVENT_STORY[event.type] ?? { actor: 'System', action: 'is working' };

  return {
    key,
    from: endpoints.from,
    to: endpoints.to,
    service: shortService(nodeServiceName(endpoints.to)),
    operation: event.type,
    detail: describeAwsEvent(event),
    category: EVENT_CATEGORY[event.type] ?? 'network',
    actor: story.actor,
    action: story.action,
  };
}

function beatFromSpan(span: AwsSpan, key: string): LiveBeat | undefined {
  const node = awsNodeIdForResource(span.resourceId);
  if (!node) return undefined;

  return {
    key,
    // Every span is a call the Fargate task made, so that is where it starts. A
    // span about Fargate itself routes to itself, which `routeBetween` reports as
    // an empty route — work that happened without a network hop.
    from: 'fargate',
    to: node,
    service: shortService(span.service),
    operation: span.operation,
    detail: span.detail ?? '',
    category: SPAN_CATEGORY[node] ?? 'compute',
    durationMs: span.durationMs,
    ok: span.ok,
    actor: 'Valentin',
    action: SPAN_ACTION[node] ?? 'thinks',
  };
}

function nodeServiceName(id: AwsNodeId): string {
  switch (id) {
    case 'browser':
      return 'Browser';
    case 'cloudfront':
      return 'CloudFront';
    case 's3':
      return 'S3';
    case 'alb':
      return 'ALB';
    case 'fargate':
      return 'Fargate';
    case 'bedrock':
      return 'Bedrock';
    case 'dynamodb':
      return 'DynamoDB';
    case 'integrations':
      return 'External APIs';
  }
}

export function useLiveArchitecture(enabled = true): UseLiveArchitectureResult {
  const [beats, setBeats] = useState<readonly LiveBeat[]>([]);
  const [currentKey, setCurrentKey] = useState<string | undefined>(undefined);
  const [spanCount, setSpanCount] = useState(0);
  const [modelCallCount, setModelCallCount] = useState(0);

  const nextKeyRef = useRef(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const record = useCallback((observed: ObservedWsEvent) => {
    const key = `live-${nextKeyRef.current}`;
    nextKeyRef.current += 1;

    let beat: LiveBeat | undefined;
    if (observed.event.type === 'aws_span') {
      const span = observed.event.payload as AwsSpan | undefined;
      if (span && typeof span.resourceId === 'string') {
        setSpanCount((count) => count + 1);
        if (span.operation === 'Converse') setModelCallCount((count) => count + 1);
        beat = beatFromSpan(span, key);
      }
    } else {
      beat = beatFromEvent(observed, key);
    }

    if (!beat) return;

    setBeats((current) => [...current, beat].slice(-LIVE_BEAT_LIMIT));
    setCurrentKey(key);

    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      highlightTimerRef.current = undefined;
      // Drop the highlight, keep the history: the feed still shows what happened,
      // the diagram stops claiming it is still happening.
      setCurrentKey(undefined);
    }, LIVE_HIGHLIGHT_MS);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    return subscribeToWsEvents(record);
  }, [enabled, record]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  const clear = useCallback(() => {
    setBeats([]);
    setCurrentKey(undefined);
    setSpanCount(0);
    setModelCallCount(0);
  }, []);

  const currentBeat = beats.find((beat) => beat.key === currentKey);
  const activeHops = currentBeat ? routeBetween(currentBeat.from, currentBeat.to) : [];
  const litNode = currentBeat?.to;

  return {
    beats,
    currentBeat,
    litNode,
    litIsResponse: activeHops.length > 0 && !activeHops[0].downstream,
    passNodes: activeHops.slice(0, -1).map((hop) => hop.node).filter((id) => id !== litNode),
    doneNodes: beats
      .filter((beat) => beat.key !== currentKey)
      .map((beat) => beat.to)
      .filter((id) => id !== litNode),
    activeHops,
    spanCount,
    modelCallCount,
    clear,
  };
}
