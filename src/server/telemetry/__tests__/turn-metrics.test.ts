import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  withTurn,
  recordModelCall,
  recordStoreRead,
  isInTurn,
  resetProcessContext,
} from '../turn-metrics';
import { subscribeToServerLogs, resetServerLogSubscribers, type ServerLogRecord } from '../../logging';

describe('turn-metrics', () => {
  let records: ServerLogRecord[];

  beforeEach(() => {
    records = [];
    resetProcessContext();
    subscribeToServerLogs((record) => records.push(record));
    // The module logs through the real logger, which writes to the console. Silenced
    // so a passing suite is not buried in JSON.
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    resetServerLogSubscribers();
    vi.restoreAllMocks();
  });

  const turns = () => records.filter((r) => r.event === 'agent.turn');

  it('emits one agent.turn line per turn', async () => {
    await withTurn({ sessionId: 's1' }, async () => {
      recordModelCall({ inputTokens: 100, outputTokens: 20 });
    });

    expect(turns()).toHaveLength(1);
    expect(turns()[0].data).toMatchObject({
      sessionId: 's1',
      modelCalls: 1,
      inputTokens: 100,
      outputTokens: 20,
      ok: true,
    });
  });

  it('counts every model call and store read in the turn', async () => {
    await withTurn({ sessionId: 's1' }, async () => {
      recordModelCall({ inputTokens: 10, outputTokens: 1 });
      recordModelCall({ inputTokens: 5, outputTokens: 2 });
      recordStoreRead();
      recordStoreRead();
      recordStoreRead();
    });

    expect(turns()[0].data).toMatchObject({
      modelCalls: 2,
      storeReads: 3,
      inputTokens: 15,
      outputTokens: 3,
    });
  });

  it('omits token fields entirely when no call reported usage', async () => {
    await withTurn({ sessionId: 's1' }, async () => {
      recordModelCall();
    });

    const data = turns()[0].data ?? {};
    // `in`, not `=== undefined`: the distinction the panel relies on is between a key
    // that is absent (nobody counted) and one that is zero (counted, and free).
    expect('inputTokens' in data).toBe(false);
    expect('outputTokens' in data).toBe(false);
    expect(data).toMatchObject({ modelCalls: 1 });
  });

  it('still emits, marked not ok, when the turn throws', async () => {
    await expect(
      withTurn({ sessionId: 's1' }, async () => {
        recordModelCall();
        throw new Error('bedrock said no');
      }),
    ).rejects.toThrow('bedrock said no');

    expect(turns()).toHaveLength(1);
    expect(turns()[0].data).toMatchObject({ modelCalls: 1, ok: false });
  });

  it('does not let two concurrent turns cross-count', async () => {
    await Promise.all([
      withTurn({ sessionId: 'a' }, async () => {
        recordModelCall();
        // Yield, so the two turns genuinely interleave rather than running to
        // completion one after the other.
        await new Promise((resolve) => setTimeout(resolve, 5));
        recordStoreRead();
      }),
      withTurn({ sessionId: 'b' }, async () => {
        recordStoreRead();
        await new Promise((resolve) => setTimeout(resolve, 1));
        recordStoreRead();
      }),
    ]);

    const byName = new Map(turns().map((r) => [r.data?.sessionId, r.data]));
    expect(byName.get('a')).toMatchObject({ modelCalls: 1, storeReads: 1 });
    expect(byName.get('b')).toMatchObject({ modelCalls: 0, storeReads: 2 });
  });

  it('is a no-op outside a turn, so tests and boot-time reads emit nothing', () => {
    expect(isInTurn()).toBe(false);
    recordModelCall({ inputTokens: 999 });
    recordStoreRead();
    expect(turns()).toHaveLength(0);
  });

  it('records what the process resolved to, and lets a test override it', async () => {
    await withTurn({ sessionId: 's1', engine: 'agentcore', storeBackend: 'dynamodb' }, async () => {});

    expect(turns()[0].data).toMatchObject({ engine: 'agentcore', storeBackend: 'dynamodb' });
  });

  it('defaults to the process engine and backend, which locally is engine A on memory', async () => {
    await withTurn({ sessionId: 's1' }, async () => {});

    expect(turns()[0].data).toMatchObject({ engine: 'valentin', storeBackend: 'memory' });
  });
});
