import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  InvokeAgentRuntimeCommand,
  ListMemoryRecordsCommand,
  Role,
} from '@aws-sdk/client-bedrock-agentcore';
import { config } from '../config';
import { logger } from '../logging';
import type { ChatMessage } from '../../shared/interfaces/message';
import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';
import type { PreferenceCategory } from '../../shared/interfaces/preference';

/** Abstract interface for AWS AgentCore lifecycle management */
export interface AgentCoreAdapter {
  /** Register the Valentin agent with AgentCore on startup */
  registerAgent(): Promise<string>;

  /** Create an AgentCore session for a user session */
  createSession(sessionId: string): Promise<string>;
}

/**
 * Stub AgentCore adapter for local development.
 *
 * Still the right thing for engine A: the baseline orchestrator calls
 * `createSession` for symmetry with engine B, but nothing about its behaviour
 * depends on the answer. Engine B uses {@link AgentCoreRuntime} instead.
 */
export class StubAgentCoreAdapter implements AgentCoreAdapter {
  async registerAgent(): Promise<string> {
    // Stub returns a placeholder agent ID
    return 'stub-agent-valentin-001';
  }

  async createSession(sessionId: string): Promise<string> {
    // Stub maps the session 1:1
    return `agentcore-session-${sessionId}`;
  }
}

/** One turn to send to the Runtime. */
export interface AgentCoreTurn {
  sessionId: string;
  /**
   * Whose memory this is. The Cognito `sub`, not the session id.
   *
   * AgentCore Memory partitions by (actorId, sessionId) and the configured
   * namespace is `/valentin/{actorId}/{sessionId}`, so passing a session id here
   * would file every conversation under a different "person" and the managed
   * preference extraction would never accumulate anything.
   */
  actorId: string;
  /** The user's message. */
  prompt: string;
  /** Valentin's persona plus the profile, exactly as engine A builds it. */
  systemPrompt: string;
  /** Recent turns, oldest first, already trimmed to the token budget. */
  history: readonly ChatMessage[];
}

/** What the Runtime sent back. */
export interface AgentCoreReply {
  content: string;
  /** The Runtime's own session id, for correlating its traces with ours. */
  runtimeSessionId?: string;
  /** X-Ray trace id, when the Runtime returned one. */
  traceId?: string;
  /** Names of the Gateway tools the agent called, in order, if it reported them. */
  toolsUsed: string[];
}

/**
 * A preference AgentCore's managed extraction inferred on its own.
 *
 * This is the row that the comparison is actually about: engine A produces the
 * same shape from `preference-extractor.ts`, a hand-written Bedrock tool-use
 * pipeline, and engine B gets it from `userPreferenceMemoryStrategy` for free.
 */
export interface RememberedPreference {
  category: PreferenceCategory;
  key: string;
  value: string;
  confidence: number;
  /** The memory record id, so a mirror write can be traced back. */
  recordId: string;
}

/** Engine B's data plane: invoke the Runtime, and read and write its Memory. */
export interface AgentCoreRuntime {
  invoke(turn: AgentCoreTurn): Promise<AgentCoreReply>;

  /**
   * File one exchange as a Memory event, which is what triggers the managed
   * extraction. Both halves of the turn go in one call so the extractor sees the
   * question its answer belongs to.
   */
  recordTurn(
    sessionId: string,
    actorId: string,
    userText: string,
    agentText: string,
  ): Promise<void>;

  /** Everything the managed strategy has extracted for this session so far. */
  recallPreferences(sessionId: string, actorId: string): Promise<RememberedPreference[]>;
}

/**
 * Engine B is unavailable when this throws at construction.
 *
 * Thrown rather than returning a null client so that a proxy task that is
 * missing its wiring fails at boot with a legible message, instead of serving
 * every request with a generic apology that looks like an AgentCore latency
 * problem in the comparison.
 */
export class AgentCoreNotConfiguredError extends Error {
  constructor(missing: string) {
    super(
      `AgentCore engine requires ${missing}. compute-stack.ts sets it on the proxy service only; ` +
        'a task running engine B without it cannot reach the Runtime.',
    );
    this.name = 'AgentCoreNotConfiguredError';
  }
}

