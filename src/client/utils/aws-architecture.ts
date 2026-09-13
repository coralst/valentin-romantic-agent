import type { EngineId } from '../../shared/interfaces/engine';
import type { ServerEvent } from '../../shared/interfaces/ws-events';
import type { BrandMarkId } from '../design-system/brand-marks';

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
 *
 * So are the table and the providers, and that is the comparison's whole premise:
 * `ValentinTable-dev` and the eight real APIs are *one* set of resources reached
 * two different ways — engine A calls them from the task, engine B goes through
 * the Gateway's two Lambda targets. An earlier version drew them twice, once per
 * engine, which reads as two databases and undercuts the point. See
 * {@link PARENT_BY_ENGINE} for how one node is reached by two paths without
 * giving the tree two parents.
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
  | 'ac-lambda-profile'
  | 'ac-lambda-tools';

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
  /**
   * Third-party providers this node stands for, drawn as a row of logos beneath it.
   *
   * Only `integrations` has them. The ids are `BrandMarkId`s so the diagram reuses
   * the marks the integrations panel already draws rather than authoring a second
   * set that could drift from it.
   */
  providers?: readonly BrandMarkId[];
  /**
   * The tool names registered on the Gateway for this target, in schema order.
   *
   * Facts about the deployment, not decoration: these are the entry points in
   * `infra/lib/agentcore-stack.ts`'s `toolSchema`, and they are what the Gateway
   * actually advertises to the agent. The layout decides how many fit.
   */
  toolEntryPoints?: readonly string[];
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
  /*
   * One table, and no `engine` field — the single most load-bearing omission in
   * this file. Engine A's task writes it through a VPC gateway endpoint; engine B's
   * proxy writes it the same way, and the agent *also* reads and writes it through
   * the Gateway's profile Lambda. Three arrows, one row of data. Both engines' UIs
   * read the profile from here, which is why switching engines mid-conversation
   * keeps her file intact.
   */
  {
    id: 'dynamodb',
    service: 'Amazon DynamoDB',
    resourceName: 'ValentinTable-dev',
    caption: 'pk/sk · GSI1 · both engines',
    tier: 'data',
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
    // What the Gateway is, in the fewest words that stay true: one MCP endpoint
    // and the JWT handled for the agent. The two targets behind it used to be
    // summarised here as a tool count; they are drawn as their own Lambdas now,
    // because "which code runs my tool" is the question this diagram is for.
    caption: 'one MCP endpoint · JWT auth',
    tier: 'data',
    engine: 'agentcore',
    inAgentCore: true,
  },
  /*
   * The two Lambda targets — the reason engine B needs no credentials in the task.
   *
   * Deliberately drawn *outside* the AgentCore box (see `AGENTCORE_BOX`): these are
   * our functions, in our account, and the Gateway invokes them. Naming them is what
   * makes the comparison legible — engine A's task calls Ontopo itself with keys it
   * holds, engine B's task cannot and does not.
   */
  {
    id: 'ac-lambda-profile',
    service: 'AWS Lambda',
    resourceName: 'valentin-profile-tools-dev',
    caption: 'valentin-profile · 3 tools',
    tier: 'data',
    engine: 'agentcore',
    toolEntryPoints: ['get_partner_profile', 'save_preference', 'list_preferences'],
  },
  {
    id: 'ac-lambda-tools',
    service: 'AWS Lambda',
    resourceName: 'valentin-integration-tools-dev',
    // The architectural fact, not the count: the provider secrets are read here,
    // from `INTEGRATION_SECRETS_PREFIX`, by a function the agent can only reach
    // through the Gateway.
    caption: 'holds the keys · 26 tools',
    tier: 'data',
    engine: 'agentcore',
    /*
     * Every entry point `valentin-integrations` advertises, in schema order: the 19
     * offered tools, then the 7 `confirm_*` halves the stack derives from the gated
     * ones. `create_conversation_link` is absent because the stack withholds it.
     *
     * The confirms are in the list and that is the point of listing them at all —
     * `agent.py` filters them out of what it shows the model, so they exist for the
     * application to call after a human clicks Confirm. Propose and confirm are two
     * authorities, and here they are two tools.
     */
    toolEntryPoints: [
      'check_availability',
      'check_shabbat',
      'find_gift_delivery',
      'find_music',
      'find_occasions',
      'find_places_nearby',
      'find_restaurants',
      'get_hebrew_occasions',
      'propose_calendar_event',
      'propose_email',
      'propose_gift',
      'propose_hotel_booking',
      'propose_playlist',
      'propose_reservation',
      'propose_whatsapp_nudge',
      'read_webpage',
      'search_activities',
      'search_hotels',
      'search_web',
      'confirm_calendar_event',
      'confirm_email',
      'confirm_gift',
      'confirm_hotel_booking',
      'confirm_playlist',
      'confirm_reservation',
      'confirm_whatsapp_nudge',
    ],
  },
  /*
   * The one node here that is not AWS, and the only honest way to draw the tool
   * loop: the real Ontopo, Google, Spotify, Gmail, Wolt and Hebcal endpoints.
   * Omitting it would draw a diagram in which Valentin books a restaurant with no
   * restaurant in the picture.
   *
   * One grouped node rather than eight. Eight cards do not read on a projector, and
   * which service fired is swapped into `resourceName` live from the span — see
   * `INTEGRATION_LABELS` in the span bridge — so the room still sees "Ontopo" and
   * its real duration on a single node. The logos beneath it are how the room knows
   * which eight without reading a list.
   *
   * Shared, like `dynamodb`: the same providers, called from the task on engine A
   * and from the Gateway's Lambda on engine B. Scoping it to engine A — which an
   * earlier version did, with a second copy for engine B — claimed the two engines
   * integrate with different companies.
   */
  {
    id: 'integrations',
    service: 'External APIs',
    resourceName: '8 providers',
    caption: 'direct on A · Gateway on B',
    tier: 'data',
    providers: [
      'ontopo',
      'google-places',
      'google-calendar',
      'wolt',
      'spotify',
      'gmail',
      'web-search',
      'hebcal',
    ],
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
 *
 * `dynamodb` and `integrations` have no entry either, and for the opposite reason:
 * they need no translation because there is nothing to translate to. A
 * `preference.saved` span from engine B names the same table engine A's does, and
 * that is the truth — what differs is the *route*, which {@link PARENT_BY_ENGINE}
 * owns.
 */
const AGENTCORE_COUNTERPART: Readonly<Partial<Record<AwsNodeId, AwsNodeId>>> = {
  fargate: 'ac-proxy',
  bedrock: 'ac-runtime',
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
 * The parent of each node — the resource one hop closer to the browser — **per
 * engine**.
 *
 * This is the load-bearing fact of the whole diagram: on either engine the
 * distribution is a **tree** rooted at the browser, so the path between any two
 * resources is unique and can be *computed* rather than authored. That is what
 * makes an impossible link — DynamoDB talking straight to CloudFront, say — not
 * merely unlikely but unrepresentable. An earlier hand-labelled version of this
 * diagram drew exactly that, which is why the model is derived now.
 *
 * WHY IT IS KEYED BY ENGINE
 *
 * One map cannot express a shared resource. `ValentinTable-dev` is reached from
 * the ECS task on engine A and from the proxy on engine B, which is two parents
 * for one node — so the earlier model duplicated the table into an `ac-dynamodb`
 * and drew two databases where the deployment has one. Splitting the map by engine
 * keeps each side a strict tree (routes stay unique and computable) while the node
 * itself stays single. That is the whole trick, and it is why `dynamodb` and
 * `integrations` appear in both maps with different parents.
 *
 * The browser is the root and has no parent.
 */
const PARENT_BY_ENGINE: Readonly<
  Record<ArchitectureEngine, Readonly<Partial<Record<AwsNodeId, AwsNodeId>>>>
> = {
  valentin: {
    cloudfront: 'browser',
    s3: 'cloudfront',
    alb: 'cloudfront',
    fargate: 'alb',
    bedrock: 'fargate',
    dynamodb: 'fargate',
    integrations: 'fargate',
  },
  agentcore: {
    cloudfront: 'browser',
    s3: 'cloudfront',
    alb: 'cloudfront',
    // The tree forks at the ALB, which is exactly where the deployed system forks:
    // one listener, two target groups, routed by path and by the
    // `X-Valentin-Engine` header.
    'ac-proxy': 'alb',
    'ac-runtime': 'ac-proxy',
    'ac-memory': 'ac-runtime',
    'ac-gateway': 'ac-runtime',
    'ac-lambda-profile': 'ac-gateway',
    'ac-lambda-tools': 'ac-gateway',
    /*
     * The table's parent on engine B is the *proxy*, not the profile Lambda, and the
     * distinction is the difference between a diagram and a claim. Every DynamoDB
     * span this drawer ever receives from engine B comes from the proxy's own store
     * calls — `createSession`, `findPreference`, the Memory mirror — because the
     * Lambda runs in AWS and reports to CloudWatch, not to this socket. Routing
     * engine B's table spans through the Gateway would animate three hops that did
     * not happen. The Lambda's access to the table is real and is drawn (see
     * `ac-lambda-profile-dynamodb`); it is simply never a *route*.
     */
    dynamodb: 'ac-proxy',
    // The providers, though, genuinely are only reachable through the Gateway on
    // this engine: the proxy's task role holds no provider secrets.
    integrations: 'ac-lambda-tools',
  },
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
  | 'ac-proxy-dynamodb'
  | 'ac-runtime-ac-memory'
  | 'ac-runtime-ac-gateway'
  | 'ac-gateway-ac-lambda-profile'
  | 'ac-gateway-ac-lambda-tools'
  | 'ac-lambda-profile-dynamodb'
  | 'ac-lambda-tools-integrations';

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
    id: 'ac-gateway-ac-lambda-profile',
    from: 'ac-gateway',
    to: 'ac-lambda-profile',
    label: 'valentin-profile target',
  },
  {
    id: 'ac-gateway-ac-lambda-tools',
    from: 'ac-gateway',
    to: 'ac-lambda-tools',
    // Named for the target rather than the transport, which is the difference
    // this connector exists to show: engine A's equivalent hop is labelled
    // 'NAT · public internet' from the task, because on that path the task itself
    // holds the credentials and makes the call.
    label: 'valentin-integrations target',
  },
  {
    id: 'ac-lambda-tools-integrations',
    from: 'ac-lambda-tools',
    to: 'integrations',
    // Same public internet as engine A's, from a Lambda instead of a task — which
    // is why the label names the credentials rather than the network: that is what
    // actually differs about this hop.
    label: 'provider keys · Secrets Manager',
  },
  {
    id: 'ac-proxy-dynamodb',
    from: 'ac-proxy',
    to: 'dynamodb',
    // The same VPC gateway endpoint engine A uses, from the other task. Engine B's
    // proxy owns sessions, the transcript and the preference mirror, so this is the
    // connector every DynamoDB span on this engine actually travels.
    label: 'VPC gateway endpoint',
  },
  {
    id: 'ac-lambda-profile-dynamodb',
    from: 'ac-lambda-profile',
    to: 'dynamodb',
    /*
     * Drawn, and never routed. `PARENT_BY_ENGINE.agentcore` gives the table the
     * *proxy* as its parent, so `routeBetween` never selects this segment — which is
     * correct, because nothing in this drawer can observe it: the Lambda's writes
     * happen behind the Gateway and land in CloudWatch, not on this socket. It is
     * here because it is how the agent's `save_preference` actually reaches the
     * table, and a Gateway target with no target would be the more misleading
     * omission. `aws-architecture.test.ts` pins both halves of that.
     */
    label: 'the agent’s own writes',
  },
] as const;

/**
 * The resource one hop closer to the browser, on the given engine.
 *
 * Undefined for the root, and undefined for a node the engine does not use —
 * `ac-gateway` on engine A has no parent because engine A has no Gateway, and a
 * route asking for one gets an empty path rather than a guess.
 */
function parentOf(id: AwsNodeId, engine: ArchitectureEngine): AwsNodeId | undefined {
  return PARENT_BY_ENGINE[engine][id];
}

/** Segment joining a node to its parent on this engine. Undefined for the root. */
function segmentToParent(id: AwsNodeId, engine: ArchitectureEngine): AwsSegment | undefined {
  const parent = parentOf(id, engine);
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

/** The chain of nodes from `id` up to the root on this engine, inclusive of both. */
function chainToRoot(id: AwsNodeId, engine: ArchitectureEngine): AwsNodeId[] {
  const chain: AwsNodeId[] = [id];
  let current = parentOf(id, engine);
  while (current) {
    chain.push(current);
    current = parentOf(current, engine);
  }
  return chain;
}

/**
 * The hops traffic takes to get from `from` to `to` on `engine`, in travel order.
 *
 * Because each engine's topology is a tree, this is the unique path: climb from
 * `from` to the lowest common ancestor, then descend to `to`. Same node in and out
 * gives an empty route — work that happened without a network hop.
 *
 * `engine` is required rather than defaulted, and that is deliberate: since the
 * table and the providers are shared, the *same* pair of endpoints has two
 * different correct answers, and a call site that forgets to say which engine it is
 * drawing would silently get engine A's. Every caller has the engine to hand.
 */
export function routeBetween(
  from: AwsNodeId,
  to: AwsNodeId,
  engine: ArchitectureEngine,
): readonly AwsHop[] {
  if (from === to) return [];

  const fromChain = chainToRoot(from, engine);
  const toChain = chainToRoot(to, engine);
  const meetingPoint = fromChain.find((id) => toChain.includes(id));
  // Reachable now, not merely defensive: ask for a route to `ac-gateway` on engine
  // A and the two chains never meet, because engine A's map has no Gateway. An
  // empty route is the honest answer — that path does not exist on that engine.
  if (!meetingPoint) return [];

  const hops: AwsHop[] = [];

  for (
    let id: AwsNodeId | undefined = from;
    id && id !== meetingPoint;
    id = parentOf(id, engine)
  ) {
    const segment = segmentToParent(id, engine);
    const parent = parentOf(id, engine);
    if (segment && parent) hops.push({ segment: segment.id, node: parent, downstream: false });
  }

  const descent: AwsNodeId[] = [];
  for (let id: AwsNodeId | undefined = to; id && id !== meetingPoint; id = parentOf(id, engine)) {
    descent.push(id);
  }
  for (const id of descent.reverse()) {
    const segment = segmentToParent(id, engine);
    if (segment) hops.push({ segment: segment.id, node: id, downstream: true });
  }

  return hops;
}

/** The nodes a route touches, including both endpoints, in travel order. */
export function nodesAlongRoute(
  from: AwsNodeId,
  to: AwsNodeId,
  engine: ArchitectureEngine,
): readonly AwsNodeId[] {
  const hops = routeBetween(from, to, engine);
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
export function flowLegs(
  from: AwsNodeId,
  to: AwsNodeId,
  engine: ArchitectureEngine,
): readonly FlowLeg[] {
  const hops = routeBetween(from, to, engine);
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
  return nodesAlongRoute(
    nodeForEngine(route.from, engine),
    nodeForEngine(route.to, engine),
    engine,
  );
}

/** The connectors that light up for an event type, with their directions. */
export function awsHopsForEventType(
  eventType: string,
  engine: ArchitectureEngine = 'valentin',
): readonly AwsHop[] {
  const route = EVENT_ROUTES[eventType];
  if (!route) return [];
  return routeBetween(nodeForEngine(route.from, engine), nodeForEngine(route.to, engine), engine);
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
  // A tool call the Gateway routed to the integration Lambda. Resolves to the
  // *Lambda*, not to `integrations`: what the proxy timed is the Gateway round trip
  // ending in that function, and lighting the provider card instead would credit
  // Ontopo with a duration that includes two AWS hops it had no part in.
  'agentcore-integrations': 'ac-lambda-tools',
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
