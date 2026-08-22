import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { SessionProvider, useSessionContext } from '../session-context';
import { ChatProvider, useChatContext } from '../chat-context';
import { PreferencesProvider, usePreferencesContext } from '../preferences-context';
import { SessionSyncer } from '../../App';
import { PERSIST_DEBOUNCE_MS } from '../../hooks/use-session-persistence';
import type { StoredSession } from '../../hooks/use-session-store';
import type { ChatMessage } from '../../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

/**
 * A stand-in for the server, holding the sessions across remounts.
 *
 * The sidebar's durable store is DynamoDB now, not localStorage, so the
 * round-trip these tests guard is `fetchSessions`/`fetchSessionDetail` rather
 * than a JSON blob in web storage. What is being tested is unchanged: the
 * SessionSyncer write path, and that a write queued while A was on screen is
 * never applied to B.
 *
 * `persistSession` still only dispatches into client state — the transcript
 * itself reaches DynamoDB over the socket, on the server side of the turn — so
 * the fake mirrors client writes into `remote` explicitly, the way a reload
 * would see them.
 */
const remote = new Map<string, StoredSession>();
let nextId = 0;

vi.mock('../../utils/session-api', () => ({
  fetchSessions: vi.fn(async () =>
    [...remote.values()].map((session) => ({ ...session, messages: [], preferences: [] })),
  ),
  fetchSessionDetail: vi.fn(async (id: string) => {
    const found = remote.get(id);
    if (!found) throw new Error(`no such session: ${id}`);
    return { ...found };
  }),
  createRemoteSession: vi.fn(async () => {
    const session: StoredSession = {
      id: `sess-${++nextId}`,
      title: null,
      partnerName: null,
      messages: [],
      preferences: [],
      lastActivity: '2026-08-21T10:00:00.000Z',
      messageCount: 0,
    };
    remote.set(session.id, session);
    return { ...session };
  }),
  deleteRemoteSession: vi.fn(async (id: string) => {
    remote.delete(id);
  }),
  renameRemoteSession: vi.fn(async (id: string, title: string) => {
    const found = remote.get(id);
    if (found) remote.set(id, { ...found, title });
  }),
  describeFailure: (error: unknown) => String(error),
}));

