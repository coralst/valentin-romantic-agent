import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { InMemoryConversationMemory } from '../conversation-memory';
import { InMemoryStore } from '../in-memory-store';
import type { ChatMessage } from '../../../shared/interfaces/message';

// --- Generators ---

const senderArb = fc.constantFrom('user' as const, 'agent' as const);

/** Safe ISO timestamp generator using integer millis to avoid Invalid Date */
const isoTimestampArb = fc
  .integer({ min: 946684800000, max: 1893456000000 }) // 2000-01-01 to 2030-01-01
  .map((ms) => new Date(ms).toISOString());

const rawMessageArb = fc.record({
  id: fc.uuid(),
  sender: senderArb,
  content: fc.string({ minLength: 1, maxLength: 300 }),
  timestamp: isoTimestampArb,
});

/** Rough token estimation matching the implementation: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: ChatMessage): number {
  return estimateTokens(msg.sender) + estimateTokens(msg.content) + 4;
}

function estimateContextWindowTokens(
  summary: string | null,
  recentMessages: ChatMessage[],
): number {
  let total = 0;
  if (summary) {
    total += estimateTokens(summary);
  }
  for (const msg of recentMessages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

// --- Property 8: Context window stays within token budget ---
// Feature: valentin-romantic-agent, Property 8: Context window stays within token budget
// **Validates: Requirements 3.6**

describe('Property 8: Context window stays within token budget', () => {
  it('returned ContextWindow estimated tokens do not exceed maxTokens', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(rawMessageArb, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 5000 }),
        async (rawMessages, maxTokens) => {
          const store = new InMemoryStore();
          const sessionId = await store.createSession();
          const memory = new InMemoryConversationMemory(store);

          for (const raw of rawMessages) {
            const msg: ChatMessage = { ...raw, sessionId };
            await memory.addMessage(sessionId, msg);
          }

          const window = await memory.getContextWindow(sessionId, maxTokens);

          const estimatedTokens = estimateContextWindowTokens(
            window.summary,
            window.recentMessages,
          );
          expect(estimatedTokens).toBeLessThanOrEqual(maxTokens);
          expect(window.totalMessages).toBe(rawMessages.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('if full history fits within budget, summary is null and all messages returned', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(rawMessageArb, { minLength: 1, maxLength: 5 }),
        async (rawMessages) => {
          const store = new InMemoryStore();
          const sessionId = await store.createSession();
          const memory = new InMemoryConversationMemory(store);

          const messages: ChatMessage[] = [];
          for (const raw of rawMessages) {
            const msg: ChatMessage = { ...raw, sessionId };
            await memory.addMessage(sessionId, msg);
            messages.push(msg);
          }

          // Use a very large budget so everything fits
          const largeBudget = 100000;
          const window = await memory.getContextWindow(sessionId, largeBudget);

          expect(window.summary).toBeNull();
          expect(window.recentMessages).toHaveLength(messages.length);
          expect(window.totalMessages).toBe(messages.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
