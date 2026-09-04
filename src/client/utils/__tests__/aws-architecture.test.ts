import { describe, it, expect } from 'vitest';
import {
  ARCHITECTURE_ENGINES,
  AWS_NODES,
  AWS_SEGMENTS,
  awsNode,
  isNodeInEngine,
  isSegmentInEngine,
  nodeForEngine,
  awsNodeIdForResource,
  awsNodesForEventType,
  awsHopsForEventType,
  describeAwsEvent,
  flowLegs,
  nodesAlongRoute,
  routeBetween,
  type AwsNodeId,
} from '../aws-architecture';
import type { ServerEvent } from '../../../shared/interfaces/ws-events';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';
import integrationToolSchemas from '../../../../infra/lib/generated/integration-tool-schemas.json';

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

  it('places both Fargate services, and nothing else, inside the VPC boundary', () => {
    const inVpc = AWS_NODES.filter((node) => node.inVpc).map((node) => node.id);
    expect(inVpc).toEqual(['fargate', 'ac-proxy']);
  });

  it('marks the three AgentCore primitives, and only those, as managed', () => {
    // `ac-dynamodb` must stay out: the table is ours, reached through a Lambda we
    // own, and drawing it inside the AgentCore boundary would credit the platform
    // with the one piece of that path we wrote.
    const managed = AWS_NODES.filter((node) => node.inAgentCore).map((node) => node.id);
    expect(managed).toEqual(['ac-runtime', 'ac-memory', 'ac-gateway']);
  });

  it('leaves everything up to the ALB shared, and tags everything past it', () => {
    // The shared spine is what makes the comparison fair: both engines really do
    // arrive through the same edge, so neither half may claim it.
    const shared = AWS_NODES.filter((node) => node.engine === undefined).map((node) => node.id);
    expect(shared).toEqual(['browser', 'cloudfront', 's3', 'alb']);
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

/**
 * The decomposition that lets the diagram animate a step instead of asserting it.
 *
 * `routeBetween` is honest about the topology but hands over the whole path at once,
 * and a renderer given the whole path lights the whole path — which is how one
 * `preference_update` came to glow across eight cards simultaneously.
 */
describe('flowLegs', () => {
  it('interleaves the nodes between the hops, starting where the traffic is', () => {
    expect(flowLegs('browser', 'alb')).toEqual([
      { kind: 'node', node: 'browser', downstream: true },
      {
        kind: 'hop',
        hop: { segment: 'browser-cloudfront', node: 'cloudfront', downstream: true },
        downstream: true,
      },
      { kind: 'node', node: 'cloudfront', downstream: true },
      {
        kind: 'hop',
        hop: { segment: 'cloudfront-alb', node: 'alb', downstream: true },
        downstream: true,
      },
      { kind: 'node', node: 'alb', downstream: true },
    ]);
  });

  it('reads box, arrow, box — never two of a kind in a row', () => {
    const legs = flowLegs('dynamodb', 'browser');

    expect(legs[0].kind).toBe('node');
    expect(legs[legs.length - 1].kind).toBe('node');
    for (let i = 1; i < legs.length; i += 1) {
      expect(legs[i].kind, `leg ${i}`).not.toBe(legs[i - 1].kind);
    }
  });

  it('carries the travel direction on every leg, so the return trip reads as one', () => {
    // Colour is by direction, not by which node it is: the browser is claret on the
    // way out and teal on the way home.
    expect(flowLegs('dynamodb', 'browser').every((leg) => !leg.downstream)).toBe(true);
    expect(flowLegs('browser', 'dynamodb').every((leg) => leg.downstream)).toBe(true);
  });

  it('visits every node on the route, so nothing is transited without a beat', () => {
    const nodes = flowLegs('dynamodb', 'browser')
      .filter((leg) => leg.kind === 'node')
      .map((leg) => (leg.kind === 'node' ? leg.node : null));

    expect(nodes).toEqual([...nodesAlongRoute('dynamodb', 'browser')]);
  });

  it('gives work with no network hop a single beat rather than none', () => {
    // Something did happen; it just happened in one place.
    expect(flowLegs('bedrock', 'bedrock')).toEqual([
      { kind: 'node', node: 'bedrock', downstream: true },
    ]);
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

describe('engine membership', () => {
  it('counts the shared spine as part of both engines', () => {
    for (const id of ['browser', 'cloudfront', 's3', 'alb'] as AwsNodeId[]) {
      expect(isNodeInEngine(id, 'valentin'), id).toBe(true);
      expect(isNodeInEngine(id, 'agentcore'), id).toBe(true);
    }
  });

  it('excludes each engine from the other', () => {
    expect(isNodeInEngine('fargate', 'agentcore')).toBe(false);
    expect(isNodeInEngine('bedrock', 'agentcore')).toBe(false);
    expect(isNodeInEngine('ac-runtime', 'valentin')).toBe(false);
    expect(isNodeInEngine('ac-dynamodb', 'valentin')).toBe(false);
  });

  it('excludes a connector as soon as either end is on the other engine', () => {
    const albToProxy = AWS_SEGMENTS.find((segment) => segment.id === 'alb-ac-proxy')!;
    const albToFargate = AWS_SEGMENTS.find((segment) => segment.id === 'alb-fargate')!;

    // `alb` is shared, so a segment is only shared when *both* ends are.
    expect(isSegmentInEngine(albToProxy, 'agentcore')).toBe(true);
    expect(isSegmentInEngine(albToProxy, 'valentin')).toBe(false);
    expect(isSegmentInEngine(albToFargate, 'valentin')).toBe(true);
    expect(isSegmentInEngine(albToFargate, 'agentcore')).toBe(false);
  });

  it('leaves every segment claimed by at least one engine', () => {
    // The property that makes the shading total: no connector may fall through and
    // render for neither engine.
    for (const segment of AWS_SEGMENTS) {
      const claimed =
        Number(isSegmentInEngine(segment, 'valentin')) +
        Number(isSegmentInEngine(segment, 'agentcore'));
      expect(claimed, segment.id).toBeGreaterThan(0);
    }
  });

  it('maps a resource to its counterpart on the other engine', () => {
    expect(nodeForEngine('fargate', 'agentcore')).toBe('ac-proxy');
    expect(nodeForEngine('bedrock', 'agentcore')).toBe('ac-runtime');
    expect(nodeForEngine('dynamodb', 'agentcore')).toBe('ac-dynamodb');
    // Shared resources, and engine A itself, map to themselves.
    expect(nodeForEngine('alb', 'agentcore')).toBe('alb');
    expect(nodeForEngine('bedrock', 'valentin')).toBe('bedrock');
  });

  it('translates back the other way too, so a stale id from either side resolves', () => {
    expect(nodeForEngine('ac-proxy', 'valentin')).toBe('fargate');
    expect(nodeForEngine('ac-runtime', 'valentin')).toBe('bedrock');
    expect(nodeForEngine('ac-dynamodb', 'valentin')).toBe('dynamodb');
  });

  it('never maps a node onto one the target engine does not have, bar the two with no counterpart', () => {
    const stranded: string[] = [];

    for (const node of AWS_NODES) {
      for (const engine of ARCHITECTURE_ENGINES) {
        if (!isNodeInEngine(nodeForEngine(node.id, engine), engine)) {
          stranded.push(`${node.id}/${engine}`);
        }
      }
    }

    // Two nodes genuinely have nothing to translate to, in both directions: engine
    // A does its own memory and calls its tools in-process, so Memory and the
    // Gateway have no counterpart there. Both are returned unchanged and the view
    // shades them, which is honest, rather than being mapped onto a resource the
    // other engine does not have.
    //
    // The external APIs used to be a third. They no longer are: engine B reaches
    // the same partners through the Gateway, so `integrations` has a real
    // counterpart in `ac-integrations` and translates in both directions like
    // Fargate and DynamoDB do.
    expect(stranded).toEqual(['ac-memory/valentin', 'ac-gateway/valentin']);
  });

  it('routes an engine-B event down engine B, without touching engine A', () => {
    const nodes = awsNodesForEventType('agent_message', 'agentcore');
    expect(nodes).toContain('ac-runtime');
    expect(nodes).not.toContain('bedrock');
    expect(nodes).not.toContain('fargate');

    const hops = awsHopsForEventType('agent_message', 'agentcore');
    expect(hops.map((hop) => hop.segment)).toContain('ac-proxy-ac-runtime');
  });

  it('sends a shared resource id to the selected engine, not to engine A by default', () => {
    // Why the engine argument exists at all: engine B mirrors preferences through
    // the same store, so it emits `resourceId: 'dynamodb'` exactly as engine A does.
    expect(awsNodeIdForResource('dynamodb')).toBe('dynamodb');
    expect(awsNodeIdForResource('dynamodb', 'agentcore')).toBe('ac-dynamodb');
  });

  it('resolves the AgentCore primitives, which own no matching node id', () => {
    expect(awsNodeIdForResource('agentcore-runtime', 'agentcore')).toBe('ac-runtime');
    expect(awsNodeIdForResource('agentcore-memory', 'agentcore')).toBe('ac-memory');
    expect(awsNodeIdForResource('agentcore-gateway', 'agentcore')).toBe('ac-gateway');
  });

  it('sends a Gateway tool call to engine B’s own External APIs card', () => {
    // Not `integrations`: that node is engine A's, and routing there would light the
    // shaded half of the diagram while the toggle says AgentCore.
    expect(awsNodeIdForResource('agentcore-integrations', 'agentcore')).toBe('ac-integrations');
  });
});

/*
 * The Gateway's caption is a claim about the stack, and the stack is generated.
 *
 * `'MCP · 2 Lambda targets · 27 tools'` is the line a room reads as the Gateway's
 * benefit, so it is worth more than a comment: the number is recomputed here from
 * the same JSON `agentcore-stack.ts` spreads into `inlinePayload`, and a tool added
 * to the registry fails this test instead of quietly making the caption a lie.
 */
describe('the Gateway caption’s tool count', () => {
  it('matches the schemas the stack actually declares', () => {
    // Mirrors `agentcore-stack.ts`: one generated tool is withheld from engine B
    // because its signing key does not reach the tool Lambda, and every gated tool
    // gains a paired `confirm_*` the proxy calls.
    const WITHHELD = new Set(['create_conversation_link']);
    const PROFILE_TOOLS = 3;

    const offered = integrationToolSchemas.filter((tool) => !WITHHELD.has(tool.name));
    const confirms = offered.filter((tool) => tool.requiresConfirmation).length;
    const total = offered.length + confirms + PROFILE_TOOLS;

    expect(awsNode('ac-gateway').caption).toBe(`MCP · 2 Lambda targets · ${total} tools`);
  });
});
