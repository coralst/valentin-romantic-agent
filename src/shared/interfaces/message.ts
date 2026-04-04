/** Sender of a chat message */
export type Sender = 'user' | 'agent';

/** A single message in the conversation thread */
export interface ChatMessage {
  id: string;
  sessionId: string;
  sender: Sender;
  content: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}
