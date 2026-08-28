import { describe, it, expect } from 'vitest';
import { ARCHITECTURE_ENGINES, AWS_NODES, AWS_SEGMENTS, type AwsNodeId } from '../aws-architecture';
import {
  AGENTCORE_BOX,
  AGENTCORE_SPINE_Y,
  AWS_DIAGRAM_CANVAS,
  AWS_DIAGRAM_SCALE,
  AWS_DIAGRAM_SPINE_Y,
  AWS_COLUMN_PITCH,
  AWS_ENGINE_BANDS,
  AWS_NODE_BOXES,
  AWS_NODE_CARD,
  AWS_NODE_VISUALS,
  AWS_SEGMENT_GEOMETRY,
  AWS_TIER_LABELS,
  AWS_VPC_BOX,
  ELBOWED_SEGMENTS,
  MARCHING_ANTS,
  awsSegmentGeometry,
} from '../aws-diagram-layout';

/** Parse `"x,y x,y x,y"` into three points. */
function points(spec: string): Array<[number, number]> {
  return spec
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return [x, y] as [number, number];
    });
}

/**
 * Which way a triangle points, from its own geometry.
 *
 * An arrowhead is a tip plus a level base. If the two base corners share a `y`
 * the base is horizontal and the tip is above or below it, so the triangle points
 * up or down; if they share an `x` it points left or right.
 *
 * The obvious version of this check — compare the tip's `x` to one base corner's
 * `x` — is what a previous verification pass actually did, and it misread every
 * vertical chevron as horizontal. The bug it was looking for went unreported.
 */
function direction(spec: string): 'up' | 'down' | 'left' | 'right' {
  const [tip, c1, c2] = points(spec);
  if (c1[1] === c2[1]) return tip[1] < c1[1] ? 'up' : 'down';
  return tip[0] < c1[0] ? 'left' : 'right';
}

/** Every coordinate pair in an SVG path's `M`/`L` commands. */
function pathPoints(path: string): Array<[number, number]> {
  return path
    .trim()
    .split(/[ML]/)
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const [x, y] = chunk.trim().split(',').map(Number);
      return [x, y] as [number, number];
    });
}

