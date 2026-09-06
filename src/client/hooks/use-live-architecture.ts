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
import { FLOW_LEG_MS, type FlowBeat } from '../utils/aws-demo-flows';
import { prefersReducedMotion } from '../utils/motion-preference';
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
 * How long a beat rests in its destination after its route has finished being walked.
 *
 * This is a *rest*, not the whole highlight: a beat holds for as long as its own route
 * takes to walk plus this. The previous version held every beat for one fixed 2600 ms
 * regardless of length, which silently truncated anything longer — a
 * `preference_update` on engine B is six hops, thirteen legs, 3120 ms of animation, so
 * the last two legs were cut off and the traffic vanished two boxes short of the
 * browser. Deriving the hold from the route means no route can outlast its own
 * highlight.
 */
export const LIVE_BEAT_REST_MS = 900;

/**
 * How many beats may be waiting to animate.
 *
 * Live traffic arrives in bursts — a single turn on engine A emits three Converse
 * spans and eight `preference_update` frames — and a queue that accepted all of them
 * would still be playing the burst long after the turn ended, which reads as the
 * system being slow rather than as the queue being deep. Past this, arrivals are
 * dropped from the *animation* only: they are still recorded in `beats`, so the feed
 * and the counters stay honest about everything that happened.
 */
export const LIVE_QUEUE_LIMIT = 8;

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
  // No engine B entries for the table or the partners: they are the same two nodes on
  // both engines now, so `dynamodb` and `integrations` above cover both.
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
 * `ac-memory` is here rather than in a second list because it is the same beat in the
 * story: on engine B the preference is extracted inside the Runtime and lands in
 * Memory, so a Memory span *is* Valentin learning something. The table and the
 * partners need no engine B entry at all — they are one node each now, so the first
 * two lines already answer for both engines.
 */
const SPAN_ACTION: Readonly<Record<string, string>> = {
  dynamodb: 'learns something new',
  integrations: 'asks the outside world',
  'ac-memory': 'learns something new',
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
    /*
     * Named for where the news came *from*, not where it landed.
     *
     * Almost every WS event ends at the browser, so labelling by destination made
     * five different events read as five identical `Browser` rows — a column that
     * distinguished nothing. By origin they read DynamoDB, Browser, Fargate, Bedrock,
     * DynamoDB, which is the question someone scanning the feed is actually asking:
     * who did this?
     */
    service: shortService(nodeServiceName(endpoints.from)),
    operation: event.type,
    detail: describeAwsEvent(event),
    category: EVENT_CATEGORY[event.type] ?? 'network',
    actor: story.actor,
    action: story.action,
  };
}

/**
 * Which resource made the call a span describes.
 *
 * On engine A every span is the Fargate task's own call. On engine B it depends how
 * deep the span is: the proxy only ever calls the Runtime, and everything past that —
 * Memory, the Gateway, the table, the partners — is called by the agent code running
 * *inside* the Runtime. Attributing those to the proxy drew the proxy reaching past a
 * Runtime it was still waiting on, which is both wrong and the reason engine B's
 * routes looked like teleports.
 */
const AC_RUNTIME_CALLEES: readonly AwsNodeId[] = ['ac-memory', 'ac-gateway', 'dynamodb', 'integrations'];

function spanOrigin(node: AwsNodeId, engine: ArchitectureEngine): AwsNodeId {
  if (engine !== 'agentcore') return 'fargate';
  return AC_RUNTIME_CALLEES.includes(node) ? 'ac-runtime' : 'ac-proxy';
}

function beatFromSpan(
  span: AwsSpan,
  key: string,
  engine: ArchitectureEngine,
): LiveBeat | undefined {
  const node = awsNodeIdForResource(span.resourceId, engine);
  if (!node) return undefined;

  const category = SPAN_CATEGORY[node] ?? 'compute';

  return {
    key,
    // A span about its own caller routes to itself, which `routeBetween` reports as an
    // empty route — work that happened without a network hop.
    from: spanOrigin(node, engine),
    to: node,
    /*
     * One card serves every partner, so for an outbound call the partner's name is
     * more use than the card's. Both engines already send it: `span.service` is the
     * constant `External APIs` and `resourceName` is `Ontopo`, `Hebrew calendar` and
     * so on. Six identical `External APIs` rows told a reader nothing about which
     * tool fired.
     */
    service:
      category === 'external' && span.resourceName
        ? shortService(span.resourceName)
        : shortService(span.service),
    operation: span.operation,
    detail: span.detail ?? '',
    category,
    durationMs: span.durationMs,
    ok: span.ok,
    actor: 'Valentin',
    action: SPAN_ACTION[node] ?? 'thinks',
    traceId: span.traceId,
    /*
     * A span is a *finished* call: it exists because something was asked and answered,
     * and its `durationMs` is how long the answer took. So it is drawn out and back.
     *
     * This is the other half of the reported bug. Every animation that completed
     * before this change was a response walk, because the spans — the only beats that
     * describe a request — were drawn one way and then had their highlight stolen
     * before they finished. The request half of "go and back" was never on screen.
     */
    returns: true,
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
  }
}

