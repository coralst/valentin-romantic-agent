import type { EngineId } from './engine';
import type { ChatMessage } from './message';
import type { Outing } from './outing';
import type { Person } from './person';
import type { PreferenceWithHistory } from './preference';
import type { Task } from './task';

/** Generic WebSocket message envelope */
export interface WsEnvelope<T extends string, P> {
  type: T;
  payload: P;
  timestamp: string;
}

/**
 * Client → Server events.
 *
 * `auth` must be the **first** frame on every connection and is the only event
 * honoured before it. A browser cannot set headers on a WebSocket handshake, and
 * the two alternatives both leak the bearer token into somewhere permanent:
 * `?token=` is stripped by CloudFront's origin request policy *and* recorded in
 * CloudFront/ALB access logs, and `Sec-WebSocket-Protocol` is a logged header.
 * A first-message frame needs no CDN change and never writes the token to a log.
 */
export type ClientEvent =
  | WsEnvelope<
      'auth',
      {
        token: string;
        /**
         * Resume this session instead of starting a new one. The server proves
         * ownership by reading it under the caller's own partition; a miss is
         * an error and never mints a replacement.
         */
        sessionId?: string;
        /**
         * Which corner of the shared demo account this visitor owns, as handed
         * out by `POST /api/demo/login`. Ignored on a non-demo token. Without
         * it the socket would bind to the pooled demo id while the HTTP routes
         * used the scoped one, and the two would disagree about which
         * conversations exist.
         */
        visitorId?: string;
      }
    >
  | WsEnvelope<
      'send_message',
      {
        sessionId: string;
        content: string;
        /**
         * The id the client already gave this turn in its own transcript.
         *
         * The server adopts it instead of minting one, which is what makes
         * `Preference.sourceMessageId` name a message the transcript can
         * actually find — see `client/utils/provenance.ts` for the mismatch this
         * closes. Optional, and validated before use: it becomes part of a
         * DynamoDB sort key, so anything that is not a v4 uuid is ignored and
         * the server mints as before.
         */
        messageId?: string;
        /**
         * Reveal the model's real reasoning for *this* turn.
         *
         * Per-turn rather than session state because it changes the request:
         * extended thinking forces `temperature: 1`, which retunes Valentin's
         * voice, so it must never be on by accident. Nothing to invalidate on a
         * reconnect or a second tab either.
         */
        showThinking?: boolean;
      }
    >
  /**
   * Accept a proposal Valentin raised. This click is the authority to act — see
   * `AgentOrchestrator.confirmAction` for why it does not go back through the
   * model.
   */
  | WsEnvelope<'confirm_action', { sessionId: string; proposalId: string }>
  | WsEnvelope<'ping', Record<string, never>>;

/**
 * Something Valentin would like to do in the outside world, awaiting a yes.
 *
 * Mirrors the server's `ActionProposal`, minus the tool that would run it. It
 * exists as its own event rather than as prose inside an `agent_message`
 * because the user has to be able to accept it with a click, and because a
 * sentence claiming a table is booked is exactly what this design prevents:
 * nothing is booked, sent or scheduled until this proposal comes back as
 * `confirm_action`.
 *
 * `expiresAt` is load-bearing, not decorative — an Ontopo checkout link is good
 * for about fifteen minutes, and the card counts down so a stale one is visibly
 * stale rather than a button that quietly fails.
 */
export interface ActionProposalPayload {
  sessionId: string;
  proposalId: string;
  /** Which integration would carry it out — `ontopo`, `gmail`, … */
  service: string;
  title: string;
  summary: string;
  /** Where accepting sends the user, when the provider owns the final step. */
  url?: string;
  expiresAt: string;
}

/**
 * One measured call against a real AWS resource, pushed to the client so the
 * Inspector can show what actually happened and how long it took.
 *
 * `resourceId` is an open string rather than a union on purpose: the client
 * renders an unrecognised resource generically instead of dropping it, so a
 * server-side rename degrades to a plain feed row rather than a missing beat.
 *
 * `sessionId` is REQUIRED at the top level. The broadcast path resolves the
 * target session from `payload.sessionId` and silently drops events without
 * one — `pong` and `error` are already dead in practice for exactly this
 * reason, and a span with no session would join them.
 *
 * `detail` carries keys and categories only — `PREF#music`, never the value.
 * This is displayed on a projector.
 */
