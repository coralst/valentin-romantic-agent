import { describe, it, expect } from 'vitest';
import {
  AWS_NODES,
  AWS_SEGMENTS,
  awsNode,
  awsNodeIdForResource,
  awsNodesForEventType,
  awsHopsForEventType,
  describeAwsEvent,
  nodesAlongRoute,
  routeBetween,
  type AwsNodeId,
} from '../aws-architecture';
import type { ServerEvent } from '../../../shared/interfaces/ws-events';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

const ALL_EVENT_TYPES = [
  'session_init',
  'send_message',
  'typing_start',
  'typing_stop',
  'agent_message',
  'preference_update',
  'connection_status',
  'error',
  'ping',
  'pong',
  'action_proposal',
  'confirm_action',
];

describe('AWS_NODES', () => {
  it('names a real service and a real resource for every node', () => {
    for (const node of AWS_NODES) {
      expect(node.service.length, node.id).toBeGreaterThan(0);
      expect(node.resourceName.length, node.id).toBeGreaterThan(0);
      expect(node.caption.length, node.id).toBeGreaterThan(0);
    }
  });

  it('has unique ids', () => {
    const ids = AWS_NODES.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('dims only S3 — the one resource that never lights during a chat turn', () => {
    const dimmed = AWS_NODES.filter((node) => node.dimmed).map((node) => node.id);
    expect(dimmed).toEqual(['s3']);
  });

  it('places only Fargate inside the VPC boundary', () => {
    const inVpc = AWS_NODES.filter((node) => node.inVpc).map((node) => node.id);
    expect(inVpc).toEqual(['fargate']);
  });

  it('resolves nodes by id and returns undefined for strangers', () => {
    expect(awsNode('dynamodb')?.resourceName).toBe('ValentinTable-dev');
    expect(awsNode('nope' as AwsNodeId)).toBeUndefined();
  });
});

describe('AWS_SEGMENTS', () => {
  it('connects only known nodes', () => {
    const ids = new Set(AWS_NODES.map((node) => node.id));
    for (const segment of AWS_SEGMENTS) {
      expect(ids.has(segment.from), segment.id).toBe(true);
      expect(ids.has(segment.to), segment.id).toBe(true);
    }
  });

  it('forms a tree: every node but the browser has exactly one inbound segment', () => {
    for (const node of AWS_NODES) {
      const inbound = AWS_SEGMENTS.filter((segment) => segment.to === node.id);
      expect(inbound.length, node.id).toBe(node.id === 'browser' ? 0 : 1);
    }
  });
});

describe('routeBetween', () => {
  it('walks the request path down to Bedrock', () => {
    expect(routeBetween('browser', 'bedrock')).toEqual([
      { segment: 'browser-cloudfront', node: 'cloudfront', downstream: true },
      { segment: 'cloudfront-alb', node: 'alb', downstream: true },
      { segment: 'alb-fargate', node: 'fargate', downstream: true },
      { segment: 'fargate-bedrock', node: 'bedrock', downstream: true },
    ]);
  });

  it('walks the response path back up from DynamoDB, never linking it to CloudFront', () => {
    const hops = routeBetween('dynamodb', 'browser');

    expect(hops).toEqual([
      { segment: 'fargate-dynamodb', node: 'fargate', downstream: false },
      { segment: 'alb-fargate', node: 'alb', downstream: false },
      { segment: 'cloudfront-alb', node: 'cloudfront', downstream: false },
      { segment: 'browser-cloudfront', node: 'browser', downstream: false },
    ]);
    // The bug this model exists to make impossible.
    expect(hops.map((hop) => hop.segment)).not.toContain('cloudfront-s3');
  });

  it('routes sibling to sibling through their common parent', () => {
    expect(routeBetween('bedrock', 'dynamodb')).toEqual([
      { segment: 'fargate-bedrock', node: 'fargate', downstream: false },
      { segment: 'fargate-dynamodb', node: 'dynamodb', downstream: true },
    ]);
  });

  it('returns no hops when work happens without a network call', () => {
    expect(routeBetween('fargate', 'fargate')).toEqual([]);
  });

  it('is symmetric in length and reversed in direction', () => {
    const down = routeBetween('browser', 'dynamodb');
    const up = routeBetween('dynamodb', 'browser');

    expect(up.length).toBe(down.length);
    expect(down.every((hop) => hop.downstream)).toBe(true);
    expect(up.every((hop) => !hop.downstream)).toBe(true);
  });

  it('only ever emits segments that exist in the topology', () => {
    const known = new Set(AWS_SEGMENTS.map((segment) => segment.id));
    const ids = AWS_NODES.map((node) => node.id);

    for (const from of ids) {
      for (const to of ids) {
        for (const hop of routeBetween(from, to)) {
          expect(known.has(hop.segment), `${from}→${to}`).toBe(true);
        }
      }
    }
  });

  it('joins consecutive hops — each hop starts where the last one landed', () => {
    const ids = AWS_NODES.map((node) => node.id);
    const endpoints = new Map(AWS_SEGMENTS.map((s) => [s.id, [s.from, s.to]] as const));

    for (const from of ids) {
      for (const to of ids) {
        const hops = routeBetween(from, to);
        let position = from;
        for (const hop of hops) {
          const pair = endpoints.get(hop.segment)!;
          expect(pair, `${from}→${to} via ${hop.segment}`).toContain(position);
          position = hop.node;
        }
        if (hops.length > 0) expect(position, `${from}→${to}`).toBe(to);
      }
    }
  });
});

describe('nodesAlongRoute', () => {
  it('includes both endpoints in travel order', () => {
    expect(nodesAlongRoute('dynamodb', 'browser')).toEqual([
      'dynamodb',
      'fargate',
      'alb',
      'cloudfront',
      'browser',
    ]);
  });

  it('returns the single node when there is no hop', () => {
    expect(nodesAlongRoute('bedrock', 'bedrock')).toEqual(['bedrock']);
  });
});

describe('awsNodesForEventType', () => {
  it('maps every existing WebSocket event to known nodes', () => {
    const ids = new Set(AWS_NODES.map((node) => node.id));

    for (const type of ALL_EVENT_TYPES) {
      const nodes = awsNodesForEventType(type);
      expect(nodes.length, type).toBeGreaterThan(0);
      for (const id of nodes) expect(ids.has(id), `${type}:${id}`).toBe(true);
    }
  });

  it('lights the full return path for a preference landing in the browser', () => {
    expect(awsNodesForEventType('preference_update')).toEqual([
      'dynamodb',
      'fargate',
      'alb',
      'cloudfront',
      'browser',
    ]);
  });

  /**
   * The A/B demo's whole point in one route. A proposal starts at the provider —
   * Ontopo held the table — and travels out; the confirmation travels all the way
   * back to it. Neither may shortcut: the previous hand-authored diagram drew
   * exactly that kind of phantom link, which is why the topology is a tree now.
   */
  it('runs a proposal out from the provider and the confirmation back to it', () => {
    expect(awsNodesForEventType('action_proposal')).toEqual([
      'integrations',
      'fargate',
      'alb',
      'cloudfront',
      'browser',
    ]);
    expect(awsNodesForEventType('confirm_action')).toEqual([
      'browser',
      'cloudfront',
      'alb',
      'fargate',
      'integrations',
    ]);
  });

  it('highlights nothing for an unknown event rather than throwing', () => {
    expect(awsNodesForEventType('some_future_event')).toEqual([]);
    expect(awsHopsForEventType('some_future_event')).toEqual([]);
  });

  it('never lights S3 during a chat turn', () => {
    const chatEvents = ['send_message', 'agent_message', 'preference_update', 'typing_start'];
    for (const type of chatEvents) {
      expect(awsNodesForEventType(type), type).not.toContain('s3');
    }
  });
});

describe('awsNodeIdForResource', () => {
  it('resolves a known resource id', () => {
    expect(awsNodeIdForResource('dynamodb')).toBe('dynamodb');
  });

  it('returns undefined for an unrecognised resource so the span still renders', () => {
    expect(awsNodeIdForResource('sqs')).toBeUndefined();
  });
});

describe('describeAwsEvent', () => {
  function preferenceEvent(): ServerEvent {
    const preference: PreferenceWithHistory = {
      id: 'pref-1',
      sessionId: 'sess-1',
      category: 'music',
      key: 'genre',
      value: 'Late-night jazz',
      confidence: 0.91,
      sourceMessageId: 'msg-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    };
    return {
      type: 'preference_update',
      payload: { preference, isNew: true },
      timestamp: new Date().toISOString(),
    };
  }

  it('never projects a raw preference value', () => {
    const detail = describeAwsEvent(preferenceEvent());

    expect(detail).toBe('new · music');
    expect(detail).not.toContain('Late-night jazz');
  });

  it('summarises an agent reply without quoting it', () => {
    const detail = describeAwsEvent({
      type: 'agent_message',
      payload: { message: { content: 'a basement room in Soho' } },
    });

    expect(detail).toBe('reply streamed');
    expect(detail).not.toContain('Soho');
  });

  it('reports an error code, not its message', () => {
    expect(
      describeAwsEvent({ type: 'error', payload: { code: 'BEDROCK_TIMEOUT', message: 'boom' } }),
    ).toBe('BEDROCK_TIMEOUT');
  });

  it('returns empty for a payload-less or unknown event', () => {
    expect(describeAwsEvent({ type: 'pong', payload: undefined })).toBe('');
    expect(describeAwsEvent({ type: 'mystery', payload: {} })).toBe('');
  });
});
