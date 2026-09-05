/**
 * What `find_music` hands the model when Spotify answers unhelpfully.
 *
 * Two live findings, both from the same bug hunt: a query naming the two artists
 * the *user* named returned nothing at all, and a mood query returned the same
 * recording twice under two ids, which the model then used twice. Neither is a
 * transport bug — Spotify answered 200 both times — so neither was visible to a
 * test that only checked shapes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../../config';
import { spotifyTools } from '../tools';

const findMusic = spotifyTools.find((tool) => tool.name === 'find_music')!;
const CTX = { sessionId: 'find-music-test', userId: 'user-1' } as never;

function track(id: string, name: string, artist: string) {
  return {
    id,
    name,
    duration_ms: 184_000,
    album: { name: 'An Album' },
    artists: [{ name: artist }],
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
  };
}

/** Answers the token route, and the search route from a per-query table. */
function stubSearch(byQuery: Record<string, unknown[]>) {
  const queried: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/api/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'app-token', expires_in: 3600 }),
          text: async () => '',
        } as Response;
      }
      const query = decodeURIComponent(
        new URL(url).searchParams.get('q') ?? '',
      );
      queried.push(query);
      return {
        ok: true,
        status: 200,
        json: async () => ({ tracks: { items: byQuery[query] ?? [] } }),
        text: async () => '',
      } as Response;
    }),
  );
  return queried;
}

describe('find_music when Spotify answers unhelpfully', () => {
  const original = {
    id: config.integrations.spotifyClientId,
    secret: config.integrations.spotifyClientSecret,
    fixture: config.integrations.spotifyFixture,
  };

  beforeEach(() => {
    config.integrations.spotifyClientId = 'id';
    config.integrations.spotifyClientSecret = 'secret';
    config.integrations.spotifyFixture = false;
  });

  afterEach(() => {
    config.integrations.spotifyClientId = original.id;
    config.integrations.spotifyClientSecret = original.secret;
    config.integrations.spotifyFixture = original.fixture;
    vi.unstubAllGlobals();
  });

  it('retries a long query that matched nothing with its leading words', async () => {
    // The live case: Spotify ANDs the terms, so no single recording is by both
    // artists and also described by four adjectives.
    const queried = stubSearch({
      'Fleetwood Mac': [track('1aaaaaaaaaaaaaaaaaaaaa', 'Dreams', 'Fleetwood Mac')],
    });

    const result = await findMusic.execute(
      { query: 'Fleetwood Mac Norah Jones warm melodic folk rock' },
      CTX,
    );

    expect(queried).toEqual([
      'Fleetwood Mac Norah Jones warm melodic folk rock',
      'Fleetwood Mac',
    ]);
    expect(result.summary).toMatch(/Dreams/);
    // And it says which query the results are for, so the model does not report
    // them as matching what the user asked for word for word.
    expect(result.summary).toMatch(/Fleetwood Mac Norah Jones warm melodic folk rock/);
  });

  it('does not narrow a short query that legitimately found nothing', async () => {
    const queried = stubSearch({});

    const result = await findMusic.execute({ query: 'Sh"tot Ahava' }, CTX);

    expect(queried).toHaveLength(1);
    expect(result.summary).toMatch(/nothing for/i);
  });

  it('says nothing was found when neither the query nor the shorter one matched', async () => {
    stubSearch({});

    const result = await findMusic.execute(
      { query: 'a b c d e f' },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/nothing for "a b c d e f"/i);
    expect(result.summary).toMatch(/do not substitute songs/i);
  });

  it('offers one id per song, not one per release of it', async () => {
    stubSearch({
      'warm mellow evening': [
        track('1aaaaaaaaaaaaaaaaaaaaa', 'Come Away With Me', 'Norah Jones'),
        track('2bbbbbbbbbbbbbbbbbbbbb', 'come away with me', 'Norah Jones'),
        track('3ccccccccccccccccccccc', 'Sunrise', 'Norah Jones'),
      ],
    });

    const result = await findMusic.execute({ query: 'warm mellow evening' }, CTX);

    expect(result.summary).toMatch(/2 track\(s\)/);
    expect(result.summary).not.toMatch(/2bbbbbbbbbbbbbbbbbbbbb/);
    expect((result.data as { tracks: unknown[] }).tracks).toHaveLength(2);
  });
});
