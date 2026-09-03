import { randomUUID } from 'node:crypto';
import { config } from '../../config';
import { logger } from '../../logging';
import { SPOTIFY_SCOPES } from './client';

/**
 * The in-app Spotify consent flow: the only way to get a refresh token without
 * a terminal.
 *
 * Saving a playlist into a library needs a user grant, and a user grant can only
 * be earned by a human approving a scope in a browser. Without this the id and
 * secret get you search and a link handoff, and the "create a playlist" half of
 * the music row stays permanently out of reach on any deployment whose operator
 * will not hand-run a script. So the panel opens a popup at Spotify, Spotify
 * redirects back here with a one-time code, and this module trades the code for
 * the refresh token — stored server-side, never sent to the browser.
 *
 * Deliberately the same shape as `google/oauth.ts`, down to the state handling.
 * Two OAuth flows that differ only where the providers differ is much easier to
 * audit than two that were each invented once.
 *
 * ### Why the callback is unauthenticated
 *
 * Spotify performs the redirect, and Spotify has no bearer token for our API. So
 * `GET /api/integrations/spotify/callback` sits outside `requireAuth`, and the
 * `state` parameter carries the whole of its security: a single-use, expiring,
 * server-minted value that must match. Without a match nothing is exchanged and
 * nothing is stored, which is what stops any page on the internet from
 * navigating a visitor's browser at our callback with a code of its own and
 * binding *their* Spotify account to this deployment.
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
 * The redirect URI Spotify will send the browser back to.
 *
 * Must be registered on the Spotify app *exactly* — Spotify compares the string,
 * so a trailing slash or an http/https mismatch is a hard failure with an opaque
 * `INVALID_CLIENT: Invalid redirect URI` message.
 *
 * Spotify additionally refuses to register a bare `http://localhost` origin on
 * apps created since 2025 — `http://127.0.0.1:<port>` is accepted where
 * `http://localhost:<port>` is not. That is why the loopback default here is the
 * IP form rather than the hostname; see the note in `.env.example`.
 */
export function spotifyRedirectUri(): string {
  const origin = process.env.PUBLIC_ORIGIN ?? 'http://127.0.0.1:5173';
  return `${origin.replace(/\/$/, '')}/api/integrations/spotify/callback`;
}

export interface SpotifyAuthUrlResult {
  ok: boolean;
  status: number;
  /** Present when ok. Safe to hand the browser — a Spotify URL with public parameters. */
  url?: string;
  message?: string;
}

/**
 * Build the consent URL the panel opens, and remember its state.
 *
 * `show_dialog=true` forces the approval screen even for an already-authorised
 * client. Spotify will otherwise silently re-issue for an existing grant, which
 * is convenient until you are trying to re-authorise a *different* account and
 * cannot work out why it keeps connecting the old one.
 */
export function buildSpotifyAuthUrl(): SpotifyAuthUrlResult {
  const { spotifyClientId } = config.integrations;
  if (!spotifyClientId) {
    return {
      ok: false,
      status: 400,
      message: 'Save a Spotify client id and secret first.',
    };
  }

  reap();
  const state = randomUUID();
  pending.set(state, { expiresAt: Date.now() + STATE_TTL_MS });

  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('client_id', spotifyClientId);
  url.searchParams.set('redirect_uri', spotifyRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SPOTIFY_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('show_dialog', 'true');

  return { ok: true, status: 200, url: url.toString() };
}

/** True exactly once per state, and only inside its TTL. */
export function consumeSpotifyState(state: string | undefined): boolean {
  if (!state) return false;
  reap();
  // Deleted whether or not it was valid, so a state cannot be tried twice — a
  // replayed code must fail on the state before it reaches Spotify.
  return pending.delete(state);
}

export interface SpotifyExchangeResult {
  ok: boolean;
  /** Safe for a browser page. Never contains a token or a Spotify error body. */
  message: string;
  refreshToken?: string;
}

/**
 * Trade an authorisation code for a refresh token.
 *
 * The refresh token is returned to the *caller* (the route, which stores it) and
 * deliberately never rendered, logged, or sent to the browser. Spotify's error
 * bodies are not propagated either: they can name the client id, and the page
 * this text lands on is one the visitor could screenshot.
 */
export async function exchangeSpotifyCode(code: string): Promise<SpotifyExchangeResult> {
  const { spotifyClientId, spotifyClientSecret } = config.integrations;
  if (!spotifyClientId || !spotifyClientSecret) {
    return { ok: false, message: 'This server has no Spotify client configured.' };
  }

  let response: Response;
  try {
    response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        // Spotify accepts the client secret in the body too, but the Basic header
        // is what its docs specify for this grant and keeps the secret out of any
        // proxy's body logging.
        authorization: `Basic ${Buffer.from(
          `${spotifyClientId}:${spotifyClientSecret}`,
          'utf8',
        ).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: spotifyRedirectUri(),
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, message: 'Spotify could not be reached to finish signing in.' };
  }

  if (!response.ok) {
    // Logged with the status only. The body is useful when debugging and can
    // carry the client id, so it does not go to CloudWatch either.
    logger.warn('integration.oauth-exchange-failed', {
      integration: 'spotify',
      status: response.status,
    });
    return {
      ok: false,
      message:
        'Spotify refused to complete the sign-in. Check that the redirect URI registered on ' +
        'the app matches this server exactly.',
    };
  }

  const body = (await response.json().catch(() => ({}))) as { refresh_token?: unknown };
  if (typeof body.refresh_token !== 'string') {
    return {
      ok: false,
      message:
        'Spotify returned no refresh token. Remove this app at spotify.com/account/apps and ' +
        'try connecting again.',
    };
  }

  return { ok: true, message: 'Spotify connected.', refreshToken: body.refresh_token };
}
