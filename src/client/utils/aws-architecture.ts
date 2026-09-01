import type { EngineId } from '../../shared/interfaces/engine';
import type { ServerEvent } from '../../shared/interfaces/ws-events';

/**
 * The real AWS topology behind Valentin, as a model the view can render and
 * the tests can assert against.
 *
 * This replaced an earlier model that named code modules (`WsGateway`,
 * `EventRouter`). An AWS audience learns nothing from a module name; a room full
 * of builders reads `ValentinTable-dev` instantly.
 *
 * Every value here is verified against live AWS reads and the CDK source, not
 * inferred from the console:
 *   CloudFront   E6OHMQWNEQL6M → d26dwovftfq9oe.cloudfront.net
 *   S3           valentin-static-dev, OAC + CACHING_OPTIMIZED
 *   ALB          valentin-alb-dev, HTTP:80, sticky 1h, idleTimeout 3600s
 *   ECS Fargate  valentin-service-dev, 256 CPU / 512 MiB, :3001, private subnets
 *   Bedrock      us.anthropic.claude-sonnet-4-5-20250929-v1:0 via the Converse API
 *   DynamoDB     ValentinTable-dev, pk/sk + GSI1, PAY_PER_REQUEST
 *
 * Deliberately absent: Cognito, valentin-photos-dev, valentin-frontend-dev, the
 * Guardrail, and the monitoring stack. All are deployed but unreferenced by
 * `src/` — drawing them would be a diagram of the account, not of the request.
 *
 * TWO ENGINES
 *
 * The same conversation runs on two engines behind the one ALB, so the diagram
 * holds both and the drawer shows one at a time with the other shaded:
 *   engine A  valentin-service-dev   the hand-built Bedrock pipeline
 *   engine B  valentin-ac-proxy-dev  Bedrock AgentCore Runtime · Memory · Gateway
 * Browser, CloudFront, S3 and the ALB carry no engine: they are genuinely shared,
 * and greying them out when you switch would claim a difference that isn't there.
 */

/** Stable identifier for an AWS resource in the diagram. */
export type AwsNodeId =
  | 'browser'
  | 'cloudfront'
  | 's3'
  | 'alb'
  | 'fargate'
  | 'bedrock'
  | 'dynamodb'
  | 'integrations'
  | 'ac-proxy'
  | 'ac-runtime'
  | 'ac-memory'
  | 'ac-gateway'
  | 'ac-dynamodb';

/**
 * Which engine a resource belongs to.
 *
 * Also the value the server reports as `engine` on `/api/config`, so the label in
 * the drawer and the label on the process are the same word.
 */
export type ArchitectureEngine = EngineId;

export const ARCHITECTURE_ENGINES: readonly ArchitectureEngine[] = ['valentin', 'agentcore'];

/** Which column the node occupies, left to right, following the request. */
export type AwsTier = 'client' | 'edge' | 'origin' | 'compute' | 'data';

/** A single AWS resource in the diagram. */
export interface AwsNode {
  id: AwsNodeId;
  /** AWS service name as AWS writes it — 'Amazon DynamoDB', not 'Dynamo'. */
  service: string;
  /** The actual deployed resource identifier. */
  resourceName: string;
  /**
   * One line of configuration worth saying out loud.
   *
   * One *line*, literally: the cards are all one size (`AWS_NODE_CARD`) and clamp
   * their caption to a single row, so anything past ~29 characters is truncated
   * rather than allowed to push the card out of the grid. Three of these were
   * over that budget and spilled onto their neighbours; the facts that had to go
   * are stated by the surrounding boxes and band captions instead.
   */
  caption: string;
  tier: AwsTier;
  /**
   * True for resources that are genuinely on the path but never light during a
   * chat turn. S3 serves the page load and nothing else; drawing it dimmed is
   * more honest than omitting it and lets the room see why it stays dark.
   */
  dimmed?: boolean;
  /** Inside `valentin-vpc-dev`'s private subnets — drawn with a dashed border. */
  inVpc?: boolean;
  /**
   * The engine this resource belongs to. Absent means shared by both, which is
   * the honest answer for everything from the browser down to the ALB.
   */
  engine?: ArchitectureEngine;
  /** Inside the Bedrock AgentCore boundary — drawn inside its own dashed box. */
  inAgentCore?: boolean;
}

