import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { InMemoryStoreFactory } from '../in-memory-store';
import type { StorageInterface } from '../storage-interface';
import type { ChatMessage } from '../../../shared/interfaces/message';
import type { PreferenceCategory } from '../../../shared/interfaces/preference';
import { PREFERENCE_CATEGORIES } from '../../../shared/constants/categories';

/**
 * A store scoped to one throwaway user.
 *
 * There is deliberately no way to build an unscoped store — see
 * ScopedStorageFactory. Tests that care about who owns what name their users;
 * the property tests below only need *a* user, so they take the default.
 */
function newStore(userId = 'user-under-test'): StorageInterface {
  return new InMemoryStoreFactory().forUser(userId);
}

// --- Generators ---

const senderArb = fc.constantFrom('user' as const, 'agent' as const);

/** Safe ISO timestamp generator using integer millis to avoid Invalid Date */
const isoTimestampArb = fc
  .integer({ min: 946684800000, max: 1893456000000 }) // 2000-01-01 to 2030-01-01
  .map((ms) => new Date(ms).toISOString());

const chatMessageArb = (sessionId: string) =>
  fc.record({
    id: fc.uuid(),
    sessionId: fc.constant(sessionId),
    sender: senderArb,
    content: fc.string({ minLength: 1, maxLength: 200 }),
    timestamp: isoTimestampArb,
  });

const categoryArb = fc.constantFrom(
  ...PREFERENCE_CATEGORIES,
) as fc.Arbitrary<PreferenceCategory>;

