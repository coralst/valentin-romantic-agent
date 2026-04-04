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

/** Server → Client events */
export type ServerEvent =
  | WsEnvelope<'agent_message', { message: ChatMessage }>
  | WsEnvelope<'typing_start', { sessionId: string }>
  | WsEnvelope<'typing_stop', { sessionId: string }>
  | WsEnvelope<'preference_update', { preference: PreferenceWithHistory; isNew: boolean }>
  | WsEnvelope<'connection_status', { status: 'connected' | 'reconnecting' | 'disconnected' }>
  | WsEnvelope<'session_init', { sessionId: string; welcomeMessage: ChatMessage }>
  | WsEnvelope<'error', { code: string; message: string }>
  | WsEnvelope<'pong', Record<string, never>>;
