import type { ArchitectureEngine, AwsNodeId, AwsSegmentId } from './aws-architecture';

/**
 * Where every box, connector and arrowhead sits in the architecture drawer.
 *
 * Separate from `aws-architecture.ts` on purpose: that file says what the
 * topology *is*, this one says how it is drawn. The component then holds no
 * magic numbers, which is what makes the geometry testable — an arrowhead
 * pointing the wrong way is an assertion, not a screenshot review.
 *
 * The layout is horizontal, eight columns, because the drawer is wide and
 * shallow: on a projector that reads far better than eight stacked rows in a
 * 560px panel.
 *
 * TWO BANDS
 *
 * Engine A occupies the band above the spine and out to the right; engine B hangs
 * below it, forking at the ALB exactly where the deployed listener forks. Both are
 * always drawn — the drawer shades the one you are not looking at rather than
 * unmounting it, because a box that vanishes reads as "we removed that" instead of
 * "that is the other engine".
 *
 * ONE SHARED COLUMN
 *
 * The last column is neither band's. DynamoDB and the eight provider APIs are the
 * *same* resources on both engines — see `aws-architecture.ts` — so they are drawn
 * once, at x = `SHARED_COLUMN_X`, with both bands converging on them. An earlier
 * version gave engine B its own copy of each, which read as two databases and
 * undercut the whole point of the comparison.
 *
 * The cost of drawing them once is the far-right gutter: the 24px lane between the
 * tool Lambdas and the shared column carries engine B's climb from
 * `ac-lambda-tools` up to the provider APIs, and the three links that arrive at the
 * shared cards' left edges cross it at right angles. Those crossings are the price
 * of a single shared node, and they are the cheaper half of the trade.
 */

/**
 * Canvas the connectors are drawn on. Node cards are positioned in the same space.
 *
 * Grew from 916×286 to hold engine B, then to 1656 wide for the tool Lambdas and
 * the shared column beyond them. Height is unchanged: engine B's band still ends
 * at 471, and height is the scarce dimension in a drawer.
 */
export const AWS_DIAGRAM_CANVAS = { width: 1656, height: 480 } as const;

/**
 * Every node card, at exactly one size.
 *
 * ONE constant, not a per-node width, and that is the point. The cards used to
 * carry their own widths (146–192) and to take their height from their contents,
 * which produced a wall of boxes that were all *nearly* the same — thirteen
 * slightly different rectangles read as a rendering fault, and on a projector the
 * eye spends its first second on the ragged edges instead of on the topology.
 * Content-sized heights were the worse half: a card grew when its duration pill
 * arrived, so the grid moved *during* a demo.
 *
 * The size is derived from the widest thing each row has to hold, and the model's
 * captions are kept inside it (see `aws-architecture.ts`):
 *   186px wide  → 139px of text once the icon, gap and padding are taken out,
 *                 which fits `d26dwovftfq9oe.cloudfront.net` at 9.5px.
 *   90px tall   → a two-line service name, one line of resource name, one line of
 *                 caption, and a reserved 16px footer for the WAF chip or the
 *                 duration pill. Reserved rather than grown into, so a pill
 *                 arriving mid-turn changes nothing about the layout.
 *
 * `AwsTopologyDiagram` clips to this box and clamps each row, so a caption someone
 * lengthens later is truncated — visibly, in one card — instead of spilling over
 * its neighbour the way the AgentCore column used to.
 */
export const AWS_NODE_CARD = { width: 186, height: 90 } as const;

/**
 * Horizontal distance between column starts.
 *
 * `AWS_NODE_CARD.width` plus 24px of connector, which is what makes every link in
 * the diagram exactly as long as every other link on its row.
 */
export const AWS_COLUMN_PITCH = 210;

/**
 * How far the whole canvas is scaled down when rendered.
 *
 * The drawer's height is fixed and reserved by the layout, so a taller diagram has
 * to shrink rather than push the composer off screen. Scaling the canvas keeps one
 * set of coordinates — every geometry test, arrowhead and chevron stays valid at
 * any scale, which a second set of "compact" numbers would not.
 *
 * 0.6 puts 1656×480 at 994×288 — 61px wider and 22px shorter than the 933×310 it
 * replaces, which keeps the flow feed beside it the width it had. Down from 0.645
 * because the canvas grew by a column and a half and the alternative was a diagram
 * the drawer had to scroll; a presenter scrolling to find a box mid-sentence is
 * worse than half a point of type.
 */
