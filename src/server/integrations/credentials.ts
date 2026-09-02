import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { config } from '../config';
import { logger } from '../logging';
import { resetTokenCache as resetAmadeusTokenCache } from './amadeus/client';
import { resetGoogleTokenCache } from './google/client';
import { resetSpotifyTokenCache } from './spotify/client';

/**
 * Credential intake at runtime — the server side of "Connect" in the app.
 *
 * Credentials used to arrive only through the environment, which meant a
 * restart per key and a terminal per person. Now the panel can hand them in
 * while the process runs. Three rules, all load-bearing:
 *
 * 1. **Probe before apply.** A candidate credential is tried against the real
 *    provider first, and only a working one replaces what is already there.
 *    Without this, pasting a typo over a working key silently breaks a live
 *    integration — the panel would say "live" on the strength of a boolean
 *    that no longer means anything.
 * 2. **Values go in and never come out.** Nothing here returns, logs, or
 *    echoes a credential — not truncated, not masked. The response to a
 *    successful connect is the same booleans `GET /api/integrations` serves.
 * 3. **Persistence is best-effort, correctness is in-memory.** The applied
 *    value lands in `config.integrations`, which every client reads at call
 *    time, so it works immediately. Writing `.env` only makes it survive a
 *    local restart; on Fargate the file is ephemeral and the write is merely
 *    harmless.
 */

/**
 * The services whose credentials can arrive through the panel.
 *
 * `google` is one entry covering both `google-calendar` and `gmail` — they
 * share a refresh token, so "connect Google" is a single act. Hebcal and
 * Ontopo need nothing and so are not connectable; they are simply on.
 */
export type ConnectableId = 'amadeus' | 'whatsapp' | 'google' | 'spotify';

export function isConnectable(id: string): id is ConnectableId {
  return id === 'amadeus' || id === 'whatsapp' || id === 'google' || id === 'spotify';
}

/** What an intake attempt came to. Never carries a credential. */
export interface IntakeResult {
  ok: boolean;
  /** HTTP status the route should answer with. */
  status: number;
  /** Safe to show a visitor; names no value and no secret. */
  message: string;
}

/**
 * A field's shape, checked before anything is sent anywhere.
 *
 * Deliberately loose — real providers change their token formats, and a regex
 * that rejects a genuine key is worse than one that lets the probe say no.
 * This only refuses the obviously wrong: empty, whitespace, or long enough to
 * be a pasted error message rather than a key.
 */
