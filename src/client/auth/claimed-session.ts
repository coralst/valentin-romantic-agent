/**
 * A session that was already obtained before `AuthProvider` mounted, handed across.
 *
 * ## Why the boot sequence needs telling
 *
 * `AuthProvider`'s boot walks four candidates in order — an OAuth callback, a stored
 * refresh token, a stored demo session, then the dev bypass. Opening a share link
 * produces a credential that matches none of them: it was minted seconds ago by
 * `POST /api/share/:token/continue`, and the tab is already holding it.
 *
 * Without this handoff the boot falls through to candidate 4 on a local server,
 * adopts the *development* user, and the visitor lands in that user's conversations
 * with the fork they were just given stranded on another partition. So the boot
 * gets a candidate 0, and it reads from here.
 *
 * Module state, and consumed on read, for the same reason `initial-session.ts` is:
 * it is meaningful between the claim and the very next boot in the same page load.
 * Persisting it would mean a later reload adopted a credential the visitor had since
 * signed out of.
 */

export interface ClaimedSession {
  accessToken: string;
  /** True when it belongs to the shared demo account, which the header chip shows. */
  demo: boolean;
  /** Short label for that chip, when there is a better one than the default. */
  label?: string;
}

let claimed: ClaimedSession | null = null;

/**
 * Record a session obtained outside the boot sequence.
 *
 * The caller is expected to have already written it to `token-store` — this only
 * tells the provider what to *display* and that it need not look further.
 */
export function rememberClaimedSession(session: ClaimedSession): void {
  claimed = session;
}

/** Read it back, once. */
export function takeClaimedSession(): ClaimedSession | null {
  const session = claimed;
  claimed = null;
  return session;
}