export const AWS_DIAGRAM_SCALE = 0.6;

/**
 * The shared vertical centre of Browser, CloudFront, ALB, Fargate and the external
 * APIs.
 *
 * The first four are the request's spine and sit in a straight line; S3 and Bedrock
 * branch up off it, and the spine then carries straight on out of the VPC, past
 * everything, to the provider APIs in the shared column. Keeping it straight is the
 * reason the diagram reads left-to-right at a glance, and the reason engine A's
 * direct call to Ontopo or Spotify is the one line in the picture that never bends.
 */
export const AWS_DIAGRAM_SPINE_Y = 152;

/**
 * The column both engines reach: DynamoDB and the provider APIs.
 *
 * Its own constant because it is asserted against and because it is the load-bearing
 * fact of this layout — one column, no engine, two sets of arrows into it. See the
 * header note and `PARENT_BY_ENGINE` in `aws-architecture.ts`.
 */
export const SHARED_COLUMN_X = 1470;

/**
 * A node card's top-left corner on the canvas.
 *
 * Position only: every card is `AWS_NODE_CARD` in size, so a per-node width or
 * height here would be a second, disagreeing source of truth for the thing the
 * layout most needs to be uniform.
 */
export interface AwsNodeBox {
  x: number;
  top: number;
}

/**
 * Per-node position, on a strict grid.
 *
 * Columns are multiples of `AWS_COLUMN_PITCH`; rows are placed so that a card
 * either sits centred on its band's spine or clears the card above it by 15–17px.
 * Both facts are asserted in `aws-diagram-layout.test.ts` — including that no two
 * cards overlap, which is the failure this replaced: the AgentCore column's boxes
 * were 60px apart while the cards themselves were taller than that, so Memory's
 * caption ran through the Gateway's title.
 */
export const AWS_NODE_BOXES: Readonly<Record<AwsNodeId, AwsNodeBox>> = {
  browser: { x: 0, top: 107 },
  cloudfront: { x: 210, top: 107 },
  s3: { x: 420, top: 0 },
  alb: { x: 420, top: 107 },
  fargate: { x: 630, top: 107 },
  // Bedrock branches up off the spine. It used to be half of an AI/Data pair with
  // DynamoDB below it; the table is shared now and lives in the last column, so
  // this column holds the one service only engine A calls.
  bedrock: { x: 840, top: 55 },
  // Engine B's band. `ac-proxy` sits in the same column as `fargate` and inside
  // the same VPC box, which is the point: one image, one task size, two services.
  'ac-proxy': { x: 630, top: 381 },
  'ac-runtime': { x: 840, top: 381 },
  // Memory branches up off engine B's spine; the Gateway stays on it, so the
  // longest chain — proxy, Runtime, Gateway, Lambda — reads as one straight line.
  'ac-memory': { x: 1050, top: 274 },
  'ac-gateway': { x: 1050, top: 381 },
  // The two Lambdas the Gateway fronts. Both outside the AgentCore box (which ends
  // at x=1246), and that is the point of where they sit: the Gateway is managed, the
  // functions behind it are ours, and the room can see the boundary.
  //
  // `ac-lambda-tools` holds engine B's spine so the Gateway→Lambda→provider chain
  // stays one straight run. `ac-lambda-profile` branches up off it — and its top is
  // chosen so its centre (295) lands on the shared table's left edge, which is what
  // lets the agent's own write to DynamoDB be drawn as a straight line rather than
  // a third elbow into an already busy card.
  'ac-lambda-profile': { x: 1260, top: 250 },
  'ac-lambda-tools': { x: 1260, top: 381 },
  // The shared column. Neither dashed box contains it and neither engine owns it:
  // the provider APIs ride engine A's spine (so engine A's direct call is the flat
  // line), and the table sits just below them, reached by three separate arrows —
  // engine A's Fargate task, engine B's proxy, and engine B's profile Lambda.
  integrations: { x: SHARED_COLUMN_X, top: 107 },
  dynamodb: { x: SHARED_COLUMN_X, top: 212 },
};

