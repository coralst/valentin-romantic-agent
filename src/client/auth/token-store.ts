/**
 * The one place a bearer token lives.
 *
 * A module singleton rather than React state, because the two things that need a
 * token — `apiFetch` and the WebSocket hook — are called from places that cannot
 * subscribe to a context (an event handler mid-reconnect, for instance). The
 * provider in context/auth-context.tsx owns the lifecycle and writes here.
 *
 * A real login's access token is held in memory only. The refresh token goes in
 * `sessionStorage`, not `localStorage`, so closing the tab ends the session and a
 * shared browser is not left holding a thirty-day credential.
 *
 * A demo session is the one exception, and it stores the *access* token. It has
 * to: the demo refresh token belongs to a server-only Cognito client, so it is
 * deliberately thrown away, which left a reload with nothing to resume from — the
 * visitor was dropped back on the login screen and their conversation looked
 * lost. What is kept is narrower than it sounds: a short-lived access token for a
 * shared synthetic account that holds nothing but fixture data, in
 * `sessionStorage` like everything else here, so it dies with the tab and a
 * shared browser is not left holding it. That trade is what makes refreshing the
 * page a non-event instead of a data loss.
 */

const REFRESH_KEY = 'valentin.auth.refresh';
const VISITOR_KEY = 'valentin.auth.visitor';
const DEMO_KEY = 'valentin.auth.demo';

/** Refresh this long before expiry, so a request never rides an expiring token */
const REFRESH_MARGIN_MS = 60_000;

export interface TokenSession {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds */
  expiresAt: number;
  /**
   * A demo sign-in, whose access token is worth surviving a reload.
   *
   * `demoLabel` rides along because the token cannot name the persona — every
   * persona shares one account — and the header chip has to after a reload too.
   */
  demo?: boolean;
  demoLabel?: string;
}

/** What a previous page load in this tab left of a demo session */
export interface StoredDemoSession {
  accessToken: string;
  /** Epoch milliseconds */
  expiresAt: number;
  label?: string;
}

type Refresher = (refreshToken: string) => Promise<TokenSession>;

/**
 * This browser's corner of the shared demo account.
 *
 * Lives here for the same reason the access token does: `apiFetch` and the
 * WebSocket hook both need it, synchronously, from places that cannot read a
 * React context. Mirrored into `sessionStorage` so a reload keeps the same
 * conversations rather than opening onto an empty account.
 *
 * Not a credential — it separates rows inside an account the caller already
 * holds a token for, and it is useless without that token.
 */
let visitorId: string | null = sessionStorage.getItem(VISITOR_KEY);

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
  if (next.demo) {
    const stored: StoredDemoSession = {
      accessToken: next.accessToken,
      expiresAt: next.expiresAt,
      ...(next.demoLabel ? { label: next.demoLabel } : {}),
    };
    sessionStorage.setItem(DEMO_KEY, JSON.stringify(stored));
  }
}

export function clearTokenSession(): void {
  session = null;
  inFlight = null;
  visitorId = null;
  sessionStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(VISITOR_KEY);
  // Signing out must not leave a token a reload could pick back up.
  sessionStorage.removeItem(DEMO_KEY);
}

/** Remember which demo visitor this browser is, as the server just assigned it */
export function setVisitorId(next: string): void {
  visitorId = next;
  sessionStorage.setItem(VISITOR_KEY, next);
}

/** This browser's demo visitor id, or null outside the demo */
export function peekVisitorId(): string | null {
  return visitorId;
}

/** The stored refresh token, if a previous page load left one */
export function storedRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_KEY);
}

/**
 * The demo session a previous load in this tab left behind, if any.
 *
 * Expiry is the caller's to judge: the boot sequence wants to distinguish
 * "resume this" from "this is stale, forget it and show the login screen".
 * Unparseable content is treated as absent — a half-written key is not worth
 * failing a page load over.
 */
export function storedDemoSession(): StoredDemoSession | null {
  const raw = sessionStorage.getItem(DEMO_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDemoSession>;
    if (typeof parsed.accessToken !== 'string') return null;
    if (typeof parsed.expiresAt !== 'number') return null;
    return {
      accessToken: parsed.accessToken,
      expiresAt: parsed.expiresAt,
      ...(typeof parsed.label === 'string' ? { label: parsed.label } : {}),
    };
  } catch {
    return null;
  }
}

/** Forget a stored demo session without disturbing the live one */
export function clearStoredDemoSession(): void {
  sessionStorage.removeItem(DEMO_KEY);
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
