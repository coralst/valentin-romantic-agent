import type { ArchitectureEngine, AwsNodeId } from './aws-architecture';
import { flowLegs, routeBetween } from './aws-architecture';
import type { AwsCategory } from './aws-diagram-layout';

/**
 * Scripted walkthroughs for the architecture drawer.
 *
 * These are NOT a mock of live mode — they are a presentation instrument. A live
 * system cannot be paused mid-hop to talk over it, and on a conference network it
 * may not fire at all. Live mode is the proof; demo mode is the explanation. The
 * drawer has to open into a legible state with no socket, because the worst
 * possible failure is a blank diagram in front of a room.
 *
 * What keeps them honest: a step names only its endpoints, and the path between
 * them is computed by `routeBetween()` against the real topology. A demo flow
 * therefore *cannot* draw a link the deployed system doesn't have — the earlier
 * hand-authored version drew DynamoDB talking straight to CloudFront, which is
 * precisely the class of error this removes.
 *
 * Durations are authored and representative, not measured, and the UI says so.
 */

/** One beat of a flow: work arriving somewhere, and how long it took. */
export interface DemoStep {
  /** Where the traffic starts. Defaults to the previous step's `to`. */
  from?: AwsNodeId;
  /** Where the work lands, and the node that lights up. */
  to: AwsNodeId;
  /** Service name as it reads in the feed — short enough for a 70px column. */
  service: string;
  /** The operation: `Converse`, `PutItem`, `send_message`. */
  operation: string;
  /**
   * One line of context. Categories and sort keys only, never a preference's
   * value — this is projected, and the values are a real person's.
   */
  detail: string;
  /** Feed swatch colour, by AWS service category. */
  category: AwsCategory;
  /** Authored duration. Absent for beats that are a delivery, not a call. */
  durationMs?: number;
  /** True for a successful write — renders the duration pill green. */
  ok?: boolean;
  /** Who is acting, e.g. `User` / `Valentin`. Groups the feed. */
  actor: string;
  /** What they are doing, e.g. `learns something new`. Captions the group. */
  action: string;
  /** See {@link FlowBeat.returns}. */
  returns?: boolean;
}

/** A step with `from` filled in, which is what the view actually consumes. */
export interface ResolvedDemoStep extends DemoStep, FlowBeat {
  from: AwsNodeId;
}

export interface DemoFlow {
  id: DemoFlowId;
  /** Shown in the flow picker. */
  title: string;
  /** One line on what this flow is for. */
  synopsis: string;
  steps: readonly ResolvedDemoStep[];
}

export type DemoFlowId =
  | 'page-load'
  | 'chat-reply'
  | 'learns-something'
  | 'proposes-a-table'
  | 'agentcore-learns-something';

/**
 * Fill in each step's origin: a flow is a continuous journey, so a step starts
 * where the traffic is currently resting.
 *
 * "Where it is resting" is not the same as the previous step's `to`, which is what
 * this used to use and why the scripts were full of explicit `from` overrides. A
 * returning step — a call — brings the traffic back to its origin, so three sibling
 * calls out of the same task now chain naturally instead of each needing
 * `from: 'fargate'` written on it. Every one of those overrides was a jump-cut on the
 * diagram, and one of them is the "why doesn't it start from the browser?" the
 * inspector was reported for.
 *
 * No flow authors `from` at all any more, and the test suite pins that: an override
 * would be a claim that the traffic teleported.
 */
function resolve(steps: readonly DemoStep[]): readonly ResolvedDemoStep[] {
  let resting: AwsNodeId | undefined;
  return steps.map((step) => {
    const resolved: ResolvedDemoStep = { ...step, from: step.from ?? resting ?? step.to };
    resting = restingNode(resolved);
    return resolved;
  });
}

const PAGE_LOAD: readonly DemoStep[] = [
  {
    to: 'browser',
    service: 'Browser',
    operation: 'GET /',
    detail: 'cold load',
    category: 'network',
    actor: 'User',
    action: 'opens the app',
  },
  {
    to: 'cloudfront',
    service: 'CloudFront',
    operation: 'viewer request',
    detail: 'WAF · 2000 req/IP',
    category: 'network',
    durationMs: 3,
    actor: 'User',
    action: 'opens the app',
  },
  {
    to: 's3',
    service: 'S3',
    operation: 'GetObject',
    detail: 'default behavior * · OAC',
    category: 'storage',
    durationMs: 11,
    ok: true,
    actor: 'User',
    action: 'opens the app',
  },
  {
    to: 'browser',
    service: 'Browser',
    operation: 'index.html',
    detail: 'React 19 SPA boots',
    category: 'network',
    actor: 'User',
    action: 'opens the app',
  },
];

