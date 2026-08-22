import type { ChatMessage } from './message';
import type { PreferenceWithHistory } from './preference';

/** Generic WebSocket message envelope */
export interface WsEnvelope<T extends string, P> {
  type: T;
  payload: P;
  timestamp: string;
}

/** Client → Server events */
export type ClientEvent =
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
  | WsEnvelope<'aws_span', AwsSpan>
  | WsEnvelope<'agent_message', { message: ChatMessage }>
  | WsEnvelope<'typing_start', { sessionId: string }>
  | WsEnvelope<'typing_stop', { sessionId: string }>
  | WsEnvelope<'preference_update', { preference: PreferenceWithHistory; isNew: boolean }>
  | WsEnvelope<'connection_status', { status: 'connected' | 'reconnecting' | 'disconnected' }>
  | WsEnvelope<'session_init', { sessionId: string; welcomeMessage: ChatMessage }>
  | WsEnvelope<'error', { code: string; message: string }>
  | WsEnvelope<'pong', Record<string, never>>;
