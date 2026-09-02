import { useEffect, useRef, useState } from 'react';
import { subscribeToWsEvents } from '../utils/ws-event-observer';
import type { EngineId } from '../../shared/interfaces/engine';
import type { AwsSpan, TurnMetrics } from '../../shared/interfaces/ws-events';

/**
 * Accumulated, measured cost of each engine.
 *
 * Subscribes to the raw event seam rather than reading `useLiveArchitecture`'s beats,
 * for one concrete reason: that hook caps its buffer at `LIVE_BEAT_LIMIT = 60` and
 * evicts the oldest, so anything derived from it silently forgets the earlier half of
 * a demo. A comparison whose numbers quietly reset partway through a talk is worse
 * than no comparison.
 *
 * Nothing here is ever estimated. A value nobody measured stays `undefined` all the
 * way to the view, which renders `—` — the rule `use-aws-spans.ts` already follows.
 */

/** How many latency samples to keep per engine before dropping the oldest. */
export const LATENCY_SAMPLE_CAP = 500;

/**
 * How often accumulated counts are published to React.
 *
 * Live traffic arrives in bursts of a dozen spans; a `setState` per span would
 * re-render the whole drawer on each one. The tally lives in a ref and a snapshot is
 * committed on this interval instead.
 */
export const COMMIT_INTERVAL_MS = 400;

/** What one engine has been measured doing. All fields absent until measured. */
export interface EngineTally {
  /** Completed turns seen. `0` means nothing below this is meaningful. */
  turns: number;
  /** Mean model calls per turn, or undefined with no turns. */
  modelCallsPerTurn?: number;
  /** Mean store reads per turn, or undefined with no turns. */
  storeReadsPerTurn?: number;
  /** Which store those reads hit, from the last turn that said. */
  storeBackend?: 'memory' | 'dynamodb';
  /** Mean total tokens per turn, over only those turns that reported any. */
  tokensPerTurn?: number;
  /** Turns that actually reported token usage. */
  tokenTurns: number;
  /** Reply latency percentiles across all measured turns. */
  replyP50Ms?: number;
  replyP95Ms?: number;
}

export interface EngineMetrics {
  valentin: EngineTally;
  agentcore: EngineTally;
  /**
   * Spans seen that could not be attributed to an engine, and were dropped.
   *
   * Surfaced rather than swallowed: a non-zero count here means the server is older
   * than this contract, and the honest response is a visible caveat, not a number
   * quietly assembled from half the traffic.
   */
  unattributed: number;
}

/** The mutable per-engine accumulator behind {@link EngineTally}. */
interface EngineAccumulator {
  turns: number;
  modelCalls: number;
  storeReads: number;
  storeBackend?: 'memory' | 'dynamodb';
  tokens: number;
  tokenTurns: number;
  latencies: number[];
}

function emptyAccumulator(): EngineAccumulator {
  return {
    turns: 0,
    modelCalls: 0,
    storeReads: 0,
    tokens: 0,
    tokenTurns: 0,
    latencies: [],
  };
}

/**
 * Nearest-rank percentile.
 *
 * Nearest-rank rather than linear interpolation on purpose: interpolating invents a
 * duration between two real ones and reports it as p95. Every number this panel shows
 * should be a value something actually took.
 *
 * Returns undefined for an empty sample — there is no p50 of nothing.
 */
