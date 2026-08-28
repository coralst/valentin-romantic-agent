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
export const AWS_DIAGRAM_CANVAS = { width: 1250, height: 392 } as const;

/**
 * How far the whole canvas is scaled down when rendered.
 *
 * The drawer's height is fixed and reserved by the layout, so a taller diagram has
 * to shrink rather than push the composer off screen. Scaling the canvas keeps one
 * set of coordinates — every geometry test, arrowhead and chevron stays valid at
 * any scale, which a second set of "compact" numbers would not.
 *
 * 0.74 puts 1250×392 at 925×290, which is the space the drawer actually has beside
 * the flow feed and a hair narrower than the old 916px diagram.
 */
export const AWS_DIAGRAM_SCALE = 0.74;

/**
 * The shared vertical centre of Browser, CloudFront, ALB and Fargate.
 *
 * Those four are the request's spine and sit in a straight line; S3 branches up
 * off it, Bedrock and DynamoDB fan out to the right. Keeping the spine straight
 * is the reason the diagram reads left-to-right at a glance.
 */
export const AWS_DIAGRAM_SPINE_Y = 154;

/** A node card's position and width on the canvas. */
export interface AwsNodeBox {
  x: number;
  top: number;
  width: number;
}

/**
 * Per-node geometry.
 *
 * CloudFront is widest (190px) because it carries the WAF chip; the rest sit at
 * 146–168. Tops are set from measured card heights rather than a shared grid,
 * since the cards differ in height: S3 has to clear the ALB below it and Bedrock
 * has to clear DynamoDB.
 */
export const AWS_NODE_BOXES: Readonly<Record<AwsNodeId, AwsNodeBox>> = {
  browser: { x: 0, top: 112, width: 146 },
  cloudfront: { x: 172, top: 102, width: 192 },
  s3: { x: 390, top: 0, width: 152 },
  alb: { x: 390, top: 112, width: 152 },
  fargate: { x: 568, top: 104, width: 168 },
  bedrock: { x: 762, top: 50, width: 154 },
  dynamodb: { x: 762, top: 168, width: 154 },
  // Engine B's band. `ac-proxy` sits in the same column as `fargate` and inside
  // the same VPC box, which is the point: one image, one task size, two services.
  'ac-proxy': { x: 568, top: 300, width: 168 },
  'ac-runtime': { x: 762, top: 300, width: 154 },
  // Memory branches up off engine B's spine; the Gateway stays on it, so the
  // longest chain — proxy, Runtime, Gateway, table — reads as one straight line.
  'ac-memory': { x: 938, top: 240, width: 146 },
  'ac-gateway': { x: 938, top: 300, width: 146 },
  'ac-dynamodb': { x: 1104, top: 300, width: 146 },
};

/** Column heading above each tier. */
export interface AwsTierLabel {
  label: string;
  x: number;
}

export const AWS_TIER_LABELS: readonly AwsTierLabel[] = [
  { label: 'Client', x: 0 },
  { label: 'Edge', x: 172 },
  { label: 'Origin', x: 390 },
  { label: 'Compute', x: 568 },
  { label: 'AI · Data', x: 762 },
  { label: 'AgentCore', x: 938 },
  { label: 'Tool target', x: 1104 },
] as const;

/**
 * The dashed box drawn around the resources inside `valentin-vpc-dev`.
 *
 * Tall enough to hold both Fargate services. They share the VPC, the subnets and
 * the image; drawing one inside the boundary and one outside it would invent a
 * difference the deployment does not have.
 */
export const AWS_VPC_BOX = {
  left: 558,
  top: 92,
  width: 188,
  height: 272,
  label: 'valentin-vpc-dev · 2 AZ',
} as const;

/**
 * The dashed box around the Bedrock AgentCore primitives.
 *
 * Drawn because the boundary is the argument: Runtime, Memory and Gateway are
 * managed, so what is inside this box is the code we did not write. `ac-dynamodb`
 * is deliberately outside it — the table is ours, and the Gateway reaches it
 * through a Lambda we own.
 */