export const AWS_NODES: readonly AwsNode[] = [
  {
    id: 'browser',
    service: 'Browser',
    resourceName: 'React 19 SPA',
    caption: 'use-websocket.ts',
    tier: 'client',
  },
  {
    id: 'cloudfront',
    service: 'Amazon CloudFront',
    resourceName: 'E6OHMQWNEQL6M',
    caption: 'd26dwovftfq9oe.cloudfront.net',
    tier: 'edge',
  },
  {
    id: 's3',
    service: 'Amazon S3',
    resourceName: 'valentin-static-dev',
    caption: 'OAC · CACHING_OPTIMIZED',
    tier: 'origin',
    dimmed: true,
  },
  {
    id: 'alb',
    service: 'Application Load Balancer',
    resourceName: 'valentin-alb-dev',
    caption: 'sticky 1 h · idle 3600 s',
    tier: 'origin',
  },
  {
    id: 'fargate',
    service: 'Amazon ECS · AWS Fargate',
    resourceName: 'valentin-service-dev',
    caption: '256 CPU · 512 MiB · :3001',
    tier: 'compute',
    inVpc: true,
    engine: 'valentin',
  },
  {
    id: 'bedrock',
    service: 'Amazon Bedrock',
    resourceName: 'Claude Sonnet 4.5',
    caption: 'Converse API · VPC endpoint',
    tier: 'data',
    engine: 'valentin',
  },
  {
    id: 'dynamodb',
    service: 'Amazon DynamoDB',
    resourceName: 'ValentinTable-dev',
    caption: 'pk/sk · GSI1 · on-demand',
    tier: 'data',
    engine: 'valentin',
  },

  // --- Engine B. Same image as `fargate`, same task size, same table. ---
  {
    id: 'ac-proxy',
    service: 'Amazon ECS · AWS Fargate',
    resourceName: 'valentin-ac-proxy-dev',
    // Word for word what `fargate` says, and that is the argument: same image,
    // same task size, same port — so a latency difference is AgentCore's, not the
    // harness's. `AGENT_ENGINE=agentcore` is dropped from here because the band
    // caption to the left already says it.
    caption: '256 CPU · 512 MiB · :3001',
    tier: 'compute',
    inVpc: true,
    engine: 'agentcore',
  },
  {
    id: 'ac-runtime',
    service: 'AgentCore Runtime',
    resourceName: 'valentin_agent_dev',
    // The model call happens *inside* the Runtime, so Bedrock is named here
    // rather than drawn: the proxy's role has no bedrock:InvokeModel, and a
    // Bedrock node on this side would be one we can never light up.
    caption: 'Strands · Sonnet 4.5 · arm64',
    tier: 'compute',
    engine: 'agentcore',
    inAgentCore: true,
  },
  {
    id: 'ac-memory',
    service: 'AgentCore Memory',
    resourceName: 'valentin_memory_dev',
    caption: 'managed preference extraction',
    tier: 'data',
    engine: 'agentcore',
    inAgentCore: true,
  },
  {
    id: 'ac-gateway',
    service: 'AgentCore Gateway',
    resourceName: 'valentin-gateway-dev',
    caption: 'MCP · Lambda target · 3 tools',
    tier: 'data',
    engine: 'agentcore',
    inAgentCore: true,
  },
  {
    id: 'ac-dynamodb',
    service: 'Amazon DynamoDB',
    resourceName: 'ValentinTable-dev',
    // Drawn twice, and it is the same table both times. Duplicating the node is
    // how a tree says "same resource, different path": engine A writes it from
    // the task, engine B reaches it through the Gateway's Lambda target. The
    // Lambda's name is on the connector rather than in here, which is where it
    // belongs anyway — it is the hop, not the table.
    caption: 'same table · via the Gateway',
    tier: 'data',
    engine: 'agentcore',
  },
  /*
   * The one node here that is not AWS, and the only honest way to draw the tool
   * loop: outbound HTTPS from the task to Ontopo, Hebcal, Amadeus, Google and
   * Meta. Omitting it would draw a diagram in which Valentin books a restaurant
   * with no restaurant in the picture.
   *
   * One grouped node rather than six. Six cards do not read on a projector, and
   * which service fired is swapped into `resourceName` live from the span — see
   * `INTEGRATION_LABELS` in the span bridge — so the room still sees "Ontopo" and
   * its real duration on a single node.
   */
  {
    id: 'integrations',
    service: 'External APIs',
    resourceName: '6 integrations',
    caption: 'outbound HTTPS · NAT gateway',
    tier: 'data',
    // Engine A's, not shared: engine B reaches the same jobs through the Gateway,
    // so leaving this unscoped would light it on a band that never calls it.
    engine: 'valentin',
  },
] as const;