export function percentile(samples: readonly number[], p: number): number | undefined {
  if (samples.length === 0) return undefined;

  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

function summarize(acc: EngineAccumulator): EngineTally {
  if (acc.turns === 0) {
    return { turns: 0, tokenTurns: 0, storeBackend: acc.storeBackend };
  }

  return {
    turns: acc.turns,
    modelCallsPerTurn: acc.modelCalls / acc.turns,
    storeReadsPerTurn: acc.storeReads / acc.turns,
    storeBackend: acc.storeBackend,
    // Divided by the turns that *reported* usage, not by all turns. Engine B reports
    // none today, and averaging its zeros over its turns would show a real-looking
    // small number instead of the truth, which is that nobody counted.
    tokensPerTurn: acc.tokenTurns === 0 ? undefined : acc.tokens / acc.tokenTurns,
    tokenTurns: acc.tokenTurns,
    replyP50Ms: percentile(acc.latencies, 50),
    replyP95Ms: percentile(acc.latencies, 95),
  };
}

/**
 * Which engine a frame belongs to.
 *
 * Precedence is deliberate and the fallback is a drop, not a guess:
 *   1. the engine the *server* stamped — the only authoritative answer;
 *   2. `servingEngine`, which is `/api/config`'s answer about who is really serving;
 *   3. nothing. Counted as unattributed and discarded.
 *
 * The client's *selection* is never consulted. Selecting AgentCore against a
 * deployment without the AgentCore wiring gets you engine A's answers on engine B's
 * socket (see `server/agent/engine.ts`), and attributing by selection would file
 * engine A's latency under AgentCore — the single failure this panel must not have.
 */
function attribute(
  stamped: EngineId | undefined,
  servingEngine: EngineId | null,
): EngineId | undefined {
  return stamped ?? servingEngine ?? undefined;
}

export interface UseEngineMetricsResult extends EngineMetrics {
  /** Discard everything measured so far. */
  reset: () => void;
}

/**
 * Accumulate both engines' measured cost for as long as this is mounted.
 *
 * Mount it ABOVE the panel that displays it — in the drawer, not in the sheet — so
 * accumulation continues while the sheet is closed. And note what this deliberately
 * does *not* do: it does not clear on engine switch. The drawer clears its beats on
 * switch on purpose, but measuring engine B requires switching to it, so a scoreboard
 * that reset at the same moment could never hold both engines at once and the
 * comparison would be structurally impossible.
 */
export function useEngineMetrics(servingEngine: EngineId | null): UseEngineMetricsResult {
  const accumulators = useRef<Record<EngineId, EngineAccumulator>>({
    valentin: emptyAccumulator(),
    agentcore: emptyAccumulator(),
  });
  const unattributed = useRef(0);
  const dirty = useRef(false);

  // Read through a ref so the subscription below never needs re-establishing when the
  // serving engine resolves. Resubscribing would be harmless but would drop any frame
  // arriving in the gap.
  const serving = useRef(servingEngine);
  serving.current = servingEngine;

  const [snapshot, setSnapshot] = useState<EngineMetrics>(() => ({
    valentin: summarize(emptyAccumulator()),
    agentcore: summarize(emptyAccumulator()),
    unattributed: 0,
  }));

  useEffect(() => {
    const unsubscribe = subscribeToWsEvents(({ direction, event }) => {
      // Outbound frames are the client's own; they carry no measurement.
      if (direction !== 'inbound') return;

      if (event.type === 'turn_metrics') {
        recordTurn(event.payload as TurnMetrics);
        return;
      }

      if (event.type === 'aws_span') {
        recordSpan(event.payload as AwsSpan);
      }
    });

    function recordTurn(turn: TurnMetrics): void {
      // A turn frame carries its own engine and is never inferred — the server
      // counted it, so it says who counted.
      const acc = accumulators.current[turn.engine];
      if (!acc) return;

      acc.turns += 1;
      acc.modelCalls += turn.modelCalls;
      acc.storeReads += turn.storeReads;
      acc.storeBackend = turn.storeBackend;
      acc.latencies.push(turn.replyLatencyMs);
      if (acc.latencies.length > LATENCY_SAMPLE_CAP) acc.latencies.shift();

      const total = (turn.inputTokens ?? 0) + (turn.outputTokens ?? 0);
      if (turn.inputTokens !== undefined || turn.outputTokens !== undefined) {
        acc.tokens += total;
        acc.tokenTurns += 1;
      }

      dirty.current = true;
    }

    function recordSpan(span: AwsSpan): void {
      // Spans contribute nothing the turn frame does not already carry, with one
      // exception worth keeping: they are how we notice traffic from a server that
      // predates `turn_metrics` and therefore cannot be attributed at all.
      const engine = attribute(span.engine, serving.current);
      if (engine) return;

      unattributed.current += 1;
      dirty.current = true;
    }

    return unsubscribe;
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!dirty.current) return;
      dirty.current = false;

      setSnapshot({
        valentin: summarize(accumulators.current.valentin),
        agentcore: summarize(accumulators.current.agentcore),
        unattributed: unattributed.current,
      });
    }, COMMIT_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  return {
    ...snapshot,
    reset: () => {
      accumulators.current = { valentin: emptyAccumulator(), agentcore: emptyAccumulator() };
      unattributed.current = 0;
      dirty.current = false;
      setSnapshot({
        valentin: summarize(emptyAccumulator()),
        agentcore: summarize(emptyAccumulator()),
        unattributed: 0,
      });
    },
  };
}