describe('AWS_NODE_BOXES', () => {
  it('positions every node in the topology', () => {
    for (const node of AWS_NODES) {
      expect(AWS_NODE_BOXES[node.id], node.id).toBeDefined();
    }
  });

  it('gives every node a visual', () => {
    for (const node of AWS_NODES) {
      expect(AWS_NODE_VISUALS[node.id], node.id).toBeDefined();
      expect(AWS_NODE_VISUALS[node.id].glyph.length).toBeGreaterThan(0);
    }
  });

  it('keeps the whole diagram inside the canvas', () => {
    for (const node of AWS_NODES) {
      const box = AWS_NODE_BOXES[node.id];
      expect(box.x, node.id).toBeGreaterThanOrEqual(0);
      expect(box.x + AWS_NODE_CARD.width, node.id).toBeLessThanOrEqual(AWS_DIAGRAM_CANVAS.width);
      expect(box.top, node.id).toBeGreaterThanOrEqual(0);
      expect(box.top + AWS_NODE_CARD.height, node.id).toBeLessThanOrEqual(
        AWS_DIAGRAM_CANVAS.height,
      );
    }
  });

  it('lays the spine out strictly left to right', () => {
    const spine = ['browser', 'cloudfront', 'alb', 'fargate'] as const;
    for (const id of spine) {
      // Centred on the spine, the same rule engine B's row follows below.
      expect(AWS_NODE_BOXES[id].top, id).toBe(AWS_DIAGRAM_SPINE_Y - AWS_NODE_CARD.height / 2);
    }
    for (let i = 1; i < spine.length; i += 1) {
      const previous = AWS_NODE_BOXES[spine[i - 1]];
      const current = AWS_NODE_BOXES[spine[i]];
      expect(current.x, spine[i]).toBeGreaterThanOrEqual(previous.x + AWS_NODE_CARD.width);
    }
  });

  it('branches S3 above the ALB and keeps Bedrock above DynamoDB', () => {
    expect(AWS_NODE_BOXES.s3.top).toBeLessThan(AWS_NODE_BOXES.alb.top);
    expect(AWS_NODE_BOXES.s3.x).toBe(AWS_NODE_BOXES.alb.x);
    expect(AWS_NODE_BOXES.bedrock.top).toBeLessThan(AWS_NODE_BOXES.dynamodb.top);
    expect(AWS_NODE_BOXES.bedrock.x).toBe(AWS_NODE_BOXES.dynamodb.x);
  });

  it('carries no per-node size, so every card is the same box', () => {
    // The regression this replaces: cards used to declare their own widths
    // (146-192) and take their height from their contents, which is how the
    // AgentCore column ended up with captions running through their neighbours.
    for (const node of AWS_NODES) {
      expect(Object.keys(AWS_NODE_BOXES[node.id]).sort(), node.id).toEqual(['top', 'x']);
    }
    expect(AWS_NODE_CARD.width).toBeGreaterThan(0);
    expect(AWS_NODE_CARD.height).toBeGreaterThan(0);
  });

  it('puts every card on the column grid', () => {
    for (const node of AWS_NODES) {
      expect(AWS_NODE_BOXES[node.id].x % AWS_COLUMN_PITCH, node.id).toBe(0);
    }
  });

  it('never overlaps two cards', () => {
    // The failure in the review screenshot, stated as an assertion: engine B's
    // boxes were 60px apart while the cards themselves were taller than that.
    for (const a of AWS_NODES) {
      for (const b of AWS_NODES) {
        if (a.id >= b.id) continue;
        const one = AWS_NODE_BOXES[a.id];
        const two = AWS_NODE_BOXES[b.id];
        const overlaps =
          one.x < two.x + AWS_NODE_CARD.width &&
          two.x < one.x + AWS_NODE_CARD.width &&
          one.top < two.top + AWS_NODE_CARD.height &&
          two.top < one.top + AWS_NODE_CARD.height;

        expect(overlaps, `${a.id} vs ${b.id}`).toBe(false);
      }
    }
  });

  it('keeps the group boxes clear of the cards above them', () => {
    // A dashed box whose label lands on a card's title is the other half of the
    // same screenshot: AGENTCORE_BOX used to start inside the DynamoDB card.
    const above = AWS_NODES.filter(
      (node) => AWS_NODE_BOXES[node.id].top + AWS_NODE_CARD.height <= AGENTCORE_BOX.top,
    );
    const lowestAbove = Math.max(
      ...above.map((node) => AWS_NODE_BOXES[node.id].top + AWS_NODE_CARD.height),
    );

    expect(AGENTCORE_BOX.top - lowestAbove).toBeGreaterThanOrEqual(12);
  });

  it('starts every tier label at the x of the column it heads', () => {
    const columnXs = new Set(AWS_NODES.map((node) => AWS_NODE_BOXES[node.id].x));
    expect(AWS_TIER_LABELS).toHaveLength(7);
    for (const label of AWS_TIER_LABELS) {
      expect(columnXs.has(label.x), label.label).toBe(true);
    }
  });

  it('wraps both Fargate services in the VPC box, and nothing else', () => {
    const inside = AWS_NODES.filter((node) => {
      const box = AWS_NODE_BOXES[node.id];
      return (
        box.x >= AWS_VPC_BOX.left &&
        box.x + AWS_NODE_CARD.width <= AWS_VPC_BOX.left + AWS_VPC_BOX.width &&
        box.top >= AWS_VPC_BOX.top &&
        box.top + AWS_NODE_CARD.height <= AWS_VPC_BOX.top + AWS_VPC_BOX.height
      );
    }).map((node) => node.id);

    expect(inside).toEqual(['fargate', 'ac-proxy']);
  });

  it('draws the VPC box around exactly the nodes the model calls in-VPC', () => {
    // The two facts have to agree: the dashed border is the only thing telling the
    // room where the subnet boundary is, and the model is what the tests trust.
    const drawn = AWS_NODES.filter((node) => {
      const box = AWS_NODE_BOXES[node.id];
      return (
        box.x >= AWS_VPC_BOX.left &&
        box.x + AWS_NODE_CARD.width <= AWS_VPC_BOX.left + AWS_VPC_BOX.width &&
        box.top >= AWS_VPC_BOX.top &&
        box.top + AWS_NODE_CARD.height <= AWS_VPC_BOX.top + AWS_VPC_BOX.height
      );
    }).map((node) => node.id);

    expect(drawn).toEqual(AWS_NODES.filter((node) => node.inVpc).map((node) => node.id));
  });

  it('draws the AgentCore box around exactly the managed primitives', () => {
    const drawn = AWS_NODES.filter((node) => {
      const box = AWS_NODE_BOXES[node.id];
      return (
        box.x >= AGENTCORE_BOX.left &&
        box.x + AWS_NODE_CARD.width <= AGENTCORE_BOX.left + AGENTCORE_BOX.width &&
        box.top >= AGENTCORE_BOX.top &&
        box.top + AWS_NODE_CARD.height <= AGENTCORE_BOX.top + AGENTCORE_BOX.height
      );
    }).map((node) => node.id);

    expect(drawn).toEqual(AWS_NODES.filter((node) => node.inAgentCore).map((node) => node.id));
  });

  it('lays engine B out along its own spine, left to right', () => {
    // Same property the engine-A spine has, and for the same reason: the drawer is
    // read at a glance from a distance, and a row that zig-zags stops reading.
    const spine: AwsNodeId[] = ['ac-proxy', 'ac-runtime', 'ac-gateway', 'ac-dynamodb'];

    for (const id of spine) {
      expect(AWS_NODE_BOXES[id].top, id).toBe(AGENTCORE_SPINE_Y - AWS_NODE_CARD.height / 2);
    }
    for (let k = 1; k < spine.length; k += 1) {
      const previous = AWS_NODE_BOXES[spine[k - 1]];
      expect(AWS_NODE_BOXES[spine[k]].x, spine[k]).toBeGreaterThan(
        previous.x + AWS_NODE_CARD.width,
      );
    }
  });

  it('keeps engine B clear of engine A, so neither band overlaps the other', () => {
    const engineA = AWS_NODES.filter((node) => node.engine === 'valentin');
    const engineB = AWS_NODES.filter((node) => node.engine === 'agentcore');
    const lowestA = Math.max(...engineA.map((node) => AWS_NODE_BOXES[node.id].top));
    const highestB = Math.min(...engineB.map((node) => AWS_NODE_BOXES[node.id].top));

    expect(highestB).toBeGreaterThan(lowestA);
  });

  it('scales the canvas down to something the drawer can hold', () => {
    expect(AWS_DIAGRAM_SCALE).toBeGreaterThan(0);
    expect(AWS_DIAGRAM_SCALE).toBeLessThanOrEqual(1);
    // The drawer reserves its height; a diagram that painted taller than this
    // would push the composer off screen, which is the failure the scale prevents.
    expect(AWS_DIAGRAM_CANVAS.height * AWS_DIAGRAM_SCALE).toBeLessThan(320);
  });

  it('names one band per engine', () => {
    expect(AWS_ENGINE_BANDS.map((band) => band.engine)).toEqual([...ARCHITECTURE_ENGINES]);
  });
});

