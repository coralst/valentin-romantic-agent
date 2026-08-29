import { randomUUID } from 'node:crypto';
import { config } from '../../config';
import { logger } from '../../logging';
import { GOOGLE_SCOPES } from './client';

/**
 * The in-app Google consent flow: the only way to get a refresh token without
 * a terminal.
 *
 * Calendar and Gmail need a refresh token, and a refresh token can only be
 * earned by a human approving scopes in a browser. That used to mean a
 * hand-run script. Now the panel opens a popup at Google, Google redirects back
 * here with a one-time code, and this module trades the code for the token —
 * which is stored server-side and never sent to the browser at all.
 *
 * ### Why the callback is unauthenticated
 *
 * Google performs the redirect, and Google has no bearer token for our API. So
 * `GET /api/integrations/google/callback` sits outside `requireAuth`, and the
 * `state` parameter carries the whole of its security: a single-use, expiring,
 * server-minted value that must match. Without a match nothing is exchanged and
 * nothing is stored, which is what stops any page on the internet from
 * navigating a visitor's browser at our callback with a code of its own and
 * binding *their* Google account to this deployment.
 */

/** How long a visitor has to finish the consent screen before the state expires. */
const STATE_TTL_MS = 10 * 60 * 1000;

interface PendingState {
  expiresAt: number;
}

/**
 * Outstanding consent attempts, by state value.
 *
 * In memory, and correctly so: a state that does not survive a restart is a
 * state a restarted process cannot be tricked into honouring, and the cost is
 * that a visitor mid-consent has to press Connect again.
 */
const pending = new Map<string, PendingState>();

/** Drop expired states so an abandoned attempt cannot be replayed later. */
function reap(): void {
  const now = Date.now();
  for (const [state, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(state);
  }
}

/**
 * The redirect URI Google will send the browser back to.
 *
 * Must match a URI registered on the OAuth client *exactly* — Google compares
 * the string, not the host. `PUBLIC_ORIGIN` is how a deployed environment says
 * what its own address is; locally the default is the vite dev server's origin,
 * because that is where the app is open and the callback has to land somewhere
 * the browser already trusts.
 */
export function redirectUri(): string {
  const origin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173';
  return `${origin.replace(/\/$/, '')}/api/integrations/google/callback`;
}

export interface AuthUrlResult {
  ok: boolean;
  status: number;
  /** Present when ok. Safe to hand the browser — it is a Google URL with public parameters. */
  url?: string;
  message?: string;
}

/**
 * Build the consent URL the panel opens, and remember its state.
 *
 * `access_type=offline` is what makes Google issue a refresh token at all, and
 * `prompt=consent` forces the screen even for an already-authorised client —
 * without it a second authorisation returns an access token and no refresh
 * token, which is the single most common way this flow appears to succeed and
 * produces nothing usable.
 */
export function buildAuthUrl(): AuthUrlResult {
  const { googleClientId } = config.integrations;
  if (!googleClientId) {
    return {
      ok: false,
      status: 400,
      message: 'Save a Google OAuth client id and secret first.',
    };
  }

  reap();
  const state = randomUUID();
  pending.set(state, { expiresAt: Date.now() + STATE_TTL_MS });

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', googleClientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');

  return { ok: true, status: 200, url: url.toString() };
}

/** True exactly once per state, and only inside its TTL. */
export function consumeState(state: string | undefined): boolean {
  if (!state) return false;
  reap();
  // Deleted whether or not it was valid, so a state cannot be tried twice —
  // a replayed code must fail on the state before it reaches Google.
  return pending.delete(state);
}

export interface ExchangeResult {
  ok: boolean;
  /** Safe for a browser page. Never contains a token or a Google error body. */
  message: string;
  refreshToken?: string;
}

/**
 * Trade an authorisation code for a refresh token.
 *
 * The refresh token is returned to the *caller* (the route, which stores it) and
 * deliberately never rendered, logged, or sent to the browser. Google's error
 * bodies are not propagated either: they can name the client id, and the page
 * this text lands on is one the visitor could screenshot.
 */
export async function exchangeCode(code: string): Promise<ExchangeResult> {
  const { googleClientId, googleClientSecret } = config.integrations;
  if (!googleClientId || !googleClientSecret) {
    return { ok: false, message: 'This server has no Google OAuth client configured.' };
  }

  let response: Response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, message: 'Google could not be reached to finish signing in.' };
  }

  if (!response.ok) {
    // Logged with the status only. The body is useful when debugging and can
    // carry the client id, so it does not go to CloudWatch either.
    logger.warn('integration.oauth-exchange-failed', {
      integration: 'google',
      status: response.status,
    });
    return {
      ok: false,
      message:
        'Google refused to complete the sign-in. Check that the redirect URI on the OAuth client matches this server exactly.',
    };
  }

  const body = (await response.json().catch(() => ({}))) as { refresh_token?: unknown };
  if (typeof body.refresh_token !== 'string') {
    // Almost always a re-authorisation of an already-granted client. We do send
    // `prompt=consent`, so if this fires the grant likely predates it.
    return {
      ok: false,
      message:
        'Google returned no refresh token. Remove this app at myaccount.google.com/permissions and try again.',
    };
  }

  return { ok: true, message: 'Google connected.', refreshToken: body.refresh_token };
}