/** The categories the mirror is allowed to write, as a set for O(1) checks. */
const VALID_CATEGORIES = new Set<string>(PREFERENCE_CATEGORIES);

/**
 * How many extracted records to read back per turn.
 *
 * The managed strategy consolidates rather than appends, so this is a profile
 * size and not a conversation length. Bounded anyway: this runs after every turn
 * and an unbounded page would grow the tail latency of the mirror with the
 * length of the relationship.
 */
const MAX_MEMORY_RECORDS = 100;

/**
 * The real thing: AgentCore Runtime for inference, AgentCore Memory for state.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not stream. `InvokeAgentRuntime` returns a streaming blob and the
 * Runtime's `/invocations` contract can produce SSE, but
 * `AgentOrchestratorInterface.handleMessage` is turn-based for both engines, and
 * streaming only engine B would hand it a time-to-first-token advantage that
 * came from the transport rather than from AgentCore. When engine A learns to
 * stream, this reads `response` incrementally instead — the wire format already
 * allows it.
 *
 * It does not call Bedrock. Engine B's task role has no `bedrock:InvokeModel`
 * (see compute-stack.ts), so a fallback here would fail with AccessDenied rather
 * than quietly answer with engine A's pipeline under engine B's label.
 */
export class BedrockAgentCoreRuntime implements AgentCoreRuntime {
  private readonly client: BedrockAgentCoreClient;
  private readonly runtimeArn: string;
  private readonly memoryId: string;

  constructor(
    runtimeArn = config.agentCore.runtimeArn,
    memoryId = config.agentCore.memoryId,
    client?: BedrockAgentCoreClient,
  ) {
    if (!runtimeArn) throw new AgentCoreNotConfiguredError('AGENTCORE_RUNTIME_ARN');
    if (!memoryId) throw new AgentCoreNotConfiguredError('AGENTCORE_MEMORY_ID');

    this.runtimeArn = runtimeArn;
    this.memoryId = memoryId;
    this.client = client ?? new BedrockAgentCoreClient({ region: config.awsRegion });
  }