describe('AWS_SEGMENT_GEOMETRY', () => {
  it('draws every segment in the topology', () => {
    for (const segment of AWS_SEGMENTS) {
      expect(awsSegmentGeometry(segment.id), segment.id).toBeDefined();
      expect(awsSegmentGeometry(segment.id).path, segment.id).toMatch(/^M/);
    }
  });

  it('gives every segment a head at each end', () => {
    for (const segment of AWS_SEGMENTS) {
      const geometry = awsSegmentGeometry(segment.id);
      expect(points(geometry.downstreamHead), segment.id).toHaveLength(3);
      expect(points(geometry.upstreamHead), segment.id).toHaveLength(3);
    }
  });

  it('points every upstream head back toward the browser', () => {
    // The browser is at x=0, so "toward the browser" along the spine is left.
    for (const segment of AWS_SEGMENTS) {
      expect(direction(awsSegmentGeometry(segment.id).upstreamHead), segment.id).toBe('left');
    }
  });

  it('points straight links downstream, away from the browser', () => {
    const straight = AWS_SEGMENTS.filter((s) => !awsSegmentGeometry(s.id).elbowed);
    expect(straight.length).toBeGreaterThan(0);
    for (const segment of straight) {
      expect(direction(awsSegmentGeometry(segment.id).downstreamHead), segment.id).toBe('right');
    }
  });

  it('starts each path at its parent and ends at its child', () => {
    for (const segment of AWS_SEGMENTS) {
      const geometry = awsSegmentGeometry(segment.id);
      const coordinates = pathPoints(geometry.path);
      const parent = AWS_NODE_BOXES[segment.from];
      const child = AWS_NODE_BOXES[segment.to];

      // Leaves the right-hand edge of the parent, arrives at the left of the child.
      expect(coordinates[0][0], segment.id).toBe(parent.x + AWS_NODE_CARD.width);
      expect(coordinates[coordinates.length - 1][0], segment.id).toBeLessThanOrEqual(child.x);
      expect(coordinates[coordinates.length - 1][0], segment.id).toBeGreaterThan(child.x - 12);
    }
  });

  it('runs the spine segments flat along the spine', () => {
    for (const id of ['browser-cloudfront', 'cloudfront-alb', 'alb-fargate'] as const) {
      for (const [, y] of pathPoints(awsSegmentGeometry(id).path)) {
        expect(y, id).toBe(AWS_DIAGRAM_SPINE_Y);
      }
    }
  });
});

