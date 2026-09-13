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
import { FLOW_ACTION, type FlowBeat } from '../utils/aws-demo-flows';
import type { AwsCategory } from '../utils/aws-diagram-layout';
import {
  CONVERSE_DETAIL,
  CONVERSE_TOOL_USE_SUFFIX,
  SPAN_DETAIL_PREFIX,
} from '../../shared/interfaces/ws-events';
import type { AgentActivityPayload, AwsSpan } from '../../shared/interfaces/ws-events';
import {
  glowTargetsForEvent,
  glowTargetsForSpan,
  learnToolService,
  type GlowTarget,
  type ToolServiceLookup,
} from '../utils/glow-target';

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
  /**
   * What this beat put on screen, so pointing at it can glow the thing itself.
   *
   * Ids, never values — see `glow-target.ts` for why that keeps the projector
   * rule intact. Absent on the beats that produced no element of their own
   * (`typing_stop`, a Bedrock span), which is why it is optional rather than an
   * empty array everywhere.
   */
  targets?: readonly GlowTarget[];
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
 * A WebSocket event is a *frame*, and these captions say so. `typing_start` used to
 * caption as "writes a reply", which put a group on the feed, above the Bedrock call,
 * claiming a reply was being composed when all that had happened was three animated
 * dots switching on — the server sends that frame before it calls the model at all.
 * The Bedrock call that really does write the reply is a span, and gets its caption
 * from {@link spanAction}.
 *
 * Unknown types fall through to a generic group instead of being dropped: a renamed
 * server event should degrade to a plain row, not vanish.
 */
const EVENT_STORY: Readonly<Record<string, { actor: string; action: string }>> = {
  session_init: { actor: 'User', action: FLOW_ACTION.opensTheApp },
  connection_status: { actor: 'User', action: FLOW_ACTION.opensTheApp },
  send_message: { actor: 'User', action: FLOW_ACTION.sendsAMessage },
  // The typing indicator, both halves. Separate captions rather than one shared
  // between them: they arrive at opposite ends of the turn, so a shared caption
  // would put two identical-looking groups on the feed with the whole reply in
  // between and nothing to say which was which.
  typing_start: { actor: 'Valentin', action: FLOW_ACTION.startsTypingDots },
  typing_stop: { actor: 'Valentin', action: FLOW_ACTION.stopsTypingDots },
  agent_message: { actor: 'Valentin', action: FLOW_ACTION.deliversTheReply },
  // `agent_activity` is absent, and dropped before a story is looked up — see the
  // note in `record`. It is not in `EVENT_ENDPOINTS` either, so it has no row.
  preference_update: { actor: 'Valentin', action: FLOW_ACTION.showsTheNewPreference },
  // No `ping`/`pong`: they are dropped before a story is looked up. See the note in
  // `EVENT_ENDPOINTS`.
  error: { actor: 'System', action: FLOW_ACTION.reportsAProblem },
  // Two halves of one beat, and the actor changes hands between them — which is
  // the sentence the drawer exists to show a room. Valentin only ever offers.
  action_proposal: { actor: 'Valentin', action: FLOW_ACTION.offersSomethingToConfirm },
  confirm_action: { actor: 'User', action: FLOW_ACTION.confirmsIt },
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
  // The two Gateway targets are our own Lambdas, so they take the compute colour
  // rather than the AgentCore group's — the table and the providers they reach are
  // the shared nodes, and those keep their own.
  'ac-lambda-profile': 'compute',
  'ac-lambda-tools': 'compute',
};

/** DynamoDB operations that only read. Everything else on the table writes. */
const READ_OPERATIONS: readonly string[] = ['Query', 'GetItem', 'BatchGetItem', 'Scan'];

/**
 * Which model call a Converse span was, and what the model did with it.
 *
 * Read off `detail`, because `operation` is `Converse` for every one of them — the
 * client counts model calls by that name, so the bridge deliberately puts the API
 * name there and the purpose in `detail`. Without this the feed captioned both of a
 * turn's Converse calls "thinks", so the two rows a presenter most needs to tell
 * apart — the reply, and the separate extraction pass that runs after it — were the
 * two rows that looked identical.
 *
 * The stop reason is read *within* a purpose, never instead of one, and both halves
 * of that matter:
 *
 *  - Tools are on for nearly every turn, so almost every reply is composed by a
 *    `chat-tools` call. Captioning by purpose alone said "picks a tool" on every
 *    turn, including the ones that called no tool.
 *  - Extraction is a *forced* tool call, so it stops on `tool_use` every single
 *    time, by construction. Captioning by stop reason alone said "picks a tool" for
 *    the extraction pass too — which is how the first attempt at this traded one
 *    wrong caption for another.
 */
function converseAction(detail: string): string {
  const askedForATool = detail.endsWith(CONVERSE_TOOL_USE_SUFFIX);
  const purpose = askedForATool ? detail.slice(0, -CONVERSE_TOOL_USE_SUFFIX.length) : detail;

  switch (purpose) {
    // Both compose the answer, and differ only in whether tools were on the table —
    // a fact about the request, not about what the model did with it. What separates
    // them here is the outcome.
    case CONVERSE_DETAIL.reply:
    case CONVERSE_DETAIL.tools:
      return askedForATool ? FLOW_ACTION.picksATool : FLOW_ACTION.writesTheReply;
    // The stop reason is deliberately ignored: this call is handed one tool and told
    // it must use it, so `tool_use` here is the schema working, not a decision.
    case CONVERSE_DETAIL.extractPreferences:
      return FLOW_ACTION.extractsAPreference;
    default:
      // An unrecognised purpose is still a model call, and says only that. See the
      // note on `FLOW_ACTION.callsTheModel`.
      return FLOW_ACTION.callsTheModel;
  }
}

