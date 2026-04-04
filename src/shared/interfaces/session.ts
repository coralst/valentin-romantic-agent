/** Metadata for a single user session */
export interface SessionData {
  id: string;
  createdAt: string;
  endedAt: string | null;
  messageCount: number;
  preferenceCount: number;
}
