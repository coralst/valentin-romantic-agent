import { randomUUID } from 'node:crypto';
import { config } from '../../config';
import type { ActionProposal, AgentTool, ToolResult } from '../tool-registry';
import {
  createPlaylist,
  describeTrack,
  FIXTURE_NOTICE,
  getTracks,
  searchTracks,
  spotifyFixtureMode,
  SPOTIFY_PROPOSAL_TTL_MS,
  type SpotifyTrack,
} from './client';

/**
 * The playlist for the drive there — the capability the music row promised.
 *
 * Two tools, the same shape as the Wolt pair: one that looks and one that offers.
 * `find_music` raises no proposal, because "what would she like" is a question
 * and putting a confirmation card in front of a question is the behaviour this
 * layer exists to avoid.
 *
 * ## What confirming actually does, and why it varies
 *
 * A playlist write needs a *user* grant. With one, confirming creates a private
 * playlist on the connected account and fills it. Without one — an id and secret
 * only, which is the common case — confirming hands over links to the tracks and
 * says so. Both are honest outcomes and the user is told which they got; what
 * must never happen is the second one worded as the first. Every string below is
 * written with that in mind, and `confirm` decides between them at confirm time
 * rather than at propose time, because a refresh token can arrive through the
 * panel while a card is already on screen.
 *
 * This is the same fallback Ontopo uses when it has no guest identity, and for
 * the same reason: the reduced form of the action is always safe, so it is the
 * default rather than an error.
 */

/** How many tracks a playlist gets when nobody says. Long enough for the drive. */
const DEFAULT_LENGTH = 12;

/** Ceiling on a single playlist, so one tool call cannot fill a library. */
const MAX_LENGTH = 30;

/** How many search results `find_music` hands back by default. */
const DEFAULT_SEARCH_LIMIT = 8;

/**
 * The most `/v1/search` will actually return — **ten**, not the fifty its
 * reference page documents.
 *
 * Measured, not read: `limit=11` and above answer `400 {"message":"Invalid
 * limit"}` for this app, with or without `market`. The documented ceiling of 50
 * applies to other endpoints, and trusting it here is what made `find_music`
 * fail in conversation while every hand-run probe passed — the probes used small
 * limits, and the model, reading a description that promised 50, asked for 12.
 *
 * Kept as a named constant so the number the schema advertises and the number the
 * request clamps to cannot drift apart again.
 */
const MAX_SEARCH_LIMIT = 10;

function readLimit(value: unknown, fallback: number, ceiling: number): number {
  return typeof value === 'number' && value > 0
    ? Math.min(Math.round(value), ceiling)
    : fallback;
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Prefix the fixture notice when it applies, so no caller can forget to. */
function stamp(text: string): string {
  return spotifyFixtureMode() ? `${FIXTURE_NOTICE} ${text}` : text;
}

/**
 * What confirming this card will actually do, as three states rather than a
 * boolean.
 *
 * It was a boolean — "is there an account?" — with fixture mode folded in as
 * true, and that produced a card reading "no Spotify account is contacted" and
 * "confirming saves it to the connected Spotify account" in the same sentence.
 * Two true facts about different modes, contradicting each other in front of the
 * user. Fixture is a third state because it behaves like neither of the others:
 * it records something, but not anywhere real.
 */
type Outcome = 'fixture' | 'saves' | 'links';

function outcome(): Outcome {
  if (spotifyFixtureMode()) return 'fixture';
  return config.integrations.spotifyRefreshToken ? 'saves' : 'links';
}

/**
 * What to say when Spotify could not be reached or is not configured.
 *
 * One wording, because the model must not learn two different stories about the
 * same failure — and because the instruction not to invent a tracklist is the
 * load-bearing half of this string.
 */
function unavailable(what: string): ToolResult {
  return {
    ok: false,
    summary:
      `Spotify did not answer, so ${what} could not be looked up. Say plainly that you ` +
      `could not reach Spotify right now and offer to try again — do not invent songs, ` +
      `and do not describe a playlist you did not build.`,
  };
}

export const findMusicTool: AgentTool = {
  name: 'find_music',
  description:
    'Search Spotify for real tracks matching a mood, artist, genre or occasion — ' +
    "e.g. \"warm Hebrew folk for a drive\" or \"Shlomo Artzi\". Use it to check " +
    'something exists before you name it, and to gather tracks for a playlist. ' +
    'It only looks; use propose_playlist once you have chosen.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'What to look for: an artist, a song, a genre, or a mood in plain words. ' +
          'Draw it from what the profile says she actually likes rather than guessing.',
      },
      limit: {
        type: 'number',
        description:
          `How many tracks to return. Defaults to ${DEFAULT_SEARCH_LIMIT}, ` +
          `max ${MAX_SEARCH_LIMIT} — Spotify rejects anything higher outright. ` +
          `Ask twice with different wording rather than once for more.`,
      },
    },
    required: ['query'],
  },
  service: 'spotify',
  requiresConfirmation: false,
  async execute(input) {
    const query = readText(input.query);
    if (!query) {
      return {
        ok: false,
        summary: 'Searching needs something to search for — ask what sort of music she likes.',
      };
    }

    const tracks = await searchTracks(
      query,
      readLimit(input.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT),
    );
    if (!tracks) return unavailable(`music for "${query}"`);

    if (tracks.length === 0) {
      return {
        ok: true,
        summary: stamp(
          `Spotify has nothing for "${query}". Say so and offer a different artist or mood — ` +
            `do not substitute songs you were not shown.`,
        ),
        data: { query, tracks: [] },
      };
    }

    return {
      ok: true,
      summary: stamp(
        // The id rides in the text the model reads, not only in `data`: the tool
        // loop hands the model `summary` alone, and a model told to "use the track
        // ids exactly as given" without ever being given one can only fail — which
        // is exactly what happened once the 403 stopped masking it.
        `${tracks.length} track(s) for "${query}": ` +
          `${tracks.map((track) => `${describeTrack(track)} [id: ${track.id}]`).join(' | ')}. ` +
          `Pick from these by name when you build a playlist — use propose_playlist with the ` +
          `bracketed track ids exactly as given.`,
      ),
      data: {
        query,
        tracks: tracks.map((track) => ({
          id: track.id,
          name: track.name,
          artists: track.artists,
          album: track.album,
          url: track.url,
        })),
      },
    };
  },
};