/** Column heading above each tier. */
export interface AwsTierLabel {
  label: string;
  x: number;
  /**
   * Show this heading only on one engine.
   *
   * Absent means "true of both", which is the case for the four columns the request
   * shares and — deliberately — for the shared column at the far right. Only the
   * columns the two engines fill differently are scoped.
   */
  engine?: ArchitectureEngine;
}

export const AWS_TIER_LABELS: readonly AwsTierLabel[] = [
  { label: 'Client', x: 0 },
  { label: 'Edge', x: 210 },
  { label: 'Origin', x: 420 },
  { label: 'Compute', x: 630 },
  // One column, two meanings: engine A calls Bedrock itself, engine B hands the
  // turn to a Runtime. A shared heading would have to be wrong on one of them.
  { label: 'Model', x: 840, engine: 'valentin' },
  { label: 'Runtime', x: 840, engine: 'agentcore' },
  // Nothing of engine A's is in these two columns, so they carry no engine-A label.
  { label: 'Memory · Gateway', x: 1050, engine: 'agentcore' },
  { label: 'Tool Lambdas', x: 1260, engine: 'agentcore' },
  // Unscoped, and that is the whole message of the column: the same table and the
  // same eight APIs, whichever engine is answering.
  { label: 'Shared data & APIs', x: SHARED_COLUMN_X },
] as const;

/**
 * The dashed box drawn around the resources inside `valentin-vpc-dev`.
 *
 * Tall enough to hold both Fargate services. They share the VPC, the subnets and
 * the image; drawing one inside the boundary and one outside it would invent a
 * difference the deployment does not have.
 */
export const AWS_VPC_BOX = {
  left: 620,
  top: 97,
  width: 206,
  height: 384,
  label: 'valentin-vpc-dev · 2 AZ',
} as const;

/**
 * The dashed box around the Bedrock AgentCore primitives.
 *
 * Drawn because the boundary is the argument: Runtime, Memory and Gateway are
 * managed, so what is inside this box is the code we did not write. `ac-dynamodb`
 * is deliberately outside it — the table is ours, and the Gateway reaches it
 * through a Lambda we own.
 *
 * Its top clears engine A's lowest card by 15px. It used to start at y=228, which
 * was *inside* the DynamoDB card above it, so the box's label sat on top of that
 * card's title — the collision in the review screenshot.
 */
export const AGENTCORE_BOX = {
  left: 830,
  top: 264,
  width: 416,
  height: 217,
  label: 'Amazon Bedrock AgentCore',
} as const;

/** A caption naming one engine's band, placed in the empty space on the left. */
export interface AwsEngineBand {
  engine: ArchitectureEngine;
  label: string;
  /** The deployed service that runs this engine. */
  sub: string;
  x: number;
  top: number;
  width: number;
}

/**
 * Band captions.
 *
 * They sit in the column below the browser, which is otherwise dead space, and
 * they are the thing that makes the two halves legible without a legend: one row
 * says engine A, the other says engine B, and the toggle says which one you are
 * looking at.
 */
export const AWS_ENGINE_BANDS: readonly AwsEngineBand[] = [
  {
    engine: 'valentin',
    // "Glue code" is the same word the rail's engine switch uses, deliberately:
    // one name for one thing, so the control and the band agree.
    label: 'Engine A · glue code',
    sub: 'AGENT_ENGINE=valentin',
    x: 0,
    top: 40,
    width: AWS_NODE_CARD.width,
  },
  {
    engine: 'agentcore',
    label: 'Engine B · AgentCore',
    sub: 'AGENT_ENGINE=agentcore',
    x: 0,
    top: 381,
    width: AWS_NODE_CARD.width,
  },
] as const;

