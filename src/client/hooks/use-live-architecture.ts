import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToWsEvents, type ObservedWsEvent } from '../utils/ws-event-observer';
import {
  awsNodeIdForResource,
  describeAwsEvent,
  flowLegs,
  nodeForEngine,
  type ArchitectureEngine,
  type AwsHop,
  type AwsNodeId,
} from '../utils/aws-architecture';
import { useFlowTraversal } from './use-flow-traversal';
import type { FlowBeat } from '../utils/aws-demo-flows';
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

/**
 * One thing that happened, live.
 *
 * `extends FlowBeat` is the promise, checked by the compiler: a recorded beat is
 * shaped like a scripted step, so it can be fed to the same diagram, the same feed
 * and the same replay. A field drifting apart here would silently become two
 * animations instead of one.
 */
export interface LiveBeat extends FlowBeat {
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
  /**
   * X-Ray id, when the span carried one — only engine B's Runtime does.
   *
   * Kept out of `detail` deliberately: `detail` is prose the feed truncates, and
   * this is a value someone copies into the console to follow the turn through the
   * two hops the proxy cannot see inside.
   */
  traceId?: string;
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
  /** The node the traffic is sitting in, or undefined while it is in flight. */
  litNode?: AwsNodeId;
  litIsResponse: boolean;
  /** Nodes already visited — a quiet trail, not a highlight. */
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
  // Folded into the reply beat on purpose. Several arrive per turn — reasoning
  // plus two frames per tool call — and each is part of composing the one answer,
  // so a beat of their own would push every other row off the feed.
  agent_activity: { actor: 'Valentin', action: 'writes a reply' },
  preference_update: { actor: 'Valentin', action: 'learns something new' },
  // No `ping`/`pong`: they are dropped before a story is looked up. See the note in
  // `EVENT_ENDPOINTS`.
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
  // Engine B. The three AgentCore primitives are `ml` because that is the service
  // group they belong to, which is the colour a builder already recognises.
  'ac-proxy': 'compute',
  'ac-runtime': 'ml',
  'ac-memory': 'ml',
  'ac-gateway': 'ml',
  'ac-dynamodb': 'database',
  'ac-integrations': 'external',
};

/**
 * What Valentin was doing, per span target. Anything unmapped reads as "thinks",
 * which is true of Bedrock and harmless for the rest.
 *
 * "asks the outside world" rather than "books a table": a span is a call, and at
 * this point in the flow nothing has been booked — the Confirm press is a
 * separate beat. Naming it otherwise on a projector would claim an authority the
 * agent does not have.
 *
 * The two engine B entries are here rather than in a second list because they are
 * the same beat in the story: on engine B the preference is extracted inside the
 * Runtime and lands in Memory, so a Memory span *is* Valentin learning something.
 */
const SPAN_ACTION: Readonly<Record<string, string>> = {
  dynamodb: 'learns something new',
  integrations: 'asks the outside world',
  'ac-memory': 'learns something new',
  'ac-dynamodb': 'learns something new',
  // Same words as `integrations`, because it is the same beat: a call out, with
  // nothing booked yet. The route differs, the story does not.
  'ac-integrations': 'asks the outside world',
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
  action_proposal: { from: 'integrations', to: 'browser' },
  confirm_action: { from: 'browser', to: 'integrations' },
  /*
   * `ping` and `pong` are deliberately absent, so the `!routed` guard below drops
   * them.
   *
   * The heartbeat fires every 30 seconds and the server answers it, so an idle tab
   * accrued two beats a minute for ever. The drawer's counter is what the demo
   * points at, and leaving a tab open long enough made it read "23 events" of which
   * every one was `Proxy → ping` — the counter measured how long the tab had been
   * open, not what Valentin had done. Keeping the socket alive is transport, not
   * architecture.
   *
   * Filtered here rather than at the emit site: `publishOutboundWsEvent` in
   * `use-websocket.ts` is a general diagnostic seam that other observers legitimately
   * want the heartbeat from, and silencing it there would make a dead socket
   * impossible to diagnose.
   */
};

