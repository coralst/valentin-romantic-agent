import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { config } from '../../../config';
import {
  createPlaylist,
  describeTrack,
  formatDuration,
  resetSpotifyTokenCache,
  searchTracks,
  spotifyAuthorizeUrl,
  SPOTIFY_SCOPES,
} from '../client';
import {
  buildSpotifyAuthUrl,
  consumeSpotifyState,
  exchangeSpotifyCode,
} from '../oauth';
import { findMusicTool, proposePlaylistTool } from '../tools';
import { runTool } from '../../tool-registry';
import { fixturePlaylists, resetFixturePlaylists } from '../fixture';
import { buildToolRegistry, integrationReadiness } from '../..';

/**
 * Spotify, with `fetch` stubbed for the live path and `SPOTIFY_FIXTURE` for the
 * offline one.
 *
 * The fixtures below keep Spotify's real field names and nesting — `duration_ms`,
 * `external_urls.spotify`, `tracks.items`, `artists[].name` — because a reader
 * that idealises them keeps passing after the wire shape moves. Unlike Wolt this
 * is a documented API, so these are taken from the published response shapes
 * rather than from observation.
 *
 * The assertions worth reading are the ones about *wording*: this integration can
 * end in a saved playlist or in a handful of links, and the failure mode that
 * matters is the second one described as the first.
 */

const CTX = { sessionId: 'spotify-test', userId: 'user-1' };

const TOKEN_RESPONSE = { access_token: 'app-token', expires_in: 3600 };

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

const SEARCH_RESPONSE = {
  tracks: {
    items: [
      track('1aBcDeFgHiJkLmNoPqRsTu', 'Ani Ve Ata', 'Arik Einstein'),
      track('2aBcDeFgHiJkLmNoPqRsTu', 'Yesh Bi Ahava', 'Shlomo Artzi'),
    ],
  },
};

/**
 * A `fetch` stub that answers by URL, so call order does not matter.
 *
 * `body` may be a function of the request URL, which the batch-tracks route needs:
 * its response has to mirror the ids actually asked for, including a `null` in the
 * slot of any it does not recognise.
 */
interface StubRoute {
  match: RegExp;
  status?: number;
  body: unknown | ((url: string) => unknown);
}