/**
 * A connector's drawn form.
 *
 * Every link carries FOUR arrowheads on the elbowed ones and two on the
 * straight ones, and the reason is a bug found on a projector rather than a
 * flourish. On `cloudfront-s3`, `fargate-bedrock` and `fargate-dynamodb` the
 * longest visible run is the vertical leg out to the far resource, while the
 * only arrowhead sat ~60px away at the spine end. The eye follows the long run,
 * so a *response* coming back from DynamoDB still read as travelling outward —
 * the direction looked wrong even though the model, the marching dashes and the
 * arrowhead were each individually correct.
 *
 * `midDownstreamHead`/`midUpstreamHead` are chevrons placed **on** that vertical
 * leg, stating the direction where the eye actually is. Straight links don't
 * have the problem and deliberately don't get them.
 */
export interface AwsSegmentGeometry {
  id: AwsSegmentId;
  /** SVG path, drawn parent → child. */
  path: string;
  /** Arrowhead at the child end, pointing away from the browser. */
  downstreamHead: string;
  /** Arrowhead at the parent end, pointing back toward the browser. */
  upstreamHead: string;
  /** True when the path bends, and therefore carries mid-leg chevrons. */
  elbowed: boolean;
  /** Chevron on the long leg, pointing away from the browser. */
  midDownstreamHead?: string;
  /** Chevron on the long leg, pointing back toward the browser. */
  midUpstreamHead?: string;
}