function beatFromEvent(
  observed: ObservedWsEvent,
  key: string,
  engine: ArchitectureEngine,
): LiveBeat | undefined {
  const { event } = observed;
  const routed = EVENT_ENDPOINTS[event.type];
  // An unrouted event has nowhere to light. It is skipped rather than guessed at:
  // inventing a path is exactly what the computed-topology design exists to stop.
  if (!routed) return undefined;
  // The endpoints are authored once, for engine A, and translated: the events are
  // identical on both engines because both engines speak the same WS protocol.
  const endpoints = {
    from: nodeForEngine(routed.from, engine),
    to: nodeForEngine(routed.to, engine),
  };

  const story = EVENT_STORY[event.type] ?? {
    actor: 'System',
    action: 'is working',
  };

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

function beatFromSpan(
  span: AwsSpan,
  key: string,
  engine: ArchitectureEngine,
): LiveBeat | undefined {
  const node = awsNodeIdForResource(span.resourceId, engine);
  if (!node) return undefined;

  return {
    key,
    // Every span is a call the task made, so that is where it starts. A span about
    // the task itself routes to itself, which `routeBetween` reports as an empty
    // route — work that happened without a network hop.
    from: nodeForEngine('fargate', engine),
    to: node,
    service: shortService(span.service),
    operation: span.operation,
    detail: span.detail ?? '',
    category: SPAN_CATEGORY[node] ?? 'compute',
    durationMs: span.durationMs,
    ok: span.ok,
    actor: 'Valentin',
    action: SPAN_ACTION[node] ?? 'thinks',
    traceId: span.traceId,
  };
}

/** Whether a span's operation is the model actually being called. */
function isModelCall(operation: string): boolean {
  // `Converse` is engine A's model call; on engine B the model runs inside the
  // Runtime, so `InvokeAgentRuntime` is the closest measurable equivalent.
  return operation === 'Converse' || operation === 'InvokeAgentRuntime';
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
    case 'ac-proxy':
      return 'Proxy';
    case 'ac-runtime':
      return 'Runtime';
    case 'ac-memory':
      return 'Memory';
    case 'ac-gateway':
      return 'Gateway';
    case 'ac-dynamodb':
      return 'DynamoDB';
    case 'ac-integrations':
      return 'External APIs';
  }
}

export function useLiveArchitecture(
  enabled = true,
  engine: ArchitectureEngine = 'valentin',
): UseLiveArchitectureResult {
  const [beats, setBeats] = useState<readonly LiveBeat[]>([]);
  const [currentKey, setCurrentKey] = useState<string | undefined>(undefined);
  const [spanCount, setSpanCount] = useState(0);
  const [modelCallCount, setModelCallCount] = useState(0);

  const nextKeyRef = useRef(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const record = useCallback(
    (observed: ObservedWsEvent) => {
      const key = `live-${nextKeyRef.current}`;
      nextKeyRef.current += 1;

      let beat: LiveBeat | undefined;
      if (observed.event.type === 'aws_span') {
        const span = observed.event.payload as AwsSpan | undefined;
        if (span && typeof span.resourceId === 'string') {
          // Counted before the beat is built, and deliberately: a span the topology
          // cannot place still arrived, and under-reporting it would make the drawer
          // look quieter than the system is. See the test that pins this.
          setSpanCount((count) => count + 1);
          if (isModelCall(span.operation)) {
            setModelCallCount((count) => count + 1);
          }
          beat = beatFromSpan(span, key, engine);
        }
      } else {
        beat = beatFromEvent(observed, key, engine);
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
    },
    [engine],
  );

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

  /*
   * Live traffic is animated exactly the way a scripted step is: the beat's route is
   * split into legs and walked one at a time.
   *
   * It used to be handed to the diagram whole, so a single `preference_update` lit
   * the browser, CloudFront, the ALB, Fargate, the Gateway, Memory and DynamoDB at
   * the same instant — a picture that shows which resources exist rather than what
   * just happened. Sharing the traversal with demo mode is also the only way the two
   * modes can be trusted to look the same, which is the promise this hook's output
   * shape exists to keep.
   */
  const legs = currentBeat ? flowLegs(currentBeat.from, currentBeat.to) : [];
  const legIndex = useFlowTraversal({
    legCount: Math.max(1, legs.length),
    resetKey: currentKey ?? null,
    enabled: currentBeat !== undefined,
  });
  const leg = legs[Math.min(legIndex, legs.length - 1)];

  const litNode = leg?.kind === 'node' ? leg.node : undefined;
  const activeHops = leg?.kind === 'hop' ? [leg.hop] : [];

  // The trail: every earlier beat's destination, plus the part of this beat's route
  // the traffic has already crossed. Not a highlight — the diagram renders these
  // border-only, so the one lit box stays the only thing that draws the eye.
  const trail = beats.filter((beat) => beat.key !== currentKey).map((beat) => beat.to);
  for (const earlier of legs.slice(0, legIndex)) {
    if (earlier.kind === 'node') trail.push(earlier.node);
  }

  return {
    beats,
    currentBeat,
    litNode,
    litIsResponse: leg !== undefined && !leg.downstream,
    doneNodes: trail.filter((id) => id !== litNode),
    activeHops,
    spanCount,
    modelCallCount,
    clear,
  };
}
