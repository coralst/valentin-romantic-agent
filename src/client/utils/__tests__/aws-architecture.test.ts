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
    // The two Lambdas must stay out, and so must the table and the providers they
    // reach: that code is ours, and drawing it inside the AgentCore boundary would
    // credit the platform with the pieces of that path we wrote.
    const managed = AWS_NODES.filter((node) => node.inAgentCore).map((node) => node.id);
    expect(managed).toEqual(['ac-runtime', 'ac-memory', 'ac-gateway']);
  });

  it('leaves the edge and the two data resources shared, and tags the rest', () => {
    // The shared spine is what makes the comparison fair: both engines really do
    // arrive through the same edge, so neither half may claim it.
    //
    // The table and the provider APIs join that list for a different reason. They are
    // not on the way in — they are at the far end of both engines, and they are the
    // *same* table and the *same* eight companies whichever engine answers. Claiming
    // either for one engine is what forced the diagram to draw two of each.
    const shared = AWS_NODES.filter((node) => node.engine === undefined).map((node) => node.id);
    expect(shared).toEqual(['browser', 'cloudfront', 's3', 'alb', 'dynamodb', 'integrations']);
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

  /*
   * The tree property, restated PER ENGINE and against routing rather than against the
   * drawn segments — the change that let the table and the provider APIs be drawn once
   * instead of twice.
   *
   * The segment list is deliberately no longer a tree. DynamoDB has three inbound links
   * (engine A's task, engine B's proxy, and the profile Lambda) and the providers have
   * two, because that is the deployment. Two of the table's three even belong to the
   * same engine. So counting inbound segments no longer states the invariant; what
   * matters is that each engine still routes to every node it uses along exactly one
   * path, which is what makes `routeBetween` unique and computable — and what a
   * single-parent model could only achieve by inventing a second database.
   *
   * Asserted through `routeBetween` on purpose: the parent map is private, and this is
   * the behaviour that would actually break if it stopped being a tree.
   */
  it('routes to every node an engine uses along exactly one path from the browser', () => {
    for (const engine of ARCHITECTURE_ENGINES) {
      const used = AWS_NODES.filter((node) => isNodeInEngine(node.id, engine)).map(
        (node) => node.id,
      );
      const treeEdges = new Set<string>();

      for (const id of used) {
        const hops = routeBetween('browser', id, engine);
        if (id === 'browser') {
          expect(hops, `browser on ${engine}`).toEqual([]);
          continue;
        }

        expect(hops.length, `${id} on ${engine} is unreachable`).toBeGreaterThan(0);
        expect(hops[hops.length - 1].node, `${id} on ${engine}`).toBe(id);
        // One parent edge per node, and no node's parent edge reused as another's.
        const parentEdge = hops[hops.length - 1].segment;
        expect(treeEdges.has(parentEdge), `${parentEdge} claimed twice on ${engine}`).toBe(false);
        treeEdges.add(parentEdge);
      }

      // n nodes, n-1 edges: the arithmetic that makes it a tree rather than a graph
      // that happens to be connected.
      expect(treeEdges.size, engine).toBe(used.length - 1);
    }
  });

  it('draws the shared table and the shared APIs exactly once each', () => {
    // The defect this now guards against by name. Two DynamoDB cards said her file
    // lived in two places, and two External APIs cards said the two engines
    // integrate with different companies. Both were the drawing's fault, not the
    // deployment's.
    const tables = AWS_NODES.filter((node) => node.service === 'Amazon DynamoDB');
    const providers = AWS_NODES.filter((node) => node.service === 'External APIs');

    expect(tables.map((node) => node.id)).toEqual(['dynamodb']);
    expect(providers.map((node) => node.id)).toEqual(['integrations']);
    // Neither is claimed by an engine, which is what makes them shared.
    expect(tables[0].engine).toBeUndefined();
    expect(providers[0].engine).toBeUndefined();
  });

  it('reaches the one table from three real places, and the providers from two', () => {
    const inboundTo = (id: AwsNodeId) =>
      AWS_SEGMENTS.filter((segment) => segment.to === id).map((segment) => segment.from);

    expect(inboundTo('dynamodb')).toEqual(['fargate', 'ac-proxy', 'ac-lambda-profile']);
    expect(inboundTo('integrations')).toEqual(['fargate', 'ac-lambda-tools']);
  });
});

