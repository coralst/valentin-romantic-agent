import type { ArchitectureEngine, AwsNodeId, AwsSegmentId } from './aws-architecture';

/**
 * Where every box, connector and arrowhead sits in the architecture drawer.
 *
 * Separate from `aws-architecture.ts` on purpose: that file says what the
 * topology *is*, this one says how it is drawn. The component then holds no
 * magic numbers, which is what makes the geometry testable — an arrowhead
 * pointing the wrong way is an assertion, not a screenshot review.
 *
 * The layout is horizontal, seven columns, because the drawer is wide and
 * shallow: on a projector that reads far better than seven stacked rows in a
 * 560px panel.
 *
 * TWO BANDS
 *
 * Engine A occupies the band above the spine and out to the right; engine B hangs
 * below it, forking at the ALB exactly where the deployed listener forks. Both are
 * always drawn — the drawer shades the one you are not looking at rather than
 * unmounting it, because a box that vanishes reads as "we removed that" instead of
 * "that is the other engine".
 */

/**
 * Canvas the connectors are drawn on. Node cards are positioned in the same space.
 *
 * Grew from 916×286 to hold engine B. The extra width is two columns for the
 * Gateway and the table it reaches; the extra height is engine B's band.
 */
export const AWS_DIAGRAM_CANVAS = { width: 1446, height: 480 } as const;

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
 * 0.645 puts 1446×480 at 933×310, which is the space the drawer actually has
 * beside the flow feed. Down from 0.74 because uniform cards are wider than the
 * narrowest of the old ones; the trade is deliberate — slightly smaller type in
 * exchange for a grid that lines up and never clips.
 */
export const AWS_DIAGRAM_SCALE = 0.645;

/**
 * The shared vertical centre of Browser, CloudFront, ALB, Fargate and DynamoDB.
 *
 * The first four are the request's spine and sit in a straight line; S3 branches
 * up off it, the AI/Data pair straddles it — Bedrock above, DynamoDB below — and
 * the spine then carries straight on out of the VPC to the external APIs. Keeping
 * it straight is the reason the diagram reads left-to-right at a glance.
 *
 * The integrations card used to be a third card stacked under DynamoDB. Engine B's
 * band claimed that space, so it took a column of its own on the spine instead,
 * which is both cheaper in height — the scarce dimension, with the drawer 424px
 * tall — and truer: the request really does leave the VPC and keep going.
 */
export const AWS_DIAGRAM_SPINE_Y = 152;

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
  // Bedrock above the spine, DynamoDB below it, centred on it as a pair.
  bedrock: { x: 840, top: 55 },
  dynamodb: { x: 840, top: 159 },
  // Engine B's band. `ac-proxy` sits in the same column as `fargate` and inside
  // the same VPC box, which is the point: one image, one task size, two services.
  'ac-proxy': { x: 630, top: 381 },
  'ac-runtime': { x: 840, top: 381 },
  // Memory branches up off engine B's spine; the Gateway stays on it, so the
  // longest chain — proxy, Runtime, Gateway, table — reads as one straight line.
  'ac-memory': { x: 1050, top: 274 },
  'ac-gateway': { x: 1050, top: 381 },
  'ac-dynamodb': { x: 1260, top: 381 },
  // The external APIs. Engine A only, and outside both dashed boxes on purpose:
  // it is neither in the VPC nor managed by AgentCore. Sits on engine A's spine
  // in the column the Gateway uses on engine B, which is why the column heading
  // is engine-scoped rather than shared.
  integrations: { x: 1050, top: 107 },

};

/** Column heading above each tier. */
export interface AwsTierLabel {
  label: string;
  x: number;
  /**
   * Show this heading only on one engine.
   *
   * Absent means "true of both", which is the case for every column up to the
   * AI/Data pair. Only the columns the two engines fill differently are scoped.
   */
  engine?: ArchitectureEngine;
}

export const AWS_TIER_LABELS: readonly AwsTierLabel[] = [
  { label: 'Client', x: 0 },
  { label: 'Edge', x: 210 },
  { label: 'Origin', x: 420 },
  { label: 'Compute', x: 630 },
  { label: 'AI · Data', x: 840 },
  // One column, two meanings. On engine A it holds the external APIs; on engine B
  // it holds the Gateway. A shared heading would have to be wrong on one of them.
  { label: 'External APIs', x: 1050, engine: 'valentin' },
  { label: 'AgentCore', x: 1050, engine: 'agentcore' },
  { label: 'Tool target', x: 1260, engine: 'agentcore' },

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
  // Below the spine, so this is the leg that carries the chevron pair which is
  // easy to get backwards — see the note above, and the assertion in the tests.
  'fargate-dynamodb': {
    id: 'fargate-dynamodb',
    path: 'M816,152 L828,152 L828,204 L834,204',
    downstreamHead: '840,204 831,198 831,210',
    upstreamHead: '816,152 825,146 825,158',
    elbowed: true,
    // DynamoDB is below the spine, so the chevrons are the other way up from
    // Bedrock's. Getting this pair backwards is exactly the bug above.
    midDownstreamHead: '828,184 822,175 834,175',
    midUpstreamHead: '828,174 822,183 834,183',
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
  'ac-gateway-ac-dynamodb': {
    id: 'ac-gateway-ac-dynamodb',
    path: 'M1236,426 L1254,426',
    downstreamHead: '1260,426 1251,420 1251,432',
    upstreamHead: '1236,426 1245,420 1245,432',
    elbowed: false,  },
  'fargate-integrations': {
    id: 'fargate-integrations',
    // Straight, and it threads the 14px gap between the Bedrock and DynamoDB
    // cards: engine A's spine continuing out of the VPC rather than a new line.
    path: 'M816,152 L1044,152',
    downstreamHead: '1050,152 1041,146 1041,158',
    upstreamHead: '816,152 825,146 825,158',
    elbowed: false
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
  'ac-dynamodb': {
    tile: 'linear-gradient(135deg,#7A9DFF,#527FFF)',
    glyph:
      '<ellipse cx="12" cy="5.8" rx="7.4" ry="2.9" /><path d="M4.6 5.8v12.4c0 1.6 3.3 2.9 7.4 2.9s7.4-1.3 7.4-2.9V5.8" /><path d="M4.6 12c0 1.6 3.3 2.9 7.4 2.9s7.4-1.3 7.4-2.9" />',
  },
};

/** The one extra badge worth projecting: the WAF rule in front of CloudFront. */
export const WAF_CHIP_LABEL = 'AWS WAF · 2000 req/IP';
