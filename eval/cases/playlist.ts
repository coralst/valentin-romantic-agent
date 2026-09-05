/**
 * "Ask for a playlist and it doesn't work."
 *
 * Two distinct failures live here and they look identical from the outside:
 *
 * 1. The model emits `track_ids` in the house snake_case style, but the schema and
 *    `execute` spell it `trackIds` alone among 21 tools, so the ids land nowhere
 *    and the user is told to use `find_music` — which the model just used. That is
 *    a request that spends two tool calls and produces no playlist, intermittently,
 *    depending on which spelling the model happened to pick.
 * 2. Ids arrive but do not resolve on Spotify, or resolve to different artists than
 *    the prose claims. Only an oracle can tell the difference, and it must not go
 *    through our own client — asking `SpotifyClient` whether `SpotifyClient`'s ids
 *    are real inherits whatever mapping bug produced them.
 *
 * PLAY-01 is the one that captures the raw argument key. It is the case most likely
 * to explain the reported symptom.
 */
import { CLAIMED_DONE, type EvalCase } from '../harness/assertions';
import { spotifyTracks } from '../harness/oracles';
import type { RecordedCall } from '../harness/recording-registry';

const FACTS = [
  { key: 'partner_name', value: 'Maya' },
  { key: 'favorite_music', value: 'Fleetwood Mac and Norah Jones' },
] as const;

/** The ids the playlist tool was actually handed, under either spelling. */
function idsGivenToPlaylist(calls: readonly RecordedCall[]): {
  key: string | null;
  ids: string[];
} {
  const call = calls.find((candidate) => candidate.name === 'propose_playlist');
  if (!call) return { key: null, ids: [] };

  for (const key of ['trackIds', 'track_ids', 'tracks', 'ids']) {
    const value = call.args[key];
    if (Array.isArray(value)) return { key, ids: value.map(String) };
  }
  return { key: null, ids: [] };
}

