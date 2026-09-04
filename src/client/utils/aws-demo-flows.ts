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
 * where the last one ended unless it says otherwise. Authoring `from` on every
 * step invited exactly one kind of typo — a step whose origin didn't match the
 * previous step's destination, drawing a jump-cut.
 */
function resolve(steps: readonly DemoStep[]): readonly ResolvedDemoStep[] {
  return steps.map((step, index) => ({
    ...step,
    from: step.from ?? (index > 0 ? steps[index - 1].to : step.to),
  }));
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
    from: 's3',
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
    actor: 'Valentin',
    action: 'writes a reply',
  },
  {
    from: 'bedrock',
    to: 'browser',
    service: 'Browser',
    operation: 'agent_message',
    detail: 'reply streamed',
    category: 'network',
    actor: 'Valentin',
    action: 'writes a reply',
  },
];

/** The 9-step flow from the approved mockup — the one the talk is built around. */
const LEARNS_SOMETHING: readonly DemoStep[] = [
  ...CHAT_REPLY,
  {
    from: 'fargate',
    to: 'bedrock',
    service: 'Bedrock',
    operation: 'Converse',
    detail: 'extract-preferences · forced tool use',
    category: 'ml',
    durationMs: 380,
    actor: 'Valentin',
    action: 'learns something new',
  },
  {
    from: 'fargate',
    to: 'dynamodb',
    service: 'DynamoDB',
    operation: 'PutItem',
    detail: 'PREF#music',
    category: 'database',
    durationMs: 18,
    ok: true,
    actor: 'Valentin',
    action: 'learns something new',
  },
  {
    from: 'dynamodb',
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
 * Every `from` here is `fargate` rather than the previous step's `to`, because
 * these are sibling calls made by the same task, not a chain. Defaulting would
 * route Ontopo → Ontopo, which `routeBetween` correctly reports as no hop at all
 * — a beat that lights nothing.
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
    actor: 'Valentin',
    action: 'picks a tool',
  },
  {
    from: 'fargate',
    to: 'integrations',
    service: 'External APIs',
    operation: 'check_shabbat',
    detail: 'Hebrew calendar · computed locally',
    category: 'external',
    durationMs: 4,
    ok: true,
    actor: 'Valentin',
    action: 'asks the outside world',
  },
  {
    from: 'fargate',
    to: 'integrations',
    service: 'External APIs',
    operation: 'search_restaurants',
    detail: 'Ontopo · Tel Aviv',
    category: 'external',
    durationMs: 612,
    ok: true,
    actor: 'Valentin',
    action: 'asks the outside world',
  },
  {
    from: 'integrations',
    to: 'browser',
    service: 'Browser',
    operation: 'action_proposal',
    detail: 'a table to confirm',
    category: 'external',
    actor: 'Valentin',
    action: 'offers something to confirm',
  },
  {
    from: 'browser',
    to: 'integrations',
    service: 'External APIs',
    operation: 'confirm_action',
    detail: 'Ontopo · checkout link',
    category: 'external',
    durationMs: 388,
    ok: true,
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
    actor: 'Valentin',
    action: 'writes a reply',
  },
  {
    to: 'ac-dynamodb',
    service: 'DynamoDB',
    operation: 'Query',
    detail: 'via valentin-profile-tools-dev',
    category: 'database',
    durationMs: 21,
    ok: true,
    actor: 'Valentin',
    action: 'writes a reply',
  },
  {
    from: 'ac-runtime',
    to: 'browser',
    service: 'Browser',
    operation: 'agent_message',
    detail: 'reply streamed',
    category: 'network',
    actor: 'Valentin',
    action: 'writes a reply',
  },
  {
    from: 'ac-runtime',
    to: 'ac-memory',
    service: 'Memory',
    operation: 'CreateEvent',
    detail: 'managed preference extraction',
    category: 'ml',
    durationMs: 37,
    ok: true,
    actor: 'Valentin',
    action: 'learns something new',
  },
  {
    from: 'ac-gateway',
    to: 'ac-dynamodb',
    service: 'DynamoDB',
    operation: 'PutItem',
    detail: 'PREF#music',
    category: 'database',
    durationMs: 19,
    ok: true,
    actor: 'Valentin',
    action: 'learns something new',
  },
  {
    from: 'ac-dynamodb',
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
}

/** How many beats a step is animated over: box, arrow, box, arrow, box. */
export function stepLegCount(beat: FlowBeat | undefined): number {
  return beat ? flowLegs(beat.from, beat.to).length : 1;
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

  for (let k = 0; k <= current; k += 1) {
    const step = steps[k];
    const isCurrent = k === current;

    if (isCurrent) {
      const legs = flowLegs(step.from, step.to);
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
      litIsResponse = !leg.downstream;

      // The trail behind the traffic, within this step as well as before it — so
      // the path fills in as it is walked instead of appearing all at once.
      for (const earlier of legs.slice(0, at)) {
        if (earlier.kind === 'node' && !done.includes(earlier.node)) done.push(earlier.node);
      }
    } else if (!done.includes(step.to)) {
      done.push(step.to);
    }

    // The current step's pill waits until the traffic has actually arrived: the
    // number is what the work cost, and announcing it before the box lights would
    // put a measurement on a node nothing has reached yet.
    const arrived = !isCurrent || litNode === step.to;
    if (step.durationMs !== undefined && arrived) {
      durations[step.to] = {
        label: `${step.durationMs} ms`,
        ok: step.ok === true,
        current: isCurrent,
      };
    }
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
export function demoStepDwellMs(step: FlowBeat | undefined): number {
  const authored = step?.durationMs !== undefined && step.durationMs >= 100 ? 1900 : 1100;
  return Math.max(authored, stepLegCount(step) * FLOW_LEG_MS + 500);
}

/**
 * How long a single beat holds. Short enough that a seven-leg step still reads as
 * one movement rather than a slideshow, long enough to follow with your eye.
 */
export const FLOW_LEG_MS = 240;