  async invoke(turn: AgentCoreTurn): Promise<AgentCoreReply> {
    const started = Date.now();
    const payload = {
      prompt: turn.prompt,
      system_prompt: turn.systemPrompt,
      session_id: turn.sessionId,
      actor_id: actorIdFor(turn.actorId),
      memory_id: this.memoryId,
      history: turn.history.map((message) => ({
        role: message.sender === 'user' ? 'user' : 'assistant',
        content: message.content,
      })),
    };

    try {
      const response = await this.client.send(
        new InvokeAgentRuntimeCommand({
          agentRuntimeArn: this.runtimeArn,
          // The Runtime keys its own session state on this. Reusing our session
          // id is what lets a conversation resume against the same Runtime
          // session instead of starting cold on every message.
          runtimeSessionId: runtimeSessionIdFor(turn.sessionId),
          runtimeUserId: actorIdFor(turn.actorId),
          contentType: 'application/json',
          accept: 'application/json',
          payload: new TextEncoder().encode(JSON.stringify(payload)),
        }),
      );

      const body = await collectBody(response.response);
      const parsed = parseRuntimeReply(body);

      /*
       * A 200 is not the same as a turn that worked.
       *
       * agent.py returns `{content: '', error: ...}` when the Strands agent threw
       * inside the Runtime, so the transport succeeded while the turn did not.
       * Logging that as `ok: true` is how an unusable engine B looked healthy in
       * the proxy's log group: the only visible symptom was a downstream
       * CreateEvent complaining that the assistant text was empty, which reads
       * like a memory bug rather than a failed model call.
       */
      const failed = Boolean(parsed.error) || !parsed.content.trim();
      logger[failed ? 'error' : 'info']('agentcore.invoke', {
        sessionId: turn.sessionId,
        durationMs: Date.now() - started,
        runtimeSessionId: response.runtimeSessionId,
        toolsUsed: parsed.toolsUsed.length,
        ok: !failed,
        // Truncated: a Python traceback can be long, and the type plus message is
        // what names the fault.
        ...(parsed.error ? { runtimeError: parsed.error.slice(0, 500) } : {}),
        ...(failed && !parsed.error ? { reason: 'the Runtime returned no content' } : {}),
      });

      // One line per tool the Runtime says it called, so the Gateway lights in
      // the drawer instead of being a node that can only ever sit dark.
      //
      // No `durationMs`: these calls happen inside the Runtime and arrive here
      // only as names in the reply, so there is nothing to time from the proxy.
      // The span bridge leaves the field off and the view shows `—`. Reporting
      // the turn's own duration here would credit the whole model call to a tool
      // lookup, which is the reading a room would most easily be misled by.
      for (const tool of parsed.toolsUsed) {
        logger.info('agentcore.gateway', { sessionId: turn.sessionId, tool });
      }

      return {
        ...parsed,
        runtimeSessionId: response.runtimeSessionId,
        traceId: response.traceId,
      };
    } catch (err) {
      logger.error('agentcore.invoke', {
        sessionId: turn.sessionId,
        durationMs: Date.now() - started,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async recordTurn(
    sessionId: string,
    actorId: string,
    userText: string,
    agentText: string,
  ): Promise<void> {
    const started = Date.now();

    /*
     * CreateEvent rejects a zero-length `content.text`, and a failed turn has
     * exactly that: agent.py answers with `content: ''` when the Runtime threw.
     * Writing it anyway turned one failure into two log lines, the second of
     * which ("Member must have length greater than or equal to 1") described the
     * symptom rather than the cause. There is also nothing worth remembering
     * about a turn the agent never completed, so skip it and say why.
     */
    if (!userText.trim() || !agentText.trim()) {
      logger.warn('agentcore.memory.skipped', {
        sessionId,
        operation: 'CreateEvent',
        reason: 'a turn with empty text cannot be stored, and holds nothing to recall',
        emptySide: !agentText.trim() ? 'assistant' : 'user',
      });
      return;
    }

    try {
      await this.client.send(
        new CreateEventCommand({
          memoryId: this.memoryId,
          actorId: actorIdFor(actorId),
          sessionId,
          eventTimestamp: new Date(),
          payload: [
            { conversational: { role: Role.USER, content: { text: userText } } },
            { conversational: { role: Role.ASSISTANT, content: { text: agentText } } },
          ],
        }),
      );
      logger.info('agentcore.memory', {
        sessionId,
        operation: 'CreateEvent',
        durationMs: Date.now() - started,
        ok: true,
      });
    } catch (err) {
      logger.error('agentcore.memory', {
        sessionId,
        operation: 'CreateEvent',
        durationMs: Date.now() - started,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async recallPreferences(sessionId: string, actorId: string): Promise<RememberedPreference[]> {
    const started = Date.now();
    try {
      // ListMemoryRecords, not RetrieveMemoryRecords: the latter requires a
      // `searchQuery` and ranks semantically, which is right for "what is
      // relevant to this message" and wrong for "what has been learned". The
      // mirror needs the whole extracted set, not the top-k nearest.
      const response = await this.client.send(
        new ListMemoryRecordsCommand({
          memoryId: this.memoryId,
          namespace: memoryNamespace(actorId, sessionId),
          maxResults: MAX_MEMORY_RECORDS,
        }),
      );

      const records = (response.memoryRecordSummaries ?? [])
        .map((summary) => parseMemoryRecord(summary.memoryRecordId, summary.content?.text))
        .filter((record): record is RememberedPreference => record !== null);

      logger.info('agentcore.memory', {
        sessionId,
        operation: 'ListMemoryRecords',
        durationMs: Date.now() - started,
        recordCount: records.length,
        ok: true,
      });

      return records;
    } catch (err) {
      logger.error('agentcore.memory', {
        sessionId,
        operation: 'ListMemoryRecords',
        durationMs: Date.now() - started,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

/**
 * The namespace one session's extracted records live under.
 *
 * Must match `memoryStrategies[].userPreferenceMemoryStrategy.namespaces` in
 * agentcore-stack.ts exactly — `/valentin/{actorId}/{sessionId}`. A mismatch
 * does not error; it returns zero records, so engine B would look as though it
 * had extracted nothing at all.
 */
export function memoryNamespace(actorId: string, sessionId: string): string {
  // Sanitised here too, so a namespace read lines up with what `CreateEvent`
  // wrote under. Idempotent, so callers that already sanitised are unaffected.
  return `/valentin/${actorIdFor(actorId)}/${sessionId}`;
}

/**
 * A Runtime session id derived from ours.
 *
 * The API requires at least 33 characters. Our session ids are UUIDs (36), so
 * they pass as-is, but a shorter id from a seeded or test session would be
 * rejected at invoke time — padding is cheaper than a 400 on someone's first
 * message.
 */
export function runtimeSessionIdFor(sessionId: string): string {
  return sessionId.length >= 33 ? sessionId : `valentin-session-${sessionId}`.padEnd(33, '0');
}

/**
 * Our storage user id, in the shape AgentCore accepts as an `actorId`.
 *
 * AgentCore validates `actorId` against
 * `[a-zA-Z0-9][a-zA-Z0-9-_/]*(?::[a-zA-Z0-9-_/]+)*[a-zA-Z0-9-_/]*`, and our ids
 * do not satisfy it: a demo visitor's storage id is `<sub>#<visitorId>` (see
 * `scopeToVisitor` in auth/demo-login.ts), and `#` is not in that set. Every
 * engine-B turn therefore failed `CreateEvent` with "Value at 'actorId' failed to
 * satisfy constraint" while the invoke itself had already succeeded — so the
 * reply streamed but nothing was ever remembered.
 *
 * `-` rather than `/`, even though `/` is legal: the Memory namespace is
 * `/valentin/{actorId}/{sessionId}` (`memoryNamespace`, and the strategy in
 * agentcore-stack.ts), so an actorId containing a slash would silently deepen the
 * namespace and make reads match nothing rather than fail. Substitution is
 * per-character and order-preserving, so distinct ids stay distinct.
 *
 * Applied inside this adapter rather than at the call site, so a write and the
 * read that follows it cannot disagree about the actor.
 */
export function actorIdFor(actorId: string): string {
  return actorId.replace(/[^a-zA-Z0-9\-_/]/g, '-');
}

/** Read a streaming or already-buffered response body into a string. */
async function collectBody(body: unknown): Promise<string> {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;

  // The SDK's StreamingBlobTypes is a union: in Node it is an IncomingMessage,
  // but `transformToString` is present on every variant the smithy mixin wraps,
  // and it is the only member of the union that does not need a runtime-specific
  // import here.
  const streaming = body as { transformToString?: () => Promise<string> };
  if (typeof streaming.transformToString === 'function') {
    return streaming.transformToString();
  }

  if (body instanceof Uint8Array) return new TextDecoder().decode(body);

  // An async iterable of chunks — the shape a plain fetch-style stream takes.
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * The Runtime's reply, from the JSON contract in `agentcore/agent.py`.
 *
 * Tolerant on purpose. The two sides of this contract deploy independently —
 * the proxy image and the agent image have separate tags — so a rolling deploy
 * always has a window where one is newer. An unrecognised field must degrade to
 * "no tools reported", not to an exception that reads as an AgentCore outage.
 *
 * Plain text is accepted too: a Runtime that returns `text/plain` on an error
 * path should surface its message, not a JSON parse failure.
 */
export function parseRuntimeReply(body: string): {
  content: string;
  toolsUsed: string[];
  /** The Runtime's own diagnosis when it failed inside the container. */
  error?: string;
} {
  const trimmed = body.trim();
  if (!trimmed) return { content: '', toolsUsed: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { content: trimmed, toolsUsed: [] };
  }

  if (typeof parsed === 'string') return { content: parsed, toolsUsed: [] };
  if (typeof parsed !== 'object' || parsed === null) {
    return { content: trimmed, toolsUsed: [] };
  }

  const record = parsed as Record<string, unknown>;
  const content =
    typeof record.content === 'string'
      ? record.content
      : typeof record.output === 'string'
        ? record.output
        : typeof record.result === 'string'
          ? record.result
          : trimmed;

  const rawTools = record.tools_used ?? record.toolsUsed;
  const toolsUsed = Array.isArray(rawTools)
    ? rawTools.filter((name): name is string => typeof name === 'string')
    : [];

  /*
   * agent.py catches its own exceptions and answers 200 with
   * `{content: '', tools_used: [], error: '<Type>: <message>'}` rather than
   * raising, so the proxy gets a diagnosable body instead of the Runtime's
   * generic error page. This field was being dropped on the floor — the turn was
   * logged `ok: true` with empty content, the user got the apology, and the one
   * string naming the cause went nowhere. The Runtime's own log group does not
   * exist until the container writes to it, so for a failure this early the
   * reply body is the *only* place the reason appears.
   */
  const error = typeof record.error === 'string' && record.error.trim() ? record.error : undefined;

  return { content, toolsUsed, error };
}

/**
 * Turn one memory record into a preference, or null to skip it.
 *
 * WHY THIS IS TOLERANT RATHER THAN TYPED
 *
 * `userPreferenceMemoryStrategy` is a managed extractor: AWS owns the schema of
 * what it writes into `content.text`, it is not published as a model in the SDK,
 * and it is free to change it. The observed shape is a JSON object, but the field
 * names differ between strategies, so this accepts several spellings and gives up
 * quietly on anything it cannot place.
 *
 * Giving up quietly is the right failure mode here and not laziness: this feeds a
 * *mirror* into DynamoDB, which is the source of truth. A record this cannot
 * parse means one fact missing from engine B's profile drawer; a throw would mean
 * the whole turn's mirror is lost, and the count shown next to engine B in the
 * comparison would silently be wrong rather than visibly incomplete.
 *
 * NOT YET CONFIRMED AGAINST A LIVE MEMORY. The parser is written from the
 * documented shape; the first real deploy should check
 * `agentcore.memory.unparsed` in the proxy's log group and tighten this to
 * whatever the strategy actually emits.
 */
export function parseMemoryRecord(
  recordId: string | undefined,
  text: string | undefined,
): RememberedPreference | null {
  if (!recordId || !text) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    logger.warn('agentcore.memory.unparsed', { reason: 'not-json', recordId });
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    logger.warn('agentcore.memory.unparsed', { reason: 'not-an-object', recordId });
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const value = firstString(record, ['preference', 'value', 'content', 'summary']);
  if (!value) {
    logger.warn('agentcore.memory.unparsed', { reason: 'no-value', recordId });
    return null;
  }

  const category = pickCategory(record);
  const key = firstString(record, ['key', 'field', 'attribute', 'name']) ?? `${category}_note`;

  // Defaulted, not invented as 1.0. The managed strategy does not report a
  // confidence, and claiming certainty would make engine B look better than
  // engine A on a number engine A actually measures.
  const rawConfidence = record.confidence;
  const confidence =
    typeof rawConfidence === 'number' && rawConfidence >= 0 && rawConfidence <= 1
      ? rawConfidence
      : 0.8;

  return {
    category,
    key: snakeCase(key),
    value,
    confidence,
    recordId,
  };
}

/** The first field present as a non-empty string. */
function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * The record's category, falling back to `personality_traits`.
 *
 * The fallback is not a guess dressed as a fact: a preference AgentCore inferred
 * but did not categorise is still a real thing it learned, and dropping it would
 * undercount engine B. `personality_traits` is the least specific of the eight,
 * so a miscategorised fact reads as vague rather than wrong.
 */
function pickCategory(record: Record<string, unknown>): PreferenceCategory {
  const direct = firstString(record, ['category', 'topic']);
  if (direct && VALID_CATEGORIES.has(direct)) return direct as PreferenceCategory;

  const list = record.categories;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (typeof entry === 'string' && VALID_CATEGORIES.has(entry)) {
        return entry as PreferenceCategory;
      }
    }
  }

  return 'personality_traits';
}

/** `Favorite Cuisine` → `favorite_cuisine`, matching engine A's key style. */
function snakeCase(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 96);
}