function fieldValue(body: Record<string, unknown>, name: string): string | null {
  const value = body[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return null;
  return trimmed;
}

const badRequest = (message: string): IntakeResult => ({ ok: false, status: 400, message });

/** The provider refused the candidate — the values are wrong, not the network. */
const rejected = (provider: string): IntakeResult => ({
  ok: false,
  status: 400,
  message: `${provider} rejected these credentials. Nothing was changed.`,
});

/** The provider could not be reached at all — a network answer, not a verdict. */
const unreachable = (provider: string): IntakeResult => ({
  ok: false,
  status: 502,
  message: `${provider} could not be reached from this server, so the credentials could not be checked. Nothing was changed.`,
});

const PROBE_TIMEOUT_MS = 10_000;

/**
 * Try a candidate Amadeus id/secret against the token endpoint.
 *
 * Takes the candidate values directly rather than applying them to config and
 * calling `accessToken()`, because a probe must not mutate global state to run
 * — a failing candidate would otherwise have already replaced a working one.
 */
async function probeAmadeus(clientId: string, clientSecret: string): Promise<IntakeResult> {
  let response: Response;
  try {
    response = await fetch(
      `https://${config.integrations.amadeusHost}/v1/security/oauth2/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    );
  } catch {
    return unreachable('Amadeus');
  }
  if (!response.ok) return rejected('Amadeus');
  return { ok: true, status: 200, message: 'Amadeus connected.' };
}

/**
 * Read the phone number object back — a call that proves the token and the id
 * belong together without sending anyone a message.
 */
async function probeWhatsapp(phoneNumberId: string, token: string): Promise<IntakeResult> {
  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}?fields=id`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    );
  } catch {
    return unreachable('WhatsApp');
  }
  if (!response.ok) return rejected('WhatsApp');
  return { ok: true, status: 200, message: 'WhatsApp connected.' };
}

/**
 * Try a candidate Spotify id/secret against the client-credentials grant.
 *
 * This proves the pair, which is exactly the capability being connected: search.
 * An optional refresh token is *not* probed here — the same request cannot
 * validate both grants, and a working id/secret with a stale refresh token is
 * still a useful connection (playlists hand over links instead of saving). So a
 * bad refresh token degrades the capability rather than rejecting the connect,
 * and `confirm` is where the user finds out, in words.
 */
async function probeSpotify(clientId: string, clientSecret: string): Promise<IntakeResult> {
  let response: Response;
  try {
    response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return unreachable('Spotify');
  }
  if (!response.ok) return rejected('Spotify');
  return { ok: true, status: 200, message: 'Spotify connected.' };
}

/**
 * Accept credentials for one service, if the provider vouches for them.
 *
 * Google is the exception to probe-before-apply: a client id and secret cannot
 * be verified without a user consenting in a browser, so they are shape-checked
 * and stored, and the OAuth callback — which *does* verify, by performing the
 * exchange — is what finally flips the readiness boolean. The message says so.
 */
export async function applyIntegrationCredentials(
  id: ConnectableId,
  body: Record<string, unknown>,
): Promise<IntakeResult> {
  if (id === 'amadeus') {
    const clientId = fieldValue(body, 'clientId');
    const clientSecret = fieldValue(body, 'clientSecret');
    if (!clientId || !clientSecret) {
      return badRequest('Amadeus needs both an API key (clientId) and an API secret (clientSecret).');
    }
    const probe = await probeAmadeus(clientId, clientSecret);
    if (!probe.ok) return probe;

    config.integrations.amadeusClientId = clientId;
    config.integrations.amadeusClientSecret = clientSecret;
    // The cache may hold a token minted by the previous credentials; a live
    // reconnect must not spend an hour acting as the old account.
    resetAmadeusTokenCache();
    persistEnv({ AMADEUS_CLIENT_ID: clientId, AMADEUS_CLIENT_SECRET: clientSecret });
    logger.info('integration.connected', { integration: 'amadeus' });
    return probe;
  }

  if (id === 'whatsapp') {
    const phoneNumberId = fieldValue(body, 'phoneNumberId');
    const token = fieldValue(body, 'token');
    if (!phoneNumberId || !token) {
      return badRequest('WhatsApp needs both a phone number id and an access token.');
    }
    const probe = await probeWhatsapp(phoneNumberId, token);
    if (!probe.ok) return probe;

    config.integrations.whatsappPhoneNumberId = phoneNumberId;
    config.integrations.whatsappToken = token;
    persistEnv({ WHATSAPP_PHONE_NUMBER_ID: phoneNumberId, WHATSAPP_TOKEN: token });
    logger.info('integration.connected', { integration: 'whatsapp' });
    return probe;
  }

  if (id === 'spotify') {
    const clientId = fieldValue(body, 'clientId');
    const clientSecret = fieldValue(body, 'clientSecret');
    if (!clientId || !clientSecret) {
      return badRequest('Spotify needs both a client ID and a client secret.');
    }
    const probe = await probeSpotify(clientId, clientSecret);
    if (!probe.ok) return probe;

    config.integrations.spotifyClientId = clientId;
    config.integrations.spotifyClientSecret = clientSecret;

    // Optional, and the only way to get a *saving* playlist rather than one that
    // hands over links. Minted out of band — see CONNECT_RECIPES.spotify — so it
    // arrives as a third field on the same form rather than through a redirect.
    const refreshToken = fieldValue(body, 'refreshToken');
    if (refreshToken) config.integrations.spotifyRefreshToken = refreshToken;

    resetSpotifyTokenCache();
    persistEnv({
      SPOTIFY_CLIENT_ID: clientId,
      SPOTIFY_CLIENT_SECRET: clientSecret,
      ...(refreshToken ? { SPOTIFY_REFRESH_TOKEN: refreshToken } : {}),
    });
    logger.info('integration.connected', { integration: 'spotify' });
    return refreshToken
      ? probe
      : {
          ok: true,
          status: 200,
          message:
            'Spotify connected for search. Add a refresh token to let playlists be saved ' +
            'to a library — without one, confirming a playlist hands over track links.',
        };
  }

  const clientId = fieldValue(body, 'clientId');
  const clientSecret = fieldValue(body, 'clientSecret');
  if (!clientId || !clientSecret) {
    return badRequest('Google needs an OAuth client id and client secret (a "Web application" client).');
  }
  config.integrations.googleClientId = clientId;
  config.integrations.googleClientSecret = clientSecret;
  persistEnv({ GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret });
  logger.info('integration.oauth-client-saved', { integration: 'google' });
  return {
    ok: true,
    status: 200,
    message: 'OAuth client saved. Now sign in with Google to finish connecting.',
  };
}

/** Store the refresh token the OAuth callback earned. Called only after a real exchange. */
export function applyGoogleRefreshToken(refreshToken: string): void {
  config.integrations.googleRefreshToken = refreshToken;
  resetGoogleTokenCache();
  persistEnv({ GOOGLE_REFRESH_TOKEN: refreshToken });
  logger.info('integration.connected', { integration: 'google' });
}

/** Forget one service's credentials, in memory and in `.env`. */
export function clearIntegrationCredentials(id: ConnectableId): void {
  if (id === 'amadeus') {
    config.integrations.amadeusClientId = undefined;
    config.integrations.amadeusClientSecret = undefined;
    resetAmadeusTokenCache();
    removeEnv(['AMADEUS_CLIENT_ID', 'AMADEUS_CLIENT_SECRET']);
  } else if (id === 'spotify') {
    config.integrations.spotifyClientId = undefined;
    config.integrations.spotifyClientSecret = undefined;
    config.integrations.spotifyRefreshToken = undefined;
    resetSpotifyTokenCache();
    removeEnv(['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REFRESH_TOKEN']);
  } else if (id === 'whatsapp') {
    config.integrations.whatsappPhoneNumberId = undefined;
    config.integrations.whatsappToken = undefined;
    removeEnv(['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TOKEN']);
  } else {
    config.integrations.googleClientId = undefined;
    config.integrations.googleClientSecret = undefined;
    config.integrations.googleRefreshToken = undefined;
    resetGoogleTokenCache();
    removeEnv(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']);
  }
  logger.info('integration.disconnected', { integration: id });
}

/** Overridable so tests never touch the real file. */
let envPath = '.env';
export function setEnvPathForTests(path: string): void {
  envPath = path;
}

/**
 * Write key=value pairs into `.env`, replacing existing lines.
 *
 * Replace-not-append matters: dotenv resolves a duplicated key to the last
 * occurrence, so an appender produces a file where the line you can see is not
 * the value in use — a genuinely miserable hour for whoever reads it next.
 *
 * Best-effort by design. In-memory config is already updated, so a failed
 * write costs only restart durability; it is logged, not thrown, because the
 * connect itself succeeded.
 */
function persistEnv(vars: Record<string, string>): void {
  try {
    let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
    for (const [key, value] of Object.entries(vars)) {
      const line = `${key}=${value}`;
      // Also matches the commented-out placeholder `.env.example` style lines,
      // so uncommenting is not a separate manual step.
      const pattern = new RegExp(`^\\s*#?\\s*${key}\\s*=.*$`, 'm');
      content = pattern.test(content)
        ? content.replace(pattern, line)
        : `${content.replace(/\n*$/, '')}\n${line}\n`;
    }
    writeFileSync(envPath, content, { mode: 0o600 });
  } catch (err) {
    logger.warn('integration.env-persist-failed', {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Drop keys from `.env` entirely — a disconnect should leave no value behind. */
function removeEnv(keys: readonly string[]): void {
  try {
    if (!existsSync(envPath)) return;
    let content = readFileSync(envPath, 'utf8');
    for (const key of keys) {
      content = content.replace(new RegExp(`^\\s*${key}\\s*=.*\\n?`, 'm'), '');
    }
    writeFileSync(envPath, content, { mode: 0o600 });
  } catch (err) {
    logger.warn('integration.env-persist-failed', {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}
