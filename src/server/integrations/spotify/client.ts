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

/** Call a Spotify endpoint with an already-obtained token. `null` on any fault. */
async function call(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<Record<string, unknown> | null> {
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
    console.error(`[spotify] ${path} threw:`, err instanceof Error ? err.message : err);
    return null;
  }
  if (!response.ok) {
    console.error(`[spotify] ${path} → ${response.status}`, await refusalDetail(response));
    return null;
  }

  // `POST /playlists/{id}/tracks` answers 201 with a body, but a 204 with no body
  // is legal elsewhere in this API and `json()` throws on it.
  if (response.status === 204) return {};
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
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
 * Resolve several track ids at once, keeping the order asked for.
 *
 * The batch endpoint rather than one call per id, and not only for the round
 * trips: `GET /v1/tracks?ids=` distinguishes the two failures that matter here.
 * A transport or auth fault fails the whole request and returns `null`, while an
 * id Spotify does not know comes back as a `null` *entry* inside a successful
 * response. Looking ids up one at a time collapses those into the same `null`,
 * and the caller has to tell "Spotify is down" apart from "the model invented
 * that id" — they get opposite messages.
 *
 * Returns `null` only for the first case. Per-id `null`s mean exactly "no such
 * track".
 */
export async function getTracks(
  ids: readonly string[],
): Promise<(SpotifyTrack | null)[] | null> {
  if (ids.length === 0) return [];
  const wanted = ids.slice(0, 50);

  if (spotifyFixtureMode()) return wanted.map((id) => fixtureTrack(id));

  const token = await appAccessToken();
  if (!token) return null;

  const params = new URLSearchParams({ ids: wanted.join(','), market: 'IL' });
  const body = await call(token, `/tracks?${params.toString()}`);
  if (!body || !Array.isArray(body.tracks)) return null;

  return body.tracks.map((raw) => readTrack(raw));
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
 * Returns `null` when there is no user grant at all, which the caller turns into
 * the link handoff rather than an error.
 */
export async function createPlaylist(input: {
  name: string;
  description: string;
  trackIds: readonly string[];
}): Promise<CreatedPlaylist | null> {
  const ids = input.trackIds.slice(0, MAX_TRACKS_PER_REQUEST);

  if (spotifyFixtureMode()) {
    const created = fixtureCreatePlaylist(input.name, ids);
    return { id: created.id, trackCount: ids.length };
  }

  const token = await userAccessToken();
  if (!token) return null;

  const me = await call(token, '/me');
  if (!me || typeof me.id !== 'string') return null;

  const playlist = await call(token, `/users/${encodeURIComponent(me.id)}/playlists`, {
    method: 'POST',
    body: {
      name: input.name,
      description: input.description,
      // Private, always. See the note on SPOTIFY_SCOPES: a gift should not turn up
      // on the giver's public profile.
      public: false,
    },
  });
  if (!playlist || typeof playlist.id !== 'string') return null;

  const playlistId = playlist.id;
  const url =
    typeof (playlist.external_urls as { spotify?: unknown } | undefined)?.spotify === 'string'
      ? ((playlist.external_urls as { spotify: string }).spotify)
      : `https://open.spotify.com/playlist/${playlistId}`;

  if (ids.length === 0) return { id: playlistId, url, trackCount: 0 };

  const added = await call(token, `/playlists/${encodeURIComponent(playlistId)}/tracks`, {
    method: 'POST',
    body: { uris: ids.map((id) => `spotify:track:${id}`) },
  });

  return { id: playlistId, url, trackCount: added ? ids.length : 0 };
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
