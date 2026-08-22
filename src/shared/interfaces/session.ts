/** Metadata for a single user session */
export interface SessionData {
  id: string;
  createdAt: string;
  endedAt: string | null;
  messageCount: number;
  preferenceCount: number;
  /**
   * When a message was last written to this session.
   *
   * Optional because the field postdates the original shape; a persisted
   * session always carries it. The sidebar orders on this, which is why the
   * GSI's sort key can stay on immutable `createdAt` — see persistence/keys.ts.
   */
  lastActivity?: string;
  /**
   * The partner's name, denormalised off the `partner_name` preference so the
   * sidebar can label a conversation without fetching its whole profile.
   */
  partnerName?: string | null;
  /** User-given conversation name, taking precedence over `partnerName` */
  title?: string | null;
}