describe('mid-leg chevrons', () => {
  it('marks exactly the links that bend', () => {
    expect([...ELBOWED_SEGMENTS].sort()).toEqual([
      // Engine B needs two: the drop from the ALB into its own band, and Memory
      // branching up off its spine.
      'ac-runtime-ac-memory',
      'alb-ac-proxy',
      'cloudfront-s3',
      'fargate-bedrock',
      'fargate-dynamodb',
    ]);
  });

  it('gives every elbowed link a chevron in both directions', () => {
    for (const id of ELBOWED_SEGMENTS) {
      const geometry = awsSegmentGeometry(id);
      expect(geometry.midDownstreamHead, id).toBeDefined();
      expect(geometry.midUpstreamHead, id).toBeDefined();
    }
  });

  it('withholds chevrons from straight links, which do not need them', () => {
    for (const segment of AWS_SEGMENTS) {
      if (awsSegmentGeometry(segment.id).elbowed) continue;
      expect(awsSegmentGeometry(segment.id).midDownstreamHead, segment.id).toBeUndefined();
      expect(awsSegmentGeometry(segment.id).midUpstreamHead, segment.id).toBeUndefined();
    }
  });

  it('places each chevron on the vertical leg, not at the spine end', () => {
    for (const id of ELBOWED_SEGMENTS) {
      const geometry = awsSegmentGeometry(id);
      const legX = pathPoints(geometry.path)[1][0];

      for (const head of [geometry.midDownstreamHead, geometry.midUpstreamHead]) {
        const [tip] = points(head!);
        expect(tip[0], id).toBe(legX);
        // Off the spine this link leaves — taken from the path's own start rather
        // than from one spine constant, since engine B runs along a second one.
        const spineY = pathPoints(geometry.path)[0][1];
        expect(Math.abs(tip[1] - spineY), id).toBeGreaterThan(20);
      }
    }
  });

  it('points every chevron along its leg, never across it', () => {
    for (const id of ELBOWED_SEGMENTS) {
      const geometry = awsSegmentGeometry(id);
      expect(['up', 'down'], id).toContain(direction(geometry.midDownstreamHead!));
      expect(['up', 'down'], id).toContain(direction(geometry.midUpstreamHead!));
    }
  });

  it('points the chevron pair in opposite directions', () => {
    // This is the actual bug the chevrons exist for: a response from DynamoDB
    // read as travelling outward because nothing on the long leg contradicted it.
    for (const id of ELBOWED_SEGMENTS) {
      const geometry = awsSegmentGeometry(id);
      expect(direction(geometry.midDownstreamHead!), id).not.toBe(
        direction(geometry.midUpstreamHead!),
      );
    }
  });

  it('sends the downstream chevron toward the far resource, whichever side it is on', () => {
    for (const id of ELBOWED_SEGMENTS) {
      const geometry = awsSegmentGeometry(id);
      const segment = AWS_SEGMENTS.find((s) => s.id === id)!;
      const child = AWS_NODE_BOXES[segment.to];
      const parent = AWS_NODE_BOXES[segment.from];
      // Bedrock and S3 sit above their parent, DynamoDB below, and engine B hangs
      // below the ALB — so "away from the browser" is up for some of these and down
      // for others. Compared against the parent rather than against a single spine
      // constant, because there are now two spines. Hardcoding one answer for all
      // five is how the pair gets flipped.
      const expected = child.top < parent.top ? 'up' : 'down';

      expect(direction(geometry.midDownstreamHead!), id).toBe(expected);
      expect(direction(geometry.midUpstreamHead!), id).toBe(expected === 'up' ? 'down' : 'up');
    }
  });
});

describe('MARCHING_ANTS', () => {
  it('runs the dashes in opposite directions for request and response', () => {
    expect(MARCHING_ANTS.downstreamOffset).toBe(-MARCHING_ANTS.upstreamOffset);
    expect(MARCHING_ANTS.downstreamOffset).toBeLessThan(0);
  });

  it('offsets by a whole number of dash cycles so the loop does not jump', () => {
    const cycle = MARCHING_ANTS.dashArray
      .split(' ')
      .map(Number)
      .reduce((sum, part) => sum + part, 0);

    expect(Math.abs(MARCHING_ANTS.downstreamOffset) % cycle).toBe(0);
  });
});
