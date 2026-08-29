import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DEMO_FLOW_ID,
  DEMO_FLOWS,
  defaultDemoFlowIdFor,
  demoFlow,
  demoStepDwellMs,
  frameForStep,
  stepLegCount,
  FLOW_LEG_MS,
  type DemoFlowId,
} from '../aws-demo-flows';
import {
  ARCHITECTURE_ENGINES,
  AWS_NODES,
  isNodeInEngine,
  routeBetween,
  type AwsNodeId,
} from '../aws-architecture';

const NODE_IDS = new Set<string>(AWS_NODES.map((node) => node.id));

describe('DEMO_FLOWS', () => {
  it('ships the five flows the talk needs, including engine B', () => {
    expect(DEMO_FLOWS.map((flow) => flow.id)).toEqual([
      'page-load',
      'chat-reply',
      'learns-something',
      'proposes-a-table',
      'agentcore-learns-something',
    ]);
  });

  describe('proposes-a-table', () => {
    const steps = demoFlow('proposes-a-table').steps;

    /**
     * The order is the argument. In Israel a Saturday-night dinner is a
     * Hebrew-calendar question before it is a restaurant question, and a flow that
     * asked Ontopo first would demonstrate the bug rather than the fix.
     */
    it('checks the calendar before it looks for a table', () => {
      const operations = steps.map((step) => step.operation);
      expect(operations.indexOf('check_shabbat')).toBeGreaterThan(-1);
      expect(operations.indexOf('check_shabbat')).toBeLessThan(
        operations.indexOf('search_restaurants'),
      );
    });

    /**
     * The authority model, asserted. The proposal is not the end of the flow — the
     * confirmation travelling back out to Ontopo is, and it is the only step that
     * reaches a provider with intent to write. A flow ending at the proposal would
     * let a room assume the agent booked it.
     */
    it('ends with the confirmation reaching the provider, not with the proposal', () => {
      const last = steps[steps.length - 1];
      expect(last.operation).toBe('confirm_action');
      expect(last.from).toBe('browser');
      expect(last.to).toBe('integrations');
    });

    it('routes each provider call from the task rather than from its sibling', () => {
      // Chaining these would give from === to, which `routeBetween` reports as no
      // hop at all — a beat that lights nothing on the diagram.
      const calls = steps.filter(
        (step) => step.to === 'integrations' && step.operation !== 'confirm_action',
      );
      expect(calls.length).toBeGreaterThan(1);
      for (const call of calls) expect(call.from, call.operation).toBe('fargate');
    });

    it('says which provider it reached without saying what was asked', () => {
      for (const step of steps) {
        expect(step.detail, step.operation).not.toMatch(/@|\bhttps?:/i);
      }
    });
  });

  it('opens on a flow whose steps belong to the engine being shown', () => {
    // A flow is a list of concrete nodes, so playing engine A's script while
    // engine A is shaded would animate greyed-out cards.
    for (const engine of ARCHITECTURE_ENGINES) {
      const flow = demoFlow(defaultDemoFlowIdFor(engine));
      for (const step of flow.steps) {
        expect(isNodeInEngine(step.to, engine), `${flow.id}:${step.to}`).toBe(true);
        expect(isNodeInEngine(step.from, engine), `${flow.id}:${step.from}`).toBe(true);
      }
    }
  });

  it('tells the same story on both engines, beat for beat', () => {
    // The comparison is only fair if the script is the same on both sides: a
    // different narrative would let the room read the script as the platform.
    const engineA = demoFlow('learns-something');
    const engineB = demoFlow('agentcore-learns-something');
    const actions = (flow: typeof engineA) => [...new Set(flow.steps.map((step) => step.action))];

    expect(actions(engineB)).toEqual(actions(engineA));
    expect(engineB.steps[engineB.steps.length - 1].operation).toBe('preference_update');
  });

  it('names only real nodes, so no step can invent a resource', () => {
    for (const flow of DEMO_FLOWS) {
      for (const step of flow.steps) {
        expect(NODE_IDS.has(step.from), `${flow.id}: ${step.from}`).toBe(true);
        expect(NODE_IDS.has(step.to), `${flow.id}: ${step.to}`).toBe(true);
      }
    }
  });

  it('joins up end to end — every step starts where a step has already been', () => {
    // A `from` that no earlier step reached is a jump-cut: the diagram would
    // light a node the traffic never travelled to.
    for (const flow of DEMO_FLOWS) {
      const reached = new Set<AwsNodeId>([flow.steps[0].to]);
      for (const step of flow.steps.slice(1)) {
        expect(reached.has(step.from), `${flow.id}: ${step.from} unreached`).toBe(true);
        reached.add(step.to);
      }
    }
  });

  it('routes every step over links the real topology actually has', () => {
    // This is the property that makes an impossible arrow unrepresentable rather
    // than merely unlikely: the path is computed, never authored.
    for (const flow of DEMO_FLOWS) {
      for (const step of flow.steps) {
        if (step.from === step.to) continue;
        const hops = routeBetween(step.from, step.to);
        expect(hops.length, `${flow.id}: ${step.from}→${step.to}`).toBeGreaterThan(0);
        expect(hops[hops.length - 1].node, `${flow.id}: ${step.from}→${step.to}`).toBe(step.to);
      }
    }
  });

  it('never turns around mid-route — each hop continues from the last', () => {
    for (const flow of DEMO_FLOWS) {
      for (const step of flow.steps) {
        const hops = routeBetween(step.from, step.to);
        // A route climbs to the common ancestor then descends: once it turns
        // downstream it must never climb again.
        const directions = hops.map((hop) => hop.downstream);
        const firstDown = directions.indexOf(true);
        if (firstDown === -1) continue;
        expect(directions.slice(firstDown).every(Boolean), `${flow.id}: ${step.to}`).toBe(true);
      }
    }
  });

  it('never projects a preference value, only its category or sort key', () => {
    // The drawer goes on a screen in front of a room and the values are a real
    // person's. The mockup's first step said `"late-night jazz"` out loud.
    for (const flow of DEMO_FLOWS) {
      for (const step of flow.steps) {
        expect(step.detail.toLowerCase(), `${flow.id}: ${step.detail}`).not.toContain('jazz');
        expect(step.detail, `${flow.id}: ${step.detail}`).not.toContain('"');
      }
    }
  });

  it('gives every step an actor and an action so the feed can group it', () => {
    for (const flow of DEMO_FLOWS) {
      for (const step of flow.steps) {
        expect(step.actor.length, flow.id).toBeGreaterThan(0);
        expect(step.action.length, flow.id).toBeGreaterThan(0);
      }
    }
  });

  it('lights S3 in the page-load flow and nowhere else', () => {
    const touchesS3 = DEMO_FLOWS.filter((flow) =>
      flow.steps.some((step) => step.to === 's3' || step.from === 's3'),
    ).map((flow) => flow.id);

    expect(touchesS3).toEqual(['page-load']);
  });

  it('ends the headline flow with the preference landing back in the browser', () => {
    const flow = demoFlow('learns-something');
    const steps = flow.steps;

    expect(steps).toHaveLength(9);
    expect(steps[7]).toMatchObject({ to: 'dynamodb', operation: 'PutItem', durationMs: 18 });
    expect(steps[8]).toMatchObject({
      from: 'dynamodb',
      to: 'browser',
      operation: 'preference_update',
    });
  });

  it('makes two Converse calls in the headline flow, as the server really does', () => {
    const converse = demoFlow('learns-something').steps.filter(
      (step) => step.operation === 'Converse',
    );

    expect(converse).toHaveLength(2);
    expect(converse.map((step) => step.detail)).toEqual([
      'chat-reply',
      'extract-preferences · forced tool use',
    ]);
  });

  it('defaults to the flow the talk is built around', () => {
    expect(DEFAULT_DEMO_FLOW_ID).toBe('learns-something');
    expect(demoFlow(DEFAULT_DEMO_FLOW_ID).steps.length).toBeGreaterThan(0);
  });

  it('falls back to a real flow rather than rendering an empty drawer', () => {
    const flow = demoFlow('not-a-flow' as DemoFlowId);

    expect(flow.steps.length).toBeGreaterThan(0);
  });
});

