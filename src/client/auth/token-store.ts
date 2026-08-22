/**
 * The one place a bearer token lives.
 *
 * A module singleton rather than React state, because the two things that need a
 * token — `apiFetch` and the WebSocket hook — are called from places that cannot
 * subscribe to a context (an event handler mid-reconnect, for instance). The
 * provider in context/auth-context.tsx owns the lifecycle and writes here.
 *
 * The access token is held in memory only. The refresh token goes in
 * `sessionStorage`, not `localStorage`, so closing the tab ends the session and a
 * shared browser is not left holding a thirty-day credential.
 */

const REFRESH_KEY = 'valentin.auth.refresh';

/** Refresh this long before expiry, so a request never rides an expiring token */
const REFRESH_MARGIN_MS = 60_000;

export interface TokenSession {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds */
  expiresAt: number;
}

type Refresher = (refreshToken: string) => Promise<TokenSession>;

let session: TokenSession | null = null;
let refresher: Refresher | null = null;
let onLost: (() => void) | null = null;

/**
 * The in-flight refresh, shared by every caller.
 *
 * Without this, ten components hitting a just-expired token would each spend the
 * refresh token; Cognito accepts the first and the rest get invalid_grant, which
 * looks exactly like a broken login.
 */
let inFlight: Promise<string | null> | null = null;

/** How the store obtains a new access token, and who to tell when it can't */
export function configureTokenStore(options: {
  refresh: Refresher | null;
  onSessionLost: (() => void) | null;
}): void {
  refresher = options.refresh;
  onLost = options.onSessionLost;
}

export function setTokenSession(next: TokenSession): void {
  session = next;
  if (next.refreshToken) {
    sessionStorage.setItem(REFRESH_KEY, next.refreshToken);
  }
}

export function clearTokenSession(): void {
  session = null;
  inFlight = null;
  sessionStorage.removeItem(REFRESH_KEY);
}

/** The stored refresh token, if a previous page load left one */
export function storedRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_KEY);
}

/** The current access token without refreshing — for a synchronous read */
export function peekAccessToken(): string | null {
  return session?.accessToken ?? null;
}

/** True when the token is gone or about to expire */
export function isExpiring(now = Date.now()): boolean {
  return !session || session.expiresAt - REFRESH_MARGIN_MS <= now;
}

/**
 * A usable access token, refreshing first if needed.
 *
 * Returns null when there is no session and none can be recovered — the caller
 * should then let the request go out unauthenticated (the dev bypass may accept
 * it) rather than block, since the server is the authority either way.
 */
export async function getAccessToken(): Promise<string | null> {
  if (session && !isExpiring()) return session.accessToken;

  const refreshToken = session?.refreshToken ?? storedRefreshToken();
  if (!refresher || !refreshToken) {
    return session?.accessToken ?? null;
  }

  inFlight ??= (async () => {
    try {
      const next = await refresher(refreshToken);
      setTokenSession(next);
      return next.accessToken;
    } catch (err) {
      console.warn('[auth] could not refresh the session', err);
      clearTokenSession();
      onLost?.();
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Treat the current access token as expired.
 *
 * Called when the server rejects a token we still believed in — a clock skew, or
 * a revoked session. The next `getAccessToken` then refreshes rather than
 * handing back the same rejected token forever.
 */
export function invalidateAccessToken(): void {
  if (session) session = { ...session, expiresAt: 0 };
}

/**
 * Stand in for a real session while the backend runs without Cognito.
 *
 * The dev-bypass verifier reads `dev:<id>` as a user id, so a developer can be
 * two different people in two tabs — which is what makes local multi-user
 * testing possible at all.
 */
export function setDevSession(userId: string): void {
  session = {
    accessToken: `dev:${userId}`,
    refreshToken: null,
    // Twelve hours, matching the bypass verifier's own idea of a lifetime.
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  };
}
