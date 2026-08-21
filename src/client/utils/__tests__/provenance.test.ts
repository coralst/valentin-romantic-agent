import { describe, it, expect } from 'vitest';
import { describeProvenance } from '../provenance';
import type { ChatMessage } from '../../../shared/interfaces/message';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'server-msg-1',
    sessionId: 'session-1',
    sender: 'user',
    content: 'She loves salsa dancing.',
    timestamp: '2026-08-11T18:30:00.000Z',
    ...overrides,
  };
}

describe('describeProvenance', () => {
  it('names the day of the message it was extracted from', () => {
    const result = describeProvenance(
      { sourceMessageId: 'server-msg-1', createdAt: '2026-08-19T00:00:00.000Z' },
      [message()],
    );
    expect(result?.kind).toBe('message');
    expect(result?.line).toBe('I picked this up from what you told me on 11 Aug.');
  });

  it('falls back to the extraction date when the id misses the transcript', () => {
    // The real failure mode: `sourceMessageId` holds the *server's* id while the
    // transcript renders the optimistic client uuid, so the lookup never hits.
    // Degrading to a true-but-vaguer date beats showing a wrong one.
    const result = describeProvenance(
      { sourceMessageId: 'server-msg-1', createdAt: '2026-08-19T09:00:00.000Z' },
      [message({ id: 'a-client-side-uuid' })],
    );
    expect(result?.kind).toBe('extraction');
    expect(result?.line).toBe('I noted this on 19 Aug from something you said.');
  });

  it('never claims a conversation happened for seeded demo rows', () => {
    const result = describeProvenance({
      sourceMessageId: 'demo-seed',
      createdAt: '2026-08-19T09:00:00.000Z',
    });
    expect(result?.kind).toBe('seed');
    expect(result?.line).toBe('From the demo profile, not from anything you told me.');
  });

  it('returns null rather than a line when nothing true can be said', () => {
    expect(describeProvenance({ sourceMessageId: '', createdAt: '' })).toBeNull();
  });

  it('ignores an unparseable timestamp instead of rendering Invalid Date', () => {
    const result = describeProvenance(
      { sourceMessageId: 'server-msg-1', createdAt: 'not-a-date' },
      [message({ timestamp: 'also-not-a-date' })],
    );
    expect(result).toBeNull();
  });
});