const CHAT_REPLY: readonly DemoStep[] = [
  {
    to: 'browser',
    service: 'Browser',
    operation: 'send_message',
    detail: 'ws frame',
    category: 'network',
    actor: 'User',
    action: 'sends a message in chat',
  },
  {
    to: 'cloudfront',
    service: 'CloudFront',
    operation: 'ws-frame',
    detail: '/ws · CACHING_DISABLED',
    category: 'network',
    durationMs: 2,
    actor: 'User',
    action: 'sends a message in chat',
  },
  {
    to: 'alb',
    service: 'ALB',
    operation: 'forward',
    detail: 'sticky cookie · 1 h',
    category: 'network',
    durationMs: 1,
    actor: 'User',
    action: 'sends a message in chat',
  },
  {
    to: 'fargate',
    service: 'Fargate',
    operation: 'typing_start',
    detail: 'agent-orchestrator',
    category: 'compute',
    durationMs: 1,
    actor: 'Valentin',
    action: 'writes a reply',
  },
  {
    to: 'bedrock',
    service: 'Bedrock',
    operation: 'Converse',
    detail: 'chat-reply',
    category: 'ml',
    durationMs: 412,
    // A call, so it is drawn out and back. The 412 ms is time Fargate spent waiting
    // for an answer that then arrived — drawing it one-way said the request left and
    // stayed there, and left the traffic parked in Bedrock with nowhere honest to go.
    returns: true,
    actor: 'Valentin',
    action: 'writes a reply',
  },
  {
    // No `from`. The Converse call came home, so the reply leaves from Fargate, which
    // is where the traffic is already resting.
    to: 'browser',
    service: 'Browser',
    operation: 'agent_message',
    detail: 'reply streamed',
    category: 'network',
    actor: 'Valentin',
    action: 'writes a reply',
  },
];

/**
 * The flow the talk is built around: a reply, and the preference the reply taught us.
 *
 * It shares the first five steps with `CHAT_REPLY` — everything up to and including
 * the reply's Converse call — and then adds the three the extractor is responsible
 * for. All three are sibling calls made by the same task, and all three return, so
 * each one starts where the last one finished without a single authored `from`.
 *
 * The last two beats are both at the browser: the reply travels home, and the
 * preference lands there too. The server pushes `preference_update` and
 * `agent_message` on the same socket a moment apart, so the flow draws the journey
 * once and then lands the preference where it is rendered — which is also the note
 * the flow should end on, since the preference is the whole point of it.
 */
const LEARNS_SOMETHING: readonly DemoStep[] = [
  ...CHAT_REPLY.slice(0, 5),
  {
    to: 'bedrock',
    service: 'Bedrock',
    operation: 'Converse',
    detail: 'extract-preferences · forced tool use',
    category: 'ml',
    durationMs: 380,
    returns: true,
    actor: 'Valentin',
    action: 'learns something new',
  },
  {
    to: 'dynamodb',
    service: 'DynamoDB',
    operation: 'PutItem',
    detail: 'PREF#music',
    category: 'database',
    durationMs: 18,
    ok: true,
    returns: true,
    actor: 'Valentin',
    action: 'learns something new',
  },
  {
    to: 'browser',
    service: 'Browser',
    operation: 'agent_message',
    detail: 'reply streamed',
    category: 'network',
    actor: 'Valentin',
    action: 'writes a reply',
  },
  {
    // Already home: this is the toast being rendered, not a second journey down the
    // same wire. `routeBetween` reports browser → browser as no hop at all, so it
    // lights the one box and moves nothing — which is exactly what happens.
    to: 'browser',
    service: 'Browser',
    operation: 'preference_update',
    detail: 'new · music',
    category: 'network',
    actor: 'Valentin',
    action: 'learns something new',
  },
];

/**
 * The tool loop, and the beat the A/B demo actually turns on.
 *
 * Two things are deliberate about the ordering. Hebcal runs *before* Ontopo,
 * because in Israel a Saturday-night dinner is a Hebrew-calendar question first
 * and a restaurant question second — asking Ontopo first is the mistake Version A
 * would make without it. And the flow does not end at the proposal: the last two
 * steps are the Confirm press travelling back out to Ontopo, which is the only
 * moment anything is booked. A flow that stopped at the proposal would let a room
 * assume the agent booked it.
 *
 * The three middle steps are sibling calls made by the same task, not a chain, and
 * every one of them returns. That is what makes the chain work without an authored
 * `from`: Hebcal answers and the traffic is back in Fargate, so Ontopo's call starts
 * from Fargate too. The previous version wrote `from: 'fargate'` on each of them,
 * which drew the traffic jumping back from Ontopo to Fargate with nothing in between.
 */