/** Lookup by id. */
export function awsNode(id: AwsNodeId): AwsNode | undefined {
  return AWS_NODES.find((node) => node.id === id);
}

/**
 * Is this resource part of the engine currently being shown?
 *
 * Shared resources answer true for both engines — that is the whole point of
 * `engine` being optional. The drawer shades everything this returns false for,
 * so the shared spine never dims and the room can see that the two engines
 * really do arrive through the same edge.
 */
export function isNodeInEngine(id: AwsNodeId, engine: ArchitectureEngine): boolean {
  const node = awsNode(id);
  if (!node) return false;
  return node.engine === undefined || node.engine === engine;
}

/** True when a connector joins two resources the given engine actually uses. */
export function isSegmentInEngine(segment: AwsSegment, engine: ArchitectureEngine): boolean {
  return isNodeInEngine(segment.from, engine) && isNodeInEngine(segment.to, engine);
}

/**
 * Engine A's resource, and engine B's counterpart doing the same job.
 *
 * Used to translate a route or a span from one side to the other. Bedrock has no
 * entry on purpose: engine B's model call happens inside the Runtime, so a
 * Bedrock span from engine B does not exist and inventing a node for it would be
 * drawing a call we cannot measure. It maps to the Runtime instead, which is
 * where that latency is actually observable from the proxy.
 */
const AGENTCORE_COUNTERPART: Readonly<Partial<Record<AwsNodeId, AwsNodeId>>> = {
  fargate: 'ac-proxy',
  bedrock: 'ac-runtime',
  dynamodb: 'ac-dynamodb',
};

/**
 * The same map read backwards.
 *
 * Derived rather than authored so the two can never disagree. `ac-memory` and
 * `ac-gateway` have no engine-A counterpart and therefore no entry: engine A does
 * its own memory and calls its tools in-process, so translating them would have to
 * invent a resource.
 */
const VALENTIN_COUNTERPART: Readonly<Partial<Record<AwsNodeId, AwsNodeId>>> = Object.fromEntries(
  Object.entries(AGENTCORE_COUNTERPART).map(([valentinId, agentcoreId]) => [
    agentcoreId,
    valentinId,
  ]),
);

/**
 * The node that plays `id`'s role on the given engine. Shared nodes map to themselves.
 *
 * Translates in both directions, because callers hand it ids from either side —
 * a stale `litNode` from the engine you just switched away from, or an authored
 * route that only names engine A. Anything with no counterpart is returned
 * unchanged rather than guessed at; `isNodeInEngine` is what decides whether the
 * result is drawable.
 */
export function nodeForEngine(id: AwsNodeId, engine: ArchitectureEngine): AwsNodeId {
  const counterpart = engine === 'agentcore' ? AGENTCORE_COUNTERPART : VALENTIN_COUNTERPART;
  return counterpart[id] ?? id;
}

/**
 * The parent of each node — the resource one hop closer to the browser.
 *
 * This is the load-bearing fact of the whole diagram: the distribution is a
 * **tree** rooted at the browser, so the path between any two resources is
 * unique and can be *computed* rather than authored. That is what makes an
 * impossible link — DynamoDB talking straight to CloudFront, say — not merely
 * unlikely but unrepresentable. An earlier hand-labelled version of this
 * diagram drew exactly that, which is why the model is derived now.
 *
 * The browser is the root and has no parent.
 */