export interface AwsSpan {
  sessionId: string;
  /** e.g. 'dynamodb' | 'bedrock' — matches an `AwsNodeId` when recognised. */
  resourceId: string;
  /** AWS service name as AWS writes it, e.g. 'Amazon DynamoDB'. */
  service: string;
  /** The deployed resource identifier, e.g. 'ValentinTable-dev'. */
  resourceName: string;
  /** The API call made, e.g. 'PutItem' | 'Converse'. */
  operation: string;
  /**
   * How long the call took, when the emitter is the one that made it.
   *
   * Absent for a call that really happened but cannot be timed from where the
   * span is emitted — a Gateway tool call runs inside the AgentCore Runtime, so
   * the proxy learns it happened from the reply and never holds a stopwatch on
   * it. The view renders that as `—`, which is the truth; a `0` would read as a
   * free call and a made-up number would be worse.
   */
  durationMs?: number;
  ok: boolean;
  /** Sort key or category, never raw partner data. */
  detail?: string;
  /**
   * What the model charged for this call, when the provider said.
   *
   * Optional for the same reason `durationMs` is: absent means nobody counted.
   * Engine B's Runtime does not report usage at all today (`agentcore/agent.py`
   * returns `content` and `tools_used` only), so its spans carry none and the view
   * shows `—`. A `0` here would read as a free call.
   */
  usage?: SpanTokenUsage;
  /**
   * Which engine made the call, stamped by the process that made it.
   *
   * The client cannot reliably infer this. It knows which engine it *selected*, but
   * a deployment missing its AgentCore wiring downgrades server-side and answers on
   * engine A anyway (see `server/agent/engine.ts`), and `servingEngine` from
   * `/api/config` is `null` for a window after every switch. Attributing a span by
   * selection would file engine A's numbers under AgentCore's name — the one error
   * this whole comparison exists to avoid.
   *
   * Optional because a span from an older task carries none; the client drops an
   * unattributable span rather than guessing.
   */
  engine?: EngineId;
  /**
   * The AWS X-Ray trace id for this call, when the service returned one.
   *
   * Only engine B's `InvokeAgentRuntime` does today. It is here because with the
   * Gateway in engine B's real path there are two hops the proxy cannot see inside
   * — the Runtime and the tool Lambda — and this id is the only thing that stitches
   * the proxy's log line to theirs. Surfaced in the drawer as a copyable string
   * rather than a link: the console URL differs by region and account, and a link
   * that 404s in a demo is worse than a value someone can paste.
   *
   * Safe to project. It is an identifier the service minted, and carries nothing
   * about the conversation.
   */
  traceId?: string;
}

/** What one model call cost, as the provider reported it. */
export interface SpanTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * What one completed user turn cost, counted by the process that served it.
 *
 * Separate from `AwsSpan` because a span is one call and these are per-turn totals.
 * Two things make them uninferrable from spans: `use-live-architecture.ts` counts
 * model calls by span *operation*, which cannot tell you how many belonged to the
 * same turn; and a store read emits no span at all, so a reads-per-turn figure has
 * no span to be derived from.
 *
 * Every field is a count of something that happened, not a rate — the client
 * derives averages and percentiles, so this frame stays honest if it is read raw.
 */
export interface TurnMetrics {
  /**
   * REQUIRED and top-level. `resolveBroadcastSessionId` reads `payload.sessionId`
   * and silently drops an event without one — `pong` and `error` are already dead
   * in practice for exactly this reason.
   */
  sessionId: string;
  /** The engine that actually served, never the one the client selected. */
  engine: EngineId;
  /**
   * Model calls this turn — Converse or InvokeAgentRuntime, including the
   * extractor's.
   *
   * This is the panel's headline number: engine A pays for a second forced-tool
   * `extract-preferences` Converse on every turn, and a tool round adds another.
   */
  modelCalls: number;
  /** Reads against the conversation store this turn. Writes are not counted. */
  storeReads: number;
  /**
   * Which store those reads hit.
   *
   * Load-bearing, not decorative: `STORAGE_BACKEND` defaults to `memory`, so on a
   * laptop these are not DynamoDB calls and a panel that called them "DynamoDB
   * reads" would be lying about the architecture it is describing.
   */
  storeBackend: 'memory' | 'dynamodb';
  /** Wall clock from the user's frame to the reply being sent. */
  replyLatencyMs: number;
  /** Omitted, never zeroed, when no call this turn reported usage. */
  inputTokens?: number;
  outputTokens?: number;
  ok: boolean;
}

/** Which sort of thing happened while Valentin was working. */
export type AgentActivityKind = 'thinking' | 'tool_start' | 'tool_end';

