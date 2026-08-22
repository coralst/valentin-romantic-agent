import { describe, it, expect } from 'vitest';
import { AWS_NODES, AWS_SEGMENTS } from '../aws-architecture';
import {
  AWS_DIAGRAM_CANVAS,
  AWS_DIAGRAM_SPINE_Y,
  AWS_NODE_BOXES,
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
      expect(box.x + box.width, node.id).toBeLessThanOrEqual(AWS_DIAGRAM_CANVAS.width);
      expect(box.top, node.id).toBeLessThan(AWS_DIAGRAM_CANVAS.height);
    }
  });

  it('lays the spine out strictly left to right', () => {
    const spine = ['browser', 'cloudfront', 'alb', 'fargate'] as const;
    for (let i = 1; i < spine.length; i += 1) {
      const previous = AWS_NODE_BOXES[spine[i - 1]];
      const current = AWS_NODE_BOXES[spine[i]];
      expect(current.x, spine[i]).toBeGreaterThanOrEqual(previous.x + previous.width);
    }
  });

  it('branches S3 above the ALB and keeps Bedrock above DynamoDB', () => {
    expect(AWS_NODE_BOXES.s3.top).toBeLessThan(AWS_NODE_BOXES.alb.top);
    expect(AWS_NODE_BOXES.s3.x).toBe(AWS_NODE_BOXES.alb.x);
    expect(AWS_NODE_BOXES.bedrock.top).toBeLessThan(AWS_NODE_BOXES.dynamodb.top);
    expect(AWS_NODE_BOXES.bedrock.x).toBe(AWS_NODE_BOXES.dynamodb.x);
  });

  it('gives CloudFront the widest card, because it carries the WAF chip', () => {
    const widest = Math.max(...AWS_NODES.map((node) => AWS_NODE_BOXES[node.id].width));
    expect(AWS_NODE_BOXES.cloudfront.width).toBe(widest);
  });

  it('starts every tier label at the x of the column it heads', () => {
    const columnXs = new Set(AWS_NODES.map((node) => AWS_NODE_BOXES[node.id].x));
    expect(AWS_TIER_LABELS).toHaveLength(5);
    for (const label of AWS_TIER_LABELS) {
      expect(columnXs.has(label.x), label.label).toBe(true);
    }
  });

  it('wraps only Fargate in the VPC box', () => {
    const inside = AWS_NODES.filter((node) => {
      const box = AWS_NODE_BOXES[node.id];
      return box.x >= AWS_VPC_BOX.left && box.x + box.width <= AWS_VPC_BOX.left + AWS_VPC_BOX.width;
    }).map((node) => node.id);

    expect(inside).toEqual(['fargate']);
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
      expect(coordinates[0][0], segment.id).toBe(parent.x + parent.width);
      expect(coordinates[coordinates.length - 1][0], segment.id).toBeLessThanOrEqual(child.x);
      expect(coordinates[coordinates.length - 1][0], segment.id).toBeGreaterThan(
        child.x - 12,
      );
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
  it('marks exactly the three links that bend', () => {
    expect([...ELBOWED_SEGMENTS].sort()).toEqual([
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
        // Off the spine, where the eye actually travels.
        expect(Math.abs(tip[1] - AWS_DIAGRAM_SPINE_Y), id).toBeGreaterThan(20);
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
      // Bedrock and S3 sit above the spine, DynamoDB below — so "away from the
      // browser" is up for two of these and down for the third. Hardcoding one
      // answer for all three is how the pair gets flipped.
      const expected = child.top < AWS_DIAGRAM_SPINE_Y ? 'up' : 'down';

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
