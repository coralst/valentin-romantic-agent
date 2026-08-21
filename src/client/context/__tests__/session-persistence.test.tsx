import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { SessionProvider, useSessionContext } from '../session-context';
import { ChatProvider, useChatContext } from '../chat-context';
import { PreferencesProvider, usePreferencesContext } from '../preferences-context';
import { SessionSyncer } from '../../App';
import { PERSIST_DEBOUNCE_MS } from '../../hooks/use-session-persistence';
import { loadSessions } from '../../hooks/use-session-store';
import type { ChatMessage } from '../../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

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

  const helpers = {
    /** Click "New conversation". Returns the new session id. */
    newConversation(): string {
      let id = '';
      act(() => {
        id = view.result.current.session.createSession().id;
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
    switchTo(id: string) {
      act(() => {
        view.result.current.session.switchSession(id);
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
  };

  return { ...view, ...helpers };
}

describe('session message persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  /**
   * THE USER'S REPRO. Before the write path existed, `activeSession.messages`
   * stayed `[]` forever, so switching back showed an empty transcript beside a
   * session row that still had its title and timestamp.
   */
  it('restores the transcript after switching away and back', () => {
    const view = renderApp();

    const a = view.newConversation();
    view.sendMessage('Tell me about anniversary gifts');
    view.receiveMessage('Happily — what does she love?');
    view.settle();

    const b = view.newConversation();
    expect(view.result.current.chat.state.messages).toEqual([]);

    view.switchTo(a);

    const restored = view.result.current.chat.state.messages.map((m) => m.content);
    expect(restored).toEqual([
      'Tell me about anniversary gifts',
      'Happily — what does she love?',
    ]);
    expect(view.storedSession(a)?.messageCount).toBe(2);
    expect(b).not.toBe(a);
  });

  it('restores preferences alongside the transcript', () => {
    const view = renderApp();

    const a = view.newConversation();
    view.sendMessage('She loves Italian food');
    view.addPreference(makePreference({ value: 'Italian' }));
    view.settle();

    const b = view.newConversation();
    view.switchTo(a);

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
  it('does not pollute the incoming session with the outgoing transcript', () => {
    const view = renderApp();

    const a = view.newConversation();
    view.sendMessage('message for A');
    view.receiveMessage('reply for A');
    // Deliberately do NOT settle — the write is still pending at switch time.

    const b = view.newConversation();
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
    view.switchTo(a);
    expect(view.result.current.chat.state.messages).toHaveLength(2);
  });

  /**
   * The same guard on the preferences half of the record. Flushing *after* the
   * switch dispatch — rather than before it — writes A's preferences under B's
   * id, which is how this surfaced when the ordering was wrong.
   */
  it('does not pollute the incoming session with the outgoing preferences', () => {
    const view = renderApp();

    const a = view.newConversation();
    view.sendMessage('She loves Italian food');
    view.addPreference(makePreference({ id: 'pref-a', value: 'Italian' }));
    // Pending write at switch time.

    const b = view.newConversation();
    view.settle();
    view.settle();

    expect(view.storedSession(b)?.preferences).toEqual([]);
    expect(view.result.current.preferences.state.preferences.food).toEqual([]);
    expect(view.storedSession(a)?.preferences.map((p) => p.value)).toEqual(['Italian']);
  });

  it('keeps two conversations independent across repeated switches', () => {
    const view = renderApp();

    const a = view.newConversation();
    view.sendMessage('A first');
    view.settle();

    const b = view.newConversation();
    view.sendMessage('B first');
    view.settle();

    view.switchTo(a);
    expect(view.result.current.chat.state.messages.map((m) => m.content)).toEqual(['A first']);
    view.sendMessage('A second');
    view.settle();

    view.switchTo(b);
    expect(view.result.current.chat.state.messages.map((m) => m.content)).toEqual(['B first']);

    view.switchTo(a);
    expect(view.result.current.chat.state.messages.map((m) => m.content)).toEqual([
      'A first',
      'A second',
    ]);
  });

  describe('reload persistence', () => {
    it('survives a loadSessions round-trip', () => {
      const view = renderApp();

      const a = view.newConversation();
      view.sendMessage('remember this after reload');
      view.receiveMessage('I will');
      view.settle();

      // What a fresh page load would read back off localStorage.
      const reloaded = loadSessions().find((s) => s.id === a);

      expect(reloaded).toBeDefined();
      expect(reloaded?.messages.map((m) => m.content)).toEqual([
        'remember this after reload',
        'I will',
      ]);
      expect(reloaded?.messageCount).toBe(2);
    });

    it('remounting the app restores the stored transcript into chat state', () => {
      const first = renderApp();
      const a = first.newConversation();
      first.sendMessage('persisted across mounts');
      first.settle();
      act(() => first.unmount());

      // A brand new provider tree, loading from localStorage on mount.
      const second = renderApp();
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
    it('does not persist before the debounce elapses', () => {
      const view = renderApp();

      const a = view.newConversation();
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

    it('flushes on switch even when the debounce has not fired', () => {
      const view = renderApp();

      const a = view.newConversation();
      view.sendMessage('flushed by the switch');

      // Switch immediately — well inside the debounce window.
      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 1);
      });
      const b = view.newConversation();

      expect(view.storedSession(a)?.messages.map((m) => m.content)).toEqual([
        'flushed by the switch',
      ]);
      expect(view.storedSession(b)?.messages).toEqual([]);
    });
  });

  describe('title and partnerName', () => {
    it('derives partnerName from a name preference without touching the title', () => {
      const view = renderApp();

      const a = view.newConversation();
      view.sendMessage('Her name is Alice');
      view.addPreference(
        makePreference({ category: 'personality_traits', key: 'name', value: 'Alice' }),
      );
      view.settle();

      expect(view.storedSession(a)?.partnerName).toBe('Alice');
      // title stays null so the user-given name keeps precedence when set.
      expect(view.storedSession(a)?.title).toBeNull();
    });

    it('keeps a user-given title taking precedence over the derived partnerName', () => {
      const view = renderApp();

      const a = view.newConversation();
      act(() => {
        view.result.current.session.renameSession(a, 'Anniversary planning');
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

    it('does not erase a known partnerName on a later turn without a name', () => {
      const view = renderApp();

      const a = view.newConversation();
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
