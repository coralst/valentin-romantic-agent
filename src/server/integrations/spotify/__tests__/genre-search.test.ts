import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { config } from '../../../config';
import {
  buildSearchQuery,
  knownGenre,
  resetSeenTracks,
  resetSpotifyTokenCache,
  searchTracks,
} from '../client';
import { findMusicTool } from '../tools';
import { runTool } from '../../tool-registry';

/**
 * The live failure, session `97725cc8…`, 2026-09-21 12:19Z:
 *
 *   user:     please create a nice playlist for her, for after the evening out.
 *   (profile: heavy metal)
 *   find_music ×5, all ok — then `agent.tool_loop_truncated iterations:5 proposals:0`
 *   Valentin: Let me get you something better — proper heavy metal, not pop songs
 *             with "heavy metal" in the title:
 *
 * …and nothing after the colon. `q=heavy metal` is a *title* search on Spotify;
 * it returned Lady Gaga's "Heavy Metal Lover". The model noticed, reworded, and
 * spent every iteration searching. `q=genre:metal` returns Metallica. These tests
 * pin the query string, because the query string is the whole fix.
 */

const CTX = { sessionId: 'spotify-genre-test', userId: 'user-1' };
const TOKEN_RESPONSE = { access_token: 'app-token', expires_in: 3600 };

const track = (id: string, name: string, artist: string) => ({
  id,
  name,
  artists: [{ name: artist }],
  album: { name: 'Album' },
  external_urls: { spotify: `https://open.spotify.com/track/${id}` },
});

/** What `/v1/search?q=heavy metal` actually returned on 2026-09-21. */
const TITLE_MATCHES = {
  tracks: {
    items: [
      track('1aaaaaaaaaaaaaaaaaaaaa', 'Heavy Metal Lover', 'Lady Gaga'),
      track('2aaaaaaaaaaaaaaaaaaaaa', 'Heavy Metal Drummer', 'Wilco'),
    ],
  },
};

/** What `/v1/search?q=genre:metal` returned the same day. */
const GENRE_MATCHES = {
  tracks: {
    items: [
      track('3aaaaaaaaaaaaaaaaaaaaa', 'Nothing Else Matters', 'Metallica'),
      track('4aaaaaaaaaaaaaaaaaaaaa', 'Enter Sandman', 'Metallica'),
    ],
  },
};

let searches: string[];

/** Answer the search route by whether the query carried a genre filter. */
function stubSpotify() {
  searches = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('accounts.spotify.com')) {
        return { ok: true, status: 200, json: async () => TOKEN_RESPONSE, text: async () => '' } as Response;
      }
      const q = new URL(url).searchParams.get('q') ?? '';
      searches.push(q);
      const body = q.startsWith('genre:') ? GENRE_MATCHES : TITLE_MATCHES;
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
    }),
  );
}

const ORIGINAL = { ...config.integrations };

beforeEach(() => {
  resetSpotifyTokenCache();
  resetSeenTracks();
  config.integrations.spotifyClientId = 'test-client';
  config.integrations.spotifyClientSecret = 'test-secret';
  config.integrations.spotifyRefreshToken = undefined;
  config.integrations.spotifyFixture = false;
  stubSpotify();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(config.integrations, ORIGINAL);
  resetSpotifyTokenCache();
});

describe('buildSearchQuery', () => {
  it('leaves a plain query alone', () => {
    expect(buildSearchQuery('Shlomo Artzi')).toEqual({ q: 'Shlomo Artzi', filtered: false });
  });

  it('turns a known genre into Spotify’s filter, reduced to the broad tag', () => {
    expect(buildSearchQuery('', { genre: 'heavy metal' })).toEqual({
      q: 'genre:metal',
      filtered: true,
    });
    expect(buildSearchQuery('', { genre: 'Jazz' })).toEqual({ q: 'genre:jazz', filtered: true });
  });

  it('keeps free text after the filter, so it narrows within the genre', () => {
    // `genre:metal ballad` → "Nothing Else Matters", "18 and Life" — live, 2026-09-21.
    expect(buildSearchQuery('ballad', { genre: 'heavy metal' })).toEqual({
      q: 'genre:metal ballad',
      filtered: true,
    });
  });

  it('never quotes the tag', () => {
    // `genre:"heavy metal"` is a strict long-tail match and returned six Russian
    // bands. Every entry in the table is a single token for exactly this reason.
    for (const genre of ['heavy metal', 'hard rock', 'indie rock', 'punk rock']) {
      expect(buildSearchQuery('', { genre }).q).not.toContain('"');
    }
  });

  it('sends an unknown genre as text rather than through a filter that returns junk', () => {
    // `genre:rap` and `genre:hip-hop` both answered with nobody anyone has heard of.
    expect(buildSearchQuery('', { genre: 'rap' })).toEqual({ q: 'rap', filtered: false });
    expect(buildSearchQuery('for a drive', { genre: 'reggaeton' })).toEqual({
      q: 'reggaeton for a drive',
      filtered: false,
    });
    expect(buildSearchQuery('reggaeton hits', { genre: 'reggaeton' }).q).toBe('reggaeton hits');
  });

  it('knows which words are genres it can filter on', () => {
    expect(knownGenre('heavy metal')).toBe(true);
    expect(knownGenre('  Metal ')).toBe(true);
    expect(knownGenre('Shlomo Artzi')).toBe(false);
    expect(knownGenre('heavy metal ballads for a drive')).toBe(false);
  });
});