function stubFetch(routes: StubRoute[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find((candidate) => candidate.match.test(url));
    if (!route) throw new Error(`unstubbed fetch: ${url}`);
    const body = typeof route.body === 'function'
      ? (route.body as (url: string) => unknown)(url)
      : route.body;
    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      json: async () => body,
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

/**
 * The batch-tracks route, answering the way Spotify documents it.
 *
 * `GET /v1/tracks?ids=` returns a `tracks` array positionally matching the ids,
 * with `null` where an id is unknown. Reproducing that is the whole point: it is
 * what lets an invented id be told apart from an unreachable Spotify.
 */
const KNOWN_TRACKS = new Map(
  SEARCH_RESPONSE.tracks.items.map((item) => [item.id, item] as const),
);

const BATCH_TRACKS_ROUTE: StubRoute = {
  match: /v1\/tracks\?/,
  body: (url: string) => {
    const ids = new URL(url).searchParams.get('ids')?.split(',') ?? [];
    return { tracks: ids.map((id) => KNOWN_TRACKS.get(id) ?? null) };
  },
};

/** Restore every credential this suite moves, so tests cannot leak into each other. */
const ORIGINAL = { ...config.integrations };

beforeEach(() => {
  resetSpotifyTokenCache();
  resetFixturePlaylists();
  config.integrations.spotifyClientId = 'test-client';
  config.integrations.spotifyClientSecret = 'test-secret';
  config.integrations.spotifyRefreshToken = undefined;
  config.integrations.spotifyFixture = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.assign(config.integrations, ORIGINAL);
  resetSpotifyTokenCache();
});

describe('searchTracks', () => {
  it('authenticates with the app grant and reads Spotify\'s real shape', async () => {
    const calls = stubFetch([
      { match: /accounts\.spotify\.com/, body: TOKEN_RESPONSE },
      { match: /api\.spotify\.com\/v1\/search/, body: SEARCH_RESPONSE },
    ]);

    const tracks = await searchTracks('hebrew folk', 2);

    expect(tracks).toHaveLength(2);
    expect(tracks?.[0]).toEqual({
      id: '1aBcDeFgHiJkLmNoPqRsTu',
      name: 'Ani Ve Ata',
      artists: ['Arik Einstein'],
      album: 'An Album',
      url: 'https://open.spotify.com/track/1aBcDeFgHiJkLmNoPqRsTu',
      durationMs: 184_000,
    });

    // client_credentials, not a user grant: searching must not require an account.
    const token = calls.find((call) => /accounts/.test(call.url));
    expect(String(token?.init?.body)).toContain('grant_type=client_credentials');
    // And the client is authenticated with Basic, per Spotify's docs.
    expect(
      (token?.init?.headers as Record<string, string> | undefined)?.authorization,
    ).toMatch(/^Basic /);
  });

  /*
   * `market=IL` is load-bearing rather than cosmetic. Without it Spotify returns
   * tracks that are unplayable where this couple lives, and a playlist of greyed
   * rows is worse than a shorter one.
   */
  it('asks for the Israeli market, so the tracks are playable', async () => {
    const calls = stubFetch([
      { match: /accounts\.spotify\.com/, body: TOKEN_RESPONSE },
      { match: /api\.spotify\.com/, body: SEARCH_RESPONSE },
    ]);
    await searchTracks('anything');
    expect(calls.find((call) => /v1\/search/.test(call.url))?.url).toContain('market=IL');
  });

  it('caches the token instead of minting one per search', async () => {
    const calls = stubFetch([
      { match: /accounts\.spotify\.com/, body: TOKEN_RESPONSE },
      { match: /api\.spotify\.com/, body: SEARCH_RESPONSE },
    ]);

    await searchTracks('one');
    await searchTracks('two');

    expect(calls.filter((call) => /accounts/.test(call.url))).toHaveLength(1);
    expect(calls.filter((call) => /v1\/search/.test(call.url))).toHaveLength(2);
  });

  /*
   * Ten is Spotify's real ceiling on `/v1/search`, whatever its reference page
   * says about fifty. `limit=11` and above answer `400 Invalid limit`.
   *
   * This is a regression test with a live failure behind it: the transport clamped
   * to 50 and `find_music` advertised "max 50", so a conversation that asked for
   * twelve tracks got "Spotify isn't answering" — indistinguishable, from the
   * outside, from a credential problem. Every hand-run probe passed because they
   * all happened to use small limits.
   */
  it('never asks for more than ten tracks, whatever the caller wants', async () => {
    const calls = stubFetch([
      { match: /accounts\.spotify\.com/, body: TOKEN_RESPONSE },
      { match: /api\.spotify\.com/, body: SEARCH_RESPONSE },
    ]);

    await searchTracks('anything', 40);

    const search = calls.find((call) => /v1\/search/.test(call.url))?.url ?? '';
    expect(search).toContain('limit=10');
    expect(search).not.toContain('limit=40');
  });

  it('returns null when Spotify refuses the credentials', async () => {
    stubFetch([{ match: /accounts\.spotify\.com/, status: 400, body: {} }]);
    expect(await searchTracks('anything')).toBeNull();
  });

  it('returns null rather than throwing when the network is gone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );
    expect(await searchTracks('anything')).toBeNull();
  });

  it('is unconfigured without an app credential', async () => {
    config.integrations.spotifyClientId = undefined;
    expect(await searchTracks('anything')).toBeNull();
  });
});

describe('createPlaylist', () => {
  const ME = { id: 'demo-user' };
  const PLAYLIST = {
    id: 'playlist-1',
    external_urls: { spotify: 'https://open.spotify.com/playlist/playlist-1' },
  };

  it('returns null with no user grant, so the caller can hand over links instead', async () => {
    // An app credential is present; a refresh token is not. This is the common
    // deployment, and it must not read as a failure.
    stubFetch([{ match: /accounts\.spotify\.com/, body: TOKEN_RESPONSE }]);
    expect(
      await createPlaylist({ name: 'x', description: 'y', trackIds: ['abc'] }),
    ).toBeNull();
  });

  it('creates a private playlist and adds the tracks as URIs', async () => {
    config.integrations.spotifyRefreshToken = 'refresh-token';
    const calls = stubFetch([
      { match: /accounts\.spotify\.com/, body: { access_token: 'user-token', expires_in: 3600 } },
      { match: /v1\/me$/, body: ME },
      { match: /v1\/users\/.*\/playlists/, body: PLAYLIST },
      { match: /v1\/playlists\/.*\/tracks/, body: { snapshot_id: 'snap' } },
    ]);

    const created = await createPlaylist({
      name: 'For the drive',
      description: 'Because you said tulips',
      trackIds: ['abc', 'def'],
    });

    expect(created).toEqual({
      id: 'playlist-1',
      url: 'https://open.spotify.com/playlist/playlist-1',
      trackCount: 2,
    });

    const token = calls.find((call) => /accounts/.test(call.url));
    expect(String(token?.init?.body)).toContain('grant_type=refresh_token');

    /*
     * Private, always. A playlist made as a gift must not appear on the giver's
     * public profile, and `public: false` is the only thing preventing it —
     * Spotify's default for a created playlist is public.
     */
    const create = calls.find((call) => /users\/.*\/playlists/.test(call.url));
    expect(JSON.parse(String(create?.init?.body))).toMatchObject({
      name: 'For the drive',
      public: false,
    });

    // Track ids become `spotify:track:` URIs; sending bare ids is a silent no-op.
    const add = calls.find((call) => /playlists\/.*\/tracks/.test(call.url));
    expect(JSON.parse(String(add?.init?.body))).toEqual({
      uris: ['spotify:track:abc', 'spotify:track:def'],
    });
  });

  /*
   * The genuinely awkward half-failure: the playlist exists but the tracks were
   * refused, so somebody has an empty playlist in their library. Reporting zero
   * rather than throwing is what lets the tool say so instead of claiming success.
   */
  it('reports zero tracks when the playlist was created but the adds failed', async () => {
    config.integrations.spotifyRefreshToken = 'refresh-token';
    stubFetch([
      { match: /accounts\.spotify\.com/, body: { access_token: 'user-token', expires_in: 3600 } },
      { match: /v1\/me$/, body: ME },
      { match: /v1\/users\/.*\/playlists/, body: PLAYLIST },
      { match: /v1\/playlists\/.*\/tracks/, status: 403, body: {} },
    ]);

    const created = await createPlaylist({ name: 'x', description: 'y', trackIds: ['abc'] });
    expect(created?.trackCount).toBe(0);
    expect(created?.id).toBe('playlist-1');
  });
});

describe('find_music', () => {
  beforeEach(() => {
    stubFetch([
      { match: /accounts\.spotify\.com/, body: TOKEN_RESPONSE },
      { match: /api\.spotify\.com/, body: SEARCH_RESPONSE },
    ]);
  });

  it('names the tracks it found and never raises a proposal', async () => {
    const result = await runTool(findMusicTool, { query: 'hebrew folk' }, CTX);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Ani Ve Ata');
    expect(result.summary).toContain('Arik Einstein');
    // A question is not an action. A card here would be the behaviour the
    // propose-then-confirm design exists to prevent.
    expect(result.proposal).toBeUndefined();
  });

  it('hands back the ids the playlist tool needs', async () => {
    const result = await runTool(findMusicTool, { query: 'x' }, CTX);
    const data = result.data as { tracks: { id: string }[] };
    expect(data.tracks.map((t) => t.id)).toEqual([
      '1aBcDeFgHiJkLmNoPqRsTu',
      '2aBcDeFgHiJkLmNoPqRsTu',
    ]);
  });

  it('refuses an empty query rather than searching for nothing', async () => {
    const result = await runTool(findMusicTool, { query: '  ' }, CTX);
    expect(result.ok).toBe(false);
  });

  /*
   * The instruction not to invent songs is the load-bearing half of the failure
   * text. A model told only "search failed" will cheerfully describe a playlist it
   * imagined, and that is indistinguishable from a working one to the reader.
   */
  it('tells the model not to invent a tracklist when Spotify is unreachable', async () => {
    vi.unstubAllGlobals();
    stubFetch([{ match: /accounts\.spotify\.com/, status: 500, body: {} }]);

    const result = await runTool(findMusicTool, { query: 'x' }, CTX);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/do not invent songs/i);
  });
});