export const AGENTCORE_BOX = {
  left: 752,
  top: 228,
  width: 342,
  height: 158,
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
    label: 'Engine A · hand-built',
    sub: 'AGENT_ENGINE=valentin',
    x: 0,
    top: 22,
    width: 146,
  },
  {
    engine: 'agentcore',
    label: 'Engine B · AgentCore',
    sub: 'AGENT_ENGINE=agentcore',
    x: 0,
    top: 300,
    width: 146,
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
    path: 'M146,154 L166,154',
    downstreamHead: '172,154 163,148 163,160',
    upstreamHead: '146,154 155,148 155,160',
    elbowed: false,
  },
  'cloudfront-s3': {
    id: 'cloudfront-s3',
    path: 'M364,154 L377,154 L377,50 L384,50',
    downstreamHead: '390,50 381,44 381,56',
    upstreamHead: '364,154 373,148 373,160',
    elbowed: true,
    // S3 sits above the spine, so "away from the browser" points up.
    midDownstreamHead: '377,96 371,105 383,105',
    midUpstreamHead: '377,108 371,99 383,99',
  },
  'cloudfront-alb': {
    id: 'cloudfront-alb',
    path: 'M364,154 L384,154',
    downstreamHead: '390,154 381,148 381,160',
    upstreamHead: '364,154 373,148 373,160',
    elbowed: false,
  },
  'alb-fargate': {
    id: 'alb-fargate',
    path: 'M542,154 L562,154',
    downstreamHead: '568,154 559,148 559,160',
    upstreamHead: '542,154 551,148 551,160',
    elbowed: false,
  },
  'fargate-bedrock': {
    id: 'fargate-bedrock',
    path: 'M736,154 L749,154 L749,92 L756,92',
    downstreamHead: '762,92 753,86 753,98',
    upstreamHead: '736,154 745,148 745,160',
    elbowed: true,
    // Bedrock is above the spine: outbound points up, the return points down.
    midDownstreamHead: '749,110 743,119 755,119',
    midUpstreamHead: '749,122 743,113 755,113',
  },
  'fargate-dynamodb': {
    id: 'fargate-dynamodb',
    path: 'M736,154 L749,154 L749,218 L756,218',
    downstreamHead: '762,218 753,212 753,224',
    upstreamHead: '736,154 745,148 745,160',
    elbowed: true,
    // DynamoDB is below the spine, so the chevrons are the other way up from
    // Bedrock's. Getting this pair backwards is exactly the bug above.
    midDownstreamHead: '749,200 743,191 755,191',
    midUpstreamHead: '749,188 743,197 755,197',
  },

  // --- Engine B. Forks at the ALB and runs along its own spine at y=328. ---
  'alb-ac-proxy': {
    id: 'alb-ac-proxy',
    // Leaves the ALB at x=555, one pixel clear of the VPC box's left edge (558),
    // so the drop into engine B's band does not run down inside the boundary.
    path: 'M542,154 L555,154 L555,328 L562,328',
    downstreamHead: '568,328 559,322 559,334',
    upstreamHead: '542,154 551,148 551,160',
    elbowed: true,
    // The long leg is the 174px drop, which is where the eye goes.
    midDownstreamHead: '555,246 549,237 561,237',
    midUpstreamHead: '555,234 549,243 561,243',
  },
  'ac-proxy-ac-runtime': {
    id: 'ac-proxy-ac-runtime',
    path: 'M736,328 L756,328',
    downstreamHead: '762,328 753,322 753,334',
    upstreamHead: '736,328 745,322 745,334',
    elbowed: false,
  },
  'ac-runtime-ac-memory': {
    id: 'ac-runtime-ac-memory',
    path: 'M916,328 L927,328 L927,268 L932,268',
    downstreamHead: '938,268 929,262 929,274',
    upstreamHead: '916,328 925,322 925,334',
    elbowed: true,
    // Memory sits above engine B's spine, so away-from-the-browser is up here —
    // the mirror image of `fargate-dynamodb`, and the same pair to get backwards.
    midDownstreamHead: '927,290 921,299 933,299',
    midUpstreamHead: '927,306 921,297 933,297',
  },
  'ac-runtime-ac-gateway': {
    id: 'ac-runtime-ac-gateway',
    path: 'M916,328 L932,328',
    downstreamHead: '938,328 929,322 929,334',
    upstreamHead: '916,328 925,322 925,334',
    elbowed: false,
  },
  'ac-gateway-ac-dynamodb': {
    id: 'ac-gateway-ac-dynamodb',
    path: 'M1084,328 L1098,328',
    downstreamHead: '1104,328 1095,322 1095,334',
    upstreamHead: '1084,328 1093,322 1093,334',
    elbowed: false,
  },
};

/**
 * Engine B's spine, the y its four in-line resources share.
 *
 * Named for the same reason `AWS_DIAGRAM_SPINE_Y` is: it is asserted against, and
 * a band that drifted a few pixels out of line would look like a rendering bug.
 */
export const AGENTCORE_SPINE_Y = 328;

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