export const AWS_SEGMENT_GEOMETRY: Readonly<Record<AwsSegmentId, AwsSegmentGeometry>> = {
  'browser-cloudfront': {
    id: 'browser-cloudfront',
    path: 'M186,152 L204,152',
    downstreamHead: '210,152 201,146 201,158',
    upstreamHead: '186,152 195,146 195,158',
    elbowed: false,
  },
  'cloudfront-s3': {
    id: 'cloudfront-s3',
    path: 'M396,152 L408,152 L408,45 L414,45',
    downstreamHead: '420,45 411,39 411,51',
    upstreamHead: '396,152 405,146 405,158',
    elbowed: true,
    // S3 sits above the spine, so "away from the browser" points up.
    midDownstreamHead: '408,92 402,101 414,101',
    midUpstreamHead: '408,106 402,97 414,97',
  },
  'cloudfront-alb': {
    id: 'cloudfront-alb',
    path: 'M396,152 L414,152',
    downstreamHead: '420,152 411,146 411,158',
    upstreamHead: '396,152 405,146 405,158',
    elbowed: false,
  },
  'alb-fargate': {
    id: 'alb-fargate',
    path: 'M606,152 L624,152',
    downstreamHead: '630,152 621,146 621,158',
    upstreamHead: '606,152 615,146 615,158',
    elbowed: false,
  },
  'fargate-bedrock': {
    id: 'fargate-bedrock',
    path: 'M816,152 L828,152 L828,100 L834,100',
    downstreamHead: '840,100 831,94 831,106',
    upstreamHead: '816,152 825,146 825,158',
    elbowed: true,
    // Bedrock is above the spine: outbound points up, the return points down.
    midDownstreamHead: '828,116 822,125 834,125',
    midUpstreamHead: '828,130 822,121 834,121',
  },
  /*
   * Engine A's own reads and writes of the shared table.
   *
   * Drops out of the spine at x=828 — two pixels clear of the VPC box's right edge,
   * so the boundary is crossed on the horizontal run rather than smeared along it —
   * then takes the corridor at y=226 all the way to the shared column. The corridor
   * matters: below y=264 this line would run straight through the AgentCore box and
   * appear to be managed by a service engine A does not use.
   *
   * Below the spine, so this is the leg that carries the chevron pair which is easy
   * to get backwards — see the note above, and the assertion in the tests.
   */
  'fargate-dynamodb': {
    id: 'fargate-dynamodb',
    path: 'M816,152 L828,152 L828,226 L1464,226',
    downstreamHead: '1470,226 1461,220 1461,232',
    upstreamHead: '816,152 825,146 825,158',
    elbowed: true,
    // The table is below the spine, so the chevrons are the other way up from
    // Bedrock's. Getting this pair backwards is exactly the bug above.
    midDownstreamHead: '828,196 822,187 834,187',
    midUpstreamHead: '828,186 822,195 834,195',
  },

  // --- Engine B. Forks at the ALB and runs along its own spine at y=426. ---
  'alb-ac-proxy': {
    id: 'alb-ac-proxy',
    // Leaves the ALB at x=614, six pixels clear of the VPC box's left edge (620),
    // so the drop into engine B's band does not run down inside the boundary.
    path: 'M606,152 L614,152 L614,426 L624,426',
    downstreamHead: '630,426 621,420 621,432',
    upstreamHead: '606,152 615,146 615,158',
    elbowed: true,
    // The long leg is the 274px drop, which is where the eye goes.
    midDownstreamHead: '614,295 608,286 620,286',
    midUpstreamHead: '614,283 608,292 620,292',
  },
  'ac-proxy-ac-runtime': {
    id: 'ac-proxy-ac-runtime',
    path: 'M816,426 L834,426',
    downstreamHead: '840,426 831,420 831,432',
    upstreamHead: '816,426 825,420 825,432',
    elbowed: false,
  },
  'ac-runtime-ac-memory': {
    id: 'ac-runtime-ac-memory',
    path: 'M1026,426 L1038,426 L1038,319 L1044,319',
    downstreamHead: '1050,319 1041,313 1041,325',
    upstreamHead: '1026,426 1035,420 1035,432',
    elbowed: true,
    // Memory sits above engine B's spine, so away-from-the-browser is up here —
    // the mirror image of `fargate-dynamodb`, and the same pair to get backwards.
    midDownstreamHead: '1038,366 1032,375 1044,375',
    midUpstreamHead: '1038,380 1032,371 1044,371',
  },
  'ac-runtime-ac-gateway': {
    id: 'ac-runtime-ac-gateway',
    path: 'M1026,426 L1044,426',
    downstreamHead: '1050,426 1041,420 1041,432',
    upstreamHead: '1026,426 1035,420 1035,432',
    elbowed: false,
  },
  /*
   * The Runtime's Bedrock call, drawn as a fact rather than a route the drawer will
   * animate live.
   *
   * The call happens inside AWS's managed AgentCore Runtime on the Runtime's own
   * role — the proxy has no `bedrock:InvokeModel` and cannot observe a span for
   * this hop — but the model is the same Sonnet 4.5 engine A talks to directly.
   * Naming Bedrock on both engines is the honest answer for the room; before this
   * segment existed the diagram dimmed Bedrock on engine B, which read as "not
   * used".
   *
   * The path leaves the AgentCore box at x=1044 (four pixels clear of the box's
   * `left+width=1246`, so the escape run reads as leaving the managed boundary
   * rather than travelling inside it), climbs to the bedrock row at y=130 (the
   * bottom of the bedrock card, deliberately below fargate-bedrock's y=100 so
   * the two arrows do not overlap on bedrock's left edge), then runs left back
   * to bedrock. Live traffic never animates it — the Runtime card's caption
   * names the model in the visual instead.
   */
  'ac-runtime-bedrock': {
    id: 'ac-runtime-bedrock',
    path: 'M1026,426 L1044,426 L1044,130 L834,130',
    downstreamHead: '840,130 831,124 831,136',
    upstreamHead: '1026,426 1035,420 1035,432',
    elbowed: true,
    // Bedrock sits above the AgentCore box: away-from-the-browser is up here —
    // the same pair as `ac-runtime-ac-memory`, just longer.
    midDownstreamHead: '1044,270 1038,279 1050,279',
    midUpstreamHead: '1044,285 1038,276 1050,276',
  },
  // The integration tool Lambda holds engine B's spine, so this is the one straight
  // link in the Gateway's column — 26 tools behind one MCP target.
  'ac-gateway-ac-lambda-tools': {
    id: 'ac-gateway-ac-lambda-tools',
    path: 'M1236,426 L1254,426',
    downstreamHead: '1260,426 1251,420 1251,432',
    upstreamHead: '1236,426 1245,420 1245,432',
    elbowed: false,
  },
  'ac-gateway-ac-lambda-profile': {
    id: 'ac-gateway-ac-lambda-profile',
    // Rises at x=1248, two pixels outside the AgentCore box, so the climb reads as
    // leaving the managed boundary rather than travelling inside it.
    path: 'M1236,426 L1248,426 L1248,295 L1254,295',
    downstreamHead: '1260,295 1251,289 1251,301',
    upstreamHead: '1236,426 1245,420 1245,432',
    elbowed: true,
    // The profile Lambda sits above engine B's spine, so away-from-the-browser is up
    // — the same pair as `ac-runtime-ac-memory` one column to the left.
    midDownstreamHead: '1248,350 1242,359 1254,359',
    midUpstreamHead: '1248,360 1242,351 1254,351',
  },
  /*
   * Engine B's provider calls, which is the contrast the whole picture exists for.
   *
   * Engine A's link to the same card is flat and 648px long; this one climbs 250px
   * up the far-right gutter from a Lambda behind a Gateway to reach it. Two routes,
   * one set of APIs — and the reason engine B needs the tool Lambda at all is that
   * it is where the provider keys live.
   */
  'ac-lambda-tools-integrations': {
    id: 'ac-lambda-tools-integrations',
    path: 'M1446,426 L1456,426 L1456,176 L1464,176',
    downstreamHead: '1470,176 1461,170 1461,182',
    upstreamHead: '1446,426 1455,420 1455,432',
    elbowed: true,
    midDownstreamHead: '1456,296 1450,305 1462,305',
    midUpstreamHead: '1456,306 1450,297 1462,297',
  },
  /*
   * Engine B's proxy reading and writing the same table engine A does.
   *
   * This is why a profile survives an engine switch: the proxy owns sessions, the
   * transcript and the preference mirror directly, in the same rows. It climbs at
   * x=822 — inside the VPC, which is honest, since the proxy is — and crosses the
   * boundary on the horizontal run at y=252, which is what the segment's
   * "VPC gateway endpoint" label names.
   */
  'ac-proxy-dynamodb': {
    id: 'ac-proxy-dynamodb',
    path: 'M816,426 L822,426 L822,252 L1464,252',
    downstreamHead: '1470,252 1461,246 1461,258',
    upstreamHead: '816,426 825,420 825,432',
    elbowed: true,
    // The table is above engine B's band, so away-from-the-browser is up here.
    midDownstreamHead: '822,330 816,339 828,339',
    midUpstreamHead: '822,340 816,331 828,331',
  },
  /*
   * The agent's own writes: `save_preference` inside the profile Lambda.
   *
   * DRAWN AND NEVER ROUTED, deliberately. The Lambda logs to CloudWatch and emits no
   * span the drawer can see, so no flow will ever animate this line — but leaving it
   * out would say the agent's own memory writes land somewhere else, which is the
   * false half of the story this column was rebuilt to tell.
   *
   * Straight, which is why `ac-lambda-profile` sits where it does: its centre is on
   * the table's left edge. A third elbow into an already busy card would have been
   * the only alternative.
   */
  'ac-lambda-profile-dynamodb': {
    id: 'ac-lambda-profile-dynamodb',
    path: 'M1446,295 L1464,295',
    downstreamHead: '1470,295 1461,289 1461,301',
    upstreamHead: '1446,295 1455,289 1455,301',
    elbowed: false,
  },
  'fargate-integrations': {
    id: 'fargate-integrations',
    // Straight, all 648px of it, passing under Bedrock with 7px to spare: engine A's
    // spine continuing out of the VPC and calling Ontopo itself. The flatness is the
    // argument — there is nothing between the task and the provider.
    path: 'M816,152 L1464,152',
    downstreamHead: '1470,152 1461,146 1461,158',
    upstreamHead: '816,152 825,146 825,158',
    elbowed: false,
  },
};