describe('propose_playlist', () => {
  /** The live path: app token, batch lookup, and search. No user grant. */
  function stubCatalogue() {
    return stubFetch([
      { match: /accounts\.spotify\.com/, body: TOKEN_RESPONSE },
      BATCH_TRACKS_ROUTE,
      { match: /v1\/search/, body: SEARCH_RESPONSE },
    ]);
  }

  const IDS = ['1aBcDeFgHiJkLmNoPqRsTu', '2aBcDeFgHiJkLmNoPqRsTu'];

  it('raises a card and saves nothing', async () => {
    stubCatalogue();
    const result = await runTool(
      proposePlaylistTool,
      { name: 'For the drive', trackIds: IDS, note: 'The ones she hums' },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(result.proposal).toBeDefined();
    expect(result.proposal?.service).toBe('spotify');
    expect(result.proposal?.title).toContain('For the drive');
    expect(result.proposal?.sessionId).toBe(CTX.sessionId);
    // Nothing may be described as saved before a human says yes.
    expect(result.summary).toMatch(/do not say it is saved/i);
    expect(result.proposal?.summary).toMatch(/nothing is saved|hands over|links/i);
  });

  /*
   * The ids are re-resolved rather than trusted, because the card's text has to
   * describe tracks that exist. A model that half-remembers a title would
   * otherwise produce a confident card for a song Spotify has never heard of.
   */
  it('drops ids that do not resolve and warns the model not to mention them', async () => {
    stubCatalogue();
    const result = await runTool(
      proposePlaylistTool,
      { name: 'x', trackIds: [...IDS, 'invented-id'] },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect((result.proposal?.payload?.trackIds as string[])).toEqual(IDS);
    expect(result.summary).toMatch(/did not resolve/i);
  });

  it('refuses when every id was invented', async () => {
    stubCatalogue();
    const result = await runTool(proposePlaylistTool, { name: 'x', trackIds: ['nope'] }, CTX);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/none of those track ids exist/i);
  });

  it('refuses an empty tracklist', async () => {
    stubCatalogue();
    const result = await runTool(proposePlaylistTool, { name: 'x', trackIds: [] }, CTX);
    expect(result.ok).toBe(false);
  });

  it('caps how much one call can queue up', async () => {
    stubCatalogue();
    const result = await runTool(
      proposePlaylistTool,
      { name: 'x', trackIds: Array.from({ length: 90 }, () => IDS[0]) },
      CTX,
    );
    expect((result.proposal?.payload?.trackIds as string[]).length).toBeLessThanOrEqual(30);
  });

  it('gives the card a deadline', async () => {
    stubCatalogue();
    const result = await runTool(proposePlaylistTool, { name: 'x', trackIds: IDS }, CTX);
    expect(Date.parse(result.proposal!.expiresAt)).toBeGreaterThan(Date.now());
  });

  describe('confirming', () => {
    /*
     * The distinction this whole integration turns on. With no account connected
     * the confirm must hand over links and *say* nothing was saved — the one
     * outcome that must never be worded as a save.
     */
    it('hands over links and denies saving when no account is connected', async () => {
      stubCatalogue();
      const proposed = await runTool(proposePlaylistTool, { name: 'x', trackIds: IDS }, CTX);
      const result = await proposePlaylistTool.confirm!(proposed.proposal!, CTX);

      expect(result.ok).toBe(true);
      expect(result.summary).toMatch(/nothing was saved/i);
      expect(result.summary).toMatch(/do not claim it is in their library/i);
      expect((result.data as { saved: boolean }).saved).toBe(false);
      expect((result.data as { urls: string[] }).urls.length).toBe(2);
    });

    it('saves a private playlist when an account is connected', async () => {
      stubFetch([
        {
          match: /accounts\.spotify\.com/,
          body: { access_token: 'user-token', expires_in: 3600 },
        },
        BATCH_TRACKS_ROUTE,
        { match: /v1\/me$/, body: { id: 'demo-user' } },
        {
          match: /v1\/users\/.*\/playlists/,
          body: {
            id: 'playlist-1',
            external_urls: { spotify: 'https://open.spotify.com/playlist/playlist-1' },
          },
        },
        { match: /v1\/playlists\/.*\/tracks/, body: { snapshot_id: 'snap' } },
      ]);

      const proposed = await runTool(proposePlaylistTool, { name: 'Drive', trackIds: IDS }, CTX);
      // Deliberately after the propose: a refresh token can arrive through the
      // panel while a card is already on screen, and confirming should then save
      // rather than hand over links it no longer needs to.
      config.integrations.spotifyRefreshToken = 'refresh-token';
      resetSpotifyTokenCache();

      const result = await proposePlaylistTool.confirm!(proposed.proposal!, CTX);
      expect(result.ok).toBe(true);
      expect(result.summary).toMatch(/saved "Drive"/i);
      expect((result.data as { saved: boolean }).saved).toBe(true);
      expect((result.data as { url: string }).url).toContain('playlist-1');
    });

    it('says so plainly when the playlist was created but left empty', async () => {
      stubFetch([
        {
          match: /accounts\.spotify\.com/,
          body: { access_token: 'user-token', expires_in: 3600 },
        },
        BATCH_TRACKS_ROUTE,
        { match: /v1\/me$/, body: { id: 'demo-user' } },
        { match: /v1\/users\/.*\/playlists/, body: { id: 'playlist-1' } },
        { match: /v1\/playlists\/.*\/tracks/, status: 403, body: {} },
      ]);

      const proposed = await runTool(proposePlaylistTool, { name: 'Drive', trackIds: IDS }, CTX);
      config.integrations.spotifyRefreshToken = 'refresh-token';
      resetSpotifyTokenCache();

      const result = await proposePlaylistTool.confirm!(proposed.proposal!, CTX);
      expect(result.ok).toBe(false);
      expect(result.summary).toMatch(/empty/i);
      expect(result.summary).toMatch(/do not describe it as done/i);
    });

    it('refuses a card whose tracks have gone missing', async () => {
      const result = await proposePlaylistTool.confirm!(
        {
          id: 'p1',
          sessionId: CTX.sessionId,
          service: 'spotify',
          title: 'x',
          summary: 'x',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          payload: { name: 'x', trackIds: [] },
        },
        CTX,
      );
      expect(result.ok).toBe(false);
    });
  });
});

/*
 * Fixture mode exists so `npm test` and `verify:local` need neither a credential
 * nor a network. The thing worth pinning is not that it works but that it cannot
 * be mistaken for a live account: every string the user reads carries the notice,
 * and the ids it hands out are visibly not Spotify ids.
 */
describe('fixture mode', () => {
  beforeEach(() => {
    config.integrations.spotifyClientId = undefined;
    config.integrations.spotifyClientSecret = undefined;
    config.integrations.spotifyFixture = true;
    // Any fetch at all in this mode is a bug — the point is that it opens no socket.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fixture mode must not touch the network');
      }),
    );
  });

  it('searches and builds a playlist with no credential and no network', async () => {
    const found = await runTool(findMusicTool, { query: 'hebrew romantic' }, CTX);
    expect(found.ok).toBe(true);

    const ids = (found.data as { tracks: { id: string }[] }).tracks.map((t) => t.id);
    expect(ids.length).toBeGreaterThan(0);
    // Visibly not a Spotify id, so nobody can mistake one in a log or a URL.
    expect(ids.every((id) => id.startsWith('fixture:'))).toBe(true);

    const proposed = await runTool(
      proposePlaylistTool,
      { name: 'Demo drive', trackIds: ids.slice(0, 3) },
      CTX,
    );
    expect(proposed.ok).toBe(true);

    const confirmed = await proposePlaylistTool.confirm!(proposed.proposal!, CTX);
    expect(confirmed.ok).toBe(true);
    expect(fixturePlaylists().size).toBe(1);
  });

  it('stamps every line the user reads, and never claims a real save', async () => {
    const found = await runTool(findMusicTool, { query: 'romantic' }, CTX);
    expect(found.summary).toMatch(/no Spotify account is contacted/i);

    const ids = (found.data as { tracks: { id: string }[] }).tracks.map((t) => t.id).slice(0, 2);
    const proposed = await runTool(proposePlaylistTool, { name: 'Demo', trackIds: ids }, CTX);
    expect(proposed.proposal?.summary).toMatch(/no Spotify account is contacted/i);

    const confirmed = await proposePlaylistTool.confirm!(proposed.proposal!, CTX);
    expect(confirmed.summary).toMatch(/no Spotify account is contacted/i);
    // `saved` stays false in fixture mode: nothing is in anybody's library.
    expect((confirmed.data as { saved: boolean }).saved).toBe(false);
  });

  it('matches an artist by name rather than returning an arbitrary track', async () => {
    const found = await runTool(findMusicTool, { query: 'Shlomo Artzi', limit: 1 }, CTX);
    expect(found.summary).toContain('Shlomo Artzi');
  });

  /*
   * The distinction that cost a round of this implementation, and the reason it is
   * pinned rather than commented.
   *
   * Fixture mode first counted as *ready*, which registered the tools — and also
   * made the consent sheet tell the visitor "this server holds working Spotify
   * credentials" when it held none. A false claim about a credential is precisely
   * what that surface exists to prevent, so registration is now OR-ed with fixture
   * mode while readiness stays keyed to a real key. The row reads "needs
   * credentials", which is true, and the tools still answer.
   */
  it('registers the tools without claiming this server holds a credential', () => {
    expect(buildToolRegistry().has('find_music')).toBe(true);
    expect(integrationReadiness().spotify).toBe(false);
  });
});

