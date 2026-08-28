import type { ArchitectureEngine, AwsNodeId } from './aws-architecture';
import { routeBetween } from './aws-architecture';
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
export interface ResolvedDemoStep extends DemoStep {
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
  'page-load' | 'chat-reply' | 'learns-something' | 'agentcore-learns-something';

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
 * Cumulative diagram state for `steps[0..index]`.
 *
 * Rebuilt from scratch every time rather than mutated forward, so stepping
 * backwards is exact instead of an attempted undo — an undo-based version
 * drifted after the first backward step, which is precisely when a presenter
 * reaches for it ("wait, go back").
 */
export interface FlowFrame {
  /** The node the current step lands on. */
  litNode?: AwsNodeId;
  /** True when the current step arrived travelling back toward the browser. */
  litIsResponse: boolean;
  /** Nodes the current step's traffic passes through without stopping. */
  passNodes: readonly AwsNodeId[];
  /** Nodes lit by an earlier step. */
  doneNodes: readonly AwsNodeId[];
  /** The current step's hops, with direction. */
  activeHops: ReturnType<typeof routeBetween>;
  /** Duration pills to show, keyed by node. */
  durations: Readonly<Partial<Record<AwsNodeId, { label: string; ok: boolean; current: boolean }>>>;
}

export function frameForStep(steps: readonly ResolvedDemoStep[], index: number): FlowFrame {
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
  const pass: AwsNodeId[] = [];

  for (let k = 0; k <= current; k += 1) {
    const step = steps[k];
    const isCurrent = k === current;
    const hops = routeBetween(step.from, step.to);

    if (isCurrent) {
      litNode = step.to;
      // A step whose first hop climbs toward the browser is a response, and gets
      // the teal treatment. Colour by direction, not by which node it is.
      litIsResponse = hops.length > 0 && !hops[0].downstream;
      activeHops = hops;
      // Everything except the final hop's node is transited, not arrived at.
      hops.slice(0, -1).forEach((hop) => pass.push(hop.node));
    } else if (!done.includes(step.to)) {
      done.push(step.to);
    }

    if (step.durationMs !== undefined) {
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
    passNodes: pass.filter((id) => id !== litNode),
    doneNodes: done.filter((id) => id !== litNode),
    activeHops,
    durations,
  };
}

/** Dwell for a step: a 412 ms Converse call earns more time on screen than a 1 ms hop. */
export function demoStepDwellMs(step: ResolvedDemoStep | undefined): number {
  if (!step) return 1100;
  if (step.durationMs !== undefined && step.durationMs >= 100) return 1900;
  return 1100;
}
