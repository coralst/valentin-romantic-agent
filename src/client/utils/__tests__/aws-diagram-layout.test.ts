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

  it('branches S3 above the ALB, and stacks the two shared cards in one column', () => {
    expect(AWS_NODE_BOXES.s3.top).toBeLessThan(AWS_NODE_BOXES.alb.top);
    expect(AWS_NODE_BOXES.s3.x).toBe(AWS_NODE_BOXES.alb.x);
    // DynamoDB and the external APIs are one card each, reached from both engines,
    // so they share the rightmost column rather than sitting under Bedrock.
    expect(AWS_NODE_BOXES.dynamodb.x).toBe(AWS_NODE_BOXES.integrations.x);
    expect(AWS_NODE_BOXES.dynamodb.top).toBeLessThan(AWS_NODE_BOXES.integrations.top);
    expect(AWS_NODE_BOXES.dynamodb.x).toBeGreaterThan(AWS_NODE_BOXES.bedrock.x);
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
    // Three cards now, not four: the fourth was engine B's private copy of the
    // DynamoDB card, and it has been folded into the one shared card off-spine.
    const spine: AwsNodeId[] = ['ac-proxy', 'ac-runtime', 'ac-gateway'];

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

  it('starts each path at its parent and lands on an edge of its child', () => {
    // Arrival used to be asserted as "just left of the child", which only holds for
    // links that come in horizontally. The two shared cards are approached from
    // above, below and the right as well — one connector per corridor — so what is
    // actually required is that the path stops just outside *some* edge of the card
    // it points at. A path that stopped short of every edge would render as a line
    // into empty space.
    const GAP = 12;
    for (const segment of AWS_SEGMENTS) {
      const geometry = awsSegmentGeometry(segment.id);
      const coordinates = pathPoints(geometry.path);
      const parent = AWS_NODE_BOXES[segment.from];
      const child = AWS_NODE_BOXES[segment.to];
      const [endX, endY] = coordinates[coordinates.length - 1];

      // Always leaves the right-hand edge of the parent.
      expect(coordinates[0][0], segment.id).toBe(parent.x + AWS_NODE_CARD.width);

      const spansX = endX >= child.x && endX <= child.x + AWS_NODE_CARD.width;
      const spansY = endY >= child.top && endY <= child.top + AWS_NODE_CARD.height;
      const fromLeft = spansY && endX <= child.x && endX > child.x - GAP;
      const fromRight =
        spansY &&
        endX >= child.x + AWS_NODE_CARD.width &&
        endX < child.x + AWS_NODE_CARD.width + GAP;
      const fromAbove = spansX && endY <= child.top && endY > child.top - GAP;
      const fromBelow =
        spansX &&
        endY >= child.top + AWS_NODE_CARD.height &&
        endY < child.top + AWS_NODE_CARD.height + GAP;

      expect(fromLeft || fromRight || fromAbove || fromBelow, segment.id).toBe(true);
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

describe('the shared column', () => {
  /**
   * DynamoDB and the external APIs are one card each, not one per engine. Both
   * engines really do read and write the same table and call the same partner APIs,
   * so two cards said something false — and the giveaway was that the duplicated
   * cards' visuals were byte-for-byte copies.
   *
   * That makes this column the only one reached from both bands, which is what the
   * assertions below are about: it has to sit clear of every dashed frame (it belongs
   * to neither), and it has to be reachable from an engine-A spine that runs above it
   * and an engine-B spine that runs below it.
   */
  const SHARED = ['dynamodb', 'integrations'] as const;

  it('sits outside the VPC box and outside the AgentCore box', () => {
    for (const id of SHARED) {
      const box = AWS_NODE_BOXES[id];
      const right = box.x + AWS_NODE_CARD.width;
      const bottom = box.top + AWS_NODE_CARD.height;

      const clearOf = (frame: { left: number; top: number; width: number; height: number }) =>
        right <= frame.left ||
        box.x >= frame.left + frame.width ||
        bottom <= frame.top ||
        box.top >= frame.top + frame.height;

      expect(clearOf(AWS_VPC_BOX), `${id} vs VPC box`).toBe(true);
      expect(clearOf(AGENTCORE_BOX), `${id} vs AgentCore box`).toBe(true);
    }
  });

  it('sits in the band between the two spines, belonging to neither', () => {
    // On engine A's spine it would read as engine A's; on engine B's, as engine B's.
    // The whole point of the dedupe is that it is neither, so it sits in the gap.
    for (const id of SHARED) {
      const box = AWS_NODE_BOXES[id];
      expect(box.top, id).toBeGreaterThan(AWS_DIAGRAM_SPINE_Y);
      expect(box.top + AWS_NODE_CARD.height, id).toBeLessThan(AGENTCORE_SPINE_Y);
    }
  });

  it('keeps a routing corridor on each side of the column', () => {
    // Four connectors reach two cards, and each needs its own lane or it would run
    // behind a card. Engine B climbs the corridor to the left of the column;
    // engine A's tool call runs past the right of it and comes back in from there.
    const left = AWS_NODE_BOXES.dynamodb.x;
    const right = left + AWS_NODE_CARD.width;

    const acDynamo = pathPoints(awsSegmentGeometry('ac-gateway-dynamodb').path);
    const climb = acDynamo.map(([x]) => x).filter((x) => x < left);
    expect(climb.length, 'engine B climbs left of the column').toBeGreaterThan(0);
    expect(Math.max(...climb)).toBeGreaterThan(AWS_NODE_BOXES['ac-memory'].x + AWS_NODE_CARD.width);

    const toolCall = pathPoints(awsSegmentGeometry('fargate-integrations').path);
    const descent = toolCall.map(([x]) => x).filter((x) => x > right);
    expect(descent.length, 'engine A descends right of the column').toBeGreaterThan(0);
    expect(Math.max(...descent)).toBeLessThan(AWS_DIAGRAM_CANVAS.width);
  });

  it('threads engine A’s links past Bedrock without crossing it', () => {
    // Both engine-A links leave Fargate and cross the Model column to get here. If
    // Bedrock's card grew down into those lanes the lines would vanish behind it.
    const bedrockBottom = AWS_NODE_BOXES.bedrock.top + AWS_NODE_CARD.height;
    const bedrockLeft = AWS_NODE_BOXES.bedrock.x;
    const bedrockRight = bedrockLeft + AWS_NODE_CARD.width;

    // Walked as runs, not vertices: the lane that passes over Bedrock is the middle
    // of a long horizontal run, so no vertex of it lands in Bedrock's column at all.
    for (const id of ['fargate-dynamodb', 'fargate-integrations'] as const) {
      const vertices = pathPoints(awsSegmentGeometry(id).path);
      let crossings = 0;
      for (let k = 1; k < vertices.length; k += 1) {
        const [x0, y0] = vertices[k - 1];
        const [x1, y1] = vertices[k];
        const overlapsColumn = Math.min(x0, x1) <= bedrockRight && Math.max(x0, x1) >= bedrockLeft;
        if (!overlapsColumn) continue;
        crossings += 1;
        expect(Math.min(y0, y1), `${id} crosses the Bedrock card`).toBeGreaterThan(bedrockBottom);
      }
      expect(crossings, `${id} should pass the Model column`).toBeGreaterThan(0);
    }
  });
});

describe('mid-leg chevrons', () => {
  /** The straight runs of a path, as `[from, to]` vertex pairs. */
  function runs(path: string): Array<[[number, number], [number, number]]> {
    const vertices = pathPoints(path);
    const out: Array<[[number, number], [number, number]]> = [];
    for (let k = 1; k < vertices.length; k += 1) out.push([vertices[k - 1], vertices[k]]);
    return out;
  }

  /**
   * The run a chevron tip sits on, and which axis that run travels.
   *
   * This is the generalisation the shared column forced. Chevrons used to be
   * assertable as "on the vertical leg" because every off-spine card lived in the
   * column directly above or below its parent, making the long leg vertical every
   * time. DynamoDB and the external APIs are now several columns right of Fargate,
   * so engine A reaches them along a long *horizontal* run and drops only ~30px at
   * the end. A chevron on that 30px stub would be invisible; it belongs on the run
   * that is actually long. So the axis is derived, not assumed.
   */
  function runUnder(path: string, head: string): { axis: 'x' | 'y'; length: number } | null {
    const [tip] = points(head);
    for (const [[x0, y0], [x1, y1]] of runs(path)) {
      if (x0 === x1 && tip[0] === x0 && tip[1] >= Math.min(y0, y1) && tip[1] <= Math.max(y0, y1)) {
        return { axis: 'y', length: Math.abs(y1 - y0) };
      }
      if (y0 === y1 && tip[1] === y0 && tip[0] >= Math.min(x0, x1) && tip[0] <= Math.max(x0, x1)) {
        return { axis: 'x', length: Math.abs(x1 - x0) };
      }
    }
    return null;
  }

  it('marks exactly the links that bend', () => {
    expect([...ELBOWED_SEGMENTS].sort()).toEqual([
      // Both reaches into the shared column from engine B: up the corridor to the
      // left of the cards for the table, and round the bottom for the tools.
      'ac-gateway-dynamodb',
      'ac-gateway-integrations',
      // Memory branching up off engine B's spine.
      'ac-runtime-ac-memory',
      // The drop from the ALB into engine B's band.
      'alb-ac-proxy',
      'cloudfront-s3',
      'fargate-bedrock',
      // And both reaches from engine A. These two are the ones that made the
      // chevron rules axis-agnostic: they run a long way right and then step off
      // the spine by barely a card's half-height.
      'fargate-dynamodb',
      'fargate-integrations',
    ]);
  });

  /**
   * The bug this whole mechanism exists for, asserted rather than eyeballed on a
   * projector: Bedrock is above the spine and Memory above engine B's, so their
   * outbound chevrons climb, while the ALB's drop into engine B's band descends.
   * Copying one pair to the other leg is the mistake, and it looks perfectly
   * plausible in code.
   */
  it('points the above-spine and below-spine chevrons opposite ways', () => {
    const bedrock = awsSegmentGeometry('fargate-bedrock');
    const acProxy = awsSegmentGeometry('alb-ac-proxy');

    expect(direction(bedrock.midDownstreamHead!)).toBe('up');
    expect(direction(bedrock.midUpstreamHead!)).toBe('down');
    expect(direction(acProxy.midDownstreamHead!)).toBe('down');
    expect(direction(acProxy.midUpstreamHead!)).toBe('up');
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

  it('places each chevron on the longest run of its own path', () => {
    for (const id of ELBOWED_SEGMENTS) {
      const geometry = awsSegmentGeometry(id);
      const longest = Math.max(
        ...runs(geometry.path).map(([[x0, y0], [x1, y1]]) => Math.abs(x1 - x0) + Math.abs(y1 - y0)),
      );

      for (const head of [geometry.midDownstreamHead, geometry.midUpstreamHead]) {
        const run = runUnder(geometry.path, head!);
        expect(run, `${id} chevron is off the path`).not.toBeNull();
        expect(run!.length, `${id} chevron is on a short run`).toBe(longest);
      }
    }
  });

  it('keeps each chevron clear of the arrowheads at either end', () => {
    // A chevron that lands on top of an end arrowhead reads as one fat triangle and
    // says nothing about the middle of the leg, which is the whole point of it.
    for (const id of ELBOWED_SEGMENTS) {
      const geometry = awsSegmentGeometry(id);
      const vertices = pathPoints(geometry.path);
      const ends = [vertices[0], vertices[vertices.length - 1]];

      for (const head of [geometry.midDownstreamHead, geometry.midUpstreamHead]) {
        const [tip] = points(head!);
        for (const end of ends) {
          const distance = Math.abs(tip[0] - end[0]) + Math.abs(tip[1] - end[1]);
          expect(distance, `${id} chevron sits on an end`).toBeGreaterThan(12);
        }
      }
    }
  });

  it('points every chevron along its run, never across it', () => {
    for (const id of ELBOWED_SEGMENTS) {
      const geometry = awsSegmentGeometry(id);
      for (const head of [geometry.midDownstreamHead, geometry.midUpstreamHead]) {
        const axis = runUnder(geometry.path, head!)!.axis;
        const along = axis === 'y' ? ['up', 'down'] : ['left', 'right'];
        expect(along, id).toContain(direction(head!));
      }
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
      const axis = runUnder(geometry.path, geometry.midDownstreamHead!)!.axis;
      // Which way "away from the browser" points depends on where the child sits
      // relative to its parent — up for Bedrock and Memory, down for engine B's
      // band, right for the shared column. Compared against the parent rather than
      // against a spine constant, because there are two spines and now two axes.
      // Hardcoding one answer for all eight is how the pair gets flipped.
      const expected =
        axis === 'y' ? (child.top < parent.top ? 'up' : 'down') : child.x > parent.x ? 'right' : 'left';
      const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' } as const;

      expect(direction(geometry.midDownstreamHead!), id).toBe(expected);
      expect(direction(geometry.midUpstreamHead!), id).toBe(opposite[expected]);
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
