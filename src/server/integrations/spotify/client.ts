import { config } from '../../config';
import {
  fixtureCreatePlaylist,
  fixtureSearch,
  fixtureTrack,
} from './fixture';

/**
 * Transport for Spotify — catalogue search, and one playlist write.
 *
 * ## Two grants, two capabilities
 *
 * Spotify's API splits neatly along the line this integration cares about, and
 * the split is the whole reason the music row is useful before anybody signs in:
 *
 * - **Client credentials** (`grant_type=client_credentials`) authenticate the
 *   *app*, not a person. They can read the catalogue — `/v1/search` — and that is
 *   all `find_music` ever needs. No user, no consent screen, no refresh token.
 * - **A user refresh token** (`grant_type=refresh_token`) authenticates a
 *   *person*, and is the only thing that can write into a library. Only
 *   {@link createPlaylist} needs it.
 *
 * So a deployment holding just an id and secret can pick real tracks off real
 * taste and hand over links; adding a refresh token upgrades the last step from
 * "here is the playlist" to "it is in your library". Nothing in between breaks,
 * and the user is told which of the two happened — see `tools.ts`.
 *
 * ## Scopes
 *
 * `playlist-modify-private` and nothing else. Notably *not*
 * `playlist-modify-public`, which would let a playlist appear on the account's
 * public profile — a surprise nobody asked for on a gift — and not
 * `user-top-read`, because this build has no business reading someone's listening
 * history to guess at taste. The taste comes from the profile the couple filled
 * in, which they can see and correct.
 *
 * ## Fixture mode
 *
 * With `SPOTIFY_FIXTURE=1` every function here answers from `fixture.ts` and no
 * socket is opened. That is for tests and `verify:local`. It is *not* a way to
 * make the panel claim a live account: {@link spotifyFixtureMode} is exported so
 * the tools can stamp every line the user reads, and they do.
 *
 * Like Google and Amadeus, and unlike Ontopo, this follows published
 * documentation rather than observation, and has not been exercised against a
 * live Spotify account from this repo. The request shapes are documented-correct.
 */

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const API_BASE = 'https://api.spotify.com/v1';

/** Spotify access tokens last an hour; refresh a minute early. */
const TOKEN_SKEW_MS = 60 * 1000;

const TIMEOUT_MS = 10_000;

/** How long a proposed playlist stays confirmable. */
export const SPOTIFY_PROPOSAL_TTL_MS = 30 * 60 * 1000;

/** Spotify's own ceiling on one add-tracks call. Far above anything we send. */
const MAX_TRACKS_PER_REQUEST = 100;

/**
 * The most `/v1/search` will return before it refuses the request outright.
 *
 * Ten, measured against the live API — `limit=11` answers `400 Invalid limit`,
 * with or without `market`. The reference page for the endpoint says 50, and this
 * clamped to 50 until a conversation asked for twelve tracks and got nothing.
 *
 * Clamped here as well as in `tools.ts` on purpose: the tool's schema is advice to
 * a model, which is free to ignore it, whereas this is the last point before the
 * wire. A caller asking for more now gets ten tracks instead of an error.
 */
const SEARCH_LIMIT_CEILING = 10;

/**
 * The scopes a refresh token for this build should carry.
 *
 * Recorded rather than sent — a refresh token already carries its grant. This
 * exists so whoever mints one knows exactly what to tick, and so widening it is a
 * visible diff rather than a quiet change of blast radius.
 */
export const SPOTIFY_SCOPES = ['playlist-modify-private'] as const;

/** True when this process is answering from the local catalogue. */
export function spotifyFixtureMode(): boolean {
  return config.integrations.spotifyFixture === true;
}

/**
 * One line, prepended to everything the user reads in fixture mode.
 *
 * Lives here rather than in `tools.ts` so there is exactly one wording to audit.
 */
export const FIXTURE_NOTICE =
  'Demo catalogue — no Spotify account is contacted and nothing is saved.';

export interface SpotifyTrack {
  /** Spotify's track id, or a `fixture:`-prefixed one in fixture mode. */
  id: string;
  name: string;
  /** Every credited artist, in Spotify's order. */
  artists: string[];
  album: string;
  /** The track's own page, for the handoff when there is no account to save to. */
  url: string;
  durationMs: number;
}

export interface CreatedPlaylist {
  id: string;
  /**
   * Spotify's link to the playlist, for the confirmation message.
   *
   * Absent in fixture mode, where there is no playlist to open. Optional rather
   * than a placeholder so a caller cannot accidentally hand a visitor a dead
   * `open.spotify.com` URL and have it read as a broken save.
   */
  url?: string;
  /** How many of the requested tracks actually went in. */
  trackCount: number;
}

