import { describe, it, expect, vi } from 'vitest';
import { recordOuting } from '../outing-recorder';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { StorageInterface } from '../../persistence/storage-interface';

const booking = {
  venueSlug: 'claro',
  venueName: 'Claro',
  city: 'Tel Aviv',
  occursOn: '2026-06-12',
};

async function freshSession(): Promise<{ store: StorageInterface; sessionId: string }> {
  const store = new InMemoryStoreFactory().forUser('user-under-test');
  return { store, sessionId: await store.createSession() };
}

describe('recordOuting', () => {
  it('writes the venue facts, unrated', async () => {
    const { store, sessionId } = await freshSession();

    const recorded = await recordOuting(store, sessionId, booking);

    expect(recorded).toMatchObject({ venueName: 'Claro', city: 'Tel Aviv', rating: null });
    expect(await store.getOutingsBySession(sessionId)).toHaveLength(1);
  });

  it('records nothing when the confirm named no place', async () => {
    // A gift delivery or an email send is a confirmed action with no venue in
    // it. A row asking her to rate the florist would be noise in the dossier and
    // in the prompt — so no `booking` means no outing.
    const { store, sessionId } = await freshSession();

    expect(await recordOuting(store, sessionId, undefined)).toBeNull();
    expect(await store.getOutingsBySession(sessionId)).toEqual([]);
  });

  it('swallows a storage failure, because the table is already booked', async () => {
    const { store, sessionId } = await freshSession();
    vi.spyOn(store, 'saveOuting').mockRejectedValue(new Error('ProvisionedThroughputExceeded'));

    // The reply this turn says "your table is booked", and it is true. A
    // DynamoDB blip must cost the history row, never the truth of the reply.
    await expect(recordOuting(store, sessionId, booking)).resolves.toBeNull();
  });

  it('gives each visit its own row, so a return does not overwrite the first', async () => {
    const { store, sessionId } = await freshSession();

    await recordOuting(store, sessionId, booking);
    await recordOuting(store, sessionId, { ...booking, occursOn: '2026-08-01' });

    const stored = await store.getOutingsBySession(sessionId);
    expect(stored).toHaveLength(2);
    expect(new Set(stored.map((row) => row.id)).size).toBe(2);
  });
});
