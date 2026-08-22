import { codeChallengeOf, randomUrlSafeString } from './pkce';
import type { RuntimeAuthConfig } from './runtime-config';

/**
 * Authorization-code-with-PKCE against Cognito's Hosted UI, hand-rolled over
 * four URLs rather than pulled in with Amplify.
 *
 * Amplify would be the largest dependency in a repo that has eight, and its
 * Hosted UI helper wants to own the redirect lifecycle — which fights the
 * server-vended demo tokens this app also accepts. What it buys us is the four
 * details below, so they are spelled out here for review:
 *
 * - `state` is 32 random bytes, held in sessionStorage, compared then deleted;
 *   a mismatch aborts *without* exchanging the code.
 * - the `code_verifier` is single-use: read-then-deleted before the token
 *   request, which also makes React StrictMode's double effect harmless.
 * - refresh is single-flight (see token-store.ts) — ten concurrent 401s must not
 *   burn the refresh token ten times.
 * - no ID token is requested, so there is no `nonce` to validate. Identity comes
 *   from the access token, which the server verifies anyway.
 */

const STATE_KEY = 'valentin.oauth.state';
const VERIFIER_KEY = 'valentin.oauth.verifier';

/** What Cognito's token endpoint returns */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export class OAuthError extends Error {}

function requireHostedConfig(config: RuntimeAuthConfig): {
  domain: string;
  clientId: string;
} {
  if (!config.cognitoDomain || !config.clientId) {
    throw new OAuthError('This deployment has no Cognito login configured');
  }
  return { domain: config.cognitoDomain, clientId: config.clientId };
}

/**
 * The redirect target: the site root.
 *
 * Not `/callback` — cdn-stack.ts remaps only 404 to index.html and S3 behind an
 * OAC returns 403 for a missing key, so a `/callback` path would render raw
 * AccessDenied XML. There is no router here anyway.
 */
export function redirectUri(): string {
  return `${window.location.origin}/`;
}

/** Send the browser to the Hosted UI. Does not return. */
export async function beginLogin(config: RuntimeAuthConfig): Promise<void> {
  const { domain, clientId } = requireHostedConfig(config);

  const state = randomUrlSafeString();
  const verifier = randomUrlSafeString();
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri(),
    // openid + profile only. Notably **not**
    // aws.cognito.signin.user.admin, which would let a stolen access token
    // change the user's password.
    scope: 'openid profile',
    state,
    code_challenge: await codeChallengeOf(verifier),
    code_challenge_method: 'S256',
  });

  window.location.assign(`${domain}/oauth2/authorize?${params.toString()}`);
}

/** A returning redirect, if this page load is one */
export interface CallbackParams {
  code: string;
  state: string;
}

/**
 * Detect and consume an authorization-code redirect.
 *
 * Uses `replaceState`, not `pushState`, so the code never enters the history
 * stack — a back button must not replay a used code.
 */
export function readCallback(): CallbackParams | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  if (!code && !error) return null;

  const clean = () => {
    window.history.replaceState({}, '', window.location.pathname);
  };

  if (error) {
    clean();
    throw new OAuthError(params.get('error_description') || error);
  }

  clean();
  return { code: code as string, state: state ?? '' };
}

/**
 * Exchange a code for tokens.
 *
 * The verifier and state are consumed *before* the network call, so a second
 * invocation (StrictMode, a double-mounted effect) finds nothing and fails fast
 * rather than replaying the exchange.
 */
export async function exchangeCode(
  config: RuntimeAuthConfig,
  callback: CallbackParams,
): Promise<TokenResponse> {
  const { domain, clientId } = requireHostedConfig(config);

  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);

  if (!verifier) {
    throw new OAuthError('This login link has already been used');
  }
  if (!expectedState || expectedState !== callback.state) {
    // Abort without exchanging: a state mismatch is the signature of a
    // cross-site request forgery on the login flow.
    throw new OAuthError('The login response did not match this browser');
  }

  return postToken(domain, {
    grant_type: 'authorization_code',
    client_id: clientId,
    code: callback.code,
    code_verifier: verifier,
    redirect_uri: redirectUri(),
  });
}

/** Trade a refresh token for a fresh access token */
export async function refreshAccessToken(
  config: RuntimeAuthConfig,
  refreshToken: string,
): Promise<TokenResponse> {
  const { domain, clientId } = requireHostedConfig(config);
  return postToken(domain, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });
}

/**
 * Invalidate a refresh token server-side.
 *
 * A local clear alone would leave a token that stays valid for its full
 * lifetime; on a shared browser that is the whole risk.
 */
export async function revokeRefreshToken(
  config: RuntimeAuthConfig,
  refreshToken: string,
): Promise<void> {
  if (!config.cognitoDomain || !config.clientId) return;
  try {
    await fetch(`${config.cognitoDomain}/oauth2/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: refreshToken,
        client_id: config.clientId,
      }).toString(),
    });
  } catch {
    // Signing out locally must succeed even when the network doesn't.
  }
}

/** Where to send the browser to clear the Hosted UI's own session cookie */
export function hostedLogoutUrl(config: RuntimeAuthConfig): string | null {
  if (!config.cognitoDomain || !config.clientId) return null;
  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: redirectUri(),
  });
  return `${config.cognitoDomain}/logout?${params.toString()}`;
}

async function postToken(
  domain: string,
  body: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(`${domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

  if (!response.ok) {
    // Cognito's error bodies are terse ({"error":"invalid_grant"}) and safe to
    // show, but not useful to a person — keep the detail in the console.
    const detail = await response.text().catch(() => '');
    console.warn('[auth] token endpoint rejected the request', response.status, detail);
    throw new OAuthError('The sign-in could not be completed');
  }

  return (await response.json()) as TokenResponse;
}