/**
 * Engine B's spine, the y its four in-line resources share.
 *
 * Named for the same reason `AWS_DIAGRAM_SPINE_Y` is: it is asserted against, and
 * a band that drifted a few pixels out of line would look like a rendering bug.
 */
export const AGENTCORE_SPINE_Y = 426;

export function awsSegmentGeometry(id: AwsSegmentId): AwsSegmentGeometry {
  return AWS_SEGMENT_GEOMETRY[id];
}

/** The links that bend, and therefore need the mid-leg direction cue. */
export const ELBOWED_SEGMENTS: readonly AwsSegmentId[] = Object.values(AWS_SEGMENT_GEOMETRY)
  .filter((segment) => segment.elbowed)
  .map((segment) => segment.id);

/**
 * Marching ants. Downstream runs the dashes away from the browser, upstream runs
 * them back — the offsets are equal and opposite, which is the whole trick.
 */
export const MARCHING_ANTS = {
  dashArray: '7 5',
  durationMs: 600,
  downstreamOffset: -24,
  upstreamOffset: 24,
} as const;

/** Colours for the traffic itself. Claret is a request, teal is a response. */
export const FLOW_COLORS = {
  request: '#8C2F45',
  response: '#0E9B84',
  idle: '#E5D9D2',
} as const;

