/**
 * Ground truth fetched independently of our own clients.
 *
 * The point of an oracle is that it can disagree with us. A check that reads the
 * Hebrew date through `hebrewDateOf` and compares it to `hebrewDateOf` proves only
 * that a function is deterministic — so these go to hebcal's and Spotify's public
 * APIs directly, over `fetch`, and never import from `src/server/integrations`.
 *
 * When a provider cannot be reached the oracle throws, and `check()` turns that
 * into `UNPROVEN`. A provider outage must never be recorded as a pass.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const CACHE_DIR = join(import.meta.dirname, '..', '.cache');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Cache by URL so a re-run of the corpus is nearly free and rate limits stay unhit. */
async function cachedJson(url: string): Promise<unknown> {
  const key = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const path = join(CACHE_DIR, `${key}.json`);

  try {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as { at: number; body: unknown };
    if (Date.now() - cached.at < CACHE_TTL_MS) return cached.body;
  } catch {
    // No usable cache entry; fall through to the network.
  }

  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const body: unknown = await response.json();

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify({ at: Date.now(), body }));
  return body;
}

/** The Israeli wall-clock date for an instant, computed without our own helpers. */
export function israelLocalDate(at: Date): string {
  // en-CA renders ISO-ordered YYYY-MM-DD, which is why it is used instead of a
  // manual assembly from parts.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export interface HebrewDate {
  readonly day: number;
  readonly month: string;
  readonly year: number;
  readonly text: string;
}

/**
 * The Hebrew date for a Gregorian day, per hebcal's own converter.
 *
 * `gs=on` matters: after sunset the Hebrew day has already advanced, and the
 * agent's civil line says "Sunday 2026-09-06" for the whole Israeli day. The
 * comparison the user cares about is date-to-date, so this asks for the plain
 * daytime conversion and the case compares it to the day the agent named.
 */
export async function hebrewDateFor(localDate: string): Promise<HebrewDate> {
  const [year, month, day] = localDate.split('-');
  const body = (await cachedJson(
    `https://www.hebcal.com/converter?cfg=json&gy=${year}&gm=${Number(month)}&gd=${Number(
      day,
    )}&g2h=1&strict=1`,
  )) as { hd?: number; hm?: string; hy?: number; hebrew?: string };

  if (typeof body.hd !== 'number' || typeof body.hm !== 'string' || typeof body.hy !== 'number') {
    throw new Error(`hebcal converter returned no date for ${localDate}`);
  }
  return { day: body.hd, month: body.hm, year: body.hy, text: `${body.hd} ${body.hm} ${body.hy}` };
}

export interface ShabbatWindow {
  readonly candleLighting?: string;
  readonly havdalah?: string;
}

/** Shabbat times for a city, from hebcal's Shabbat endpoint. */
export async function shabbatTimesFor(
  geonameid: string,
  localDate: string,
): Promise<ShabbatWindow> {
  const body = (await cachedJson(
    `https://www.hebcal.com/shabbat?cfg=json&geonameid=${geonameid}&gy=${localDate.slice(
      0,
      4,
    )}&gm=${Number(localDate.slice(5, 7))}&gd=${Number(localDate.slice(8, 10))}&M=on`,
  )) as { items?: { category?: string; date?: string }[] };

  const at = (category: string): string | undefined =>
    body.items?.find((item) => item.category === category)?.date;

  return { candleLighting: at('candles'), havdalah: at('havdalah') };
}

/**
 * Resolve Spotify track ids with a token this harness minted itself.
 *
 * Deliberately not `SpotifyClient`: the question is whether the ids the agent put
 * in a playlist card exist and belong to the artists it named in its prose, and
 * asking our own client would inherit whatever mapping bug produced them.
 */
export async function spotifyTracks(
  ids: readonly string[],
): Promise<Map<string, { name: string; artist: string }>> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('no Spotify client credentials for the oracle');

  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`Spotify token: ${tokenResponse.status}`);
  const { access_token: token } = (await tokenResponse.json()) as { access_token?: string };
  if (!token) throw new Error('Spotify returned no access token');

  const bare = ids.map((id) => id.replace(/^spotify:track:/, '')).filter(Boolean);
  const found = new Map<string, { name: string; artist: string }>();
  if (bare.length === 0) return found;

  // One id per request, not the batch `?ids=` form.
  //
  // This app 403s on `GET /v1/tracks?ids=…` while `GET /v1/tracks/{id}` returns
  // 200 for the same ids and the same token — verified directly against both. It
  // is an app-level restriction, not a credential problem, and it is the same
  // restriction the production client already works around. An oracle that used
  // the batch form would report every playlist case UNPROVEN and prove nothing.
  for (const id of bare.slice(0, 30)) {
    const response = await fetch(`https://api.spotify.com/v1/tracks/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    // A 404 means the id does not exist, which is a finding rather than an outage,
    // so it is recorded as absent instead of thrown.
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`Spotify /v1/tracks/${id}: ${response.status}`);

    const track = (await response.json()) as {
      id?: string;
      name?: string;
      artists?: { name?: string }[];
    };
    if (!track.id) continue;
    found.set(track.id, { name: track.name ?? '', artist: track.artists?.[0]?.name ?? '' });
  }
  return found;
}

/**
 * Today's date from an independent time source.
 *
 * Proves `nowBlock`'s civil day is right rather than merely self-consistent with
 * the container clock — a drifted or misconfigured host is a real failure mode and
 * one that no amount of internal agreement would reveal.
 */
export async function independentIsraelDate(): Promise<string> {
  const body = (await cachedJson('https://worldtimeapi.org/api/timezone/Asia/Jerusalem')) as {
    datetime?: string;
  };
  if (!body.datetime) throw new Error('no datetime from the independent time source');
  return body.datetime.slice(0, 10);
}