/**
 * Common to every activity frame.
 *
 * `sessionId` is at the top level, not nested, for the same reason `AwsSpan` and
 * `TurnMetrics` put it there: `resolveBroadcastSessionId` reads
 * `payload.sessionId` and silently drops an event without one.
 */
interface AgentActivityBase {
  sessionId: string;
  /**
   * Correlates the two halves of a tool call — Bedrock's `toolUseId` for tool
   * frames, `thinking:<iteration>` for thinking.
   *
   * The client completes the line it already drew rather than appending a second
   * row, so a finishing call does not reflow the trail under the reader's eyes.
   */
  id: string;
  /** Which model round trip produced it, 1-based. See `MAX_TOOL_ITERATIONS`. */
  iteration: number;
}

/**
 * The model's own reasoning, verbatim from a `reasoningContent` block.
 *
 * Only ever emitted for a turn the user asked for it on, and never synthesised:
 * `client/utils/provenance.ts` is the standing refusal to render reasoning the
 * system did not perform, and this frame is the first thing that can honour it.
 */
export interface AgentThinkingActivity extends AgentActivityBase {
  kind: 'thinking';
  text: string;
}

/** A tool call has been dispatched and is in flight. */
export interface AgentToolStartActivity extends AgentActivityBase {
  kind: 'tool_start';
  /** The tool name as the model called it — `check_availability`. */
  tool: string;
  /** The partner behind it — `ontopo`, `hebcal`, `spotify`, … */
  service: string;
  /**
   * A one-line summary of what the tool was asked to do.
   *
   * Redacted, never raw JSON: see `server/agent/activity-summary.ts`. Tool
   * arguments carry her name, his address and prose about their relationship.
   */
  inputSummary: string;
}

/** The same tool call, finished. */
export interface AgentToolEndActivity extends AgentActivityBase {
  kind: 'tool_end';
  tool: string;
  service: string;
  /** Measured around the call, so it is the one number nobody can estimate. */
  durationMs: number;
  ok: boolean;
  /** Redacted one-line outcome — "3 slots found", "no availability". */
  outcome: string;
}

/**
 * What Valentin is doing, while he is doing it.
 *
 * One event with a discriminated `kind` rather than three event types: it keeps
 * `resolveBroadcastSessionId` untouched and gives the client a single reducer
 * case for a frame that arrives many times per turn.
 */
export type AgentActivityPayload =
  | AgentThinkingActivity
  | AgentToolStartActivity
  | AgentToolEndActivity;

/** Server → Client events */
export type ServerEvent =
  | WsEnvelope<'auth_ok', { userId: string; isDemo: boolean }>
  | WsEnvelope<'aws_span', AwsSpan>
  | WsEnvelope<'turn_metrics', TurnMetrics>
  | WsEnvelope<'agent_activity', AgentActivityPayload>
  | WsEnvelope<'agent_message', { message: ChatMessage }>
  | WsEnvelope<'action_proposal', ActionProposalPayload>
  | WsEnvelope<'typing_start', { sessionId: string }>
  | WsEnvelope<'typing_stop', { sessionId: string }>
  | WsEnvelope<'preference_update', { preference: PreferenceWithHistory; isNew: boolean }>
  /**
   * Someone in her life was learned from the conversation.
   *
   * `sessionId` sits at the top level rather than inside `person`, unlike
   * `preference_update`: a `Person` has no session on it, because it is stored
   * under the session's partition and a copy of the id on the record would be a
   * second place for it to be wrong. `resolveBroadcastSessionId` reads the top
   * level first, so this is the shape that reaches the right socket.
   */
  | WsEnvelope<'person_update', { sessionId: string; person: Person; isNew: boolean }>
  /** Something the user said he would do was learned from the conversation. */
  | WsEnvelope<'task_update', { sessionId: string; task: Task; isNew: boolean }>
  /**
   * A booking was confirmed, so there is now a place he has taken her.
   *
   * No `isNew` flag, unlike its two neighbours. An outing is only ever announced
   * on creation: the other write to the row is the survey, which the client makes
   * itself and already holds the result of, so a frame for it would be an echo the
   * client would have to recognise and drop.
   */
  | WsEnvelope<'outing_update', { sessionId: string; outing: Outing }>
  | WsEnvelope<'connection_status', { status: 'connected' | 'reconnecting' | 'disconnected' }>
  | WsEnvelope<'session_init', { sessionId: string; welcomeMessage: ChatMessage }>
  | WsEnvelope<'error', { code: string; message: string }>
  | WsEnvelope<'pong', Record<string, never>>;
