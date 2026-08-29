import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DEMO_FLOW_ID,
  DEMO_FLOWS,
  demoFlow,
  demoStepDwellMs,
  frameForStep,
  type DemoFlowId,
} from '../aws-demo-flows';
import { AWS_NODES, routeBetween, type AwsNodeId } from '../aws-architecture';

const NODE_IDS = new Set<string>(AWS_NODES.map((node) => node.id));

describe('DEMO_FLOWS', () => {
  it('ships the four flows the talk needs', () => {
    expect(DEMO_FLOWS.map((flow) => flow.id)).toEqual([
      'page-load',
      'chat-reply',
      'learns-something',
      'proposes-a-table',
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
    expect(steps[8]).toMatchObject({ from: 'dynamodb', to: 'browser', operation: 'preference_update' });
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
    expect(frame.activeHops[0].downstream).toBe(false);
  });

  it('marks transited nodes as passed, not arrived at', () => {
    const frame = frameForStep(steps, 8);

    // Fargate, ALB and CloudFront are travelled through on the way back.
    expect(frame.passNodes).toContain('fargate');
    expect(frame.passNodes).toContain('cloudfront');
    expect(frame.passNodes).not.toContain('browser');
  });

  it('never lists a node as both lit and something else', () => {
    for (let i = 0; i < steps.length; i += 1) {
      const frame = frameForStep(steps, i);
      if (!frame.litNode) continue;
      expect(frame.passNodes, `step ${i}`).not.toContain(frame.litNode);
      expect(frame.doneNodes, `step ${i}`).not.toContain(frame.litNode);
    }
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
