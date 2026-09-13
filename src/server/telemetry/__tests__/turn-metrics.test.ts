import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  withTurn,
  recordModelCall,
  recordSideWork,
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

  /*
   * The bug these cover, in the shape it shipped in: engine A answers, then launches
   * `extractor.extract()` without awaiting it — a second forced-tool Converse. The
   * tally was published the moment the reply returned, so the emitted line said
   * `modelCalls: 1` on the engine whose defining cost is that every turn makes two.
   */
  describe('side work the turn started but did not await', () => {
    it('counts a deferred model call', async () => {
      await withTurn({ sessionId: 's1' }, async () => {
        recordModelCall({ inputTokens: 100, outputTokens: 20 }); // the reply
        recordSideWork(
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            recordModelCall({ inputTokens: 80, outputTokens: 10 }); // extract-preferences
          })(),
        );
      });

      expect(turns()).toHaveLength(1);
      expect(turns()[0].data).toMatchObject({
        modelCalls: 2,
        inputTokens: 180,
        outputTokens: 30,
      });
    });

    it('does not charge the reply latency for waiting on it', async () => {
      await withTurn({ sessionId: 's1' }, async () => {
        recordModelCall();
        recordSideWork(new Promise((resolve) => setTimeout(resolve, 60)));
      });

      // The reply landed immediately; only the metrics line waited. A latency tile
      // that absorbed the extraction would trade an undercounted call for an
      // overcounted second, which is not an improvement.
      const latency = turns()[0].data?.replyLatencyMs as number;
      expect(latency).toBeLessThan(50);
    });

    it('still emits when side work rejects, and keeps the turn ok', async () => {
      await withTurn({ sessionId: 's1' }, async () => {
        recordModelCall();
        recordSideWork(Promise.reject(new Error('Memory is down')));
      });

      // The user got their reply; a failed profile update is not a failed turn.
      expect(turns()[0].data).toMatchObject({ modelCalls: 1, ok: true });
    });

    it('is a no-op outside a turn', () => {
      recordSideWork(Promise.resolve());
      expect(turns()).toHaveLength(0);
    });
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