describe('frameForStep', () => {
  const steps = demoFlow('learns-something').steps;

  it('lights only the first node at step 0', () => {
    const frame = frameForStep(steps, 0);

    expect(frame.litNode).toBe('browser');
    expect(frame.doneNodes).toEqual([]);
    expect(frame.activeHops).toEqual([]);
  });

  it('marks earlier nodes done and the current one lit', () => {
    const frame = frameForStep(steps, 2);

    expect(frame.litNode).toBe('alb');
    expect(frame.doneNodes).toContain('browser');
    expect(frame.doneNodes).toContain('cloudfront');
    expect(frame.doneNodes).not.toContain('alb');
  });

  it('reads a request as a request', () => {
    const frame = frameForStep(steps, 4); // Fargate → Bedrock

    expect(frame.litNode).toBe('bedrock');
    expect(frame.litIsResponse).toBe(false);
    expect(frame.activeHops.every((hop) => hop.downstream)).toBe(true);
  });

  it('reads the return trip as a response', () => {
    const frame = frameForStep(steps, 8); // DynamoDB → Browser

    expect(frame.litNode).toBe('browser');
    expect(frame.litIsResponse).toBe(true);
    // Mid-flight on the way home, the live hop climbs rather than descends.
    expect(frameForStep(steps, 8, 1).activeHops[0].downstream).toBe(false);
  });

  it('never lists a node as both lit and done', () => {
    for (let i = 0; i < steps.length; i += 1) {
      const frame = frameForStep(steps, i);
      if (!frame.litNode) continue;
      expect(frame.doneNodes, `step ${i}`).not.toContain(frame.litNode);
    }
  });

  /**
   * One thing highlighted at a time, which is the whole reason legs exist.
   *
   * The bug this replaces: a step lit every node on its route and animated every
   * segment the instant it became current, so step 11 of the AgentCore flow glowed
   * across eight cards at once — a picture of which resources exist rather than of
   * where the request had got to.
   */
  describe('walking a step one beat at a time', () => {
    // DynamoDB → Browser, the longest journey in the flow.
    const homeward = 8;

    it('alternates a node and a segment, and never both', () => {
      const legs = stepLegCount(steps[homeward]);
      expect(legs).toBeGreaterThan(2);

      for (let leg = 0; leg < legs; leg += 1) {
        const frame = frameForStep(steps, homeward, leg);
        const parked = frame.litNode !== undefined;
        expect(parked, `leg ${leg}`).toBe(leg % 2 === 0);
        expect(frame.activeHops.length, `leg ${leg}`).toBe(parked ? 0 : 1);
      }
    });

    it('starts where the traffic already is and ends where the step lands', () => {
      expect(frameForStep(steps, homeward, 0).litNode).toBe('dynamodb');
      expect(frameForStep(steps, homeward, 99).litNode).toBe('browser');
    });

    it('fills the trail in behind the traffic rather than all at once', () => {
      // On the first step of the flow nothing has been visited yet, so the trail is
      // purely this step's own — which is what makes the growth observable.
      const outbound = 1; // Browser → CloudFront … the descent begins.
      const first = frameForStep(steps, outbound, 0).doneNodes;
      const later = frameForStep(steps, outbound, 2).doneNodes;

      expect(first).toEqual([]);
      expect(later).toContain('browser');
      expect(later.length).toBeGreaterThan(first.length);
    });

    it('leaves the node behind it in the trail once the traffic moves on', () => {
      expect(frameForStep(steps, homeward, 0).doneNodes).not.toContain('dynamodb');
      expect(frameForStep(steps, homeward, 2).doneNodes).toContain('dynamodb');
    });

    it('withholds the duration pill until the traffic has arrived', () => {
      // The number is what the work cost; announcing it over a box nothing has
      // reached yet would be a measurement of nothing.
      const bedrock = 4;
      expect(frameForStep(steps, bedrock, 0).durations.bedrock).toBeUndefined();
      expect(frameForStep(steps, bedrock).durations.bedrock?.current).toBe(true);
    });

    it('holds a step at least as long as its legs take to walk', () => {
      // Otherwise autoplay advances mid-traversal and the animation jumps instead
      // of arriving.
      for (const step of steps) {
        expect(demoStepDwellMs(step)).toBeGreaterThanOrEqual(stepLegCount(step) * FLOW_LEG_MS);
      }
    });
  });

  it('accumulates duration pills and mutes the ones that are not current', () => {
    const frame = frameForStep(steps, 7);

    expect(frame.durations.dynamodb).toEqual({ label: '18 ms', ok: true, current: true });
    expect(frame.durations.bedrock?.current).toBe(false);
    expect(frame.durations.browser).toBeUndefined();
  });

  it('rebuilds identically when the same step is reached backwards', () => {
    // Cumulative rendering, not undo: this is what makes "wait, go back" exact.
    const forward = frameForStep(steps, 5);
    frameForStep(steps, 8);
    const backward = frameForStep(steps, 5);

    expect(backward).toEqual(forward);
  });

  it('returns an empty frame for an index before the start', () => {
    const frame = frameForStep(steps, -1);

    expect(frame.litNode).toBeUndefined();
    expect(frame.doneNodes).toEqual([]);
    expect(frame.durations).toEqual({});
  });

  it('clamps to the last step rather than throwing past the end', () => {
    const frame = frameForStep(steps, 99);

    expect(frame.litNode).toBe('browser');
  });

  it('handles an empty flow', () => {
    expect(frameForStep([], 0).litNode).toBeUndefined();
  });
});

describe('demoStepDwellMs', () => {
  it('holds a slow model call longer than a fast network hop', () => {
    const steps = demoFlow('learns-something').steps;
    const converse = steps[4];
    const albHop = steps[2];

    expect(demoStepDwellMs(converse)).toBeGreaterThan(demoStepDwellMs(albHop));
  });

  it('falls back to a sensible dwell for a step with no duration', () => {
    expect(demoStepDwellMs(undefined)).toBeGreaterThan(0);
  });
});
