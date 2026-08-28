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
  | WsEnvelope<'ping', Record<string, never>>;

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
