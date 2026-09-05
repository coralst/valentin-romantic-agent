/**
 * The ways a playlist request fails while looking like it worked.
 *
 * `spotify.test.ts` already covers the happy path and the fixture path. What it
 * does not cover is the gap between what the *model* sends and what the tool
 * reads, which is where "ask for a playlist and it doesn't work" actually lives:
 * the tool is fine, the card is fine, and the argument never arrives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../../config';
import { spotifyTools } from '../tools';

const proposePlaylist = spotifyTools.find((tool) => tool.name === 'propose_playlist')!;
const ctx = { sessionId: 'session-1', userId: 'user-1' } as never;

describe('the argument the model actually sends', () => {
  /**
   * Every other schema in the catalogue is snake_case, so a model writing in the
   * house style emits `track_ids`. The tool reads `input.trackIds` only, so the
   * ids land nowhere and the user is told to use find_music — which the model just
   * used. That is a request that consumes two tool calls and produces no playlist,
   * intermittently, depending on which spelling the model picked that turn.
   *
   * Accepting both spellings is the cheap fix; renaming the property is the clean
   * one. Either way this test is what says the argument arrived.
   */
  it('accepts snake_case track_ids as well as camelCase trackIds', async () => {
    const result = await proposePlaylist.execute(
      { name: 'For the drive', track_ids: ['4cOdK2wGLETKBW3PvgPWqT'] } as never,
      ctx,
    );

    expect(
      result.summary,
      'a track_ids emission is read as no ids at all',
    ).not.toMatch(/No track ids were given/);
  });

  it('still accepts camelCase trackIds', async () => {
    const result = await proposePlaylist.execute(
      { name: 'For the drive', trackIds: ['4cOdK2wGLETKBW3PvgPWqT'] } as never,
      ctx,
    );

    expect(result.summary).not.toMatch(/No track ids were given/);
  });

  it('tells the model plainly when there really are no ids', async () => {
    const result = await proposePlaylist.execute({ name: 'Empty' } as never, ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/no track ids|nothing to put/i);
  });
});

describe('fixture mode cannot pass for the real thing', () => {
  const originalFixture = config.integrations.spotifyFixture;

  beforeEach(() => {
    config.integrations.spotifyFixture = true;
  });

  afterEach(() => {
    config.integrations.spotifyFixture = originalFixture;
    vi.unstubAllGlobals();
  });

  it('never hands back a real-looking playlist URL', async () => {
    const result = await proposePlaylist.execute(
      { name: 'Fixture run', trackIds: ['fixture:track:1'] } as never,
      ctx,
    );

    // A card that links open.spotify.com while nothing was sent to Spotify is the
    // one failure the fixture exists to make impossible.
    expect(JSON.stringify(result)).not.toMatch(/open\.spotify\.com\/playlist/);
  });
});