const PROPOSES_A_TABLE: readonly DemoStep[] = [
  ...CHAT_REPLY.slice(0, 4),
  {
    to: 'bedrock',
    service: 'Bedrock',
    operation: 'Converse',
    detail: 'chat-reply · tool_use',
    category: 'ml',
    durationMs: 486,
    returns: true,
    actor: 'Valentin',
    action: 'picks a tool',
  },
  {
    to: 'integrations',
    service: 'External APIs',
    operation: 'check_shabbat',
    detail: 'Hebrew calendar · computed locally',
    category: 'external',
    durationMs: 4,
    ok: true,
    returns: true,
    actor: 'Valentin',
    action: 'asks the outside world',
  },
  {
    to: 'integrations',
    service: 'External APIs',
    operation: 'search_restaurants',
    detail: 'Ontopo · Tel Aviv',
    category: 'external',
    durationMs: 612,
    ok: true,
    returns: true,
    actor: 'Valentin',
    action: 'asks the outside world',
  },
  {
    to: 'browser',
    service: 'Browser',
    operation: 'action_proposal',
    detail: 'a table to confirm',
    category: 'external',
    actor: 'Valentin',
    action: 'offers something to confirm',
  },
  {
    // The longest journey in any flow, and deliberately: the Confirm press crosses the
    // edge, the load balancer and the task before it reaches Ontopo, and then the
    // checkout link comes all the way back. This is the only moment anything is
    // booked, so it is the one beat worth watching travel the whole way.
    to: 'integrations',
    service: 'External APIs',
    operation: 'confirm_action',
    detail: 'Ontopo · checkout link',
    category: 'external',
    durationMs: 388,
    ok: true,
    returns: true,
    actor: 'User',
    action: 'confirms it',
  },
] as const;

/**
 * The same story on engine B.
 *
 * Step-for-step the same beats as `LEARNS_SOMETHING` — that is the point of it
 * existing. A demo that walked engine B through a *different* narrative would let
 * the room read a difference in the script as a difference in the platform.
 *
 * The durations are authored and deliberately larger than engine A's on the two
 * hops that genuinely add work: `InvokeAgentRuntime` is a second network call
 * wrapping the model call, and a tool goes out over MCP to a Lambda instead of
 * calling the SDK in-process. Live mode measures the real numbers.
 */
