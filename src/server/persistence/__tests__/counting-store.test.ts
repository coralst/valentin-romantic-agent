import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { countingStore, READ_METHODS } from '../counting-store';
import { InMemoryStoreFactory } from '../in-memory-store';
import { withTurn, resetProcessContext } from '../../telemetry/turn-metrics';
import {
  subscribeToServerLogs,
  resetServerLogSubscribers,
  type ServerLogRecord,
} from '../../logging';

describe('countingStore', () => {
  let records: ServerLogRecord[];

  beforeEach(() => {
    records = [];
    resetProcessContext();
    subscribeToServerLogs((record) => records.push(record));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    resetServerLogSubscribers();
    vi.restoreAllMocks();
  });

  const store = () => countingStore(new InMemoryStoreFactory().forUser('u1'));
  const lastTurn = () => records.filter((r) => r.event === 'agent.turn').at(-1)?.data;

  /**
   * The guard that keeps the reads tile from silently zeroing.
   *
   * `READ_METHODS` is a list of strings, so a rename in `StorageInterface` would not
   * break compilation — the Proxy would simply stop matching and the panel would show
   * a confident `0`. Asserting the names exist on a real store turns that into a
   * failing test instead.
   */
  it('names only methods that exist on a real store', () => {
    const real = new InMemoryStoreFactory().forUser('u1') as unknown as Record<string, unknown>;

    for (const method of READ_METHODS) {
      expect(typeof real[method], `${method} is missing from StorageInterface`).toBe('function');
    }
  });

  it('counts reads against the turn in progress', async () => {
    const wrapped = store();
    const sessionId = await wrapped.createSession();

    await withTurn({ sessionId }, async () => {
      await wrapped.getMessagesBySession(sessionId);
      await wrapped.getPreferencesBySession(sessionId);
      await wrapped.listSessions();
    });

    expect(lastTurn()).toMatchObject({ storeReads: 3 });
  });

  it('does not count writes', async () => {
    const wrapped = store();
    const sessionId = await wrapped.createSession();

    await withTurn({ sessionId }, async () => {
      await wrapped.saveMessage({
        id: 'm1',
        sessionId,
        sender: 'user',
        content: 'hello',
        timestamp: new Date().toISOString(),
      });
    });

    expect(lastTurn()).toMatchObject({ storeReads: 0 });
  });

  it('delegates transparently — the wrapper returns what the store returns', async () => {
    const inner = new InMemoryStoreFactory().forUser('u1');
    const wrapped = countingStore(inner);

    const sessionId = await wrapped.createSession();
    await wrapped.saveMessage({
      id: 'm1',
      sessionId,
      sender: 'user',
      content: 'hello',
      timestamp: new Date().toISOString(),
    });

    // Read back through the *unwrapped* store: the Proxy must not have intercepted
    // the write, only observed the read.
    expect(await inner.getMessagesBySession(sessionId)).toHaveLength(1);
    expect(await wrapped.getMessagesBySession(sessionId)).toHaveLength(1);
  });

  it('is transparent outside a turn, so seeding and boot reads emit nothing', async () => {
    const wrapped = store();
    const sessionId = await wrapped.createSession();

    await wrapped.getMessagesBySession(sessionId);

    expect(records.filter((r) => r.event === 'agent.turn')).toHaveLength(0);
  });
});