const PARENT: Readonly<Partial<Record<AwsNodeId, AwsNodeId>>> = {
  cloudfront: 'browser',
  s3: 'cloudfront',
  alb: 'cloudfront',
  fargate: 'alb',
  bedrock: 'fargate',
  dynamodb: 'fargate',
  integrations: 'fargate',
  // The tree forks at the ALB, which is exactly where the deployed system forks:
  // one listener, two target groups, routed by path and by the
  // `X-Valentin-Engine` header.
  'ac-proxy': 'alb',
  'ac-runtime': 'ac-proxy',
  'ac-memory': 'ac-runtime',
  'ac-gateway': 'ac-runtime',
  'ac-dynamodb': 'ac-gateway',
};

/**
 * A physical link between a parent and its child, named for the pair it joins.
 * Ids are stable because the view keys its rendered connectors off them.
 */
export type AwsSegmentId =
  | 'browser-cloudfront'
  | 'cloudfront-s3'
  | 'cloudfront-alb'
  | 'alb-fargate'
  | 'fargate-bedrock'
  | 'fargate-dynamodb'
  | 'fargate-integrations'
  | 'alb-ac-proxy'
  | 'ac-proxy-ac-runtime'
  | 'ac-runtime-ac-memory'
  | 'ac-runtime-ac-gateway'
  | 'ac-gateway-ac-dynamodb';

/** A connector in the diagram, always oriented parent → child. */
export interface AwsSegment {
  id: AwsSegmentId;
  from: AwsNodeId;
  to: AwsNodeId;
  /** Shown on the connector: how this hop physically happens. */
  label?: string;
}

export const AWS_SEGMENTS: readonly AwsSegment[] = [
  { id: 'browser-cloudfront', from: 'browser', to: 'cloudfront' },
  { id: 'cloudfront-s3', from: 'cloudfront', to: 's3', label: 'default behavior *' },
  { id: 'cloudfront-alb', from: 'cloudfront', to: 'alb', label: '/api/* · /ws' },
  { id: 'alb-fargate', from: 'alb', to: 'fargate', label: 'target group :3001' },
  { id: 'fargate-bedrock', from: 'fargate', to: 'bedrock', label: 'VPC interface endpoint' },
  { id: 'fargate-dynamodb', from: 'fargate', to: 'dynamodb', label: 'VPC gateway endpoint' },
  // Not an endpoint of any kind: these leave the VPC entirely. Worth labelling
  // precisely, because "how does the task reach ontopo.com from a private subnet"
  // is the first question an AWS audience asks about this node.
  { id: 'fargate-integrations', from: 'fargate', to: 'integrations', label: 'NAT · public internet' },
  {
    id: 'alb-ac-proxy',
    from: 'alb',
    to: 'ac-proxy',
    label: '/api/agentcore/* · /ws/agentcore',
  },
  {
    id: 'ac-proxy-ac-runtime',
    from: 'ac-proxy',
    to: 'ac-runtime',
    label: 'InvokeAgentRuntime',
  },
  {
    id: 'ac-runtime-ac-memory',
    from: 'ac-runtime',
    to: 'ac-memory',
    label: 'CreateEvent',
  },
  {
    id: 'ac-runtime-ac-gateway',
    from: 'ac-runtime',
    to: 'ac-gateway',
    label: 'MCP tool call',
  },
  {
    id: 'ac-gateway-ac-dynamodb',
    from: 'ac-gateway',
    to: 'ac-dynamodb',
    label: 'Lambda target',
  },
] as const;

/** Segment joining a node to its parent. Undefined for the root. */
function segmentToParent(id: AwsNodeId): AwsSegment | undefined {
  const parent = PARENT[id];
  if (!parent) return undefined;
  return AWS_SEGMENTS.find((segment) => segment.from === parent && segment.to === id);
}

/** One hop of a route. */
export interface AwsHop {
  segment: AwsSegmentId;
  /** The node this hop arrives at. */
  node: AwsNodeId;
  /**
   * True when travelling away from the browser — a request. False when
   * travelling back toward it — a response. The view uses this to choose the
   * direction traffic animates along the connector.
   */
  downstream: boolean;
}