const AGENTCORE_LEARNS_SOMETHING: readonly DemoStep[] = [
  {
    to: 'browser',
    service: 'Browser',
    operation: 'send_message',
    detail: 'ws frame · /ws/agentcore',
    category: 'network',
    actor: 'User',
    action: 'sends a message in chat',
  },
  {
    to: 'cloudfront',
    service: 'CloudFront',
    operation: 'ws-frame',
    detail: '/ws/agentcore · CACHING_DISABLED',
    category: 'network',
    durationMs: 2,
    actor: 'User',
    action: 'sends a message in chat',
  },
  {
    to: 'alb',
    service: 'ALB',
    operation: 'forward',
    detail: 'second target group',
    category: 'network',
    durationMs: 1,
    actor: 'User',
    action: 'sends a message in chat',
  },
  {
    to: 'ac-proxy',
    service: 'Proxy',
    operation: 'typing_start',
    detail: 'AGENT_ENGINE=agentcore',
    category: 'compute',
    durationMs: 1,
    actor: 'Valentin',
    action: 'writes a reply',
  },
  {
    /*
     * The one call in either flow drawn *one way*, and it is not an oversight.
     *
     * `InvokeAgentRuntime` wraps everything below it: the Gateway tool call, both
     * table hits and the Memory write all happen inside this call, while the proxy is
     * still waiting. So the traffic arrives in the Runtime and stays there, which is
     * what lets the next four steps start from the Runtime. Its 486 ms is the wrapper,
     * not a fifth sibling. The return is step 10, the journey home.
     */
    to: 'ac-runtime',
    service: 'Runtime',
    operation: 'InvokeAgentRuntime',
    detail: 'Strands agent · session id preserved',
    category: 'ml',
    durationMs: 486,
    actor: 'Valentin',
    action: 'writes a reply',
  },
  {
    to: 'ac-gateway',
    service: 'Gateway',
    operation: 'get_partner_profile',
    detail: 'MCP tool call',
    category: 'ml',
    durationMs: 94,
    returns: true,
    actor: 'Valentin',
    action: 'writes a reply',
  },
  {
    // The same `dynamodb` card engine A writes, reached the other way: on this engine
    // its parent is the Gateway, so the route computes Runtime → Gateway → table
    // without the flow having to say so.
    to: 'dynamodb',
    service: 'DynamoDB',
    operation: 'Query',
    detail: 'via valentin-profile-tools-dev',
    category: 'database',
    durationMs: 21,
    ok: true,
    returns: true,
    actor: 'Valentin',
    action: 'writes a reply',
  },
  {
    to: 'ac-memory',
    service: 'Memory',
    operation: 'CreateEvent',
    detail: 'managed preference extraction',
    category: 'ml',
    durationMs: 37,
    ok: true,
    returns: true,
    actor: 'Valentin',
    action: 'learns something new',
  },
  {
    to: 'dynamodb',
    service: 'DynamoDB',
    operation: 'PutItem',
    detail: 'PREF#music',
    category: 'database',
    durationMs: 19,
    ok: true,
    returns: true,
    actor: 'Valentin',
    action: 'learns something new',
  },
  {
    // The Runtime's answer, all the way home: Runtime → Proxy → ALB → CloudFront →
    // browser. This leg is `InvokeAgentRuntime` returning as much as it is the WS
    // frame, which is why the wrapper above is drawn one way.
    to: 'browser',
    service: 'Browser',
    operation: 'agent_message',
    detail: 'reply streamed',
    category: 'network',
    actor: 'Valentin',
    action: 'writes a reply',
  },
  {
    to: 'browser',
    service: 'Browser',
    operation: 'preference_update',
    detail: 'new · music',
    category: 'network',
    actor: 'Valentin',
    action: 'learns something new',
  },
];

export const DEMO_FLOWS: readonly DemoFlow[] = [
  {
    id: 'page-load',
    title: 'Page load',
    // The only flow that lights S3, which answers "why is that node dim?"
    // before anyone in the room has to ask it.
    synopsis: 'CloudFront serves the SPA from S3 — the only time S3 is touched.',
    steps: resolve(PAGE_LOAD),
  },
  {
    id: 'chat-reply',
    title: 'Chat reply',
    synopsis: 'A message crosses the edge to Fargate, and Bedrock writes the reply.',
    steps: resolve(CHAT_REPLY),
  },
  {
    id: 'learns-something',
    title: 'Valentin learns something',
    synopsis: 'The reply, then a second Converse call that extracts and stores a preference.',
    steps: resolve(LEARNS_SOMETHING),
  },
  {
    id: 'proposes-a-table',
    title: 'Valentin proposes a table',
    synopsis:
      'The tool loop: Hebcal rules out Friday, Ontopo finds a table, and nothing is booked until Confirm.',
    steps: resolve(PROPOSES_A_TABLE),
  },
  {
    id: 'agentcore-learns-something',
    title: 'Valentin learns something · AgentCore',
    synopsis: 'The same beats through AgentCore Runtime, a Gateway tool call and Memory.',
    steps: resolve(AGENTCORE_LEARNS_SOMETHING),
  },
] as const;

/** Default flow: the one the whole talk is built around. */
export const DEFAULT_DEMO_FLOW_ID: DemoFlowId = 'learns-something';

/**
 * The flow to open on for a given engine.
 *
 * Needed because a flow's steps name concrete nodes: playing engine A's script
 * while the engine-A half of the diagram is shaded would animate greyed-out cards,
 * which reads as a rendering bug rather than as a comparison.
 */
export function defaultDemoFlowIdFor(engine: ArchitectureEngine): DemoFlowId {
  return engine === 'agentcore' ? 'agentcore-learns-something' : DEFAULT_DEMO_FLOW_ID;
}

export function demoFlow(id: DemoFlowId): DemoFlow {
  const found = DEMO_FLOWS.find((flow) => flow.id === id);
  // The id is a closed union, so this is unreachable through the type system;
  // falling back beats rendering an empty drawer if a stale persisted id shows up.
  return found ?? DEMO_FLOWS[DEMO_FLOWS.length - 1];
}

