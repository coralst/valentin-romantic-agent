import { subscribeToServerLogs, type ServerLogRecord } from '../logging';
import { config } from '../config';
import { resolveEngine } from '../agent/engine';
import type { EngineId } from '../../shared/interfaces/engine';
import type {
  AwsSpan,
  ServerEvent,
  SpanTokenUsage,
  TurnMetrics,
} from '../../shared/interfaces/ws-events';
import type { IntegrationId } from '../../shared/interfaces/integrations';
import {
  INTEGRATION_IDS,
  INTEGRATION_LABELS,
} from '../../shared/interfaces/integrations';

/**
 * The log-event prefix `runTool` writes, e.g. `integration.ontopo`.
 *
 * One constant so the producer and this reader cannot drift; `runTool` builds the
 * event name from the same shape.
 */
const INTEGRATION_EVENT_PREFIX = 'integration.';

/**
 * Emits a server event to one user's clients. Same shape as `index.ts`'s
 * `emitFor`, curried the other way round.
 *
 * The userId is not redundant with the span's sessionId: session ids live under
 * a user in storage, so two users can hold the same one, and a session-only
 * broadcast would put one person's spans on another person's screen.
 */
export type SpanEmitter = (userId: string, event: ServerEvent) => void;

/** Read a string field, or undefined if absent or the wrong type. */
function str(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** Read a finite number field, or undefined. */
function num(data: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The AgentCore resources' own names, read off the identifiers the proxy is
 * already given rather than from three new environment variables.
 *
 * A Runtime ARN ends in `.../valentin_agent_dev-SUFFIX` and a Gateway URL starts
 * `https://valentin-gateway-dev-SUFFIX.gateway...`, so the deployed name is
 * already in hand on the one path where these spans can fire. Unset means engine
 * B was never configured here, in which case no `agentcore.*` line is logged
 * either — the placeholder exists so a span can never carry an empty name.
 */
const UNNAMED_RESOURCE = 'not configured';

function agentCoreRuntimeName(): string {
  const arn = config.agentCore.runtimeArn;
  if (!arn) return UNNAMED_RESOURCE;
  return arn.split('/').pop() || arn;
}

function agentCoreGatewayName(): string {
  const url = config.agentCore.gatewayUrl;
  if (!url) return UNNAMED_RESOURCE;
  try {
    return new URL(url).hostname.split('.')[0];
  } catch {
    // A malformed URL is a misconfiguration worth seeing in the feed rather than
    // a reason to drop the span; the tool call itself really did happen.
    return url;
  }
}

/**
 * Read token counts off a log record, or undefined when it carried none.
 *
 * Undefined rather than `{inputTokens: 0}` when absent, so the client can tell "nobody
 * counted" from "counted zero" — the rule `AwsSpan.durationMs` already sets.
 */
function tokenUsage(data: Record<string, unknown> | undefined): SpanTokenUsage | undefined {
  const inputTokens = num(data, 'inputTokens');
  const outputTokens = num(data, 'outputTokens');
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens, outputTokens };
}

/**
 * Which engine this process serves.
 *
 * Resolved lazily and once. Per-process by design — see `agent/engine.ts` — so it
 * cannot be read off the record, and re-resolving per span would repeat the downgrade
 * error line on every call.
 */
let cachedEngine: EngineId | undefined;

function spanEngine(): EngineId {
  cachedEngine ??= resolveEngine();
  return cachedEngine;
}

/** Forget the cached engine. Test helper. */
export function resetSpanEngine(): void {
  cachedEngine = undefined;
}

/**
 * Translate an `agent.turn` record into per-turn metrics, or undefined.
 *
 * A sibling of {@link logRecordToSpan} rather than a case inside it, because a turn is
 * not a span: it has no resource, no operation and no single duration, and widening
 * `logRecordToSpan`'s return type would have meant editing every one of its existing
 * tests to prove nothing new.
 *
 * Absent token fields stay absent. `'inputTokens' in data` is the distinction the
 * emitter went to trouble to preserve, and defaulting them to `0` here would throw it
 * away at the last step.
 */
export function logRecordToTurnMetrics(record: ServerLogRecord): TurnMetrics | undefined {
  if (record.event !== 'agent.turn') return undefined;

  const { data } = record;
  const sessionId = str(data, 'sessionId');
  const engine = str(data, 'engine');
  const storeBackend = str(data, 'storeBackend');
  const modelCalls = num(data, 'modelCalls');
  const storeReads = num(data, 'storeReads');
  const replyLatencyMs = num(data, 'replyLatencyMs');

  // A malformed line is dropped rather than published with holes in it. The panel
  // divides by `modelCalls`, and a partial frame would skew an average silently.
  if (!sessionId || modelCalls === undefined || storeReads === undefined) return undefined;
  if (replyLatencyMs === undefined) return undefined;
  if (engine !== 'valentin' && engine !== 'agentcore') return undefined;
  if (storeBackend !== 'memory' && storeBackend !== 'dynamodb') return undefined;

  const inputTokens = num(data, 'inputTokens');
  const outputTokens = num(data, 'outputTokens');
  const tokens =
    inputTokens === undefined && outputTokens === undefined ? {} : { inputTokens, outputTokens };

  return {
    sessionId,
    engine,
    storeBackend,
    modelCalls,
    storeReads,
    replyLatencyMs,
    ok: data?.ok !== false,
    ...tokens,
  };
}

/**
 * Translate a structured log record into a span, or undefined to ignore it.
 *
 * Only recognised events map. That asymmetry is deliberate: the server logs
 * plenty of things that are not AWS calls, and the bridge must never have to
 * know every call site in order to stay correct. Adding a span later means
 * adding a case here, not editing the code that does the work.
 *
 * `sessionId` is stamped at the **top level** of the span. `resolveBroadcastSessionId`
 * reads `payload.sessionId`, `payload.message.sessionId` and
 * `payload.preference.sessionId` and nothing else — a span that nested its
 * session anywhere else would be silently dropped, never reaching any client.
 */
export function logRecordToSpan(record: ServerLogRecord): AwsSpan | undefined {
  const { event, data } = record;

  switch (event) {
    case 'preference.saved': {
      const sessionId = str(data, 'sessionId');
      const category = str(data, 'category');
      if (!sessionId) return undefined;

      return {
        sessionId,
        resourceId: 'dynamodb',
        service: 'Amazon DynamoDB',
        resourceName: config.dynamoTableName,
        operation: 'PutItem',
        durationMs: num(data, 'durationMs') ?? 0,
        ok: record.level !== 'error',
        // The sort key, not the value. This is projected in front of a room and
        // the values are a real person's private preferences.
        detail: category ? `PREF#${category}` : undefined,
      };
    }

    case 'bedrock.converse': {
      const sessionId = str(data, 'sessionId');
      const durationMs = num(data, 'durationMs');
      if (!sessionId || durationMs === undefined) return undefined;

      return {
        sessionId,
        resourceId: 'bedrock',
        service: 'Amazon Bedrock',
        resourceName: str(data, 'modelId') ?? config.bedrockModelId,
        // The client counts model calls by `operation === 'Converse'`, so the
        // API name belongs here and the which-call-was-it goes in `detail`.
        operation: 'Converse',
        durationMs,
        ok: data?.ok !== false,
        detail: str(data, 'operation'),
        usage: tokenUsage(data),
        engine: spanEngine(),
      };
    }

    case 'agentcore.invoke': {
      const sessionId = str(data, 'sessionId');
      const durationMs = num(data, 'durationMs');
      if (!sessionId || durationMs === undefined) return undefined;

      const toolsUsed = num(data, 'toolsUsed');
      return {
        sessionId,
        // Not a node id: engine B's Runtime is `ac-runtime` in the diagram, and
        // `awsNodeIdForResource` is what knows that. Keeping the wire name the
        // service's own means a renamed node never silently drops a span.
        resourceId: 'agentcore-runtime',
        service: 'AgentCore Runtime',
        resourceName: agentCoreRuntimeName(),
        // The client counts model calls by this, alongside Converse: one
        // InvokeAgentRuntime is one turn of the model, just made a hop further out.
        operation: 'InvokeAgentRuntime',
        durationMs,
        ok: data?.ok !== false,
        // The count, never the tool arguments — those carry partner data.
        detail: toolsUsed ? `${toolsUsed} tool call${toolsUsed === 1 ? '' : 's'}` : undefined,
        // TODO(yellow): engine B tokens are unreported. `agentcore/agent.py` returns
        // `content` and `tools_used` only, so `tokenUsage` finds nothing here and the
        // scoreboard's token tile shows `—` for AgentCore. That is the correct display
        // for an unmeasured value, not a gap to paper over — fixing it means extending
        // the Runtime container and redeploying it.
        usage: tokenUsage(data),
        engine: spanEngine(),
      };
    }

    case 'agentcore.memory': {
      const sessionId = str(data, 'sessionId');
      const operation = str(data, 'operation');
      const durationMs = num(data, 'durationMs');
      if (!sessionId || !operation || durationMs === undefined) return undefined;

      const recordCount = num(data, 'recordCount');
      return {
        sessionId,
        resourceId: 'agentcore-memory',
        service: 'AgentCore Memory',
        resourceName: config.agentCore.memoryId ?? UNNAMED_RESOURCE,
        // CreateEvent or ListMemoryRecords — the adapter says which, and the two
        // are different beats in the story, so neither is flattened away here.
        operation,
        durationMs,
        ok: data?.ok !== false,
        detail: recordCount === undefined ? undefined : `${recordCount} records`,
      };
    }

    case 'agentcore.gateway': {
      const sessionId = str(data, 'sessionId');
      const tool = str(data, 'tool');
      if (!sessionId || !tool) return undefined;

      return {
        sessionId,
        resourceId: 'agentcore-gateway',
        service: 'AgentCore Gateway',
        resourceName: agentCoreGatewayName(),
        // The tool name is the operation, because that is what the Gateway was
        // asked for. `durationMs` is deliberately absent: this call happened
        // inside the Runtime and the proxy only learns of it from the reply, so
        // there is no measurement to report. See `AwsSpan.durationMs`.
        operation: tool,
        ok: record.level !== 'error',
        detail: 'via valentin-profile-tools-dev',
      };
    }

    default:
      return integrationSpan(record);
  }
}

/**
 * Map an `integration.<service>` log onto the diagram's External APIs node.
 *
 * A prefix match against the closed {@link INTEGRATION_IDS} set rather than six
 * near-identical `case` arms. That keeps the bridge's "only recognised events map"
 * rule intact — an id not in the union is still ignored — without six copies of the
 * same six lines, which is where a typo would hide.
 *
 * `resourceId` is the *node*, not the service, because the diagram carries one
 * grouped node: six cards do not read on a projector. Which service fired shows in
 * `resourceName`, so a single node still says "ontopo, 412ms" out loud.
 *
 * `operation` is the tool name and there is no `detail` at all. The tool name is the
 * whole of what is safe to show: a search carries a city and a party size, but a
 * proposed message carries prose about someone's partner, and this is on a
 * projector. `runTool` never logs the tool input for the same reason, so there is
 * nothing here to leak even by accident.
 */
function integrationSpan(record: ServerLogRecord): AwsSpan | undefined {
  const { event, data } = record;
  if (!event.startsWith(INTEGRATION_EVENT_PREFIX)) return undefined;

  const service = event.slice(INTEGRATION_EVENT_PREFIX.length);
  if (!INTEGRATION_IDS.includes(service as IntegrationId)) return undefined;

  const sessionId = str(data, 'sessionId');
  if (!sessionId) return undefined;

  return {
    sessionId,
    resourceId: 'integrations',
    service: 'External APIs',
    resourceName: INTEGRATION_LABELS[service as IntegrationId],
    operation: str(data, 'operation') ?? 'call',
    durationMs: num(data, 'durationMs') ?? 0,
    ok: data?.ok !== false && record.level !== 'error',
  };
}

/**
 * Bridge the server's structured logs onto the wire as `aws_span` events.
 *
 * Subscribes to the log seam rather than being called from each AWS call site.
 * `dynamodb-store.ts` already logged `preference.saved` with everything needed,
 * so DynamoDB spans cost zero edits to the store — and a refactor there cannot
 * break telemetry it does not reference.
 *
 * This is deliberately not load-bearing: remove the call and the drawer still
 * opens, still highlights from WebSocket events, and still passes its tests. It
 * adds measured durations; it is not the thing that makes the drawer work.
 *
 * Call this **once per process**, not once per connection: the returned
 * unsubscribe is the only way to detach, and a per-connection bridge that
 * discarded it would leak a subscriber per socket.
 *
 * Returns an unsubscribe function.
 */
export function startSpanBridge(emit: SpanEmitter): () => void {
  return subscribeToServerLogs((record) => {
    // Read before the span, because an `agent.turn` line is never a span and the
    // two mappers are mutually exclusive by event name.
    const metrics = logRecordToTurnMetrics(record);
    const span = metrics ? undefined : logRecordToSpan(record);
    if (!metrics && !span) return;

    // No user, nowhere to send it. `logging.ts` supplies this from the ambient
    // user scope for anything logged while serving a socket message, so a
    // missing one means the log came from outside a request — a boot-time or
    // background line, which no client is waiting on.
    const userId = str(record.data, 'userId');
    if (!userId) return;

    const timestamp = new Date().toISOString();

    if (metrics) {
      emit(userId, { type: 'turn_metrics', payload: metrics, timestamp });
      return;
    }

    emit(userId, {
      type: 'aws_span',
      // Narrowed by the guard above; `span` is defined whenever `metrics` is not.
      payload: span as AwsSpan,
      timestamp,
    });
  });
}
