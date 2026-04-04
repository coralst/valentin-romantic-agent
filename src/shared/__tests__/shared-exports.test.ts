import { describe, it, expect } from 'vitest';
import {
  PREFERENCE_CATEGORIES,
  CATEGORY_LABELS,
} from '../index';
import type {
  ChatMessage,
  Sender,
  Preference,
  PreferenceCategory,
  PreferenceHistoryEntry,
  PreferenceWithHistory,
  SessionData,
  WsEnvelope,
  ClientEvent,
  ServerEvent,
} from '../index';

describe('shared barrel exports', () => {
  it('exports PREFERENCE_CATEGORIES with exactly 8 entries', () => {
    expect(PREFERENCE_CATEGORIES).toHaveLength(8);
  });

  it('PREFERENCE_CATEGORIES contains all expected categories', () => {
    const expected: PreferenceCategory[] = [
      'food',
      'hobbies',
      'music',
      'travel',
      'gifts',
      'love_language',
      'important_dates',
      'personality_traits',
    ];
    expect([...PREFERENCE_CATEGORIES]).toEqual(expected);
  });

  it('CATEGORY_LABELS has an entry for each category', () => {
    for (const category of PREFERENCE_CATEGORIES) {
      const meta = CATEGORY_LABELS[category];
      expect(meta).toBeDefined();
      expect(meta.label).toBeTruthy();
      expect(meta.description).toBeTruthy();
    }
  });

  it('all interfaces are importable from barrel', () => {
    // Type-level assertions — if this file compiles, the imports work.
    // We create conforming objects to prove the types resolve at runtime.
    const message: ChatMessage = {
      id: '1',
      sessionId: 's1',
      sender: 'user',
      content: 'hello',
      timestamp: new Date().toISOString(),
    };
    expect(message.sender).toBe('user');

    const sender: Sender = 'agent';
    expect(sender).toBe('agent');

    const pref: Preference = {
      id: '1',
      sessionId: 's1',
      category: 'food',
      key: 'cuisine',
      value: 'Italian',
      confidence: 0.9,
      sourceMessageId: 'm1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(pref.category).toBe('food');

    const entry: PreferenceHistoryEntry = {
      previousValue: 'French',
      changedAt: new Date().toISOString(),
      sourceMessageId: 'm2',
    };
    expect(entry.previousValue).toBe('French');

    const prefWithHistory: PreferenceWithHistory = {
      ...pref,
      history: [entry],
    };
    expect(prefWithHistory.history).toHaveLength(1);

    const session: SessionData = {
      id: 's1',
      createdAt: new Date().toISOString(),
      endedAt: null,
      messageCount: 0,
      preferenceCount: 0,
    };
    expect(session.endedAt).toBeNull();

    // WsEnvelope, ClientEvent, ServerEvent — type-only checks
    const envelope: WsEnvelope<'ping', Record<string, never>> = {
      type: 'ping',
      payload: {},
      timestamp: new Date().toISOString(),
    };
    expect(envelope.type).toBe('ping');

    const clientEvent: ClientEvent = {
      type: 'send_message',
      payload: { sessionId: 's1', content: 'hi' },
      timestamp: new Date().toISOString(),
    };
    expect(clientEvent.type).toBe('send_message');

    const serverEvent: ServerEvent = {
      type: 'pong',
      payload: {},
      timestamp: new Date().toISOString(),
    };
    expect(serverEvent.type).toBe('pong');
  });
});
