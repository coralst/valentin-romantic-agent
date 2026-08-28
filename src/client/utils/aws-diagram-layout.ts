import type { AwsNodeId, AwsSegmentId } from './aws-architecture';

/**
 * Where every box, connector and arrowhead sits in the architecture drawer.
 *
 * Separate from `aws-architecture.ts` on purpose: that file says what the
 * topology *is*, this one says how it is drawn. The component then holds no
 * magic numbers, which is what makes the geometry testable — an arrowhead
 * pointing the wrong way is an assertion, not a screenshot review.
 *
 * The layout is horizontal, five columns across 916px, because the drawer is
 * wide and shallow: on a projector that reads far better than five stacked rows
 * in a 560px panel.
 */

/** Canvas the connectors are drawn on. Node cards are positioned in the same space. */
export const AWS_DIAGRAM_CANVAS = { width: 916, height: 316 } as const;

/**
 * The shared vertical centre of Browser, CloudFront, ALB, Fargate and DynamoDB.
 *
 * The first four are the request's spine and sit in a straight line; S3 branches
 * up off it, and the last column fans out three ways — Bedrock up, DynamoDB
 * straight ahead, External APIs down. Keeping the spine straight is the reason
 * the diagram reads left-to-right at a glance.
 *
 * DynamoDB moved onto the spine when the integrations node arrived, and height
 * is the scarce dimension here: the drawer is 424px tall, so stacking a fourth
 * card under DynamoDB would have cost ~130px and squeezed the composer. A
 * three-way fan-out costs 30. It also happens to be truer — DynamoDB is on
 * every turn's critical path, and now the spine runs through it.
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
 * since the cards differ in height: S3 has to clear the ALB below it, and the
 * three cards in the last column have to clear each other.
 *
 * The last column's pitch is 104px against a card that is ~87px tall when it is
 * showing a duration pill. That 17px of air is the constraint — three lit cards
 * at once is the normal case during a tool call, not an edge case.
 */
export const AWS_NODE_BOXES: Readonly<Record<AwsNodeId, AwsNodeBox>> = {
  browser: { x: 0, top: 112, width: 146 },
  cloudfront: { x: 172, top: 102, width: 192 },
  s3: { x: 390, top: 0, width: 152 },
  alb: { x: 390, top: 112, width: 152 },
  fargate: { x: 568, top: 104, width: 168 },
  bedrock: { x: 762, top: 8, width: 154 },
  dynamodb: { x: 762, top: 111, width: 154 },
  integrations: { x: 762, top: 215, width: 154 },
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
  // Three services in this column now, and only one of them is AWS. Naming the
  // APIs in the heading is how the room knows the third card is not a stack the
  // account pays for.
  { label: 'AI · Data · APIs', x: 762 },
] as const;

/** The dashed box drawn around the resources inside `valentin-vpc-dev`. */
export const AWS_VPC_BOX = {
  left: 558,
  top: 92,
  width: 188,
  height: 126,
  label: 'valentin-vpc-dev · 2 AZ',
} as const;

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
    path: 'M736,154 L749,154 L749,50 L756,50',
    downstreamHead: '762,50 753,44 753,56',
    upstreamHead: '736,154 745,148 745,160',
    elbowed: true,
    // Bedrock is above the spine: outbound points up, the return points down.
    midDownstreamHead: '749,96 743,105 755,105',
    midUpstreamHead: '749,108 743,99 755,99',
  },
  // Straight ahead on the spine, so no elbow and — per the note above —
  // deliberately no mid-leg chevrons: there is no long vertical run for the eye
  // to misread. The below-spine chevron pair now lives on `fargate-integrations`.
  'fargate-dynamodb': {
    id: 'fargate-dynamodb',
    path: 'M736,154 L756,154',
    downstreamHead: '762,154 753,148 753,160',
    upstreamHead: '736,154 745,148 745,160',
    elbowed: false,
  },
  'fargate-integrations': {
    id: 'fargate-integrations',
    path: 'M736,154 L749,154 L749,258 L756,258',
    downstreamHead: '762,258 753,252 753,264',
    upstreamHead: '736,154 745,148 745,160',
    elbowed: true,
    // Below the spine, so the chevrons are the other way up from Bedrock's:
    // outbound points down, the return points up. Getting this pair backwards is
    // exactly the bug described above, and it is asserted rather than eyeballed.
    midDownstreamHead: '749,212 743,203 755,203',
    midUpstreamHead: '749,200 743,209 755,209',
  },
};

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
};

/** The one extra badge worth projecting: the WAF rule in front of CloudFront. */
export const WAF_CHIP_LABEL = 'AWS WAF · 2000 req/IP';