/**
 * Why a playlist write did not happen, when it did not.
 *
 * This was a bare `null` for every cause, and the caller — having no way to tell
 * them apart — said "no Spotify account is connected" to all of them. That
 * sentence was actively false in the case that actually occurred: an account was
 * connected, its refresh token minted an access token fine, and Spotify then
 * refused every user-scoped call because the account is not on the app's
 * development-mode user list. Telling someone to connect an account they have
 * already connected sends them round a loop that cannot terminate.
 *
 * - `no-grant` — no refresh token at all. The link handoff is correct here.
 * - `not-registered` — a valid token for an account Spotify will not serve,
 *   because the app is unpublished and the account is not on its allowlist.
 *   Only a human with the developer dashboard can clear this.
 * - `refused` — anything else: a revoked token, an outage, a rejected write.
 */
export type PlaylistFailure = 'no-grant' | 'not-registered' | 'refused';

export type CreatePlaylistResult =
  | { ok: true; playlist: CreatedPlaylist }
  | { ok: false; reason: PlaylistFailure };

interface TokenCache {
  token: string;
  expiresAt: number;
  /** Which grant minted it — a user token must never be served to an app call. */
  kind: 'app' | 'user';
}

let appToken: TokenCache | null = null;
let userToken: TokenCache | null = null;

/**
 * Spotify's own words about a refusal, for the log line — never for the user.
 *
 * Defensive to the point of paranoia because this only ever runs on a path that
 * is *already* failing, and a diagnostic that throws turns a handled `null` into
 * an unhandled rejection. `text()` is missing on a hand-rolled test double and
 * throws on a body that was already consumed, so both are swallowed.
 */
async function refusalDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).replace(/\s+/g, ' ').slice(0, 200);
  } catch {
    return '(no body)';
  }
}

/** Drop both cached tokens. Called on connect/disconnect, and by tests. */
export function resetSpotifyTokenCache(): void {
  appToken = null;
  userToken = null;
}

/** The Basic header both grants authenticate the *client* with. */
function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

/**
 * Ask the token endpoint for a bearer token, and cache it.
 *
 * Shared by both grants because the request and response shapes are identical
 * apart from the form body — and because getting the caching wrong twice is how
 * one of them ends up minting a token per call.
 */
async function mintToken(
  kind: 'app' | 'user',
  body: Record<string, string>,
): Promise<string | null> {
  const { spotifyClientId, spotifyClientSecret } = config.integrations;
  if (!spotifyClientId || !spotifyClientSecret) return null;

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: basicAuth(spotifyClientId, spotifyClientSecret),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[spotify] token fetch threw:', err instanceof Error ? err.message : err);
    return null;
  }
  // `400 invalid_grant` lands here for a revoked refresh token, and no amount of
  // retrying will help — a human has to mint a new one.
  if (!response.ok) {
    console.error(
      `[spotify] ${kind} token refused: ${response.status}`,
      await refusalDetail(response),
    );
    return null;
  }

  const parsed = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof parsed.access_token !== 'string') return null;

  const ttlSeconds = typeof parsed.expires_in === 'number' ? parsed.expires_in : 3599;
  const cached: TokenCache = {
    token: parsed.access_token,
    expiresAt: Date.now() + ttlSeconds * 1000 - TOKEN_SKEW_MS,
    kind,
  };
  if (kind === 'app') appToken = cached;
  else userToken = cached;
  return cached.token;
}

/**
 * A token good for reading the catalogue.
 *
 * Returns `null` for both "not configured" and "Spotify refused", because the
 * caller says the same thing to the user either way.
 */
export async function appAccessToken(): Promise<string | null> {
  if (appToken && appToken.expiresAt > Date.now()) return appToken.token;
  return mintToken('app', { grant_type: 'client_credentials' });
}

/** A token good for writing a playlist, or `null` when no account is connected. */
export async function userAccessToken(): Promise<string | null> {
  const { spotifyRefreshToken } = config.integrations;
  if (!spotifyRefreshToken) return null;
  if (userToken && userToken.expiresAt > Date.now()) return userToken.token;
  return mintToken('user', {
    grant_type: 'refresh_token',
    refresh_token: spotifyRefreshToken,
  });
}

/**
 * Call a Spotify endpoint with an already-obtained token, keeping the status.
 *
 * The status is what lets a caller distinguish a 403 "user is not registered for
 * this application" — which no retry and no reconnect will ever fix — from the
 * transient faults that share its shape. `status: 0` means the request never
 * completed.
 */
