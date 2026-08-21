import type { ServerEvent } from '../../shared/interfaces/ws-events';

/**
 * The real AWS topology behind Valentin, as a model the view can render and
 * the tests can assert against.
 *
 * Sibling to `inspector-architecture.ts`, which stays: that file names code
 * modules (`WsGateway`, `EventRouter`), this one names AWS resources. An AWS
 * audience learns nothing from a module name; a room full of builders reads
 * `ValentinTable-dev` instantly.
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
 */

/** Stable identifier for an AWS resource in the diagram. */
export type AwsNodeId =
  | 'browser'
  | 'cloudfront'
  | 's3'
  | 'alb'
  | 'fargate'
  | 'bedrock'
  | 'dynamodb';

/** Which column the node occupies, left to right, following the request. */
export type AwsTier = 'client' | 'edge' | 'origin' | 'compute' | 'data';

/** A single AWS resource in the diagram. */
export interface AwsNode {
  id: AwsNodeId;
  /** AWS service name as AWS writes it — 'Amazon DynamoDB', not 'Dynamo'. */
  service: string;
  /** The actual deployed resource identifier. */
  resourceName: string;
  /** One line of configuration worth saying out loud. */
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
  },
  {
    id: 'bedrock',
    service: 'Amazon Bedrock',
    resourceName: 'Claude Sonnet 4.5',
    caption: 'Converse API · VPC endpoint',
    tier: 'data',
  },
  {
    id: 'dynamodb',
    service: 'Amazon DynamoDB',
    resourceName: 'ValentinTable-dev',
    caption: 'pk/sk · GSI1 · on-demand',
    tier: 'data',
  },
] as const;

/** Lookup by id. */
export function awsNode(id: AwsNodeId): AwsNode | undefined {
  return AWS_NODES.find((node) => node.id === id);
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
  | 'fargate-dynamodb';

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
};

/**
 * Which AWS resources light up for an event type.
 *
 * Unknown event types highlight nothing rather than throwing — a new event from
 * a refactored server still lists in the feed, it just doesn't animate. This is
 * the property that lets the diagram survive server renames.
 */
export function awsNodesForEventType(eventType: string): readonly AwsNodeId[] {
  const route = EVENT_ROUTES[eventType];
  if (!route) return [];
  return nodesAlongRoute(route.from, route.to);
}

/** The connectors that light up for an event type, with their directions. */
export function awsHopsForEventType(eventType: string): readonly AwsHop[] {
  const route = EVENT_ROUTES[eventType];
  if (!route) return [];
  return routeBetween(route.from, route.to);
}

/**
 * Which resource an `aws_span` refers to.
 *
 * `resourceId` is an open string on the wire on purpose (see the `aws_span`
 * envelope), so an unrecognised value resolves to `undefined` and the span
 * still renders in the feed under its own service name. A closed union here
 * would turn a server-side rename into a silently missing beat.
 */
export function awsNodeIdForResource(resourceId: string): AwsNodeId | undefined {
  return AWS_NODES.find((node) => node.id === resourceId)?.id;
}

/**
 * A short detail line for an event, safe to project.
 *
 * Unlike `describeEvent` in `inspector-architecture.ts`, this NEVER includes a
 * preference's value — only its category and key. The Inspector is on a screen
 * in front of a room, and the values are a real person's private preferences.
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