describe('readiness', () => {
  it('is ready on an app credential alone, because search is the read half', () => {
    config.integrations.spotifyFixture = false;
    config.integrations.spotifyClientId = 'id';
    config.integrations.spotifyClientSecret = 'secret';
    config.integrations.spotifyRefreshToken = undefined;
    expect(integrationReadiness().spotify).toBe(true);
  });

  it('is dark with no credential at all', () => {
    config.integrations.spotifyFixture = false;
    config.integrations.spotifyClientId = undefined;
    config.integrations.spotifyClientSecret = undefined;
    expect(integrationReadiness().spotify).toBe(false);
  });
});

/*
 * What confirming will do has three answers, and the card has to give the right
 * one. It was a boolean with fixture folded into "connected", which produced a
 * card saying "no Spotify account is contacted" and "saves it to the connected
 * Spotify account" in the same sentence. These pin each state's wording against
 * the wording of the other two.
 */
describe('what the card promises', () => {
  const IDS = ['1aBcDeFgHiJkLmNoPqRsTu'];

  async function cardSummary(): Promise<string> {
    const proposed = await runTool(proposePlaylistTool, { name: 'x', trackIds: IDS }, CTX);
    return proposed.proposal!.summary;
  }

  it('promises a save and a link when an account is connected', async () => {
    config.integrations.spotifyRefreshToken = 'refresh-token';
    stubFetch([
      { match: /accounts\.spotify\.com/, body: TOKEN_RESPONSE },
      BATCH_TRACKS_ROUTE,
    ]);

    const summary = await cardSummary();
    expect(summary).toMatch(/saves it as a private playlist/i);
    expect(summary).toMatch(/gives you the link/i);
    expect(summary).not.toMatch(/demo catalogue/i);
  });

  it('promises links, not a save, with no account', async () => {
    stubFetch([
      { match: /accounts\.spotify\.com/, body: TOKEN_RESPONSE },
      BATCH_TRACKS_ROUTE,
    ]);

    const summary = await cardSummary();
    expect(summary).toMatch(/no Spotify account is connected/i);
    expect(summary).toMatch(/links to open yourself/i);
    expect(summary).not.toMatch(/saves it as a private playlist/i);
  });

  it('promises neither in fixture mode, and does not claim a connected account', async () => {
    config.integrations.spotifyFixture = true;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network'); }));

    // Fixture ids, since the live-shaped ones above exist only in the stub.
    const found = await findMusicTool.execute({ query: 'romantic', limit: 2 }, CTX);
    const ids = (found.data as { tracks: { id: string }[] }).tracks.map((t) => t.id);
    const proposed = await runTool(proposePlaylistTool, { name: 'x', trackIds: ids }, CTX);
    const summary = proposed.proposal!.summary;
    expect(summary).toMatch(/demo catalogue/i);
    expect(summary).toMatch(/nothing reaches Spotify/i);
    // The contradiction this state exists to prevent.
    expect(summary).not.toMatch(/connected Spotify account/i);
  });

  /*
   * A dead `open.spotify.com/playlist/...` would read as a broken save rather
   * than as a demo, so the fixture hands back no link at all and says so.
   */
  it('offers no playlist link in fixture mode rather than a dead one', async () => {
    config.integrations.spotifyFixture = true;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network'); }));

    const found = await findMusicTool.execute({ query: 'romantic', limit: 2 }, CTX);
    const ids = (found.data as { tracks: { id: string }[] }).tracks.map((t) => t.id);
    const proposed = await runTool(proposePlaylistTool, { name: 'x', trackIds: ids }, CTX);
    const confirmed = await proposePlaylistTool.confirm!(proposed.proposal!, CTX);

    expect(confirmed.summary).toMatch(/no playlist to open/i);
    expect(confirmed.summary).not.toMatch(/open\.spotify\.com/);
    expect((confirmed.data as { url?: string }).url).toBeUndefined();
  });
});