async function callDetailed(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; status: number; detail: string }
> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[spotify] ${path} threw:`, detail);
    return { ok: false, status: 0, detail };
  }
  if (!response.ok) {
    const detail = await refusalDetail(response);
    console.error(`[spotify] ${path} → ${response.status}`, detail);
    return { ok: false, status: response.status, detail };
  }

  // `POST /playlists/{id}/tracks` answers 201 with a body, but a 204 with no body
  // is legal elsewhere in this API and `json()` throws on it.
  if (response.status === 204) return { ok: true, body: {} };
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null
      ? { ok: true, body: parsed as Record<string, unknown> }
      : { ok: false, status: response.status, detail: 'body was not an object' };
  } catch {
    return { ok: false, status: response.status, detail: 'body was not JSON' };
  }
}

/** {@link callDetailed} for the callers that treat every fault alike. */
async function call(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<Record<string, unknown> | null> {
  const result = await callDetailed(token, path, init);
  return result.ok ? result.body : null;
}

/**
 * Spotify's wording for an account its unpublished app is not allowed to serve.
 *
 * Matched on the message rather than the status alone because a 403 also covers
 * a missing scope, and the two need different advice: one is a dashboard entry,
 * the other a re-consent.
 */
function isNotRegistered(status: number, detail: string): boolean {
  return status === 403 && /not registered/i.test(detail);
}

function readTrack(raw: unknown): SpotifyTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as {
    id?: unknown;
    name?: unknown;
    duration_ms?: unknown;
    album?: { name?: unknown };
    artists?: unknown;
    external_urls?: { spotify?: unknown };
    uri?: unknown;
  };
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return null;

  const artists = Array.isArray(record.artists)
    ? record.artists
        .map((artist) =>
          artist && typeof artist === 'object' && typeof (artist as { name?: unknown }).name === 'string'
            ? ((artist as { name: string }).name)
            : null,
        )
        .filter((name): name is string => name !== null)
    : [];

  return {
    id: record.id,
    name: record.name,
    artists,
    album: typeof record.album?.name === 'string' ? record.album.name : '',
    url:
      typeof record.external_urls?.spotify === 'string'
        ? record.external_urls.spotify
        : `https://open.spotify.com/track/${record.id}`,
    durationMs: typeof record.duration_ms === 'number' ? record.duration_ms : 0,
  };
}

/**
 * Search the catalogue.
 *
 * `market=IL` is not cosmetic: without a market Spotify happily returns tracks
 * that are unplayable where this couple actually lives, and a playlist of grey
 * rows is worse than a shorter playlist.
 */
export async function searchTracks(query: string, limit = 10): Promise<SpotifyTrack[] | null> {
  const wanted = Math.max(1, Math.min(Math.round(limit), SEARCH_LIMIT_CEILING));
  if (spotifyFixtureMode()) return fixtureSearch(query, wanted);

  const token = await appAccessToken();
  if (!token) return null;

  const params = new URLSearchParams({
    q: query,
    type: 'track',
    limit: String(wanted),
    market: 'IL',
  });
  const body = await call(token, `/search?${params.toString()}`);
  if (!body) return null;

  const items = (body.tracks as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items)) return null;
  return items.map(readTrack).filter((track): track is SpotifyTrack => track !== null);
}

/**
 * One `GET /v1/tracks/{id}`, keeping the two failures that matter apart.
 *
 * `'missing'` covers exactly the statuses Spotify uses for "no such track" — a
 * 404 for a well-formed id it does not know, a 400 for an id that is not an id
 * at all. Anything else non-ok is a `'fault'`: auth, quota, an outage — things
 * that would refuse a *real* id too, so treating them as "missing" would tell
 * the model its ids were invented when Spotify was simply down.
 */
async function getOneTrack(
  token: string,
  id: string,
): Promise<{ kind: 'found'; track: SpotifyTrack } | { kind: 'missing' } | { kind: 'fault' }> {
  let response: Response;
  const path = `/tracks/${encodeURIComponent(id)}?market=IL`;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`[spotify] ${path} threw:`, err instanceof Error ? err.message : err);
    return { kind: 'fault' };
  }
  if (response.status === 404 || response.status === 400) return { kind: 'missing' };
  if (!response.ok) {
    console.error(`[spotify] ${path} → ${response.status}`, await refusalDetail(response));
    return { kind: 'fault' };
  }

  try {
    const track = readTrack(await response.json());
    return track ? { kind: 'found', track } : { kind: 'missing' };
  } catch {
    return { kind: 'fault' };
  }
}

