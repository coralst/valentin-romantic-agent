import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { chatReducer, type ChatState } from '../use-chat-state';
import type { ChatMessage } from '../../../shared/interfaces/message';
import type { ActionProposalPayload } from '../../../shared/interfaces/ws-events';

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
    proposals: [],
    liveMessageIds: new Set<string>(),
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

describe('chatReducer — SESSION_INIT', () => {
  const welcome: ChatMessage = {
    id: 'welcome-1',
    sessionId: 'sess',
    sender: 'agent',
    content: "Hello! I'm Valentin, your romantic concierge.",
    timestamp: '2026-08-21T10:00:00.000Z',
  };

  /** The same state with an explicit session id, since SESSION_INIT now reads it. */
  function stateFor(
    sessionId: string | null,
    messages: ChatMessage[] = [],
  ): ChatState {
    return { ...makeState(messages, ''), sessionId };
  }

  it('adds the welcome message to an empty transcript', () => {
    const next = chatReducer(stateFor(null), {
      type: 'SESSION_INIT',
      sessionId: 'sess-1',
      welcomeMessage: welcome,
    });

    expect(next.sessionId).toBe('sess-1');
    expect(next.messages).toEqual([welcome]);
  });

  it('greets the session the app is already on', () => {
    const next = chatReducer(stateFor('sess-1'), {
      type: 'SESSION_INIT',
      sessionId: 'sess-1',
      welcomeMessage: welcome,
    });

    expect(next.messages).toEqual([welcome]);
  });

  /**
   * REGRESSION GUARD. The server greets on every connect, so a reconnect or a
   * reload re-delivers `session_init`. Appending unconditionally re-greeted a
   * restored conversation and — because transcripts are now persisted — saved
   * the duplicate, so the greeting accumulated on every reload.
   */
  it('does not re-append the welcome message to a restored transcript', () => {
    const restored: ChatMessage[] = [
      {
        id: 'msg-1',
        sessionId: 'sess',
        sender: 'user',
        content: 'Alice loves jazz',
        timestamp: '2026-08-21T10:01:00.000Z',
      },
    ];

    let state = stateFor('sess-1', restored);
    // Three reconnects in a row.
    for (let i = 0; i < 3; i += 1) {
      state = chatReducer(state, {
        type: 'SESSION_INIT',
        sessionId: 'sess-1',
        welcomeMessage: welcome,
      });
    }

    expect(state.messages).toEqual(restored);
    expect(state.messages.filter((m) => m.id === 'welcome-1')).toHaveLength(0);
  });

  const restored: ChatMessage[] = [
    {
      id: 'msg-1',
      sessionId: 'sess',
      sender: 'user',
      content: 'hi',
      timestamp: '2026-08-21T10:01:00.000Z',
    },
  ];

  it('adopts the server session id when the app has none, transcript or not', () => {
    const next = chatReducer(stateFor(null, restored), {
      type: 'SESSION_INIT',
      sessionId: 'server-session-9',
      welcomeMessage: welcome,
    });

    expect(next.sessionId).toBe('server-session-9');
    expect(next.messages).toEqual(restored);
  });

  /**
   * REGRESSION GUARD, and half of the "one conversation on sign-in" fix.
   *
   * A switch reconnects, so a `session_init` for the conversation just left can
   * still be in flight when the new one is on screen. This reducer used to adopt
   * it unconditionally, which dragged the socket, the persistence owner and the
   * sidebar's active row back onto the old session — and dropped a greeting into
   * a transcript that had nothing to do with it. Remove the guard and a rapid
   * switch starts landing messages in the wrong conversation.
   */
  it('ignores a greeting addressed to a conversation the app has left', () => {
    const state = stateFor('sess-current', restored);

    const next = chatReducer(state, {
      type: 'SESSION_INIT',
      sessionId: 'sess-previous',
      welcomeMessage: welcome,
    });

    expect(next).toBe(state);
  });
});

