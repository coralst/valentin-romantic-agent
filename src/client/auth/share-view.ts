import { SHARE_PARAM } from '../../shared/constants/share-link';

/**
 * The signed share token a link handed us, captured before anything can wipe it.
 *
 * `/?share=<token>` is the one entry point into this app that belongs to somebody
 * with no account: the token names the session and its owner and is the guest's
 * whole credential. So it has to be read at the same moment `resume-session.ts`
 * reads its own parameter, and for the same two reasons:
 *
 * 1. `cognito-oauth.ts` finishes a sign-in with
 *    `window.history.replaceState({}, '', window.location.pathname)`, which wipes
 *    the *entire* query string rather than just the auth code it means to clean.
 * 2. `auth-context.tsx` renders `{status === 'signed-in' ? children : <LoginScreen />}`,
 *    so anything mounted below the provider only ever runs for someone signed in —
 *    which a guest is not, and will not become.
 *
 * Module state rather than `sessionStorage`, exactly as `resume-session.ts` argues,
 * with a sharper edge: persisting a *credential* would mean a later reload of the
 * same browser silently reopened somebody else's conversation, long after the tab
 * that was handed the link had moved on. This is meaningful for one page load only.
 */
function readFromLocation(): string | null {
  // Guarded for the test environment and for any future SSR: this module is
  // imported for its side effect, so it must not throw where there is no window.
  if (typeof window === 'undefined') return null;

  try {
    const value = new URLSearchParams(window.location.search).get(SHARE_PARAM);
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

let shareToken: string | null = readFromLocation();

/**
 * Read the token this page load was opened with.
 *
 * **Idempotent, unlike `takeResumeSession`** — and the difference is deliberate
 * rather than an oversight. A resume id is consumed on read because it is acted on
 * once, by the session loader, and a remount reusing it would reopen a conversation
 * the visitor had moved on from. A share token is not acted on once: it *is* the
 * answer to "which app am I", and `App.tsx` asks that on every render. Clearing it
 * on first read would drop the guest into `LoginScreen` on the next one.
 *
 * Nothing here validates it. The signature, the owner and the expiry are the
 * server's to check in `share-token.ts`; a bad token is a 404 from
 * `GET /api/share/:token`, which the guest view renders as "this link has expired".
 */
export function takeShareToken(): string | null {
  return shareToken;
}

/** Whether this page load is a guest arriving on a shared link. */
export function hasShareToken(): boolean {
  return shareToken !== null;
}

/** Test seam. Nothing in the app calls this. */
export function setShareTokenForTests(token: string | null): void {
  shareToken = token;
}