/**
 * Resolve several track ids, keeping the order asked for.
 *
 * One `GET /v1/tracks/{id}` per id, *not* the batch `GET /v1/tracks?ids=` the
 * reference page suggests — the batch endpoint answers **403 Forbidden** for
 * this app (a development-mode quota restriction, verified live 2026-09-05
 * with a token that passed `/search` in the same second), while the single-id
 * form answers 200 with the same token. No request shape lifts the 403, so the
 * round trips are the price of working at all; they run in parallel, and a
 * playlist's worth of ids is at most {@link MAX_TRACKS_PER_REQUEST}.
 *
 * The two failures that matter stay distinct: a transport or auth fault on
 * *any* id fails the whole call and returns `null` ("Spotify is down"), while
 * an id Spotify does not know becomes a `null` *entry* ("the model invented
 * that id"). The caller gives those opposite messages.
 */
export async function getTracks(
  ids: readonly string[],
): Promise<(SpotifyTrack | null)[] | null> {
  if (ids.length === 0) return [];
  const wanted = ids.slice(0, 50);

  if (spotifyFixtureMode()) return wanted.map((id) => fixtureTrack(id));

  const token = await appAccessToken();
  if (!token) return null;

  const results = await Promise.all(wanted.map((id) => getOneTrack(token, id)));
  if (results.some((result) => result.kind === 'fault')) return null;

  return results.map((result) => (result.kind === 'found' ? result.track : null));
}

/**
 * Create a private playlist on the connected account and fill it.
 *
 * Three calls, in this order, because Spotify offers no way to do it in one:
 * `GET /me` for the user id, `POST /users/{id}/playlists`, then
 * `POST /playlists/{id}/tracks`. The middle one is the point of no return — a
 * playlist created and then not filled leaves an empty playlist in someone's
 * library, so a failure to add tracks reports the count it managed rather than
 * pretending the whole thing failed.
 *
 * Never throws, and never reports success it did not have: see
 * {@link PlaylistFailure} for the three ways it can decline, which the caller
 * turns into three different sentences.
 */
export async function createPlaylist(input: {
  name: string;
  description: string;
  trackIds: readonly string[];
}): Promise<CreatePlaylistResult> {
  const ids = input.trackIds.slice(0, MAX_TRACKS_PER_REQUEST);

  if (spotifyFixtureMode()) {
    const created = fixtureCreatePlaylist(input.name, ids);
    return { ok: true, playlist: { id: created.id, trackCount: ids.length } };
  }

  // No refresh token at all is the one case that is not a fault: this deployment
  // simply has no account, and the caller hands over links instead.
  if (!config.integrations.spotifyRefreshToken) return { ok: false, reason: 'no-grant' };

  const token = await userAccessToken();
  if (!token) return { ok: false, reason: 'refused' };

  const me = await callDetailed(token, '/me');
  if (!me.ok) {
    return {
      ok: false,
      reason: isNotRegistered(me.status, me.detail) ? 'not-registered' : 'refused',
    };
  }
  if (typeof me.body.id !== 'string') return { ok: false, reason: 'refused' };

  const playlist = await call(token, `/users/${encodeURIComponent(me.body.id)}/playlists`, {
    method: 'POST',
    body: {
      name: input.name,
      description: input.description,
      // Private, always. See the note on SPOTIFY_SCOPES: a gift should not turn up
      // on the giver's public profile.
      public: false,
    },
  });
  if (!playlist || typeof playlist.id !== 'string') return { ok: false, reason: 'refused' };

  const playlistId = playlist.id;
  const url =
    typeof (playlist.external_urls as { spotify?: unknown } | undefined)?.spotify === 'string'
      ? ((playlist.external_urls as { spotify: string }).spotify)
      : `https://open.spotify.com/playlist/${playlistId}`;

  if (ids.length === 0) return { ok: true, playlist: { id: playlistId, url, trackCount: 0 } };

  const added = await call(token, `/playlists/${encodeURIComponent(playlistId)}/tracks`, {
    method: 'POST',
    body: { uris: ids.map((id) => `spotify:track:${id}`) },
  });

  return {
    ok: true,
    playlist: { id: playlistId, url, trackCount: added ? ids.length : 0 },
  };
}

/**
 * The consent URL a human visits once to mint this build's refresh token.
 *
 * Unlike Google there is no callback route in this server for it — a Spotify
 * refresh token is minted out of band and pasted into the panel, which is a
 * smaller surface than a second OAuth redirect and needs no state store. The URL
 * is built here so the scope list and the `authorize` spelling live next to the
 * code that depends on them.
 */
export function spotifyAuthorizeUrl(redirectUri: string): string | null {
  const { spotifyClientId } = config.integrations;
  if (!spotifyClientId) return null;
  const params = new URLSearchParams({
    client_id: spotifyClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES.join(' '),
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** "3:04", for a line a human reads. */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** One track on a line, for the model to quote from. */
export function describeTrack(track: SpotifyTrack): string {
  const artists = track.artists.length ? track.artists.join(', ') : 'unknown artist';
  return `${track.name} — ${artists} (${formatDuration(track.durationMs)})`;
}
