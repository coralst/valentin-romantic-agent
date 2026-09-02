import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import React from 'react';
import {
  useEngineMetrics,
  percentile,
  COMMIT_INTERVAL_MS,
  LATENCY_SAMPLE_CAP,
  type UseEngineMetricsResult,
} from '../use-engine-metrics';
import { publishInboundWsEvent, resetWsObservers } from '../../utils/ws-event-observer';
import type { EngineId } from '../../../shared/interfaces/engine';
import type { TurnMetrics } from '../../../shared/interfaces/ws-events';

function turn(overrides: Partial<TurnMetrics> = {}): TurnMetrics {
  return {
    sessionId: 's1',
    engine: 'valentin',
    storeBackend: 'memory',
    modelCalls: 2,
    storeReads: 8,
    replyLatencyMs: 1200,
    ok: true,
    ...overrides,
  };
}

function send(metrics: TurnMetrics): void {
  publishInboundWsEvent({
    type: 'turn_metrics',
    payload: metrics,
    timestamp: new Date().toISOString(),
  });
}

/** Mount the hook and expose its latest snapshot. */
function mount(serving: EngineId | null = 'valentin') {
  const seen: { current: UseEngineMetricsResult | undefined } = { current: undefined };

  function Probe() {
    const metrics = useEngineMetrics(serving);
    seen.current = metrics;
    return null;
  }

  const view = render(<Probe />);
  return { seen, view };
}

/** Advance past the commit timer so the ref-held tally reaches React. */
function commit(): void {
  act(() => {
    vi.advanceTimersByTime(COMMIT_INTERVAL_MS + 1);
  });
}

describe('percentile', () => {
  it('is nearest-rank, so every result is a value something actually took', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    // Not 55, which linear interpolation would give and which nothing measured.
    expect(percentile(samples, 50)).toBe(50);
    expect(percentile(samples, 95)).toBe(100);
    expect(percentile(samples, 1)).toBe(10);
  });

  it('is undefined for an empty sample — there is no p50 of nothing', () => {
    expect(percentile([], 50)).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const samples = [3, 1, 2];
    percentile(samples, 50);
    expect(samples).toEqual([3, 1, 2]);
  });
});

describe('useEngineMetrics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetWsObservers();
    vi.useRealTimers();
  });

  it('reports nothing measured before any turn arrives', () => {
    const { seen } = mount();

    expect(seen.current?.valentin.turns).toBe(0);
    expect(seen.current?.valentin.modelCallsPerTurn).toBeUndefined();
    expect(seen.current?.valentin.replyP50Ms).toBeUndefined();
    expect(seen.current?.agentcore.turns).toBe(0);
  });

  it('averages per turn and keeps the engines apart', () => {
    const { seen } = mount();

    act(() => {
      send(turn({ engine: 'valentin', modelCalls: 2, storeReads: 8 }));
      send(turn({ engine: 'valentin', modelCalls: 3, storeReads: 10 }));
      send(turn({ engine: 'agentcore', modelCalls: 1, storeReads: 9 }));
    });
    commit();

    expect(seen.current?.valentin).toMatchObject({
      turns: 2,
      modelCallsPerTurn: 2.5,
      storeReadsPerTurn: 9,
    });
    expect(seen.current?.agentcore).toMatchObject({ turns: 1, modelCallsPerTurn: 1 });
  });

  it('attributes by the engine the server stamped, never by what the client selected', () => {
    // Selection says AgentCore; the server says it actually served engine A. The
    // frame must land on engine A, or the panel would report engine A's cost under
    // AgentCore's name.
    const { seen } = mount('agentcore');

    act(() => send(turn({ engine: 'valentin' })));
    commit();

    expect(seen.current?.valentin.turns).toBe(1);
    expect(seen.current?.agentcore.turns).toBe(0);
  });

  it('averages tokens over only the turns that reported them', () => {
    const { seen } = mount();

    act(() => {
      send(turn({ inputTokens: 900, outputTokens: 100 }));
      // Reported nothing — engine B's Runtime does this on every turn. Must not
      // drag the average toward zero.
      send(turn({}));
    });
    commit();

    expect(seen.current?.valentin.turns).toBe(2);
    expect(seen.current?.valentin.tokenTurns).toBe(1);
    expect(seen.current?.valentin.tokensPerTurn).toBe(1000);
  });

  it('leaves tokens unmeasured when no turn ever reported any', () => {
    const { seen } = mount();

    act(() => send(turn({})));
    commit();

    expect(seen.current?.valentin.tokensPerTurn).toBeUndefined();
    expect(seen.current?.valentin.tokenTurns).toBe(0);
  });

  it('keeps accumulating past 60 events, unlike the live beat buffer', () => {
    // The regression this hook exists to avoid: `use-live-architecture` caps at
    // LIVE_BEAT_LIMIT = 60 and evicts, so a scoreboard derived from it would forget
    // the first half of a demo.
    const { seen } = mount();

    act(() => {
      for (let i = 0; i < 80; i += 1) send(turn({ modelCalls: 2 }));
    });
    commit();

    expect(seen.current?.valentin.turns).toBe(80);
    expect(seen.current?.valentin.modelCallsPerTurn).toBe(2);
  });

  it('caps latency samples without losing the turn count', () => {
    const { seen } = mount();

    act(() => {
      for (let i = 0; i < LATENCY_SAMPLE_CAP + 20; i += 1) {
        send(turn({ replyLatencyMs: 1000 }));
      }
    });
    commit();

    expect(seen.current?.valentin.turns).toBe(LATENCY_SAMPLE_CAP + 20);
    expect(seen.current?.valentin.replyP50Ms).toBe(1000);
  });

  it('derives p50 and p95 from measured latencies', () => {
    const { seen } = mount();

    act(() => {
      for (const ms of [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]) {
        send(turn({ replyLatencyMs: ms }));
      }
    });
    commit();

    expect(seen.current?.valentin.replyP50Ms).toBe(500);
    expect(seen.current?.valentin.replyP95Ms).toBe(1000);
  });

  it('carries the store backend through, so the label can stay honest', () => {
    const { seen } = mount();

    act(() => send(turn({ storeBackend: 'dynamodb' })));
    commit();

    expect(seen.current?.valentin.storeBackend).toBe('dynamodb');
  });

  it('reset clears everything measured', () => {
    const { seen } = mount();

    act(() => send(turn()));
    commit();
    expect(seen.current?.valentin.turns).toBe(1);

    act(() => seen.current?.reset());
    expect(seen.current?.valentin.turns).toBe(0);
    expect(seen.current?.valentin.modelCallsPerTurn).toBeUndefined();
  });
});