describe('routeBetween', () => {
  it('walks the request path down to Bedrock', () => {
    expect(routeBetween('browser', 'bedrock', 'valentin')).toEqual([
      { segment: 'browser-cloudfront', node: 'cloudfront', downstream: true },
      { segment: 'cloudfront-alb', node: 'alb', downstream: true },
      { segment: 'alb-fargate', node: 'fargate', downstream: true },
      { segment: 'fargate-bedrock', node: 'bedrock', downstream: true },
    ]);
  });

  it('walks the response path back up from DynamoDB, never linking it to CloudFront', () => {
    const hops = routeBetween('dynamodb', 'browser', 'valentin');

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
    expect(routeBetween('bedrock', 'dynamodb', 'valentin')).toEqual([
      { segment: 'fargate-bedrock', node: 'fargate', downstream: false },
      { segment: 'fargate-dynamodb', node: 'dynamodb', downstream: true },
    ]);
  });

  it('returns no hops when work happens without a network call', () => {
    expect(routeBetween('fargate', 'fargate', 'valentin')).toEqual([]);
  });

  it('is symmetric in length and reversed in direction', () => {
    const down = routeBetween('browser', 'dynamodb', 'valentin');
    const up = routeBetween('dynamodb', 'browser', 'valentin');

    expect(up.length).toBe(down.length);
    expect(down.every((hop) => hop.downstream)).toBe(true);
    expect(up.every((hop) => !hop.downstream)).toBe(true);
  });

  it('only ever emits segments that exist in the topology, on either engine', () => {
    const known = new Set(AWS_SEGMENTS.map((segment) => segment.id));
    const ids = AWS_NODES.map((node) => node.id);

    for (const engine of ARCHITECTURE_ENGINES) {
      for (const from of ids) {
        for (const to of ids) {
          for (const hop of routeBetween(from, to, engine)) {
            expect(known.has(hop.segment), `${from}→${to} on ${engine}`).toBe(true);
          }
        }
      }
    }
  });

  it('joins consecutive hops — each hop starts where the last one landed', () => {
    const ids = AWS_NODES.map((node) => node.id);
    const endpoints = new Map(AWS_SEGMENTS.map((s) => [s.id, [s.from, s.to]] as const));

    for (const engine of ARCHITECTURE_ENGINES) {
      for (const from of ids) {
        for (const to of ids) {
          const hops = routeBetween(from, to, engine);
          let position = from;
          for (const hop of hops) {
            const pair = endpoints.get(hop.segment)!;
            expect(pair, `${from}→${to} via ${hop.segment} on ${engine}`).toContain(position);
            position = hop.node;
          }
          if (hops.length > 0) expect(position, `${from}→${to} on ${engine}`).toBe(to);
        }
      }
    }
  });

  /*
   * The payoff of the per-engine parent map, asserted rather than described: one node,
   * two genuinely different routes to it. This is the pair of sentences the diagram is
   * for — "engine A's task talks to the table" and "engine B's proxy talks to the same
   * table" — and before the parent map they could only be drawn as two tables.
   */
  it('reaches the one shared table by a different route on each engine', () => {
    expect(nodesAlongRoute('browser', 'dynamodb', 'valentin')).toEqual([
      'browser',
      'cloudfront',
      'alb',
      'fargate',
      'dynamodb',
    ]);
    expect(nodesAlongRoute('browser', 'dynamodb', 'agentcore')).toEqual([
      'browser',
      'cloudfront',
      'alb',
      'ac-proxy',
      'dynamodb',
    ]);
  });

  it('reaches the shared providers directly on A and through the Gateway on B', () => {
    // What the right-hand side of the diagram exists to say: engine A's task calls
    // Spotify itself, engine B cannot and goes Gateway → Lambda → Spotify.
    expect(nodesAlongRoute('fargate', 'integrations', 'valentin')).toEqual([
      'fargate',
      'integrations',
    ]);
    expect(nodesAlongRoute('ac-runtime', 'integrations', 'agentcore')).toEqual([
      'ac-runtime',
      'ac-gateway',
      'ac-lambda-tools',
      'integrations',
    ]);
  });

  /*
   * Drawn, and deliberately never routed.
   *
   * `ac-lambda-profile → dynamodb` is how `save_preference` actually reaches the table,
   * so omitting it would draw a Gateway target that reaches nothing. But nothing in the
   * drawer can observe it — the Lambda reports to CloudWatch, not to this socket — so
   * the table's engine-B parent is the proxy, whose mirrored write is the one we can
   * time. Both halves are pinned here because either alone is a lie: without the
   * segment the picture is incomplete, and without the routing ban a beat would animate
   * a hop we never measured.
   */
  it('draws the profile Lambda’s write to the table without ever routing through it', () => {
    expect(AWS_SEGMENTS.map((segment) => segment.id)).toContain('ac-lambda-profile-dynamodb');

    const ids = AWS_NODES.map((node) => node.id);
    for (const from of ids) {
      for (const to of ids) {
        const segments = routeBetween(from, to, 'agentcore').map((hop) => hop.segment);
        expect(segments, `${from}→${to}`).not.toContain('ac-lambda-profile-dynamodb');
      }
    }
  });
});