/**
 * Which of the table's writes this was — the profile, or the transcript.
 *
 * The two are indistinguishable by operation, service, table and duration: both are
 * a `PutItem` on `ValentinTable-dev` taking about twenty milliseconds. The sort-key
 * prefix in `detail` is the only thing that separates them, which is why
 * {@link SPAN_DETAIL_PREFIX} is a shared constant and not a literal on each side.
 */
function tableAction(operation: string, detail: string): string {
  if (READ_OPERATIONS.includes(operation)) return FLOW_ACTION.readsWhatItKnows;
  if (detail.startsWith(SPAN_DETAIL_PREFIX.preference)) return FLOW_ACTION.savesAPreference;
  if (detail.startsWith(SPAN_DETAIL_PREFIX.message)) return FLOW_ACTION.savesTheConversation;
  // A write this build does not recognise. `isWorking` rather than guessing at a
  // preference: the profile panel is what a room watches during this beat, and
  // captioning a transcript write as a preference would explain the wrong thing.
  return FLOW_ACTION.isWorking;
}

/**
 * What Valentin was doing, for one span.
 *
 * A function rather than the `node → caption` table this replaces, because the node
 * is not enough to name the beat: `dynamodb` was captioned "learns something new"
 * whichever of its writes had happened, and `bedrock` fell through to "thinks" for
 * both of a turn's model calls. The operation and the detail are what say which call
 * it was, so they are what this reads.
 *
 * "asks the outside world" rather than "books a table": a span is a call, and at
 * this point in the flow nothing has been booked — the Confirm press is a separate
 * beat. Naming it otherwise on a projector would claim an authority the agent does
 * not have.
 */
function spanAction(node: AwsNodeId, span: AwsSpan): string {
  const detail = span.detail ?? '';

  switch (node) {
    case 'bedrock':
      return converseAction(detail);
    case 'dynamodb':
      return tableAction(span.operation, detail);
    // Engine B's profile tools are a Lambda in front of the same table, so its
    // calls read as the same beats — a `save_preference` there and a `PutItem` here
    // are one story told through two routes.
    case 'ac-lambda-profile':
      return tableAction(span.operation, detail);
    // The model call, one hop further out: the Runtime is where engine B's model
    // runs, so this is the beat engine A spends on Converse.
    case 'ac-runtime':
      return FLOW_ACTION.writesTheReply;
    // AgentCore Memory does its own extraction, so a `CreateEvent` is the beat
    // engine A spends on `extract-preferences` *plus* the write. The adapter reports
    // which call it was and the two are different beats, so neither is flattened.
    case 'ac-memory':
      return span.operation === 'ListMemoryRecords'
        ? FLOW_ACTION.recallsWhatItKnows
        : FLOW_ACTION.storesAMemory;
    case 'ac-gateway':
      return FLOW_ACTION.callsAGatewayTool;
    // Same words for both, because it is the same beat: a call out, with nothing
    // booked yet. The route differs, the story does not.
    case 'integrations':
    case 'ac-lambda-tools':
      return FLOW_ACTION.asksTheOutsideWorld;
    default:
      return FLOW_ACTION.isWorking;
  }
}

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
    targets: glowTargetsForEvent(observed),
  };
}

function beatFromSpan(
  span: AwsSpan,
  key: string,
  engine: ArchitectureEngine,
  toolServices: ToolServiceLookup,
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
    action: spanAction(node, span),
    traceId: span.traceId,
    targets: glowTargetsForSpan(span, node, toolServices),
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
    case 'ac-lambda-profile':
      return 'Profile tools';
    case 'ac-lambda-tools':
      return 'Integration tools';
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
  /**
   * Tool name → the integration it belongs to, accumulated over the session.
   *
   * A ref rather than state: nothing renders from it, and re-rendering the drawer
   * on every tool frame would be forty renders a turn for a lookup table.
   */
  const toolServicesRef = useRef(new Map<string, string>());

  const record = useCallback(
    (observed: ObservedWsEvent) => {
      /*
       * Read for its service name on the way past, then left to fall through and
       * be dropped as it always has been.
       *
       * `agent_activity` is absent from `EVENT_ENDPOINTS`, so it has never
       * produced a beat and deliberately still does not — several arrive per turn
       * and giving them rows would push every other action off the feed. But it
       * is the only frame that says which integration a tool belongs to, and the
       * span that *does* become a row has that flattened away. See
       * `learnToolService`.
       */
      if (observed.event.type === 'agent_activity') {
        learnToolService(toolServicesRef.current, observed.event.payload);
      }

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
          beat = beatFromSpan(span, key, engine, toolServicesRef.current);
        }
      } else {
        beat = beatFromEvent(observed, key, engine);
      }

      if (!beat) return;

      // Stamped on arrival rather than taken from the event: the WS protocol carries
      // no client-comparable clock, and the moment the browser saw it is what the
      // feed's timestamp claims to be.
      const stamped: LiveBeat = { ...beat, at: Date.now() };

      setBeats((current) => [...current, stamped].slice(-LIVE_BEAT_LIMIT));
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
  const legs = currentBeat ? flowLegs(currentBeat.from, currentBeat.to, engine) : [];
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
