import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '../logging';
import { resolveEngine } from '../agent/engine';
import { resolveStorageBackend, type StorageBackend } from '../persistence/create-store';
import type { EngineId } from '../../shared/interfaces/engine';
import type { SpanTokenUsage, TurnMetrics } from '../../shared/interfaces/ws-events';

/**
 * Per-turn cost accounting.
 *
 * An ambient scope rather than a threaded parameter, for the reason `withUserScope`
 * in `logging.ts` gives about the same problem: the Bedrock client and the store are
 * process singletons shared by every connection, and neither is handed anything
 * identifying the turn. Threading a turn id to them would mean editing
 * `BedrockClient`, `StorageInterface`, both orchestrators and the extractor to carry
 * a value none of them otherwise needs.
 *
 * What this exists to measure: engine A fires a *second* forced-tool
 * `extract-preferences` Converse on every turn on top of the reply, and a tool round
 * adds a third. Counting calls per turn is the only way to show that, because a span
 * knows its own operation but not which turn it belonged to.
 */

/**
 * What a turn is being counted against.
 *
 * Only the session is passed in. The engine and the store backend are properties of
 * the *process*, not of the turn — `resolveEngine()` is per-process by design (see
 * its header comment) and `STORAGE_BACKEND` is read once at boot — so asking the
 * caller for them would invite a call site that passes the selected engine instead of
 * the resolved one, which is the exact mislabelling this whole panel guards against.
 * Both are overridable for tests.
 */
interface TurnContext {
  sessionId: string;
  engine?: EngineId;
  storeBackend?: StorageBackend;
}

/**
 * Resolved once, lazily.
 *
 * Not at module load: `resolveEngine()` logs an error when AgentCore is requested but
 * unwired, and doing that at import time would fire it during every unrelated unit
 * test that happens to pull this module in. Not per turn either — it would repeat that
 * log line on every message.
 */
let processContext: { engine: EngineId; storeBackend: StorageBackend } | undefined;

function resolveProcessContext(): { engine: EngineId; storeBackend: StorageBackend } {
  processContext ??= { engine: resolveEngine(), storeBackend: resolveStorageBackend() };
  return processContext;
}

/** Forget the cached process context. Test helper. */
export function resetProcessContext(): void {
  processContext = undefined;
}

/** The mutable tally for one turn. */
interface TurnTally {
  readonly sessionId: string;
  readonly engine: EngineId;
  readonly storeBackend: StorageBackend;
  readonly startedAt: number;
  modelCalls: number;
  storeReads: number;
  inputTokens: number;
  outputTokens: number;
  /**
   * How many calls reported usage at all.
   *
   * Kept so the emitted frame can omit token fields entirely when nothing reported
   * them, rather than publishing a `0` that reads as a free turn. Engine B's Runtime
   * reports no usage today, so this is `0` for every one of its turns.
   */
  usageReports: number;
  ok: boolean;
}

const turnScope = new AsyncLocalStorage<TurnTally>();

/**
 * Run `fn` as one measured turn, emitting a single `agent.turn` log line when it
 * settles.
 *
 * `span-bridge.ts` turns that line into a `turn_metrics` frame, so this module never
 * needs to know a socket exists — the same seam every other piece of telemetry here
 * rides on.
 *
 * The scope stays open for the whole of `fn`, which matters because the preference
 * extractor is deliberately *not* awaited by the orchestrator. Callers that want the
 * extractor's model call counted must keep it inside this scope; see the note at the
 * call site in `ws-gateway.ts`.
 */
export async function withTurn<T>(context: TurnContext, fn: () => Promise<T>): Promise<T> {
  const resolved = resolveProcessContext();
  const tally: TurnTally = {
    sessionId: context.sessionId,
    engine: context.engine ?? resolved.engine,
    storeBackend: context.storeBackend ?? resolved.storeBackend,
    startedAt: Date.now(),
    modelCalls: 0,
    storeReads: 0,
    inputTokens: 0,
    outputTokens: 0,
    usageReports: 0,
    ok: true,
  };

  return turnScope.run(tally, async () => {
    try {
      return await fn();
    } catch (error) {
      tally.ok = false;
      throw error;
    } finally {
      // In `finally` rather than after the `await`, so a turn that threw is still
      // counted. A failed turn still cost model calls and store reads, and a panel
      // that only counted successes would flatter whichever engine fails more.
      emit(tally);
    }
  });
}

/**
 * The turn in progress, or `undefined` outside one.
 *
 * Every recorder below is a no-op when this is `undefined`, which is what keeps
 * `npm test`, `POST /api/session/seed` and boot-time reads from emitting phantom
 * turns.
 */
function currentTurn(): TurnTally | undefined {
  return turnScope.getStore();
}

/** Count one model call, and its tokens when the provider reported them. */
export function recordModelCall(usage?: SpanTokenUsage): void {
  const tally = currentTurn();
  if (!tally) return;

  tally.modelCalls += 1;

  if (usage?.inputTokens === undefined && usage?.outputTokens === undefined) return;

  tally.usageReports += 1;
  tally.inputTokens += usage.inputTokens ?? 0;
  tally.outputTokens += usage.outputTokens ?? 0;
}

/** Count one read against the conversation store. Writes are not counted. */
export function recordStoreRead(): void {
  const tally = currentTurn();
  if (!tally) return;

  tally.storeReads += 1;
}

/** True when a turn is in scope. Test seam, and a guard for expensive detail. */
export function isInTurn(): boolean {
  return currentTurn() !== undefined;
}

function emit(tally: TurnTally): void {
  const metrics: TurnMetrics = {
    sessionId: tally.sessionId,
    engine: tally.engine,
    storeBackend: tally.storeBackend,
    modelCalls: tally.modelCalls,
    storeReads: tally.storeReads,
    replyLatencyMs: Date.now() - tally.startedAt,
    ok: tally.ok,
  };

  // Spread conditionally so the keys are *absent*, not `undefined`. `JSON.stringify`
  // drops an explicit `undefined` anyway, but the in-process subscriber in
  // `span-bridge` reads the object directly and `'inputTokens' in data` is the check
  // that distinguishes "nobody counted" from "counted zero".
  const withTokens =
    tally.usageReports === 0
      ? metrics
      : { ...metrics, inputTokens: tally.inputTokens, outputTokens: tally.outputTokens };

  logger.info('agent.turn', { ...withTokens });
}
