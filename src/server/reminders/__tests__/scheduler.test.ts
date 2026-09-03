import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Reminder } from '../../../shared/interfaces/reminder';
import type { ReminderIndexReader } from '../../persistence/storage-interface';
import { startReminderScheduler } from '../scheduler';
import { loggingSender, type ReminderSender } from '../sender';

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'birthday-2026-06-12',
    sessionId: 'session-1',
    userId: 'user-1',
    kind: 'birthday',
    occursOn: '2026-06-12',
    dueAt: '2026-06-05T06:00:00.000Z',
    leadDays: 7,
    occasion: 'birthday',
    channel: 'log',
    target: 'him@example.com',
    sentAt: null,
    attempts: 0,
    lastError: null,
    createdAt: '2026-01-01T08:00:00.000Z',
    ...overrides,
  };
}

/** A reader whose `dueBefore` can be made slow or made to throw. */
function countingReader(behaviour: {
  rows?: Reminder[];
  delayMs?: number;
  throws?: boolean;
}): ReminderIndexReader & { calls: number } {
  return {
    calls: 0,
    async dueBefore() {
      this.calls += 1;
      if (behaviour.throws) throw new Error('index unavailable');
      if (behaviour.delayMs) await new Promise((resolve) => setTimeout(resolve, behaviour.delayMs));
      return behaviour.rows ?? [];
    },
    async markSent() {
      return true;
    },
    async recordFailure() {},
  };
}

describe('startReminderScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sweeps once per interval', async () => {
    const reader = countingReader({});
    const scheduler = startReminderScheduler({
      reader,
      sender: loggingSender,
      intervalMs: 60_000,
      origin: 'https://valentin.example.com',
    });

    expect(reader.calls).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reader.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(reader.calls).toBe(3);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(reader.calls).toBe(3);
  });

  it('sends a due reminder through the sweep', async () => {
    const sent: string[] = [];
    const sender: ReminderSender = {
      channel: 'test',
      async send(to) {
        sent.push(to);
      },
    };
    const reader = countingReader({ rows: [reminder()] });
    const scheduler = startReminderScheduler({ reader, sender, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.stop();

    expect(sent).toEqual(['him@example.com']);
  });

  it('does not start a second sweep while one is in flight', async () => {
    // Three intervals elapse inside one sweep; only the first may have started.
    const reader = countingReader({ delayMs: 3_500 });
    const scheduler = startReminderScheduler({ reader, sender: loggingSender, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(reader.calls).toBe(1);

    // Once the slow sweep has finished the next tick is free to run again.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reader.calls).toBe(2);

    scheduler.stop();
  });

  it('swallows a failing sweep rather than rejecting into the timer', async () => {
    const reader = countingReader({ throws: true });
    const scheduler = startReminderScheduler({ reader, sender: loggingSender, intervalMs: 1_000 });

    // An escaped rejection here would kill the process under Node's default policy.
    await expect(vi.advanceTimersByTimeAsync(2_000)).resolves.not.toThrow();
    expect(reader.calls).toBe(2);

    scheduler.stop();
  });

  it('clears the in-flight flag after a failure, so it keeps sweeping', async () => {
    const reader = countingReader({ throws: true });
    const scheduler = startReminderScheduler({ reader, sender: loggingSender, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(reader.calls).toBe(5);

    scheduler.stop();
  });

  it('stop() is safe to call twice', async () => {
    const reader = countingReader({});
    const scheduler = startReminderScheduler({ reader, sender: loggingSender, intervalMs: 1_000 });

    scheduler.stop();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(reader.calls).toBe(0);
  });
});