describe('chatReducer — proposals', () => {
  const proposal: ActionProposalPayload = {
    sessionId: 'sess-1',
    proposalId: 'p1',
    service: 'ontopo',
    title: 'Table for two',
    summary: 'Saturday at 20:00',
    expiresAt: '2026-09-05T18:15:00.000Z',
  };

  function stateOn(sessionId: string | null): ChatState {
    return { ...makeState([], ''), sessionId };
  }

  it('holds a proposal open when it arrives', () => {
    const next = chatReducer(stateOn('sess-1'), { type: 'RECEIVE_PROPOSAL', proposal });

    expect(next.proposals).toEqual([{ proposal, status: 'open' }]);
  });

  it('drops a proposal addressed to another conversation', () => {
    const state = stateOn('sess-other');
    // Same hazard as SESSION_INIT: a reply can be in flight when the app has
    // already moved on, and a card offering to book a table belongs to the
    // conversation that asked for it.
    expect(chatReducer(state, { type: 'RECEIVE_PROPOSAL', proposal })).toBe(state);
  });

  it('is idempotent on proposalId', () => {
    const once = chatReducer(stateOn('sess-1'), { type: 'RECEIVE_PROPOSAL', proposal });
    const twice = chatReducer(once, { type: 'RECEIVE_PROPOSAL', proposal });

    // Two identical Confirm buttons means the second click is the one that fails.
    expect(twice).toBe(once);
  });

  it('records a confirmation without removing the card', () => {
    const open = chatReducer(stateOn('sess-1'), { type: 'RECEIVE_PROPOSAL', proposal });
    const next = chatReducer(open, {
      type: 'RESOLVE_PROPOSAL',
      proposalId: 'p1',
      status: 'confirmed',
    });

    // Kept, not deleted: this is the only record in the transcript that a table
    // was actually booked.
    expect(next.proposals).toEqual([{ proposal, status: 'confirmed' }]);
  });

  it('leaves other proposals alone when one is resolved', () => {
    const second = { ...proposal, proposalId: 'p2' };
    let state = chatReducer(stateOn('sess-1'), { type: 'RECEIVE_PROPOSAL', proposal });
    state = chatReducer(state, { type: 'RECEIVE_PROPOSAL', proposal: second });
    state = chatReducer(state, {
      type: 'RESOLVE_PROPOSAL',
      proposalId: 'p2',
      status: 'dismissed',
    });

    expect(state.proposals.map((entry) => entry.status)).toEqual(['open', 'dismissed']);
  });

  it('clears proposals on a session switch', () => {
    const open = chatReducer(stateOn('sess-1'), { type: 'RECEIVE_PROPOSAL', proposal });
    const next = chatReducer(open, {
      type: 'SWITCH_SESSION',
      sessionId: 'sess-2',
      messages: [],
    });

    // The server holds proposals in memory and lets them lapse, so there is
    // nothing to come back to — a leftover card would offer to act on a proposal
    // the orchestrator has already forgotten.
    expect(next.proposals).toEqual([]);
  });
});

/**
 * THE USER'S REPRO: "the gradual typing of last message when enter to it … (the
 * behavior is good as reaction to you send something)".
 *
 * The typewriter reveal has no way of its own to tell a reply that just arrived
 * from one that was loaded a moment ago — the two `ChatMessage`s are identical.
 * It used to guess from the timestamp, which is why entering a conversation
 * shortly after the last reply re-typed it and entering an hour later did not.
 * The reducer is the only place that knows, so it records it.
 */
describe('chatReducer — which messages arrived live', () => {
  const agentReply: ChatMessage = {
    id: 'reply-1',
    sessionId: 'sess',
    sender: 'agent',
    content: 'A reply the socket just delivered.',
    timestamp: new Date().toISOString(),
  };

  it('marks a received message as live', () => {
    const next = chatReducer(makeState([], ''), {
      type: 'RECEIVE_MESSAGE',
      message: agentReply,
    });

    expect(next.liveMessageIds.has('reply-1')).toBe(true);
  });

  it('treats a hydrated transcript as not live, however new its last reply is', () => {
    // Exactly the entry case: the reply is seconds old and it still must not
    // re-type itself, because the user is opening the conversation rather than
    // watching it happen.
    const next = chatReducer(makeState([], ''), {
      type: 'SWITCH_SESSION',
      sessionId: 'sess-2',
      messages: [agentReply],
    });

    expect(next.messages).toEqual([agentReply]);
    expect(next.liveMessageIds.size).toBe(0);
  });

  it("drops the previous conversation's live ids on a switch", () => {
    const afterLive = chatReducer(makeState([], ''), {
      type: 'RECEIVE_MESSAGE',
      message: agentReply,
    });

    // Leaving and coming back: the same message is history now, so the id must
    // not survive — carrying it across is what replayed the reveal on return.
    const switched = chatReducer(afterLive, {
      type: 'SWITCH_SESSION',
      sessionId: 'sess-3',
      messages: [agentReply],
    });

    expect(switched.liveMessageIds.has('reply-1')).toBe(false);
  });

  it('counts a greeting it actually appends as live', () => {
    const next = chatReducer(makeState([], ''), {
      type: 'SESSION_INIT',
      sessionId: 'test-session',
      welcomeMessage: { ...agentReply, id: 'welcome-9' },
    });

    // A brand-new conversation's greeting is being said now, so revealing it is
    // the reaction-to-something behaviour the user asked to keep.
    expect(next.liveMessageIds.has('welcome-9')).toBe(true);
  });

  it('does not mark a greeting it declines to append', () => {
    const existing: ChatMessage = { ...agentReply, id: 'stored-1' };

    const next = chatReducer(makeState([existing], ''), {
      type: 'SESSION_INIT',
      sessionId: 'test-session',
      welcomeMessage: { ...agentReply, id: 'welcome-9' },
    });

    expect(next.messages).toEqual([existing]);
    expect(next.liveMessageIds.has('welcome-9')).toBe(false);
  });
});