export function useLiveArchitecture(
  enabled = true,
  engine: ArchitectureEngine = 'valentin',
): UseLiveArchitectureResult {
  const [beats, setBeats] = useState<readonly LiveBeat[]>([]);
  /*
   * Beats waiting to be animated, head first. The head is the one on screen.
   *
   * This queue is the fix for the reported bug. Every arrival used to seize the
   * highlight immediately, resetting the traversal to leg 0 — so on a real turn, where
   * sixteen events land in a few seconds, fifteen of them cancelled the animation of
   * the one before it and only the last survivor ever finished walking. That is both
   * halves of "it jumps over steps and doesn't start from the browser": the walk
   * restarted from a *new* beat's origin mid-journey, and the origins it restarted from
   * were the server's, not the browser's.
   *
   * Kept separate from `beats` on purpose. `beats` is the record of what happened and
   * must accept everything, because the feed and the counters are evidence. This is a
   * playlist, and a playlist may drop a duplicate.
   */
  const [queue, setQueue] = useState<readonly LiveBeat[]>([]);
  const [spanCount, setSpanCount] = useState(0);
  const [modelCallCount, setModelCallCount] = useState(0);

  const nextKeyRef = useRef(0);

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
      const queued = beat;

      setBeats((current) => [...current, queued].slice(-LIVE_BEAT_LIMIT));
      setQueue((current) => {
        /*
         * Collapse a route that is already waiting to be drawn.
         *
         * One turn emits eight `preference_update` frames and three Converse spans, and
         * each set walks an identical path. Queueing all eleven would make the diagram
         * replay the same journey eight times over while the conversation moved on. One
         * animation per distinct route says the same thing in a tenth of the time, and
         * the feed still lists all eleven rows.
         */
        if (current.some((pending) => pending.from === queued.from && pending.to === queued.to)) {
          return current;
        }
        if (current.length >= LIVE_QUEUE_LIMIT) return current;
        return [...current, queued];
      });
    },
    [engine],
  );

  useEffect(() => {
    if (!enabled) return;
    return subscribeToWsEvents(record);
  }, [enabled, record]);

  /*
   * Switching engines empties the playlist.
   *
   * A queued beat names concrete nodes, and half of them do not exist on the other
   * band — an `ac-runtime` beat animated while engine A is shown would light a card the
   * viewer has just been told is not in play. `beats` survives, because the feed is a
   * log of what happened and that did happen.
   */
  useEffect(() => {
    setQueue([]);
  }, [engine]);

  const clear = useCallback(() => {
    setBeats([]);
    setQueue([]);
    setSpanCount(0);
    setModelCallCount(0);
  }, []);

  const currentBeat = queue[0];

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
  const legs = currentBeat
    ? flowLegs(currentBeat.from, currentBeat.to, engine, currentBeat.returns)
    : [];
  const legIndex = useFlowTraversal({
    legCount: Math.max(1, legs.length),
    resetKey: currentBeat?.key ?? null,
    enabled: currentBeat !== undefined,
  });
  const leg = legs[Math.min(legIndex, legs.length - 1)];

  /*
   * Retire the head once it has finished walking, and let the next beat start.
   *
   * The hold is the beat's own length plus a rest, so a thirteen-leg engine B route
   * gets the 3120 ms it needs and a one-leg browser beat does not sit there for three
   * seconds. Under reduced motion the traversal has already jumped to the destination,
   * so there is nothing to walk and only the rest applies.
   */
  const legCount = Math.max(1, legs.length);
  const beatKey = currentBeat?.key;
  useEffect(() => {
    if (beatKey === undefined) return;
    const walk = prefersReducedMotion() ? 0 : legCount * FLOW_LEG_MS;
    const timer = setTimeout(() => setQueue((current) => current.slice(1)), walk + LIVE_BEAT_REST_MS);
    return () => clearTimeout(timer);
  }, [beatKey, legCount]);

  const litNode = leg?.kind === 'node' ? leg.node : undefined;
  const activeHops = leg?.kind === 'hop' ? [leg.hop] : [];

  // The trail: the destination of every beat that has already been animated, plus the
  // part of this beat's route the traffic has already crossed. Not a highlight — the
  // diagram renders these border-only, so the one lit box stays the only thing that
  // draws the eye. Beats still queued are excluded: their destination has not been
  // visited yet, and marking it as history would give away where the traffic is going.
  const pending = new Set(queue.map((beat) => beat.key));
  const trail = beats.filter((beat) => !pending.has(beat.key)).map((beat) => beat.to);
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