/**
 * Category colours, taken from AWS's own service-group palette so a builder in
 * the room recognises them without a legend.
 */
export const AWS_CATEGORY_COLORS = {
  network: '#8C4FFF',
  storage: '#7AA116',
  compute: '#ED7100',
  ml: '#01A88D',
  database: '#527FFF',
  // Not from AWS's palette, because this one is not an AWS service. Valentin's
  // own claret, so a builder reading the colours sees at a glance that this call
  // left the account.
  external: '#8C2F45',
} as const;

export type AwsCategory = keyof typeof AWS_CATEGORY_COLORS;

/** How a node's icon tile is drawn: a filled tile plus a stroked glyph. */
export interface AwsNodeVisual {
  /** CSS background for the 26px tile. */
  tile: string;
  /** Inner SVG markup for the glyph, stroked white on a 24×24 viewBox. */
  glyph: string;
}

export const AWS_NODE_VISUALS: Readonly<Record<AwsNodeId, AwsNodeVisual>> = {
  browser: {
    tile: '#232F3E',
    glyph: '<rect x="2.5" y="4" width="19" height="13" rx="1.5" /><path d="M8 20h8M12 17v3" />',
  },
  cloudfront: {
    tile: 'linear-gradient(135deg,#A16BFF,#8C4FFF)',
    glyph:
      '<circle cx="12" cy="12" r="8.2" /><ellipse cx="12" cy="12" rx="3.4" ry="8.2" /><path d="M3.9 9.4h16.2M3.9 14.6h16.2" />',
  },
  s3: {
    tile: 'linear-gradient(135deg,#8FBF2A,#7AA116)',
    glyph:
      '<path d="M4.5 5.5h15l-1.7 13a1.4 1.4 0 0 1-1.4 1.2H7.6a1.4 1.4 0 0 1-1.4-1.2L4.5 5.5Z" /><path d="M3.4 5.5h17.2" />',
  },
  alb: {
    tile: 'linear-gradient(135deg,#A16BFF,#8C4FFF)',
    glyph:
      '<circle cx="5" cy="12" r="2.1" /><circle cx="19" cy="6.5" r="2.1" /><circle cx="19" cy="17.5" r="2.1" /><path d="M7.1 11.2 16.9 7.2M7.1 12.8l9.8 4" />',
  },
  fargate: {
    tile: 'linear-gradient(135deg,#FF9A3E,#ED7100)',
    glyph:
      '<rect x="3" y="3.5" width="7.5" height="7.5" rx="1" /><rect x="13.5" y="3.5" width="7.5" height="7.5" rx="1" /><rect x="3" y="13" width="7.5" height="7.5" rx="1" /><rect x="13.5" y="13" width="7.5" height="7.5" rx="1" />',
  },
  bedrock: {
    tile: 'linear-gradient(135deg,#21C8AC,#01A88D)',
    glyph:
      '<path d="M12 3 3.2 7.6 12 12.2l8.8-4.6L12 3Z" /><path d="M3.2 12.3 12 16.9l8.8-4.6M3.2 16.6 12 21.2l8.8-4.6" />',
  },
  dynamodb: {
    tile: 'linear-gradient(135deg,#7A9DFF,#527FFF)',
    glyph:
      '<ellipse cx="12" cy="5.8" rx="7.4" ry="2.9" /><path d="M4.6 5.8v12.4c0 1.6 3.3 2.9 7.4 2.9s7.4-1.3 7.4-2.9V5.8" /><path d="M4.6 12c0 1.6 3.3 2.9 7.4 2.9s7.4-1.3 7.4-2.9" />',
  },
  integrations: {
    // Claret rather than an AWS service gradient: this card is Ontopo and Meta,
    // not a service the account is billed for, and the colour is the fastest way
    // to say so on a projector.
    tile: 'linear-gradient(135deg,#B8536B,#8C2F45)',
    // An arrow leaving an open-sided box — the request departing the VPC. A globe
    // would have been the obvious choice and is already CloudFront's.
    glyph:
      '<path d="M13.5 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h7.5" /><path d="M10.5 12h10M17 8.2l3.5 3.8-3.5 3.8" />',
  },
  // Engine B. The proxy borrows Fargate's tile because it *is* Fargate; the three
  // AgentCore primitives share the Bedrock teal because that is the service they
  // belong to, and differ by glyph.
  'ac-proxy': {
    tile: 'linear-gradient(135deg,#FF9A3E,#ED7100)',
    glyph:
      '<rect x="3" y="3.5" width="7.5" height="7.5" rx="1" /><rect x="13.5" y="3.5" width="7.5" height="7.5" rx="1" /><rect x="3" y="13" width="7.5" height="7.5" rx="1" /><rect x="13.5" y="13" width="7.5" height="7.5" rx="1" />',
  },
  'ac-runtime': {
    tile: 'linear-gradient(135deg,#21C8AC,#01A88D)',
    // A running box: the managed container the agent code lives in.
    glyph:
      '<rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M9 9.5l3 2.5-3 2.5M13.5 14.5h3" />',
  },
  'ac-memory': {
    tile: 'linear-gradient(135deg,#21C8AC,#01A88D)',
    // Concentric arcs: something recalled rather than something stored.
    glyph:
      '<circle cx="12" cy="12" r="3" /><path d="M12 4.2a7.8 7.8 0 0 1 7.8 7.8M12 19.8A7.8 7.8 0 0 1 4.2 12" />',
  },
  'ac-gateway': {
    tile: 'linear-gradient(135deg,#21C8AC,#01A88D)',
    // A doorway with traffic through it.
    glyph:
      '<path d="M5 20V6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V20" /><path d="M3 20h18M9.5 12.5h5M12.5 10l2.5 2.5-2.5 2.5" />',
  },
  // The two Gateway targets. Lambda orange rather than the AgentCore teal above,
  // and that is the point of the colour: these are our own functions, in our own
  // account, holding our own credentials. The Gateway routes to them; it does not
  // contain them, which is also why they sit outside the dashed AgentCore box.
  'ac-lambda-profile': {
    tile: 'linear-gradient(135deg,#FF9A3E,#ED7100)',
    glyph: '<path d="M7 4.5 L16.5 19.5" /><path d="M12.2 12 L6.5 19.5" />',
  },
  'ac-lambda-tools': {
    tile: 'linear-gradient(135deg,#FF9A3E,#ED7100)',
    glyph: '<path d="M7 4.5 L16.5 19.5" /><path d="M12.2 12 L6.5 19.5" />',
  },
};

