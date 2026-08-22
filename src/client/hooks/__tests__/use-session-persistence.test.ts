import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useSessionPersistence,
  derivePartnerName,
  flattenPreferences,
  PERSIST_DEBOUNCE_MS,
} from '../use-session-persistence';
import type { ChatMessage } from '../../../shared/interfaces/message';
import type {
  PreferenceCategory,
  PreferenceWithHistory,
} from '../../../shared/interfaces/preference';
import { PREFERENCE_CATEGORIES } from '../../../shared/constants/categories';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 'sess-a',
    sender: 'user',
    content: 'Hello',
    timestamp: '2026-08-21T10:00:00.000Z',
    ...overrides,
  };
}

function makePreference(overrides: Partial<PreferenceWithHistory> = {}): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'sess-a',
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

/** Build the category-keyed record the preferences reducer holds. */
function grouped(
  preferences: PreferenceWithHistory[],
): Record<PreferenceCategory, PreferenceWithHistory[]> {
  const record = {} as Record<PreferenceCategory, PreferenceWithHistory[]>;
  for (const category of PREFERENCE_CATEGORIES) record[category] = [];
  for (const preference of preferences) record[preference.category].push(preference);
  return record;
}

/**
 * Drives the hook the way `SessionSyncer` does: props change as the live
 * transcript changes, and `setOwner`/`flush` are called around a switch.
 */
function renderPersistence(initialMessages: ChatMessage[] = []) {
  const writes: Array<{
    id: string;
    messages: ChatMessage[];
    preferences: PreferenceWithHistory[];
    partnerName?: string | null;
  }> = [];

  const persistSession = vi.fn(
    (
      id: string,
      messages: ChatMessage[],
      preferences: PreferenceWithHistory[],
      partnerName?: string | null,
    ) => {
      writes.push({ id, messages, preferences, partnerName });
    },
  );

  const view = renderHook(
    ({
      messages,
      preferences,
    }: {
      messages: ChatMessage[];
      preferences: Record<PreferenceCategory, PreferenceWithHistory[]>;
    }) => useSessionPersistence({ messages, preferences, persistSession }),
    { initialProps: { messages: initialMessages, preferences: grouped([]) } },
  );

  return { ...view, writes, persistSession };
}

