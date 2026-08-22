/**
 * The conversation a sign-in already created, handed from the auth flow to the
 * session store.
 *
 * `POST /api/demo/login` seeds a session *before* the browser has rendered
 * anything and returns its id. That id used to be dropped on the floor, and the
 * app relied on `GET /api/sessions` to rediscover it — which is a race it can
 * lose: `listSessions` is a DynamoDB GSI query, and a GSI is eventually
 * consistent, so the conversation created a few hundred milliseconds ago may
 * simply not be in the answer yet. The client would then conclude the account
 * has no conversations and create a second one, which is how a brand-new
 * account ends up with a pile of them.
 *
 * Module state rather than `sessionStorage`: it is only meaningful between the
 * sign-in and the very next session load in the same page. Persisting it would
 * mean a reload could resurrect an id the visitor has since deleted.
 */
let signInSessionId: string | null = null;

/** Record the session a sign-in response named. */
export function rememberSignInSession(sessionId: string): void {
  signInSessionId = sessionId;
}

/**
 * Read it back, once. Consumed on read so a later remount — a sign-out and a
 * sign-in as somebody else — cannot reuse the previous visitor's id.
 */
export function takeSignInSession(): string | null {
  const id = signInSessionId;
  signInSessionId = null;
  return id;
}