/**
 * Cumulative diagram state for `steps[0..index]`, at one beat within that step.
 *
 * Rebuilt from scratch every time rather than mutated forward, so stepping
 * backwards is exact instead of an attempted undo — an undo-based version
 * drifted after the first backward step, which is precisely when a presenter
 * reaches for it ("wait, go back").
 *
 * At most one node is lit and at most one segment is animated, always. That is
 * the whole point of the leg index: a step from the browser to Bedrock crosses
 * five resources, and lighting all five the instant the step begins says "these
 * eight boxes are involved" when what a presenter needs it to say is "the request
 * is *here* now".
 */
export interface FlowFrame {
  /** The node the traffic is sitting in, or undefined while it is in flight. */
  litNode?: AwsNodeId;
  /** True when the traffic is travelling back toward the browser. */
  litIsResponse: boolean;
  /** Nodes already visited — a quiet trail, not a highlight. */
  doneNodes: readonly AwsNodeId[];
  /** The single segment currently in flight, or empty while the traffic is parked. */
  activeHops: ReturnType<typeof routeBetween>;
  /** Duration pills to show, keyed by node. */
  durations: Readonly<Partial<Record<AwsNodeId, { label: string; ok: boolean; current: boolean }>>>;
}

/**
 * The least a thing needs to be animated on the diagram and listed in the feed.
 *
 * Both a scripted step and a recorded live beat satisfy it, which is what lets one
 * renderer, one playback and one frame builder serve demo mode, live mode and the
 * replay of a real conversation. Any divergence here would immediately become two
 * animations that drift apart.
 */
export interface FlowBeat {
  from: AwsNodeId;
  to: AwsNodeId;
  service: string;
  operation: string;
  detail: string;
  category: AwsCategory;
  durationMs?: number;
  ok?: boolean;
  actor: string;
  action: string;
  /**
   * X-Ray trace id, for a beat that came from a real call that reported one.
   *
   * Always absent on a scripted step, and that is deliberate rather than a gap: a
   * made-up trace id would be the one value in the demo a viewer could paste into
   * the console and find nothing behind.
   */
  traceId?: string;
  /**
   * True when this beat is a *call* — it goes out and the answer comes back — so the
   * animation should be drawn out and back.
   *
   * This is the difference between a request and a delivery, and the diagram used to
   * draw both the same way: one-way. That made a measured 412 ms Converse look like
   * traffic that left Fargate and stayed in Bedrock, and it forced the flow scripts
   * into jump-cuts, because the next call from the same task had to start at Fargate
   * while the traffic was parked in Bedrock. Marking the call as returning is what
   * lets the traffic come home, so the next sibling call begins where the last one
   * ended and no step has to teleport.
   *
   * Left false for a delivery — a WS frame pushed to the browser is genuinely one
   * way, and drawing a return leg on it would invent a request the browser never
   * made.
   */
  returns?: boolean;
}

/**
 * Where the traffic is resting once a beat has finished playing.
 *
 * A one-way beat leaves it at the destination. A returning beat brings it home, so
 * it rests where it *started* — which is the whole reason `returns` exists, and the
 * reason the flow scripts no longer need a single explicit `from`.
 */
export function restingNode(beat: FlowBeat): AwsNodeId {
  return beat.returns ? beat.from : beat.to;
}

/** How many beats a step is animated over: box, arrow, box, arrow, box. */
export function stepLegCount(
  beat: FlowBeat | undefined,
  engine: ArchitectureEngine = 'valentin',
): number {
  return beat ? flowLegs(beat.from, beat.to, engine, beat.returns).length : 1;
}

