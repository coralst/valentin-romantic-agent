import { describe, it, expect } from 'vitest';
import { buildNotedIndex } from '../noted-index';
import { DEMO_SEED_SOURCE_MESSAGE_ID } from '../provenance';
import type { PreferenceCategory, PreferenceWithHistory } from '../../../shared/interfaces/preference';

function preference(overrides: Partial<PreferenceWithHistory> = {}): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'session-1',
    category: 'gifts',
    key: 'flowers',
    value: 'peonies',
    confidence: 0.9,
    sourceMessageId: 'msg-1',
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    history: [],
    ...overrides,
  };
}

/** The store's shape, without having to spell out all eight categories. */
function grouped(
  lists: Partial<Record<PreferenceCategory, PreferenceWithHistory[]>>,
): Partial<Record<PreferenceCategory, PreferenceWithHistory[]>> {
  return lists;
}

describe('buildNotedIndex', () => {
  it('files each value under the message that produced it', () => {
    const index = buildNotedIndex(
      grouped({
        gifts: [preference()],
        food: [preference({ id: 'pref-2', category: 'food', value: 'ramen', sourceMessageId: 'msg-2' })],
      }),
    );

    expect(index.get('msg-1')).toEqual(['peonies']);
    expect(index.get('msg-2')).toEqual(['ramen']);
  });

  it('puts two facts from one sentence on one line', () => {
    // A single sentence routinely teaches Valentin two unrelated things, and the
    // store is right to hold them separately — but two badges under one bubble is
    // the stacked-card bug again.
    const index = buildNotedIndex(
      grouped({
        gifts: [preference()],
        food: [preference({ id: 'pref-2', category: 'food', value: 'ramen' })],
      }),
    );

    expect(index.get('msg-1')).toEqual(['peonies', 'ramen']);
  });

  it('does not repeat a value that arrived twice', () => {
    const index = buildNotedIndex(
      grouped({ gifts: [preference(), preference({ id: 'pref-2' })] }),
    );

    expect(index.get('msg-1')).toEqual(['peonies']);
  });

  it('skips seeded demo rows, which no one ever said', () => {
    const index = buildNotedIndex(
      grouped({
        gifts: [preference({ sourceMessageId: DEMO_SEED_SOURCE_MESSAGE_ID })],
      }),
    );

    // A badge here would assert that a conversation happened. The demo profile is
    // furniture, not testimony.
    expect(index.size).toBe(0);
  });

  it('skips rows with no source message at all', () => {
    const index = buildNotedIndex(grouped({ gifts: [preference({ sourceMessageId: '' })] }));

    expect(index.size).toBe(0);
  });

  it('says nothing about ids the transcript does not hold', () => {
    // Preferences written before the client id was adopted point at a server id
    // that matches no rendered message. No badge is the honest outcome.
    const index = buildNotedIndex(grouped({ gifts: [preference({ sourceMessageId: 'server-side-only' })] }));

    expect(index.get('msg-1')).toBeUndefined();
    expect(index.get('server-side-only')).toEqual(['peonies']);
  });

  it('handles an empty store', () => {
    expect(buildNotedIndex(grouped({})).size).toBe(0);
    expect(buildNotedIndex(grouped({ gifts: [] })).size).toBe(0);
  });
});
