import { describe, it, expect } from 'vitest';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { StorageInterface } from '../../persistence/storage-interface';
import {
  decodeKeepsake,
  encodeKeepsake,
  KEEPSAKE_CATEGORY,
  PLAYLIST_KEY,
  recordKeepsake,
} from '../keepsake-recorder';
import { reminderContextFor } from '../../reminders/suggestions';
import type { Reminder } from '../../../shared/interfaces/reminder';

/**
 * The chain this file exists to keep intact: a playlist confirmed on Thursday has to
 * still be findable by a timer on the following Monday, in a process with no
 * conversation in it. Every link is tested from the confirm's own value through to the
 * context the mail is built from, because a break anywhere in it is invisible — the
 * reply still says "saved", and only the mail is quietly missing its last paragraph.
 */

const PLAYLIST = {
  kind: 'playlist' as const,
  title: 'For Maya — Nina Simone and the quiet hours',
  url: 'https://open.spotify.com/playlist/abc123',
};

async function store(): Promise<{ storage: StorageInterface; sessionId: string }> {
  const storage = new InMemoryStoreFactory().forUser('user-1');
  return { storage, sessionId: await storage.createSession() };
}

describe('encoding', () => {
  it('round-trips a title and a link', () => {
    expect(decodeKeepsake(encodeKeepsake(PLAYLIST))).toEqual({
      title: PLAYLIST.title,
      url: PLAYLIST.url,
    });
  });

  it('splits on the last separator, so a title may contain one', () => {
    const awkward = { ...PLAYLIST, title: 'me@home mixtape' };
    expect(decodeKeepsake(encodeKeepsake(awkward))?.title).toBe('me@home mixtape');
  });

  /*
   * Anything unusable is `null` rather than a partial render. The mail's own tests
   * assert it says nothing without a link; this makes sure a malformed *row* reaches
   * that branch instead of producing a surprise with a broken address in it.
   */
  it('refuses anything that is not a title and an openable link', () => {
    for (const bad of [null, undefined, '', 'no separator', '@only-a-url', 'name@', 'name@ftp://x']) {
      expect(decodeKeepsake(bad)).toBeNull();
    }
  });
});

describe('recordKeepsake', () => {
  it('writes the playlist where the reminder path will look for it', async () => {
    const { storage, sessionId } = await store();

    await recordKeepsake(storage, sessionId, 'proposal-1', PLAYLIST);

    const row = await storage.findPreference(sessionId, KEEPSAKE_CATEGORY, PLAYLIST_KEY);
    expect(decodeKeepsake(row?.value)).toEqual({ title: PLAYLIST.title, url: PLAYLIST.url });
  });

  it('does nothing at all when the confirm made nothing', async () => {
    const { storage, sessionId } = await store();

    await recordKeepsake(storage, sessionId, 'proposal-1', undefined);

    expect(await storage.findPreference(sessionId, KEEPSAKE_CATEGORY, PLAYLIST_KEY)).toBeNull();
  });

  it('records a second playlist as a revision, not a duplicate row', async () => {
    const { storage, sessionId } = await store();
    const second = { ...PLAYLIST, title: 'Take two', url: 'https://open.spotify.com/playlist/xyz' };

    await recordKeepsake(storage, sessionId, 'proposal-1', PLAYLIST);
    await recordKeepsake(storage, sessionId, 'proposal-2', second);

    const row = await storage.findPreference(sessionId, KEEPSAKE_CATEGORY, PLAYLIST_KEY);
    expect(decodeKeepsake(row?.value)?.url).toBe(second.url);
    // Changing your mind is a real revision and shows as one.
    expect(row?.history?.length ?? 0).toBeGreaterThan(0);
  });

  it('does not grow a fake revision trail when nothing changed', async () => {
    const { storage, sessionId } = await store();

    await recordKeepsake(storage, sessionId, 'proposal-1', PLAYLIST);
    await recordKeepsake(storage, sessionId, 'proposal-1', PLAYLIST);

    const row = await storage.findPreference(sessionId, KEEPSAKE_CATEGORY, PLAYLIST_KEY);
    expect(row?.history?.length ?? 0).toBe(0);
  });

  /*
   * By the time this runs the playlist exists and the user has been told so. A
   * throttled write must cost the mail its closing paragraph, never the confirm its
   * reply — so this resolves rather than throwing.
   */
  it('swallows a failed write, because the playlist already exists', async () => {
    const { storage, sessionId } = await store();
    const broken: StorageInterface = {
      ...storage,
      findPreference: async () => {
        throw new Error('ProvisionedThroughputExceededException');
      },
    };

    await expect(recordKeepsake(broken, sessionId, 'proposal-1', PLAYLIST)).resolves.toBeUndefined();
  });
});

describe('the whole chain, confirm to mail', () => {
  it('reaches the reminder context as a surprise', async () => {
    const { storage, sessionId } = await store();
    await recordKeepsake(storage, sessionId, 'proposal-1', PLAYLIST);

    const reminder: Reminder = {
      id: 'anniversary-2026-09-17',
      sessionId,
      userId: 'user-1',
      channel: 'log',
      attempts: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      kind: 'anniversary',
      title: null,
      occasion: 'anniversary',
      occursOn: '2026-09-17',
      leadDays: 7,
      dueAt: '2026-09-10T05:30:00.000Z',
      target: 'him@example.test',
      sentAt: null,
    };

    const context = await reminderContextFor(storage, reminder);

    expect(context.surprise).toEqual({ title: PLAYLIST.title, url: PLAYLIST.url });
  });

  it('leaves the surprise null for a session that made nothing', async () => {
    const { storage, sessionId } = await store();

    const context = await reminderContextFor(storage, {
      id: 'anniversary-2026-09-17',
      sessionId,
      userId: 'user-1',
      channel: 'log',
      attempts: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      kind: 'anniversary',
      title: null,
      occasion: 'anniversary',
      occursOn: '2026-09-17',
      leadDays: 7,
      dueAt: '2026-09-10T05:30:00.000Z',
      target: 'him@example.test',
      sentAt: null,
    });

    expect(context.surprise).toBeNull();
  });
});
