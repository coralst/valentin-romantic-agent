import type { SpotifyTrack } from './client';

/**
 * A small local catalogue, so the playlist path can be shown with no account.
 *
 * Every id here is prefixed `fixture:` rather than shaped like a Spotify id, and
 * that is deliberate. A 22-character base-62 string would be indistinguishable
 * from the real thing in a log, in a test failure, and in a URL — and the first
 * time somebody pasted one into a browser they would conclude the integration
 * had been talking to Spotify all along. An id that cannot be mistaken for real
 * is worth more than an id that looks convincing.
 *
 * The tracks themselves are real songs, chosen to span the moods the agent
 * actually asks for. That matters for the demo: a fixture full of invented band
 * names shows the plumbing but not the judgement, and the judgement — picking
 * something *she* would like — is the part worth watching.
 */

interface FixtureTrack extends SpotifyTrack {
  /** Free-text moods this track answers, matched loosely against the query. */
  moods: readonly string[];
}

const CATALOGUE: readonly FixtureTrack[] = [
  {
    id: 'fixture:track-01',
    name: 'At Last',
    artists: ['Etta James'],
    album: 'At Last!',
    url: 'https://open.spotify.com/search/Etta%20James%20At%20Last',
    durationMs: 182_000,
    moods: ['romantic', 'slow', 'soul', 'classic', 'anniversary', 'dinner'],
  },
  {
    id: 'fixture:track-02',
    name: 'La Vie en rose',
    artists: ['Édith Piaf'],
    album: 'La Vie en rose',
    url: 'https://open.spotify.com/search/Edith%20Piaf%20La%20Vie%20en%20rose',
    durationMs: 190_000,
    moods: ['romantic', 'french', 'classic', 'dinner', 'slow'],
  },
  {
    id: 'fixture:track-03',
    name: 'Ani Ve Ata',
    artists: ['Arik Einstein'],
    album: 'Shablul',
    url: 'https://open.spotify.com/search/Arik%20Einstein%20Ani%20Ve%20Ata',
    durationMs: 168_000,
    moods: ['hebrew', 'israeli', 'folk', 'warm', 'drive'],
  },
  {
    id: 'fixture:track-04',
    name: 'Yesh Bi Ahava',
    artists: ['Shlomo Artzi'],
    album: 'Tirkod',
    url: 'https://open.spotify.com/search/Shlomo%20Artzi%20Yesh%20Bi%20Ahava',
    durationMs: 245_000,
    moods: ['hebrew', 'israeli', 'romantic', 'drive'],
  },
  {
    id: 'fixture:track-05',
    name: 'Dream a Little Dream of Me',
    artists: ['Ella Fitzgerald', 'Louis Armstrong'],
    album: 'Ella and Louis Again',
    url: 'https://open.spotify.com/search/Ella%20Fitzgerald%20Dream%20a%20Little%20Dream',
    durationMs: 189_000,
    moods: ['jazz', 'romantic', 'slow', 'dinner', 'classic'],
  },
  {
    id: 'fixture:track-06',
    name: 'Harvest Moon',
    artists: ['Neil Young'],
    album: 'Harvest Moon',
    url: 'https://open.spotify.com/search/Neil%20Young%20Harvest%20Moon',
    durationMs: 304_000,
    moods: ['folk', 'warm', 'slow', 'drive', 'romantic'],
  },
  {
    id: 'fixture:track-07',
    name: 'Sunday Morning',
    artists: ['Maroon 5'],
    album: 'Songs About Jane',
    url: 'https://open.spotify.com/search/Maroon%205%20Sunday%20Morning',
    durationMs: 244_000,
    moods: ['upbeat', 'pop', 'morning', 'drive', 'breakfast'],
  },
  {
    id: 'fixture:track-08',
    name: 'Put Your Records On',
    artists: ['Corinne Bailey Rae'],
    album: 'Corinne Bailey Rae',
    url: 'https://open.spotify.com/search/Corinne%20Bailey%20Rae%20Put%20Your%20Records%20On',
    durationMs: 214_000,
    moods: ['upbeat', 'soul', 'morning', 'drive', 'breakfast'],
  },
  {
    id: 'fixture:track-09',
    name: 'Nuvole Bianche',
    artists: ['Ludovico Einaudi'],
    album: 'Una Mattina',
    url: 'https://open.spotify.com/search/Ludovico%20Einaudi%20Nuvole%20Bianche',
    durationMs: 359_000,
    moods: ['instrumental', 'classical', 'quiet', 'dinner', 'slow'],
  },
  {
    id: 'fixture:track-10',
    name: 'Sea of Love',
    artists: ['Cat Power'],
    album: 'The Covers Record',
    url: 'https://open.spotify.com/search/Cat%20Power%20Sea%20of%20Love',
    durationMs: 141_000,
    moods: ['indie', 'quiet', 'romantic', 'slow'],
  },
  {
    id: 'fixture:track-11',
    name: 'Tel Aviv',
    artists: ['Omer Adam'],
    album: 'Omer Adam',
    url: 'https://open.spotify.com/search/Omer%20Adam%20Tel%20Aviv',
    durationMs: 201_000,
    moods: ['hebrew', 'israeli', 'upbeat', 'pop', 'drive'],
  },
  {
    id: 'fixture:track-12',
    name: 'First Day of My Life',
    artists: ['Bright Eyes'],
    album: "I'm Wide Awake, It's Morning",
    url: 'https://open.spotify.com/search/Bright%20Eyes%20First%20Day%20of%20My%20Life',
    durationMs: 189_000,
    moods: ['indie', 'romantic', 'folk', 'quiet'],
  },
];