describe('searchTracks with a genre', () => {
  it('sends the filter to Spotify', async () => {
    await searchTracks('', 5, { genre: 'heavy metal' });
    expect(searches).toEqual(['genre:metal']);
  });
});

describe('find_music', () => {
  it('filters by genre when the model passes one', async () => {
    const result = await runTool(findMusicTool, { genre: 'heavy metal' }, CTX);

    expect(result.ok).toBe(true);
    expect(searches).toEqual(['genre:metal']);
    expect(result.summary).toContain('Metallica');
    expect(result.summary).not.toContain('Lady Gaga');
  });

  it('promotes a query that is nothing but a genre, because that is what the model wrote live', async () => {
    const result = await runTool(findMusicTool, { query: 'heavy metal' }, CTX);

    expect(searches).toEqual(['genre:metal']);
    expect(result.summary).toContain('Metallica');
    expect(result.data).toMatchObject({ genre: 'heavy metal', genreFiltered: true });
  });

  it('does not rewrite a real sentence that happens to contain a genre', async () => {
    await runTool(findMusicTool, { query: 'heavy metal ballads for a drive' }, CTX);
    expect(searches[0]).toBe('heavy metal ballads for a drive');
  });

  it('tells the model these are the genre and to build now, not search again', async () => {
    // This sentence is what stops the loop: five searches and no playlist was the
    // model re-searching because no title contained the word "metal".
    const result = await runTool(findMusicTool, { genre: 'heavy metal' }, CTX);
    expect(result.summary).toMatch(/real heavy metal tracks/);
    expect(result.summary).toMatch(/build the playlist from them now/);
  });

  it('says a genre it cannot filter on was searched as text, and still says build from it', async () => {
    const result = await runTool(findMusicTool, { genre: 'reggaeton' }, CTX);
    expect(searches).toEqual(['reggaeton']);
    expect(result.summary).toMatch(/not a genre Spotify filters on cleanly/);
    expect(result.summary).toMatch(/build from them rather than retrying/);
    expect(result.data).toMatchObject({ genreFiltered: false });
  });

  it('keeps the genre filter on the narrower retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('accounts.spotify.com')) {
          return { ok: true, status: 200, json: async () => TOKEN_RESPONSE, text: async () => '' } as Response;
        }
        const q = new URL(url).searchParams.get('q') ?? '';
        searches.push(q);
        // Nothing for the long query, something for the short one.
        const body = q.split(' ').length > 3 ? { tracks: { items: [] } } : GENRE_MATCHES;
        return { ok: true, status: 200, json: async () => body, text: async () => '' } as Response;
      }),
    );

    const result = await runTool(
      findMusicTool,
      { genre: 'metal', query: 'slow songs about the sea at night' },
      CTX,
    );

    expect(searches).toEqual([
      'genre:metal slow songs about the sea at night',
      'genre:metal slow songs',
    ]);
    expect(result.summary).toContain('Metallica');
  });

  it('still needs something to search for', async () => {
    const result = await runTool(findMusicTool, {}, CTX);
    expect(result.ok).toBe(false);
    expect(searches).toEqual([]);
  });

  it('no longer requires query in its schema, since genre alone is a search', () => {
    expect(findMusicTool.input_schema.required).toEqual([]);
    expect(findMusicTool.input_schema.properties).toHaveProperty('genre');
  });
});