describe('use-session-persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('flattenPreferences', () => {
    it('flattens every category into a single array', () => {
      const food = makePreference({ id: 'p-1', category: 'food' });
      const music = makePreference({ id: 'p-2', category: 'music' });

      expect(flattenPreferences(grouped([food, music]))).toEqual([food, music]);
    });

    it('returns an empty array for an empty record', () => {
      expect(flattenPreferences(grouped([]))).toEqual([]);
    });
  });

  describe('derivePartnerName', () => {
    it('derives the name from a preference mapping to partner_name', () => {
      const name = makePreference({
        category: 'personality_traits',
        key: 'name',
        value: 'Alice',
      });

      expect(derivePartnerName([name])).toBe('Alice');
    });

    it('returns undefined when no preference maps to partner_name', () => {
      // undefined, not null — UPDATE_SESSION reads undefined as "leave as is",
      // so a name found earlier is not erased by a later turn.
      expect(derivePartnerName([makePreference()])).toBeUndefined();
    });

    it('prefers the most recent partner_name preference', () => {
      const first = makePreference({
        id: 'p-1',
        category: 'personality_traits',
        key: 'name',
        value: 'Alice',
      });
      const second = makePreference({
        id: 'p-2',
        category: 'personality_traits',
        key: 'name',
        value: 'Beatrice',
      });

      expect(derivePartnerName([first, second])).toBe('Beatrice');
    });

    it('ignores a blank partner_name value', () => {
      const blank = makePreference({
        category: 'personality_traits',
        key: 'name',
        value: '   ',
      });

      expect(derivePartnerName([blank])).toBeUndefined();
    });
  });

  describe('debounced writes', () => {
    it('does not write before the debounce elapses', () => {
      const view = renderPersistence();
      act(() => view.result.current.setOwner('sess-a'));

      act(() => {
        view.rerender({ messages: [makeMessage()], preferences: grouped([]) });
      });
      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 1);
      });

      expect(view.persistSession).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(view.persistSession).toHaveBeenCalledTimes(1);
      expect(view.writes[0].id).toBe('sess-a');
    });

    it('coalesces a burst of changes into a single write', () => {
      const view = renderPersistence();
      act(() => view.result.current.setOwner('sess-a'));

      // A reply plus the preference updates that accompany it.
      act(() => {
        view.rerender({ messages: [makeMessage()], preferences: grouped([]) });
      });
      act(() => {
        view.rerender({
          messages: [makeMessage()],
          preferences: grouped([makePreference({ id: 'p-1' })]),
        });
      });
      act(() => {
        view.rerender({
          messages: [makeMessage()],
          preferences: grouped([
            makePreference({ id: 'p-1' }),
            makePreference({ id: 'p-2', category: 'music' }),
          ]),
        });
      });

      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      });

      expect(view.persistSession).toHaveBeenCalledTimes(1);
      expect(view.writes[0].preferences).toHaveLength(2);
    });

    it('never writes without an owner id', () => {
      const view = renderPersistence();

      act(() => {
        view.rerender({ messages: [makeMessage()], preferences: grouped([]) });
      });
      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      });

      expect(view.persistSession).not.toHaveBeenCalled();
    });

    it('does not write an empty transcript over a stored one', () => {
      const view = renderPersistence();
      act(() => view.result.current.setOwner('sess-a'));

      // The state right after a switch, before the incoming messages land.
      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      });

      expect(view.persistSession).not.toHaveBeenCalled();
    });

    it('carries the derived partner name into the write', () => {
      const view = renderPersistence();
      act(() => view.result.current.setOwner('sess-a'));

      act(() => {
        view.rerender({
          messages: [makeMessage()],
          preferences: grouped([
            makePreference({ category: 'personality_traits', key: 'name', value: 'Alice' }),
          ]),
        });
      });
      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      });

      expect(view.writes[0].partnerName).toBe('Alice');
    });
  });

  describe('flush', () => {
    it('writes immediately and cancels the pending debounce', () => {
      const view = renderPersistence();
      act(() => view.result.current.setOwner('sess-a'));

      act(() => {
        view.rerender({ messages: [makeMessage()], preferences: grouped([]) });
      });
      act(() => view.result.current.flush());

      expect(view.persistSession).toHaveBeenCalledTimes(1);

      // The cancelled timer must not produce a second write.
      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS * 2);
      });

      expect(view.persistSession).toHaveBeenCalledTimes(1);
    });

    it('flushes the transcript on unmount', () => {
      const view = renderPersistence();
      act(() => view.result.current.setOwner('sess-a'));

      act(() => {
        view.rerender({ messages: [makeMessage()], preferences: grouped([]) });
      });
      act(() => view.unmount());

      expect(view.persistSession).toHaveBeenCalled();
      expect(view.writes[view.writes.length - 1].id).toBe('sess-a');
    });

    it('flushes on pagehide so a reload does not lose the last reply', () => {
      const view = renderPersistence();
      act(() => view.result.current.setOwner('sess-a'));

      act(() => {
        view.rerender({ messages: [makeMessage()], preferences: grouped([]) });
      });
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });

      expect(view.persistSession).toHaveBeenCalledTimes(1);
      expect(view.writes[0].id).toBe('sess-a');
    });
  });

  describe('switch race', () => {
    /**
     * The corruption case. A write queued while session A was on screen must
     * land on A even though B is now active — writing A's messages to B would
     * turn a data-loss bug into a data-corruption bug.
     */
    it('addresses a late write to the session the messages belong to', () => {
      const messagesA = [makeMessage({ id: 'a-1', content: 'from A' })];
      const view = renderPersistence();
      act(() => view.result.current.setOwner('sess-a'));

      act(() => {
        view.rerender({ messages: messagesA, preferences: grouped([]) });
      });

      // Switch to B without letting A's debounce fire: flush A, retag, then the
      // new transcript arrives — exactly the order SessionSyncer uses.
      act(() => {
        view.result.current.flush();
        view.result.current.setOwner('sess-b');
      });
      act(() => {
        view.rerender({
          messages: [makeMessage({ id: 'b-1', sessionId: 'sess-b', content: 'from B' })],
          preferences: grouped([]),
        });
      });
      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      });

      const writesForA = view.writes.filter((w) => w.id === 'sess-a');
      const writesForB = view.writes.filter((w) => w.id === 'sess-b');

      // A kept its own transcript...
      expect(writesForA).toHaveLength(1);
      expect(writesForA[0].messages).toEqual(messagesA);

      // ...and B was never written A's messages.
      for (const write of writesForB) {
        expect(write.messages.map((m) => m.content)).not.toContain('from A');
      }
    });

    it('does not write the outgoing transcript to the incoming session', () => {
      const view = renderPersistence();
      act(() => view.result.current.setOwner('sess-a'));

      act(() => {
        view.rerender({
          messages: [makeMessage({ id: 'a-1', content: 'from A' })],
          preferences: grouped([]),
        });
      });

      // The pathological ordering: retag to B while chat state still holds A's
      // messages, then let the timer fire. Tagged writes make this land on B
      // only if the transcript really is B's — here we assert the guard by
      // flushing to A first, which is what SessionSyncer does.
      act(() => view.result.current.flush());
      const afterFlush = view.writes.length;
      act(() => view.result.current.setOwner('sess-b'));

      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS * 2);
      });

      // The flush already drained the pending write, so nothing new hit B.
      expect(view.writes.length).toBe(afterFlush);
      expect(view.writes.every((w) => w.id === 'sess-a')).toBe(true);
    });
  });
});
