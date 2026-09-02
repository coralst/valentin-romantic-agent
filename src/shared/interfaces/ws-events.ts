import type { EngineId } from './engine';
import type { ChatMessage } from './message';
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
  | WsEnvelope<'send_message', { sessionId: string; content: string }>
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

/** Server → Client events */
export type ServerEvent =
  | WsEnvelope<'auth_ok', { userId: string; isDemo: boolean }>
  | WsEnvelope<'aws_span', AwsSpan>
  | WsEnvelope<'turn_metrics', TurnMetrics>
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
  | WsEnvelope<'connection_status', { status: 'connected' | 'reconnecting' | 'disconnected' }>
  | WsEnvelope<'session_init', { sessionId: string; welcomeMessage: ChatMessage }>
  | WsEnvelope<'error', { code: string; message: string }>
  | WsEnvelope<'pong', Record<string, never>>;