/** The chain of nodes from `id` up to the root, inclusive of both. */
function chainToRoot(id: AwsNodeId): AwsNodeId[] {
  const chain: AwsNodeId[] = [id];
  let current = PARENT[id];
  while (current) {
    chain.push(current);
    current = PARENT[current];
  }
  return chain;
}

/**
 * The hops traffic takes to get from `from` to `to`, in travel order.
 *
 * Because the topology is a tree, this is the unique path: climb from `from` to
 * the lowest common ancestor, then descend to `to`. Same node in and out gives
 * an empty route — work that happened without a network hop.
 */
export function routeBetween(from: AwsNodeId, to: AwsNodeId): readonly AwsHop[] {
  if (from === to) return [];

  const fromChain = chainToRoot(from);
  const toChain = chainToRoot(to);
  const meetingPoint = fromChain.find((id) => toChain.includes(id));
  // Unreachable while every node chains to `browser`, but a future node added
  // without a parent entry would otherwise route into nonsense silently.
  if (!meetingPoint) return [];

  const hops: AwsHop[] = [];

  for (let id: AwsNodeId | undefined = from; id && id !== meetingPoint; id = PARENT[id]) {
    const segment = segmentToParent(id);
    const parent = PARENT[id];
    if (segment && parent) hops.push({ segment: segment.id, node: parent, downstream: false });
  }

  const descent: AwsNodeId[] = [];
  for (let id: AwsNodeId | undefined = to; id && id !== meetingPoint; id = PARENT[id]) {
    descent.push(id);
  }
  for (const id of descent.reverse()) {
    const segment = segmentToParent(id);
    if (segment) hops.push({ segment: segment.id, node: id, downstream: true });
  }

  return hops;
}

/** The nodes a route touches, including both endpoints, in travel order. */
export function nodesAlongRoute(from: AwsNodeId, to: AwsNodeId): readonly AwsNodeId[] {
  const hops = routeBetween(from, to);
  if (hops.length === 0) return [from];
  return [from, ...hops.map((hop) => hop.node)];
}

/**
 * One beat of a journey: either sitting in a node, or in flight along a segment.
 *
 * A `downstream` flag rides on both kinds so a renderer can colour the beat by
 * travel direction without re-deriving it — for a node leg it is the direction of
 * the hop that *arrived* there, which is what makes the response leg read as a
 * return rather than as a second outbound trip.
 */
export type FlowLeg =
  | { kind: 'node'; node: AwsNodeId; downstream: boolean }
  | { kind: 'hop'; hop: AwsHop; downstream: boolean };

/**
 * A route split into single beats, alternating node and segment.
 *
 * This is the difference between "this step touched eight things" and "watch it
 * move": `routeBetween` hands back the whole path at once, which is honest about
 * the topology but, animated, lights the entire path simultaneously. Interleaving
 * the nodes between the hops gives a sequence a presenter can follow — box, arrow,
 * box, arrow, box — where exactly one thing is ever highlighted.
 *
 * The origin node leads, so the journey starts where the traffic already is. Work
 * with no network hop (`from === to`) is a single node leg rather than nothing:
 * something did happen, it just happened in one place.
 */
export function flowLegs(from: AwsNodeId, to: AwsNodeId): readonly FlowLeg[] {
  const hops = routeBetween(from, to);
  if (hops.length === 0) return [{ kind: 'node', node: to, downstream: true }];

  const legs: FlowLeg[] = [{ kind: 'node', node: from, downstream: hops[0].downstream }];
  for (const hop of hops) {
    legs.push({ kind: 'hop', hop, downstream: hop.downstream });
    legs.push({ kind: 'node', node: hop.node, downstream: hop.downstream });
  }
  return legs;
}

/**
 * Where each WebSocket event's work lands, and where it started.
 *
 * `from` is the originator, `to` is where the work happens; the route between
 * them is computed. Events the browser initiates start at `browser`; events the
 * server pushes start at whichever resource produced them. This is what lets
 * `preference_update` correctly draw DynamoDB → Fargate → ALB → CloudFront →
 * Browser instead of a phantom DynamoDB → CloudFront link.
 */