const extractedPrefArb = fc.record({
  category: categoryArb,
  key: fc.string({ minLength: 1, maxLength: 50 }),
  value: fc.string({ minLength: 1, maxLength: 200 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
});

// --- Property 5: Message persistence round trip ---
// Feature: valentin-romantic-agent, Property 5: Message persistence round trip
// **Validates: Requirements 3.1, 3.2, 3.4**

describe('Property 5: Message persistence round trip', () => {
  let store: StorageInterface;
  let sessionId: string;

  beforeEach(async () => {
    store = newStore();
    sessionId = await store.createSession();
  });

  it('saveMessage then getMessagesBySession returns message with identical fields', async () => {
    await fc.assert(
      fc.asyncProperty(chatMessageArb(sessionId), async (msg) => {
        const freshStore = newStore();
        const sid = await freshStore.createSession();
        const message: ChatMessage = { ...msg, sessionId: sid };

        await freshStore.saveMessage(message);
        const retrieved = await freshStore.getMessagesBySession(sid);

        expect(retrieved).toHaveLength(1);
        expect(retrieved[0].id).toBe(message.id);
        expect(retrieved[0].content).toBe(message.content);
        expect(retrieved[0].sender).toBe(message.sender);
        expect(retrieved[0].timestamp).toBe(message.timestamp);
        expect(retrieved[0].sessionId).toBe(sid);
      }),
      { numRuns: 100 },
    );
  });

  it('for N stored messages, getMessagesBySession returns exactly N', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(chatMessageArb(sessionId), { minLength: 0, maxLength: 20 }),
        async (messages) => {
          const freshStore = newStore();
          const sid = await freshStore.createSession();

          for (const msg of messages) {
            await freshStore.saveMessage({ ...msg, sessionId: sid });
          }

          const retrieved = await freshStore.getMessagesBySession(sid);
          expect(retrieved).toHaveLength(messages.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 6: Preference persistence with valid structure ---
// Feature: valentin-romantic-agent, Property 6: Preference persistence with valid structure
// **Validates: Requirements 2.2, 2.4**

describe('Property 6: Preference persistence with valid structure', () => {
  it('persisted preference has non-empty id, valid category, non-empty key/value, confidence in [0,1]', async () => {
    await fc.assert(
      fc.asyncProperty(extractedPrefArb, async (extracted) => {
        const store = newStore();
        const sessionId = await store.createSession();

        const saved = await store.savePreference({
          sessionId,
          category: extracted.category,
          key: extracted.key,
          value: extracted.value,
          confidence: extracted.confidence,
          sourceMessageId: 'msg-1',
        });

        expect(saved.id).toBeTruthy();
        expect(saved.id.length).toBeGreaterThan(0);
        expect(PREFERENCE_CATEGORIES).toContain(saved.category);
        expect(saved.key.length).toBeGreaterThan(0);
        expect(saved.value.length).toBeGreaterThan(0);
        expect(saved.confidence).toBeGreaterThanOrEqual(0);
        expect(saved.confidence).toBeLessThanOrEqual(1);
        expect(saved.history).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});


// --- Property 7: Preference update retains history ---
// Feature: valentin-romantic-agent, Property 7: Preference update retains history
// **Validates: Requirements 2.3**

describe('Property 7: Preference update retains history', () => {
  it('after N updates, history length equals N and most recent entry has previousValue equal to old value', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 100 }), {
          minLength: 1,
          maxLength: 10,
        }),
        async (newValues) => {
          const store = newStore();
          const sessionId = await store.createSession();

          const saved = await store.savePreference({
            sessionId,
            category: 'food',
            key: 'cuisine',
            value: 'initial',
            confidence: 0.8,
            sourceMessageId: 'msg-0',
          });

          let currentValue = saved.value;
          let result = saved;

          for (let i = 0; i < newValues.length; i++) {
            const oldValue = currentValue;
            result = await store.updatePreference(
              { sessionId, category: 'food', key: 'cuisine' },
              {
                value: newValues[i],
                sourceMessageId: `msg-${i + 1}`,
              },
            );
            currentValue = newValues[i];

            // Most recent history entry should have the old value
            const lastEntry = result.history[result.history.length - 1];
            expect(lastEntry.previousValue).toBe(oldValue);
            expect(lastEntry.changedAt).toBeTruthy();
          }

          expect(result.history).toHaveLength(newValues.length);
          expect(result.value).toBe(newValues[newValues.length - 1]);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// --- clearSession ---

describe('InMemoryStore.clearSession', () => {
  let store: StorageInterface;
  let sessionId: string;

  beforeEach(async () => {
    store = newStore();
    sessionId = await store.createSession();
    await store.savePreference({
      sessionId,
      category: 'food',
      key: 'cuisine',
      value: 'Italian',
      confidence: 0.9,
      sourceMessageId: 'msg-1',
    });
    await store.saveMessage({
      id: 'msg-1',
      sessionId,
      sender: 'user',
      content: 'She loves Italian food',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
  });

  it('removes all preferences for the session', async () => {
    await store.clearSession(sessionId);

    expect(await store.getPreferencesBySession(sessionId)).toEqual([]);
  });

  it('removes all messages for the session', async () => {
    await store.clearSession(sessionId);

    expect(await store.getMessagesBySession(sessionId)).toEqual([]);
  });

  it('keeps the session itself alive', async () => {
    await store.clearSession(sessionId);

    const session = await store.getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(sessionId);
    expect(session!.endedAt).toBeNull();
  });

  it('resets the session counters to zero', async () => {
    await store.clearSession(sessionId);

    const session = await store.getSession(sessionId);
    expect(session!.preferenceCount).toBe(0);
    expect(session!.messageCount).toBe(0);
  });

  it('leaves other sessions untouched', async () => {
    const otherSessionId = await store.createSession();
    await store.savePreference({
      sessionId: otherSessionId,
      category: 'music',
      key: 'genre',
      value: 'Indie folk',
      confidence: 0.8,
      sourceMessageId: 'msg-2',
    });

    await store.clearSession(sessionId);

    expect(await store.getPreferencesBySession(otherSessionId)).toHaveLength(1);
  });

  it('is a no-op for an unknown session id', async () => {
    await expect(store.clearSession('does-not-exist')).resolves.toBeUndefined();
    expect(await store.getPreferencesBySession(sessionId)).toHaveLength(1);
  });
});

// --- Cross-tenant isolation ---
//
// The security claim of the whole persistence layer: one user cannot reach
// another's data even holding a valid session id. Both stores come from the
// *same* factory and therefore share one data set — if they had private maps
// every assertion below would pass without proving anything.

describe('cross-tenant isolation', () => {
  let alice: StorageInterface;
  let bob: StorageInterface;
  let aliceSession: string;

  beforeEach(async () => {
    const factory = new InMemoryStoreFactory();
    alice = factory.forUser('alice');
    bob = factory.forUser('bob');

    aliceSession = await alice.createSession();
    await alice.savePreference({
      sessionId: aliceSession,
      category: 'food',
      key: 'cuisine',
      value: 'Italian',
      confidence: 0.9,
      sourceMessageId: 'msg-1',
    });
    await alice.saveMessage({
      id: 'msg-1',
      sessionId: aliceSession,
      sender: 'user',
      content: 'She loves Italian food',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
  });

  it('does not leak the session itself', async () => {
    expect(await bob.getSession(aliceSession)).toBeNull();
  });

  it('does not leak messages', async () => {
    expect(await bob.getMessagesBySession(aliceSession)).toEqual([]);
  });

  it('does not leak preferences', async () => {
    expect(await bob.getPreferencesBySession(aliceSession)).toEqual([]);
    expect(await bob.findPreference(aliceSession, 'food', 'cuisine')).toBeNull();
  });

  it('omits other users from listSessions', async () => {
    await bob.createSession();

    const bobIds = (await bob.listSessions()).map((s) => s.id);
    expect(bobIds).toHaveLength(1);
    expect(bobIds).not.toContain(aliceSession);
  });

  it('cannot clear another user\'s session', async () => {
    await bob.clearSession(aliceSession);

    expect(await alice.getPreferencesBySession(aliceSession)).toHaveLength(1);
    expect(await alice.getMessagesBySession(aliceSession)).toHaveLength(1);
  });

  it('cannot delete another user\'s session', async () => {
    await bob.deleteSession(aliceSession);

    expect(await alice.getSession(aliceSession)).not.toBeNull();
  });

  it('cannot end another user\'s session', async () => {
    await bob.endSession(aliceSession);

    const session = await alice.getSession(aliceSession);
    expect(session!.endedAt).toBeNull();
  });

  it('cannot rename another user\'s session', async () => {
    await bob.updateSessionMeta(aliceSession, { title: 'hijacked' });

    const session = await alice.getSession(aliceSession);
    expect(session!.title).toBeNull();
  });

  it('keeps identical session ids apart across users', async () => {
    // Two users can hold the same session id without colliding, because the
    // user is part of the partition key rather than a field compared after
    // the read.
    const bobSession = await bob.createSession();
    await bob.saveMessage({
      id: 'bob-msg',
      sessionId: bobSession,
      sender: 'user',
      content: 'Bob speaking',
      timestamp: '2026-01-02T00:00:00.000Z',
    });

    const aliceMessages = await alice.getMessagesBySession(aliceSession);
    expect(aliceMessages).toHaveLength(1);
    expect(aliceMessages[0].id).toBe('msg-1');
  });
});

// --- Session metadata ---

describe('session metadata', () => {
  it('records a partner name and a title', async () => {
    const store = newStore();
    const sessionId = await store.createSession();

    await store.updateSessionMeta(sessionId, { partnerName: 'Maya' });
    expect((await store.getSession(sessionId))!.partnerName).toBe('Maya');

    await store.updateSessionMeta(sessionId, { title: 'Anniversary plans' });
    const session = await store.getSession(sessionId);
    expect(session!.title).toBe('Anniversary plans');
    // A patch touches only the fields it names.
    expect(session!.partnerName).toBe('Maya');
  });

  it('orders listSessions by most recent activity', async () => {
    const store = newStore();
    const older = await store.createSession();
    const newer = await store.createSession();

    await store.saveMessage({
      id: 'm1',
      sessionId: older,
      sender: 'user',
      content: 'first',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    await store.saveMessage({
      id: 'm2',
      sessionId: newer,
      sender: 'user',
      content: 'second',
      timestamp: '2026-02-01T00:00:00.000Z',
    });

    expect((await store.listSessions()).map((s) => s.id)).toEqual([newer, older]);
  });

  it('writes a batch of preferences with one counter bump', async () => {
    const store = newStore();
    const sessionId = await store.createSession();

    const written = await store.savePreferencesBatch(sessionId, [
      { category: 'food', key: 'cuisine', value: 'Italian', confidence: 0.9, sourceMessageId: 'm1' },
      { category: 'music', key: 'genre', value: 'Indie', confidence: 0.8, sourceMessageId: 'm1' },
    ]);

    expect(written).toHaveLength(2);
    expect((await store.getSession(sessionId))!.preferenceCount).toBe(2);
  });

  it('deleteSession removes the session and its contents', async () => {
    const store = newStore();
    const sessionId = await store.createSession();
    await store.saveMessage({
      id: 'm1',
      sessionId,
      sender: 'user',
      content: 'hello',
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    await store.deleteSession(sessionId);

    expect(await store.getSession(sessionId)).toBeNull();
    expect(await store.getMessagesBySession(sessionId)).toEqual([]);
  });
});