/**
 * Where the provider logos sit relative to the shared External APIs card.
 *
 * Above it, not below, and that is forced rather than chosen: DynamoDB is the very
 * next card down the shared column with only 15px between them, and the card's own
 * footer row is reserved for the duration pill. Above is the only free space.
 *
 * Eight marks at 16px with 2px gaps is 142px, so centring inside the 186px card is
 * an inset of (186 − 142) / 2 = 22 — written as the sum so it stays centred if the
 * card width or the provider count ever changes.
 */
export const AWS_PROVIDER_STRIP = {
  x: SHARED_COLUMN_X + 22,
  top: 82,
  markSize: 16,
  gap: 2,
} as const;

/**
 * The panel listing the Gateway's registered tool entry points.
 *
 * Placed in the empty bottom-left quarter, which is the only region wide enough to
 * hold 26 names: it clears the browser card (bottom 197), engine B's band label
 * (top 381) and the `alb-ac-proxy` vertical at x=614. Greyed out on engine A,
 * because on that engine no such registration exists — the tools are described to
 * Bedrock in-process, on every turn.
 */
export const AWS_TOOL_PANEL = { x: 0, top: 214, width: 600, height: 152 } as const;

/** The one extra badge worth projecting: the WAF rule in front of CloudFront. */
export const WAF_CHIP_LABEL = 'AWS WAF · 2000 req/IP';
