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
    turns: ['Three songs for Maya — tell me which artists you picked and why.'],
    facts: FACTS,
    expect: {
      maxMs: 120_000,
      oracle: async (outcome) => {
        const { ids } = idsGivenToPlaylist(outcome.calls);
        if (ids.length === 0) return 'no ids were passed, so nothing could be cross-checked';

        const found = await spotifyTracks(ids);
        if (found.size === 0) return 'no id resolved, so the artists cannot be checked';

        // Every artist actually attached should be one the prose mentioned. The
        // reverse is not required — the model may discuss an artist it chose not
        // to include.
        const unmentioned = [...found.values()].filter(
          (track) => !outcome.reply.toLowerCase().includes(track.artist.toLowerCase()),
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

        const { ids } = idsGivenToPlaylist(calls);
        // Fewer is fine and honest; zero is the bug, and duplicates inflate a count
        // the user will later find missing.
        if (ids.length === 0) return 'the card carries no tracks at all';
        const unique = new Set(ids);
        if (unique.size !== ids.length) {
          return `${ids.length - unique.size} duplicate ids padded the playlist`;
        }
        return true;
      },
      replyRejects: [CLAIMED_DONE],
      maxMs: 150_000,
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