/** Split a query into lowercase words worth matching on. */
function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);
}

/**
 * Score a track against a free-text query, the way a search endpoint would.
 *
 * Artist and title matches outrank mood matches because that is what a caller
 * naming "Shlomo Artzi" means, while an unmatched query still returns the
 * catalogue in its own order rather than nothing — an empty result for "music
 * she likes" would be a worse lie than an imperfect ranking.
 */
function score(track: FixtureTrack, query: string): number {
  const words = terms(query);
  if (words.length === 0) return 0;

  const haystack = `${track.name} ${track.artists.join(' ')} ${track.album}`.toLowerCase();
  let total = 0;
  for (const word of words) {
    if (haystack.includes(word)) total += 3;
    if (track.moods.some((mood) => mood.includes(word) || word.includes(mood))) total += 1;
  }
  return total;
}

/** The fixture's answer to a catalogue search. Never empty, never network. */
export function fixtureSearch(query: string, limit: number): SpotifyTrack[] {
  const ranked = CATALOGUE.map((track) => ({ track, rank: score(track, query) }))
    .sort((a, b) => b.rank - a.rank)
    .map(({ track }) => strip(track));
  return ranked.slice(0, limit);
}

/** Drop the fixture-only `moods` field so callers see the real track shape. */
function strip(track: FixtureTrack): SpotifyTrack {
  const { moods, ...rest } = track;
  void moods;
  return rest;
}

/** Look a fixture track up by the id `fixtureSearch` handed out. */
export function fixtureTrack(id: string): SpotifyTrack | null {
  const found = CATALOGUE.find((track) => track.id === id);
  return found ? strip(found) : null;
}

/**
 * Playlists "saved" in this process, so a confirmed proposal has somewhere to go.
 *
 * In-memory and per-process on purpose: this is the shape of a save, not a save.
 * Nothing here survives a restart and nothing here is a promise.
 */
const savedPlaylists = new Map<string, { name: string; trackIds: string[] }>();

let nextPlaylist = 1;

export function fixtureCreatePlaylist(name: string, trackIds: readonly string[]): {
  id: string;
  url: string;
} {
  const id = `fixture:playlist-${nextPlaylist++}`;
  savedPlaylists.set(id, { name, trackIds: [...trackIds] });
  return { id, url: 'https://open.spotify.com/' };
}

/** For tests: what the fixture believes it holds. */
export function fixturePlaylists(): ReadonlyMap<string, { name: string; trackIds: string[] }> {
  return savedPlaylists;
}

/** For tests: forget every fixture playlist and restart numbering. */
export function resetFixturePlaylists(): void {
  savedPlaylists.clear();
  nextPlaylist = 1;
}