describe('nodesAlongRoute', () => {
  it('includes both endpoints in travel order', () => {
    expect(nodesAlongRoute('dynamodb', 'browser', 'valentin')).toEqual([
      'dynamodb',
      'fargate',
      'alb',
      'cloudfront',
      'browser',
    ]);
  });

  it('returns the single node when there is no hop', () => {
    expect(nodesAlongRoute('bedrock', 'bedrock', 'valentin')).toEqual(['bedrock']);
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
    expect(flowLegs('browser', 'alb', 'valentin')).toEqual([
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
    const legs = flowLegs('dynamodb', 'browser', 'valentin');

    expect(legs[0].kind).toBe('node');
    expect(legs[legs.length - 1].kind).toBe('node');
    for (let i = 1; i < legs.length; i += 1) {
      expect(legs[i].kind, `leg ${i}`).not.toBe(legs[i - 1].kind);
    }
  });

  it('carries the travel direction on every leg, so the return trip reads as one', () => {
    // Colour is by direction, not by which node it is: the browser is claret on the
    // way out and teal on the way home.
    expect(flowLegs('dynamodb', 'browser', 'valentin').every((leg) => !leg.downstream)).toBe(true);
    expect(flowLegs('browser', 'dynamodb', 'valentin').every((leg) => leg.downstream)).toBe(true);
  });

  it('visits every node on the route, so nothing is transited without a beat', () => {
    const nodes = flowLegs('dynamodb', 'browser', 'valentin')
      .filter((leg) => leg.kind === 'node')
      .map((leg) => (leg.kind === 'node' ? leg.node : null));

    expect(nodes).toEqual([...nodesAlongRoute('dynamodb', 'browser', 'valentin')]);
  });

  it('gives work with no network hop a single beat rather than none', () => {
    // Something did happen; it just happened in one place.
    expect(flowLegs('bedrock', 'bedrock', 'valentin')).toEqual([
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
    expect(isNodeInEngine('ac-lambda-tools', 'valentin')).toBe(false);
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
    // Shared resources, and engine A itself, map to themselves — and the table and
    // the providers are now shared, which is the whole change. The table used to
    // translate to an `ac-dynamodb` that existed only so a single-parent tree could
    // have two parents.
    expect(nodeForEngine('dynamodb', 'agentcore')).toBe('dynamodb');
    expect(nodeForEngine('integrations', 'agentcore')).toBe('integrations');
    expect(nodeForEngine('alb', 'agentcore')).toBe('alb');
    expect(nodeForEngine('bedrock', 'valentin')).toBe('bedrock');
  });

  it('translates back the other way too, so a stale id from either side resolves', () => {
    expect(nodeForEngine('ac-proxy', 'valentin')).toBe('fargate');
    expect(nodeForEngine('ac-runtime', 'valentin')).toBe('bedrock');
  });

  it('never maps a node onto one the target engine does not have, bar those with no counterpart', () => {
    const stranded: string[] = [];

    for (const node of AWS_NODES) {
      for (const engine of ARCHITECTURE_ENGINES) {
        if (!isNodeInEngine(nodeForEngine(node.id, engine), engine)) {
          stranded.push(`${node.id}/${engine}`);
        }
      }
    }

    /*
     * Four nodes genuinely have nothing to translate to: engine A does its own
     * memory, describes its tool schemas inline in every Converse request, and calls
     * the providers from the task itself. So Memory, the Gateway and the Gateway's two
     * Lambdas have no engine-A counterpart. All four are returned unchanged and the
     * view shades them, which is honest, rather than being mapped onto a resource the
     * other engine does not have.
     *
     * The table and the external APIs are absent from this list for the opposite
     * reason: they are literally the same resources on both engines, so they translate
     * to themselves and can never be stranded.
     */
    expect(stranded).toEqual([
      'ac-memory/valentin',
      'ac-gateway/valentin',
      'ac-lambda-profile/valentin',
      'ac-lambda-tools/valentin',
    ]);
  });

  it('routes an engine-B event down engine B, without touching engine A', () => {
    const nodes = awsNodesForEventType('agent_message', 'agentcore');
    expect(nodes).toContain('ac-runtime');
    expect(nodes).not.toContain('bedrock');
    expect(nodes).not.toContain('fargate');

    const hops = awsHopsForEventType('agent_message', 'agentcore');
    expect(hops.map((hop) => hop.segment)).toContain('ac-proxy-ac-runtime');
  });

  it('sends a span about the shared table to the one shared card, on either engine', () => {
    // Engine B mirrors preferences through the same store, so it emits
    // `resourceId: 'dynamodb'` exactly as engine A does — and now lands on the same
    // card, which is what makes "her file survived the switch" something a room can
    // watch rather than something the narrator claims.
    expect(awsNodeIdForResource('dynamodb')).toBe('dynamodb');
    expect(awsNodeIdForResource('dynamodb', 'agentcore')).toBe('dynamodb');
  });

  it('resolves the AgentCore primitives, which own no matching node id', () => {
    expect(awsNodeIdForResource('agentcore-runtime', 'agentcore')).toBe('ac-runtime');
    expect(awsNodeIdForResource('agentcore-memory', 'agentcore')).toBe('ac-memory');
    expect(awsNodeIdForResource('agentcore-gateway', 'agentcore')).toBe('ac-gateway');
  });

  it('sends a Gateway tool call to the tool Lambda, not to the provider card', () => {
    // What the proxy timed is the Gateway round trip ending in our own function, so
    // that is where the duration belongs. Landing it on the provider card instead
    // would credit Ontopo with two AWS hops it had no part in.
    expect(awsNodeIdForResource('agentcore-integrations', 'agentcore')).toBe('ac-lambda-tools');
  });
});

/*
 * The registered tool entry points are a claim about the stack, and the stack is
 * generated.
 *
 * These names go on a projector as "this is what the Gateway advertises", which is
 * worth more than a comment: they are recomputed here from the same JSON
 * `agentcore-stack.ts` spreads into `inlinePayload`, so a tool added to the registry
 * and not to the diagram fails this test instead of quietly making the panel a lie.
 */
describe('the Gateway’s registered tool entry points', () => {
  // Mirrors `agentcore-stack.ts`: one generated tool is withheld from engine B because
  // its signing key does not reach the tool Lambda, and every gated tool gains a paired
  // `confirm_*` the proxy calls once a human has pressed Confirm.
  const WITHHELD = new Set(['create_conversation_link']);
  const offered = integrationToolSchemas.filter((tool) => !WITHHELD.has(tool.name));
  const confirms = offered
    .filter((tool) => tool.requiresConfirmation)
    .map((tool) => tool.name.replace(/^propose_/, 'confirm_'));

  it('lists exactly the tools the integration Lambda is given, in schema order', () => {
    expect(awsNode('ac-lambda-tools')?.toolEntryPoints).toEqual([
      ...offered.map((tool) => tool.name),
      ...confirms,
    ]);
  });

  it('does not advertise the tool the stack withholds', () => {
    for (const withheld of WITHHELD) {
      expect(awsNode('ac-lambda-tools')?.toolEntryPoints).not.toContain(withheld);
    }
  });

  it('says on each Lambda’s card how many entry points it holds', () => {
    // The captions are the two numbers a room reads without expanding the panel, so
    // they are checked against the lists rather than trusted beside them.
    const profile = awsNode('ac-lambda-profile')!;
    const tools = awsNode('ac-lambda-tools')!;

    expect(profile.caption).toContain(`${profile.toolEntryPoints!.length} tools`);
    expect(tools.caption).toContain(`${tools.toolEntryPoints!.length} tools`);
  });

  it('registers entry points on the two Lambdas and nowhere else', () => {
    // Not on the Gateway node: the Gateway routes to targets, it does not hold code.
    // Listing the tools on it is what made the earlier diagram unanswerable when
    // someone asked which function actually runs `find_restaurants`.
    const withTools = AWS_NODES.filter((node) => node.toolEntryPoints !== undefined);
    expect(withTools.map((node) => node.id)).toEqual(['ac-lambda-profile', 'ac-lambda-tools']);
  });

  it('gives the shared provider card one mark per provider it stands for', () => {
    // The strip of logos and the card's own count cannot be allowed to disagree on a
    // projector, so one is derived from the other.
    const providers = awsNode('integrations')!;
    expect(providers.providers).toHaveLength(8);
    expect(providers.resourceName).toBe(`${providers.providers!.length} providers`);
  });

  it('puts the provider marks on the shared card and nowhere else', () => {
    const withMarks = AWS_NODES.filter((node) => node.providers !== undefined);
    expect(withMarks.map((node) => node.id)).toEqual(['integrations']);
  });
});