const EVENT_ROUTES: Readonly<Record<string, { from: AwsNodeId; to: AwsNodeId }>> = {
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
  /*
   * The two halves of the authority model, and they deliberately run opposite ways.
   * A proposal originates at the provider — Ontopo held a table, Amadeus priced a
   * room — and travels out to the browser. The confirmation starts as a click and
   * travels all the way back to the provider, which is the point worth watching on
   * a projector: the click is what reaches the outside world, not the model.
   */
  action_proposal: { from: 'integrations', to: 'browser' },
  confirm_action: { from: 'browser', to: 'integrations' },
};

/**
 * Which AWS resources light up for an event type.
 *
 * Unknown event types highlight nothing rather than throwing — a new event from
 * a refactored server still lists in the feed, it just doesn't animate. This is
 * the property that lets the diagram survive server renames.
 */
export function awsNodesForEventType(
  eventType: string,
  engine: ArchitectureEngine = 'valentin',
): readonly AwsNodeId[] {
  const route = EVENT_ROUTES[eventType];
  if (!route) return [];
  return nodesAlongRoute(nodeForEngine(route.from, engine), nodeForEngine(route.to, engine));
}

/** The connectors that light up for an event type, with their directions. */
export function awsHopsForEventType(
  eventType: string,
  engine: ArchitectureEngine = 'valentin',
): readonly AwsHop[] {
  const route = EVENT_ROUTES[eventType];
  if (!route) return [];
  return routeBetween(nodeForEngine(route.from, engine), nodeForEngine(route.to, engine));
}

/**
 * Which resource an `aws_span` refers to.
 *
 * `resourceId` is an open string on the wire on purpose (see the `aws_span`
 * envelope), so an unrecognised value resolves to `undefined` and the span
 * still renders in the feed under its own service name. A closed union here
 * would turn a server-side rename into a silently missing beat.
 *
 * The engine matters because both engines emit the *same* resource ids — engine
 * B's preference mirror logs `preference.saved` with `resourceId: 'dynamodb'`
 * exactly as engine A does, since both go through the same store. Without the
 * translation, engine B's writes would light engine A's DynamoDB node while the
 * whole engine-A half is shaded out.
 */
export function awsNodeIdForResource(
  resourceId: string,
  engine: ArchitectureEngine = 'valentin',
): AwsNodeId | undefined {
  const direct = AWS_NODES.find((node) => node.id === resourceId)?.id;
  if (direct) return nodeForEngine(direct, engine);
  // Ids the server emits that are not node ids. Only engine B produces these,
  // so they resolve on either engine rather than being gated on the view: a
  // Memory span arriving while the valentin half is shown is a mislabelled view,
  // and a beat in the feed is how you find that out.
  return AGENTCORE_RESOURCE_IDS[resourceId];
}

/** Server-side resource ids for the AgentCore primitives, which own no node id. */
const AGENTCORE_RESOURCE_IDS: Readonly<Record<string, AwsNodeId>> = {
  'agentcore-runtime': 'ac-runtime',
  'agentcore-memory': 'ac-memory',
  'agentcore-gateway': 'ac-gateway',
};

/**
 * A short detail line for an event, safe to project.
 *
 * NEVER includes a preference's value — only its category and key. The drawer is
 * on a screen in front of a room, and the values are a real person's private
 * preferences.
 */
export function describeAwsEvent(event: ServerEvent | { type: string; payload: unknown }): string {
  const payload = event.payload as Record<string, unknown> | undefined;
  if (!payload) return '';

  switch (event.type) {
    case 'preference_update': {
      const preference = payload.preference as Record<string, unknown> | undefined;
      if (!preference) return '';
      const verb = payload.isNew === true ? 'new' : 'updated';
      return `${verb} · ${String(preference.category)}`;
    }
    case 'agent_message':
      return 'reply streamed';
    case 'send_message':
      return 'message sent';
    case 'session_init':
      return 'session loaded';
    case 'connection_status':
      return typeof payload.status === 'string' ? payload.status : '';
    case 'error':
      return typeof payload.code === 'string' ? payload.code : 'error';
    default:
      return '';
  }
}
