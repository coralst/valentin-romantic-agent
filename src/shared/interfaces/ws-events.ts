import type { ChatMessage } from './message';
import type { PreferenceWithHistory } from './preference';

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
  durationMs: number;
  ok: boolean;
  /** Sort key or category, never raw partner data. */
  detail?: string;
}

/** Server → Client events */
export type ServerEvent =
  | WsEnvelope<'auth_ok', { userId: string; isDemo: boolean }>
  | WsEnvelope<'aws_span', AwsSpan>
  | WsEnvelope<'agent_message', { message: ChatMessage }>
  | WsEnvelope<'action_proposal', ActionProposalPayload>
  | WsEnvelope<'typing_start', { sessionId: string }>
  | WsEnvelope<'typing_stop', { sessionId: string }>
  | WsEnvelope<'preference_update', { preference: PreferenceWithHistory; isNew: boolean }>
  | WsEnvelope<'connection_status', { status: 'connected' | 'reconnecting' | 'disconnected' }>
  | WsEnvelope<'session_init', { sessionId: string; welcomeMessage: ChatMessage }>
  | WsEnvelope<'error', { code: string; message: string }>
  | WsEnvelope<'pong', Record<string, never>>;