/**
 * Resolve the ids the model passed back into tracks, keeping its order.
 *
 * Looking ids up rather than trusting the model's own titles is the point: the
 * card's text must describe tracks that exist, and the only way to be sure is to
 * ask. An id the model invented drops out here, which is why the count is checked
 * afterwards.
 *
 * `null` means Spotify could not be reached — distinct from every id being
 * unknown, which is an empty array. {@link getTracks} keeps those apart on
 * purpose, because the two get opposite messages: one says try again, the other
 * says search again and stop using remembered ids.
 */
async function resolveTracks(ids: readonly string[]): Promise<SpotifyTrack[] | null> {
  const resolved = await getTracks(ids);
  if (!resolved) return null;
  return resolved.filter((track): track is SpotifyTrack => track !== null);
}

export const proposePlaylistTool: AgentTool = {
  name: 'propose_playlist',
  description:
    'Offer to build a playlist from tracks find_music returned. This does NOT save ' +
    'anything: it shows a card, and only confirming writes the playlist. Never say a ' +
    'playlist has been created or saved before it is confirmed. Use track ids exactly ' +
    'as find_music gave them.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          'What to call the playlist, e.g. "For the drive to Rosh Pina". Keep it short ' +
          'and about the occasion rather than about you.',
      },
      trackIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Track ids from find_music, in the order they should play. Only ids you were ' +
          'actually given — never composed or remembered ones.',
      },
      occasion: {
        type: 'string',
        description:
          'What it is for, e.g. "your anniversary drive". Shown on the card so she sees why.',
      },
      note: {
        type: 'string',
        description:
          'One line on why these songs, shown on the card. This is where the thought goes.',
      },
    },
    required: ['name', 'trackIds'],
  },
  service: 'spotify',
  requiresConfirmation: true,
  async execute(input, ctx) {
    const name = readText(input.name);
    if (!name) {
      return { ok: false, summary: 'A playlist needs a name before it can be offered.' };
    }

    const rawIds = Array.isArray(input.trackIds)
      ? input.trackIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : [];
    if (rawIds.length === 0) {
      return {
        ok: false,
        summary:
          'No track ids were given, so there is nothing to put in the playlist. Use ' +
          'find_music first and pass the ids it returns.',
      };
    }

    const ids = rawIds.slice(0, MAX_LENGTH);
    const tracks = await resolveTracks(ids);
    if (!tracks) return unavailable('those tracks');

    if (tracks.length === 0) {
      return {
        ok: false,
        summary:
          'None of those track ids exist on Spotify. Search again with find_music and use ' +
          'the ids from that result rather than ids you remember.',
      };
    }

    const occasion = readText(input.occasion);
    const note = readText(input.note);
    const dropped = ids.length - tracks.length;
    const will = outcome();

    const proposal: ActionProposal = {
      id: randomUUID(),
      sessionId: ctx.sessionId,
      service: 'spotify',
      title: occasion ? `${name} — ${occasion}` : name,
      summary: stamp(
        `${note ? `${note} — ` : ''}${tracks.length} track(s), opening with ` +
          `${describeTrack(tracks[0])}. ` +
          {
            fixture:
              'Confirming records it in the demo catalogue only — nothing reaches Spotify ' +
              'and there is no playlist to open afterwards.',
            saves:
              'Confirming saves it as a private playlist on the connected Spotify account ' +
              'and gives you the link. Nothing is saved until you do.',
            links:
              'No Spotify account is connected here, so confirming gives you the tracks as ' +
              'links to open yourself rather than saving a playlist.',
          }[will],
      ),
      expiresAt: new Date(Date.now() + SPOTIFY_PROPOSAL_TTL_MS).toISOString(),
      // Ids and titles both: the ids are what gets written, and the titles let the
      // confirmation message name the songs without a second round of lookups.
      payload: {
        name,
        occasion,
        note,
        trackIds: tracks.map((track) => track.id),
        titles: tracks.map(describeTrack),
        urls: tracks.map((track) => track.url),
      },
    };

    return {
      ok: true,
      summary: stamp(
        `I've put a playlist card in front of them: "${name}", ${tracks.length} track(s) — ` +
          `${tracks.map(describeTrack).join(' | ')}. ` +
          (dropped > 0
            ? `${dropped} of the ids you gave did not resolve and were left out; do not mention ` +
              `songs that are not on this list. `
            : '') +
          {
            fixture:
              'Tell them what you chose and why, and that this build is running on a demo ' +
              'catalogue so nothing will reach Spotify. Do not say it is saved.',
            saves:
              'Tell them what you chose and why, and that confirming saves it. Do not say it ' +
              'is saved.',
            links:
              'Tell them what you chose and why, and that confirming hands over the links ' +
              'because no Spotify account is connected. Do not say it is saved.',
          }[will],
      ),
      data: {
        name,
        trackCount: tracks.length,
        tracks: tracks.map((track) => ({ id: track.id, name: track.name, artists: track.artists })),
      },
      proposal,
    };
  },

  /**
   * Save it if there is an account to save to, hand over links if not.
   *
   * The branch is decided here rather than carried on the proposal because
   * credentials can arrive through the panel between propose and confirm — a card
   * raised before someone connected Spotify should save, not hand over links it
   * no longer needs to.
   */
  async confirm(proposal) {
    const payload = proposal.payload ?? {};
    const name = typeof payload.name === 'string' ? payload.name : 'the playlist';
    const trackIds = Array.isArray(payload.trackIds)
      ? payload.trackIds.filter((id): id is string => typeof id === 'string')
      : [];
    const titles = Array.isArray(payload.titles)
      ? payload.titles.filter((title): title is string => typeof title === 'string')
      : [];
    const urls = Array.isArray(payload.urls)
      ? payload.urls.filter((url): url is string => typeof url === 'string')
      : [];

    if (trackIds.length === 0) {
      return {
        ok: false,
        summary:
          `That playlist card has no tracks on it any more. Apologise and offer to put it ` +
          `together again.`,
      };
    }

    const occasion = typeof payload.occasion === 'string' ? payload.occasion : null;
    const note = typeof payload.note === 'string' ? payload.note : null;
    const description = [note, occasion ? `For ${occasion}.` : null, 'Made by Valentin.']
      .filter((part): part is string => Boolean(part))
      .join(' ');

    const created = await createPlaylist({ name, description, trackIds });

    // `null` means there is no user grant — not a failure. Hand over the links.
    if (!created) {
      return {
        ok: true,
        summary:
          `No Spotify account is connected, so nothing was saved. Give them the ${titles.length} ` +
          `song(s) as a list they can open — ${titles.join(' | ')} — and say plainly that you ` +
          `could not save the playlist itself. Do not claim it is in their library.`,
        data: { saved: false, name, tracks: titles, urls },
      };
    }

    if (created.trackCount === 0) {
      return {
        ok: false,
        summary:
          `The playlist "${name}" was created but Spotify refused the tracks, so it is empty. ` +
          `Tell them that plainly and offer to try again — do not describe it as done.`,
        data: { saved: true, empty: true, url: created.url },
      };
    }

    if (spotifyFixtureMode()) {
      /*
       * No `url`. The fixture has no playlist to link to, and inventing an
       * `open.spotify.com/playlist/...` that 404s would be worse than omitting
       * one — a link that looks real and is dead reads as a broken save rather
       * than as a demo, which is the opposite of what the notice is for.
       */
      return {
        ok: true,
        summary: stamp(
          `Recorded "${name}" with ${created.trackCount} track(s) in the demo catalogue. ` +
            `There is no playlist to open — say so if they ask for the link — but you can ` +
            `name the songs: ${titles.slice(0, 3).join(' | ')}.`,
        ),
        data: { saved: false, demo: true, name, trackCount: created.trackCount },
      };
    }

    return {
      ok: true,
      summary:
        `Saved "${name}" as a private playlist with ${created.trackCount} track(s). ` +
        `Give them the link — ${created.url} — and name a couple of the songs: ` +
        `${titles.slice(0, 3).join(' | ')}.`,
      data: {
        saved: true,
        name,
        url: created.url,
        trackCount: created.trackCount,
      },
    };
  },
};

export const spotifyTools: readonly AgentTool[] = [findMusicTool, proposePlaylistTool];