export const playlistCases: readonly EvalCase[] = [
  {
    id: 'PLAY-01',
    group: 'playlist',
    severity: 'high',
    why: 'The reported bug. propose_playlist reads only camelCase trackIds; if the model emits snake_case track_ids the tool reports no ids at all and the playlist silently never happens.',
    turns: ['Make Maya a playlist of songs she\'d love for our drive on Saturday.'],
    facts: FACTS,
    expect: {
      calledTool: ['propose_playlist'],
      args: (calls) => {
        const playlist = calls.find((call) => call.name === 'propose_playlist');
        if (!playlist) return 'propose_playlist was never called';

        const { key, ids } = idsGivenToPlaylist(calls);
        if (ids.length === 0) {
          return `propose_playlist got no ids under any spelling; args were ${JSON.stringify(
            playlist.args,
          )}`;
        }
        // The tool succeeding while the model used the house style is the pass.
        // Recording which key it chose is what makes an intermittent bug legible.
        if (!playlist.ok) {
          return `propose_playlist failed with ids passed as "${key}": ${playlist.summary}`;
        }
        return true;
      },
      replyRejects: [CLAIMED_DONE],
      maxMs: 120_000,
    },
  },
  {
    id: 'PLAY-02',
    group: 'playlist',
    severity: 'high',
    why: 'Every track id in the card must resolve on Spotify. An id that 404s makes a playlist that cannot be created, and the failure surfaces only at confirm time.',
    turns: ['Put together a short playlist of romantic songs for Maya.'],
    facts: FACTS,
    expect: {
      calledTool: ['find_music', 'propose_playlist'],
      maxMs: 120_000,
      oracle: async (outcome) => {
        const { ids } = idsGivenToPlaylist(outcome.calls);
        if (ids.length === 0) return 'no ids were passed, so none could be checked';

        const found = await spotifyTracks(ids);
        const missing = ids.filter((id) => !found.has(id.replace(/^spotify:track:/, '')));
        if (missing.length === 0) return true;
        return `${missing.length}/${ids.length} ids do not resolve on Spotify: ${missing.join(', ')}`;
      },
    },
  },
  {
    id: 'PLAY-03',
    group: 'playlist',
    severity: 'high',
    why: 'The artists named in the prose must be the artists on the ids in the card. Naming a real song and attaching a different track is invisible until she plays it.',
    // Two turns because a single "tell me which artists" is legitimately answered
    // with an offer rather than a card — the agent did exactly that, and asserting
    // on one turn tested the harness's patience rather than the app.
    turns: [
      'Three songs for Maya — tell me which artists you picked and why.',
      'Those are good. Put those three in a playlist for her.',
    ],
    facts: FACTS,
    expect: {
      maxMs: 150_000,
      oracle: async (outcome) => {
        const { ids } = idsGivenToPlaylist(outcome.calls);
        if (ids.length === 0) return 'no ids were passed, so nothing could be cross-checked';

        const found = await spotifyTracks(ids);
        if (found.size === 0) return 'no id resolved, so the artists cannot be checked';

        // Every artist actually attached should be one the prose mentioned. The
        // reverse is not required — the model may discuss an artist it chose not
        // to include.
        // Across all turns: the artists are named when they are proposed, which is
        // a turn before the card is built.
        const said = outcome.replies.join('\n').toLowerCase();
        const unmentioned = [...found.values()].filter(
          (track) => !said.includes(track.artist.toLowerCase()),
        );
        if (unmentioned.length === 0) return true;
        return `the card contains tracks by artists the reply never names: ${unmentioned
          .map((track) => `${track.artist} — ${track.name}`)
          .join('; ')}`;
      },
    },
  },
  {
    id: 'PLAY-04',
    group: 'playlist',
    severity: 'medium',
    why: 'A round-number request must not become a 400 or a quiet truncation. Whatever count reaches the card, the prose must state the real one.',
    turns: ['Build me a 20-song playlist for the road trip.'],
    facts: FACTS,
    expect: {
      calledTool: ['propose_playlist'],
      args: (calls) => {
        const playlist = calls.find((call) => call.name === 'propose_playlist');
        if (!playlist) return 'propose_playlist was never called';
        if (!playlist.ok) return `propose_playlist failed: ${playlist.summary}`;

        /*
         * Asserted on what reached the *card*, not on the raw argument.
         *
         * The first version of this case failed a run in which the model repeated
         * two ids to pad a 20-song request — but the tool dedupes before resolving
         * and tells the model plainly that it did ("You repeated 2 id(s); the
         * repeats were removed"), so the user was never offered the same song
         * twice. Failing that reported honest behaviour as a bug. What must hold
         * is the outcome: the card carries distinct tracks, and the prose does not
         * promise a count the card does not have.
         */
        const onCard = ((playlist.data as { tracks?: { id?: unknown }[] } | undefined)?.tracks ?? [])
          .map((track) => String(track.id));
        if (onCard.length === 0) return 'the card carries no tracks at all';
        const unique = new Set(onCard);
        if (unique.size !== onCard.length) {
          return `${onCard.length - unique.size} duplicate track(s) reached the card`;
        }
        return true;
      },
      replyRejects: [CLAIMED_DONE],
      maxMs: 150_000,
    },
  },
  {
    id: 'PLAY-06',
    group: 'playlist',
    severity: 'high',
    why: 'Every id in the card must be one find_music returned, character for character. The contract makes the model hand-copy 22-character opaque ids out of prose, and a single wrong character silently drops a song — observed once in a 17-track playlist, where find_music returned …S5XeNUgr and the card carried …S6XeNUgr.',
    turns: ['Make Maya a playlist of about eight songs she would love.'],
    facts: FACTS,
    expect: {
      calledTool: ['propose_playlist'],
      args: (calls) => {
        // The ids find_music actually offered, harvested from its own summaries.
        const offered = new Set(
          calls
            .filter((call) => call.name === 'find_music')
            .flatMap((call) => [...call.summary.matchAll(/\[id:\s*([A-Za-z0-9]+)\]/g)])
            .map((match) => match[1]),
        );
        if (offered.size === 0) return 'find_music offered no ids to copy';

        const { ids } = idsGivenToPlaylist(calls);
        if (ids.length === 0) return 'propose_playlist got no ids under any spelling';

        const invented = ids.filter((id) => !offered.has(id.replace(/^spotify:track:/, '')));
        return invented.length === 0
          ? true
          : `${invented.length}/${ids.length} ids were not among those find_music returned — ` +
            `transcription corruption: ${invented.join(', ')}`;
      },
      maxMs: 150_000,
    },
  },
  {
    id: 'PLAY-07',
    group: 'playlist',
    severity: 'medium',
    why: 'find_music is the entry point for every playlist, and the natural first query — the two artists the user actually named — returns nothing at all. Observed: query "Fleetwood Mac Norah Jones warm melodic folk rock" → "Spotify has nothing for …", and a mood-only retry returned two copies of a German-language track by an unrelated artist. The agent recovers by searching each artist separately, which costs three extra calls, but a request that names a mood rather than an artist has nothing to fall back on. This is the other half of "ask for a playlist and it doesn\'t work".',
    turns: ['Find me a few songs with a warm, mellow late-evening mood for Maya.'],
    facts: FACTS,
    expect: {
      calledTool: ['find_music'],
      args: (calls) => {
        const searches = calls.filter((call) => call.name === 'find_music');
        if (searches.length === 0) return 'find_music was never called';

        const empty = searches.filter((call) => /has nothing for/i.test(call.summary));
        if (empty.length === searches.length) {
          return `every find_music query came back empty: ${searches
            .map((call) => JSON.stringify(call.args.query))
            .join(', ')}`;
        }

        // A single search returning the same track twice under different ids is
        // what later lets a playlist be padded with duplicates.
        const dupes = searches.filter((call) => {
          const titles = [...call.summary.matchAll(/([^|:]+?) — ([^(]+?) \(\d+:\d\d\)/g)].map(
            (match) => `${match[1].trim()} — ${match[2].trim()}`,
          );
          return new Set(titles).size !== titles.length;
        });
        return dupes.length === 0
          ? true
          : `find_music returned the same track twice under different ids: ${dupes
              .map((call) => JSON.stringify(call.args.query))
              .join(', ')}`;
      },
      maxMs: 120_000,
    },
  },
  {
    id: 'PLAY-05',
    group: 'playlist',
    severity: 'high',
    why: 'Nothing is confirmed in this run, so any claim that the playlist is saved to her library is false. This is the anti-hallucination floor for every write tool.',
    turns: [
      'Make Maya a playlist for tonight.',
      'Great — is it in her Spotify library now?',
    ],
    facts: FACTS,
    expect: {
      replyRejects: [CLAIMED_DONE, /\b(?:in|to) (?:her|your) (?:spotify )?library\b/i],
      maxMs: 150_000,
    },
  },
];
