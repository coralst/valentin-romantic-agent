import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { chatReducer, type ChatState } from '../use-chat-state';
import type { ChatMessage } from '../../../shared/interfaces/message';

/** Arbitrary for a valid ISO timestamp string */
const isoTimestampArb = fc
  .integer({ min: 1577836800000, max: 1893456000000 }) // 2020-01-01 to 2030-01-01 in ms
  .map((ms) => new Date(ms).toISOString());

/** Arbitrary for a valid ChatMessage */
const chatMessageArb = fc.record({
  id: fc.uuid(),
  sessionId: fc.uuid(),
  sender: fc.constantFrom('user' as const, 'agent' as const),
  content: fc.string({ minLength: 1 }),
  timestamp: isoTimestampArb,
});

/** Arbitrary for a non-empty array of ChatMessages */
const chatMessageListArb = fc.array(chatMessageArb, { minLength: 0, maxLength: 20 });

/** Build a ChatState with a given message list and input */
function makeState(messages: ChatMessage[], inputValue: string): ChatState {
  return {
    sessionId: 'test-session',
    messages,
    isTyping: false,
    connectionStatus: 'connected',
    inputValue,
  };
}

describe('chatReducer — property tests', () => {
  // Feature: valentin-romantic-agent, Property 1: Message submission adds to conversation
  // **Validates: Requirements 1.2**
  it('Property 1: SEND_MESSAGE grows the list by exactly one with sender user and matching content', () => {
    fc.assert(
      fc.property(
        chatMessageListArb,
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.uuid(),
        fc.uuid(),
        (existingMessages, content, msgId, sessionId) => {
          const state = makeState(existingMessages, content);
          const newMessage: ChatMessage = {
            id: msgId,
            sessionId,
            sender: 'user',
            content,
            timestamp: new Date().toISOString(),
          };

          const next = chatReducer(state, { type: 'SEND_MESSAGE', message: newMessage });

          expect(next.messages).toHaveLength(existingMessages.length + 1);

          const added = next.messages.find((m) => m.id === msgId);
          expect(added).toBeDefined();
          expect(added!.sender).toBe('user');
          expect(added!.content).toBe(content);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: valentin-romantic-agent, Property 2: Messages display in chronological order
  // **Validates: Requirements 1.3**
  it('Property 2: messages are always sorted ascending by timestamp after any action', () => {
    fc.assert(
      fc.property(chatMessageListArb, (messages) => {
        const state = makeState([], '');

        // Feed all messages via RECEIVE_MESSAGE
        let current = state;
        for (const msg of messages) {
          current = chatReducer(current, { type: 'RECEIVE_MESSAGE', message: msg });
        }

        // Verify ascending order
        for (let i = 1; i < current.messages.length; i++) {
          const prev = new Date(current.messages[i - 1].timestamp).getTime();
          const curr = new Date(current.messages[i].timestamp).getTime();
          expect(curr).toBeGreaterThanOrEqual(prev);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: valentin-romantic-agent, Property 4: Input cleared after message submission
  // **Validates: Requirements 1.5**
  it('Property 4: after SEND_MESSAGE, inputValue is always empty', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.uuid(),
        (inputValue, msgId) => {
          const state = makeState([], inputValue);
          const message: ChatMessage = {
            id: msgId,
            sessionId: 'sess',
            sender: 'user',
            content: inputValue,
            timestamp: new Date().toISOString(),
          };

          const next = chatReducer(state, { type: 'SEND_MESSAGE', message });

          expect(next.inputValue).toBe('');
        },
      ),
      { numRuns: 100 },
    );
  });
});
