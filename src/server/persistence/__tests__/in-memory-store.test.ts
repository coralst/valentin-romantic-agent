import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { InMemoryStore } from '../in-memory-store';
import type { ChatMessage } from '../../../shared/interfaces/message';
import type { PreferenceCategory } from '../../../shared/interfaces/preference';
import { PREFERENCE_CATEGORIES } from '../../../shared/constants/categories';

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
  let store: InMemoryStore;
  let sessionId: string;

  beforeEach(async () => {
    store = new InMemoryStore();
    sessionId = await store.createSession();
  });

  it('saveMessage then getMessagesBySession returns message with identical fields', async () => {
    await fc.assert(
      fc.asyncProperty(chatMessageArb(sessionId), async (msg) => {
        const freshStore = new InMemoryStore();
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
          const freshStore = new InMemoryStore();
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
        const store = new InMemoryStore();
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
          const store = new InMemoryStore();
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
            result = await store.updatePreference(result.id, {
              value: newValues[i],
              sourceMessageId: `msg-${i + 1}`,
            });
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