export function frameForStep(
  steps: readonly FlowBeat[],
  index: number,
  /**
   * Which beat *within* the current step to render. Defaults to the last one —
   * the settled, arrived state — so a caller that only cares about "where did
   * this step end up" needn't know legs exist.
   */
  legIndex?: number,
  /**
   * Which engine's topology to route against.
   *
   * Required rather than inferred because `dynamodb` and `integrations` are one node
   * each, shared by both engines, and the route in differs: engine A drops onto the
   * table off Fargate, engine B reaches it through the Gateway. Routing an engine B
   * step against engine A's tree would draw the AgentCore Runtime talking to Fargate.
   */
  engine: ArchitectureEngine = 'valentin',
): FlowFrame {
  // Clamp rather than trust the caller. An index past the end would make
  // `isCurrent` false for every step, so nothing would light and the whole flow
  // would render as history — a diagram with no current step, which is the one
  // failure mode that cannot be allowed in front of a room. `useFlowPlayback`
  // clamps too; this is cheap and the consequence of missing it is severe.
  const current = Math.min(index, steps.length - 1);

  const done: AwsNodeId[] = [];
  const durations: Partial<Record<AwsNodeId, { label: string; ok: boolean; current: boolean }>> =
    {};
  let litNode: AwsNodeId | undefined;
  let litIsResponse = false;
  let activeHops: ReturnType<typeof routeBetween> = [];
  // Whether the current step's traffic has reached the resource it was calling.
  // Tracked as a leg index rather than by comparing `litNode` to `step.to`, because a
  // returning step keeps walking *past* its destination on the way home — a
  // `litNode === step.to` test would show the duration pill for one beat and then take
  // it away again, which reads as a flicker rather than as a measurement.
  let reachedTarget = true;
  /*
   * Which way the traffic is currently travelling, carried across steps.
   *
   * Needed only for a self-beat, whose direction genuinely cannot be read off a
   * route: it has no hop, so there is no `downstream` flag to colour it by. And the
   * node alone does not settle it either — `browser → browser` is the user's own
   * send in two flows and the preference toast in a third. So a self-beat continues
   * whichever way the traffic was already going, which is both correct in every
   * case and the only reading that does not flip the browser card back to
   * request-claret one beat after the reply landed on it in teal.
   *
   * A flow opens with a request, hence `false`.
   */
  let travellingHome = false;

  for (let k = 0; k <= current; k += 1) {
    const step = steps[k];
    const isCurrent = k === current;
    const legs = flowLegs(step.from, step.to, engine, step.returns);
    const isSelfBeat = step.from === step.to;

    if (isCurrent) {
      const at = Math.max(0, Math.min(legIndex ?? legs.length - 1, legs.length - 1));
      const leg = legs[at];

      if (leg.kind === 'node') {
        litNode = leg.node;
        activeHops = [];
      } else {
        // In flight: the arrow carries the highlight and no box holds it, which is
        // what makes the movement between boxes readable rather than implied.
        activeHops = [leg.hop];
      }
      // Colour by travel direction, not by which node it is: the same node is
      // claret on the way out and teal on the way home.
      litIsResponse = isSelfBeat ? travellingHome : !leg.downstream;

      // The trail behind the traffic, within this step as well as before it — so
      // the path fills in as it is walked instead of appearing all at once.
      for (const earlier of legs.slice(0, at)) {
        if (earlier.kind === 'node' && !done.includes(earlier.node)) done.push(earlier.node);
      }

      // The outbound half's last leg is the traffic sitting in the callee. On a one-way
      // step that is also the step's last leg, so this is just "have we arrived".
      reachedTarget = at >= flowLegs(step.from, step.to, engine).length - 1;
    } else if (!done.includes(step.to)) {
      done.push(step.to);
    }

    // The current step's pill waits until the traffic has actually arrived: the
    // number is what the work cost, and announcing it before the box lights would
    // put a measurement on a node nothing has reached yet.
    const arrived = !isCurrent || reachedTarget;
    if (step.durationMs !== undefined && arrived) {
      durations[step.to] = {
        label: `${step.durationMs} ms`,
        ok: step.ok === true,
        current: isCurrent,
      };
    }

    // Hand the direction on. A step's parting direction is that of its last leg —
    // for a returning call, the climb home rather than the descent out. A self-beat
    // moves nothing, so it passes on what it was given.
    if (!isSelfBeat) travellingHome = !legs[legs.length - 1].downstream;
  }

  return {
    litNode,
    litIsResponse,
    doneNodes: done.filter((id) => id !== litNode),
    activeHops,
    durations,
  };
}

/**
 * Dwell for a step: a 412 ms Converse call earns more time on screen than a 1 ms hop.
 *
 * Floored at the time its legs need to be walked, plus a moment to rest on the
 * destination. Without that floor, autoplay would advance to the next step
 * mid-traversal on any step that crosses more than a couple of resources, and the
 * animation would visibly jump instead of arriving.
 */
export function demoStepDwellMs(
  step: FlowBeat | undefined,
  engine: ArchitectureEngine = 'valentin',
): number {
  const authored = step?.durationMs !== undefined && step.durationMs >= 100 ? 1900 : 1100;
  return Math.max(authored, stepLegCount(step, engine) * FLOW_LEG_MS + 500);
}

/**
 * How long a single beat holds. Short enough that a seven-leg step still reads as
 * one movement rather than a slideshow, long enough to follow with your eye.
 */
export const FLOW_LEG_MS = 240;
