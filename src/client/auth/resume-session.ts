import { RESUME_PARAM } from '../../shared/constants/resume-link';

/**
 * The conversation a link asked to reopen, captured before anything can wipe it.
 *
 * A reminder email carries `/?s=<sessionId>` so that clicking it lands the reader
 * in the conversation the mail is about, with the options still in the transcript.
 * Dropping them on an empty chat instead is the difference between a notification
 * and a nuisance.
 *
 * ## Why this is read at module-eval time and not in an effect
 *
 * Two things destroy the parameter before any React effect could see it:
 *
 * 1. `cognito-oauth.ts` finishes the sign-in with
 *    `window.history.replaceState({}, '', window.location.pathname)`, which wipes
 *    the *entire* query string — not just the auth code it is trying to clean up.
 * 2. `redirectUri()` in the same module is `${window.location.origin}/` with no
 *    query, so the parameter would not survive the OAuth round trip regardless.
 *
 * And `auth-context.tsx` renders `{status === 'signed-in' ? children : <LoginScreen />}`,
 * so `SessionProvider` — the only thing that could act on the id — does not mount
 * until sign-in is already over. Reading `window.location` at import time is the
 * one moment that is guaranteed to be before all of it.
 *
 * Module state rather than `sessionStorage`, exactly as `initial-session.ts`
 * argues: this is meaningful only between page load and the very next session
 * load. Persisting it would mean every later reload silently reopened a
 * conversation the visitor had moved on from, which reads as the app losing their
 * place rather than keeping it.
 */
function readFromLocation(): string | null {
  // Guarded for the test environment and for any future SSR: this module is
  // imported for its side effect, so it must not throw where there is no window.
  if (typeof window === 'undefined') return null;

  try {
    const value = new URLSearchParams(window.location.search).get(RESUME_PARAM);
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

let resumeSessionId: string | null = readFromLocation();

/**
 * Read the requested id, once.
 *
 * Consumed on read for the same reason `takeSignInSession` is: a remount, or a
 * sign-out and a sign-in as somebody else, must not reuse it. If the id belongs to
 * another account the session fetch 404s and the app falls back to the newest
 * conversation, which is why no check is needed here — authorisation is the
 * server's, and every session route is already scoped to the caller.
 */
export function takeResumeSession(): string | null {
  const id = resumeSessionId;
  resumeSessionId = null;
  return id;
}

/**
 * Whether a resume was requested, without consuming it.
 *
 * For anything that wants to render differently on arrival from a link — a
 * "picking up where you left off" line — without stealing the id from the session
 * loader that needs it.
 */
export function hasResumeSession(): boolean {
  return resumeSessionId !== null;
}

/** Test seam. Nothing in the app calls this. */
export function setResumeSessionForTests(id: string | null): void {
  resumeSessionId = id;
}