/*
 * The consent leg. Without it the "create a playlist" half of the music row is
 * only reachable by hand-running a script, which on most deployments means never.
 */
describe('oauth', () => {
  it('refuses to build a consent URL before an app credential is saved', () => {
    config.integrations.spotifyClientId = undefined;
    const result = buildSpotifyAuthUrl();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('asks only for the playlist scope, and carries a state', () => {
    const result = buildSpotifyAuthUrl();
    expect(result.ok).toBe(true);

    const url = new URL(result.url!);
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('scope')).toBe('playlist-modify-private');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBeTruthy();
    // Forces the approval screen, so re-authorising a *different* account works.
    expect(url.searchParams.get('show_dialog')).toBe('true');
    // The redirect must be the loopback IP form: Spotify rejects `localhost` on
    // apps created since 2025, and the failure is an opaque invalid-redirect error.
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:5173/api/integrations/spotify/callback',
    );
  });

  /*
   * The state is the entire security of an unauthenticated callback: it stops any
   * page on the internet from navigating a visitor's browser at our callback with
   * a code of its own and binding *their* Spotify account to this deployment.
   */
  it('accepts a state exactly once, and never one it did not mint', () => {
    const state = new URL(buildSpotifyAuthUrl().url!).searchParams.get('state')!;

    expect(consumeSpotifyState(state)).toBe(true);
    expect(consumeSpotifyState(state)).toBe(false);
    expect(consumeSpotifyState('a-state-we-never-issued')).toBe(false);
    expect(consumeSpotifyState(undefined)).toBe(false);
  });

  it('trades a code for a refresh token with the documented grant', async () => {
    const calls = stubFetch([
      {
        match: /accounts\.spotify\.com\/api\/token/,
        body: { access_token: 'a', refresh_token: 'the-refresh-token', expires_in: 3600 },
      },
    ]);

    const result = await exchangeSpotifyCode('the-code');
    expect(result.ok).toBe(true);
    expect(result.refreshToken).toBe('the-refresh-token');

    const body = String(calls[0]?.init?.body);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=the-code');
    // The redirect URI must be sent again on the exchange and match the one on the
    // consent URL, or Spotify refuses with an opaque error.
    expect(body).toContain(encodeURIComponent('/api/integrations/spotify/callback'));
    expect(
      (calls[0]?.init?.headers as Record<string, string> | undefined)?.authorization,
    ).toMatch(/^Basic /);
  });

  it('reports a failure without leaking the provider body', async () => {
    stubFetch([
      {
        match: /accounts\.spotify\.com/,
        status: 400,
        body: { error: 'invalid_client', error_description: 'client id 123abc is wrong' },
      },
    ]);

    const result = await exchangeSpotifyCode('bad');
    expect(result.ok).toBe(false);
    expect(result.refreshToken).toBeUndefined();
    // Spotify's body can name the client id, and this text lands on a page the
    // visitor could screenshot.
    expect(result.message).not.toContain('123abc');
    expect(result.message).toMatch(/redirect URI/i);
  });

  it('treats a response with no refresh token as a failure', async () => {
    stubFetch([
      {
        match: /accounts\.spotify\.com/,
        body: { access_token: 'only-an-access-token', expires_in: 3600 },
      },
    ]);
    const result = await exchangeSpotifyCode('code');
    expect(result.ok).toBe(false);
  });

  it('does not exchange at all when the app credential is gone', async () => {
    config.integrations.spotifyClientSecret = undefined;
    const result = await exchangeSpotifyCode('code');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no Spotify client configured/i);
  });
});