function makeMessage(content: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${content}`,
    sessionId: 'sess',
    sender: 'user',
    content,
    timestamp: '2026-08-21T10:00:00.000Z',
    ...overrides,
  };
}

function makePreference(overrides: Partial<PreferenceWithHistory> = {}): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'sess',
    category: 'food',
    key: 'cuisine',
    value: 'Italian',
    confidence: 0.9,
    sourceMessageId: 'msg-1',
    createdAt: '2026-08-21T10:00:00.000Z',
    updatedAt: '2026-08-21T10:00:00.000Z',
    history: [],
    ...overrides,
  };
}

/**
 * Mounts the real provider stack the app uses, with `SessionSyncer` in place, and
 * exposes the three stores plus helpers that mimic user actions.
 */
function renderApp() {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(SessionProvider, {
      children: React.createElement(ChatProvider, {
        children: React.createElement(PreferencesProvider, {
          children: React.createElement(SessionSyncer, { children }),
        }),
      }),
    });

  const view = renderHook(
    () => ({
      session: useSessionContext(),
      chat: useChatContext(),
      preferences: usePreferencesContext(),
    }),
    { wrapper },
  );

  /** Mirror client state back into the fake server, as a real turn would. */
  const mirror = (id: string) => {
    const stored = view.result.current.session.state.sessions.find((s) => s.id === id);
    if (stored) remote.set(id, { ...stored });
  };

  const helpers = {
    /** Let the mount load, or any awaited call, settle. */
    async flush() {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    /** Click "New conversation". Returns the new session id. */
    async newConversation(): Promise<string> {
      let id = '';
      await act(async () => {
        id = (await view.result.current.session.createSession()).id;
      });
      // Let SessionSyncer's switch effect run for the new session.
      act(() => {
        vi.advanceTimersByTime(0);
      });
      return id;
    },
    /** Type and send a message, as the chat surface does. */
    sendMessage(content: string) {
      act(() => {
        view.result.current.chat.dispatch({ type: 'SEND_MESSAGE', message: makeMessage(content) });
      });
    },
    /** An agent reply arriving over the socket. */
    receiveMessage(content: string) {
      act(() => {
        view.result.current.chat.dispatch({
          type: 'RECEIVE_MESSAGE',
          message: makeMessage(content, { sender: 'agent' }),
        });
      });
    },
    addPreference(preference: PreferenceWithHistory) {
      act(() => {
        view.result.current.preferences.dispatch({ type: 'ADD_PREFERENCE', preference });
      });
    },
    /** Click a session in the sidebar. */
    async switchTo(id: string) {
      // The transcript the server would hand back is whatever the client last
      // held for that session.
      mirror(id);
      await act(async () => {
        await view.result.current.session.switchSession(id);
      });
      act(() => {
        vi.advanceTimersByTime(0);
      });
    },
    /** Let the debounce fire. */
    settle() {
      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      });
    },
    storedSession(id: string) {
      return view.result.current.session.state.sessions.find((s) => s.id === id);
    },
    mirror,
  };

  return { ...view, ...helpers };
}

/** Mount, and wait for the on-mount session list to arrive. */
async function bootApp() {
  const view = renderApp();
  await view.flush();
  return view;
}

describe('session message persistence', () => {
  beforeEach(() => {
    remote.clear();
    nextId = 0;
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    remote.clear();
  });

  /**
   * THE USER'S REPRO. Before the write path existed, `activeSession.messages`
   * stayed `[]` forever, so switching back showed an empty transcript beside a
   * session row that still had its title and timestamp.
   */
  it('restores the transcript after switching away and back', async () => {
    const view = await bootApp();

    const a = await view.newConversation();
    view.sendMessage('Tell me about anniversary gifts');
    view.receiveMessage('Happily — what does she love?');
    view.settle();

    const b = await view.newConversation();
    expect(view.result.current.chat.state.messages).toEqual([]);

    await view.switchTo(a);

    const restored = view.result.current.chat.state.messages.map((m) => m.content);
    expect(restored).toEqual([
      'Tell me about anniversary gifts',
      'Happily — what does she love?',
    ]);
    expect(view.storedSession(a)?.messageCount).toBe(2);
    expect(b).not.toBe(a);
  });

  it('restores preferences alongside the transcript', async () => {
    const view = await bootApp();

    const a = await view.newConversation();
    view.sendMessage('She loves Italian food');
    view.addPreference(makePreference({ value: 'Italian' }));
    view.settle();

    const b = await view.newConversation();
    await view.switchTo(a);

    expect(view.result.current.preferences.state.preferences.food.map((p) => p.value)).toEqual([
      'Italian',
    ]);
    expect(view.storedSession(b)?.preferences).toEqual([]);
  });

  /**
   * THE A/B CROSS-CONTAMINATION GUARD.
   *
   * A write queued while A was on screen must not be applied to B. If the write
   * effect were addressed to "the active session" rather than to the session the
   * messages belong to, B would end up holding A's transcript.
   */
  it('does not pollute the incoming session with the outgoing transcript', async () => {
    const view = await bootApp();

    const a = await view.newConversation();
    view.sendMessage('message for A');
    view.receiveMessage('reply for A');
    // Deliberately do NOT settle — the write is still pending at switch time.

    const b = await view.newConversation();
    // Let every timer drain, including anything queued before the switch.
    view.settle();
    view.settle();

    // B was not polluted. Asserted FIRST and independently of A's own state:
    // a write misaddressed to the active session shows up here as B holding
    // A's transcript, which is the corruption case this test exists for.
    expect(view.storedSession(b)?.messages).toEqual([]);
    expect(view.storedSession(b)?.messageCount).toBe(0);
    expect(view.storedSession(b)?.preferences).toEqual([]);
    expect(view.result.current.chat.state.messages).toEqual([]);

    // A kept its own messages — the flush-before-switch half of the guard.
    expect(view.storedSession(a)?.messages.map((m) => m.content)).toEqual([
      'message for A',
      'reply for A',
    ]);

    // And switching back still shows A's transcript, not a merged one.
    await view.switchTo(a);
    expect(view.result.current.chat.state.messages).toHaveLength(2);
  });

  /**
   * The same guard on the preferences half of the record. Flushing *after* the
   * switch dispatch — rather than before it — writes A's preferences under B's
   * id, which is how this surfaced when the ordering was wrong.
   */
  it('does not pollute the incoming session with the outgoing preferences', async () => {
    const view = await bootApp();

    const a = await view.newConversation();
    view.sendMessage('She loves Italian food');
    view.addPreference(makePreference({ id: 'pref-a', value: 'Italian' }));
    // Pending write at switch time.

    const b = await view.newConversation();
    view.settle();
    view.settle();

    expect(view.storedSession(b)?.preferences).toEqual([]);
    expect(view.result.current.preferences.state.preferences.food).toEqual([]);
    expect(view.storedSession(a)?.preferences.map((p) => p.value)).toEqual(['Italian']);
  });

  it('keeps two conversations independent across repeated switches', async () => {
    const view = await bootApp();

    const a = await view.newConversation();
    view.sendMessage('A first');
    view.settle();

    const b = await view.newConversation();
    view.sendMessage('B first');
    view.settle();

    await view.switchTo(a);
    expect(view.result.current.chat.state.messages.map((m) => m.content)).toEqual(['A first']);
    view.sendMessage('A second');
    view.settle();

    await view.switchTo(b);
    expect(view.result.current.chat.state.messages.map((m) => m.content)).toEqual(['B first']);

    await view.switchTo(a);
    expect(view.result.current.chat.state.messages.map((m) => m.content)).toEqual([
      'A first',
      'A second',
    ]);
  });

  describe('reload persistence', () => {
    it('survives a server round-trip', async () => {
      const view = await bootApp();

      const a = await view.newConversation();
      view.sendMessage('remember this after reload');
      view.receiveMessage('I will');
      view.settle();

      // What a fresh page load would read back off the server.
      view.mirror(a);
      const reloaded = remote.get(a);

      expect(reloaded).toBeDefined();
      expect(reloaded?.messages.map((m) => m.content)).toEqual([
        'remember this after reload',
        'I will',
      ]);
      expect(reloaded?.messageCount).toBe(2);
    });

    it('remounting the app restores the stored transcript into chat state', async () => {
      const first = await bootApp();
      const a = await first.newConversation();
      first.sendMessage('persisted across mounts');
      first.settle();
      first.mirror(a);
      act(() => first.unmount());

      // A brand new provider tree, loading from the server on mount.
      const second = await bootApp();
      act(() => {
        vi.advanceTimersByTime(0);
      });

      expect(second.result.current.session.state.activeSessionId).toBe(a);
      expect(second.result.current.chat.state.messages.map((m) => m.content)).toEqual([
        'persisted across mounts',
      ]);
    });
  });

  describe('debounce boundary', () => {
    it('does not persist before the debounce elapses', async () => {
      const view = await bootApp();

      const a = await view.newConversation();
      view.sendMessage('not yet written');

      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 1);
      });
      expect(view.storedSession(a)?.messages).toEqual([]);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(view.storedSession(a)?.messages).toHaveLength(1);
    });

    it('flushes on switch even when the debounce has not fired', async () => {
      const view = await bootApp();

      const a = await view.newConversation();
      view.sendMessage('flushed by the switch');

      // Switch immediately — well inside the debounce window.
      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 1);
      });
      const b = await view.newConversation();

      expect(view.storedSession(a)?.messages.map((m) => m.content)).toEqual([
        'flushed by the switch',
      ]);
      expect(view.storedSession(b)?.messages).toEqual([]);
    });
  });

  describe('title and partnerName', () => {
    it('derives partnerName from a name preference without touching the title', async () => {
      const view = await bootApp();

      const a = await view.newConversation();
      view.sendMessage('Her name is Alice');
      view.addPreference(
        makePreference({ category: 'personality_traits', key: 'name', value: 'Alice' }),
      );
      view.settle();

      expect(view.storedSession(a)?.partnerName).toBe('Alice');
      // title stays null so the user-given name keeps precedence when set.
      expect(view.storedSession(a)?.title).toBeNull();
    });

    it('keeps a user-given title taking precedence over the derived partnerName', async () => {
      const view = await bootApp();

      const a = await view.newConversation();
      await act(async () => {
        await view.result.current.session.renameSession(a, 'Anniversary planning');
      });
      view.sendMessage('Her name is Alice');
      view.addPreference(
        makePreference({ category: 'personality_traits', key: 'name', value: 'Alice' }),
      );
      view.settle();

      const stored = view.storedSession(a);
      expect(stored?.title).toBe('Anniversary planning');
      expect(stored?.partnerName).toBe('Alice');
    });

    it('does not erase a known partnerName on a later turn without a name', async () => {
      const view = await bootApp();

      const a = await view.newConversation();
      view.addPreference(
        makePreference({ category: 'personality_traits', key: 'name', value: 'Alice' }),
      );
      view.settle();
      expect(view.storedSession(a)?.partnerName).toBe('Alice');

      view.sendMessage('What about flowers?');
      view.settle();

      expect(view.storedSession(a)?.partnerName).toBe('Alice');
    });
  });
});