describe('helpers', () => {
  it('formats a duration the way a human reads one', () => {
    expect(formatDuration(184_000)).toBe('3:04');
    expect(formatDuration(59_000)).toBe('0:59');
  });

  it('describes a track with every credited artist', () => {
    expect(
      describeTrack({
        id: 'x',
        name: 'Dream a Little Dream of Me',
        artists: ['Ella Fitzgerald', 'Louis Armstrong'],
        album: 'Ella and Louis Again',
        url: 'https://open.spotify.com/track/x',
        durationMs: 189_000,
      }),
    ).toBe('Dream a Little Dream of Me — Ella Fitzgerald, Louis Armstrong (3:09)');
  });

  /*
   * The scope list is recorded rather than sent, so nothing else would catch it
   * widening. `playlist-modify-public` would put a private gift on a public
   * profile and `user-top-read` would read someone's listening history — neither
   * is needed, so neither may appear.
   */
  it('asks for the narrowest scope that can write a playlist', () => {
    expect(SPOTIFY_SCOPES).toEqual(['playlist-modify-private']);
    const url = spotifyAuthorizeUrl('http://localhost:3001/callback');
    expect(url).toContain('scope=playlist-modify-private');
    expect(url).not.toContain('public');
    expect(url).not.toContain('user-top-read');
  });
});
