import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStore, resolveStorageBackend } from '../create-store';
import { InMemoryStore } from '../in-memory-store';
import { DynamoDBStore } from '../dynamodb-store';
import { resetServerLogSubscribers, subscribeToServerLogs } from '../../logging';
import type { ServerLogRecord } from '../../logging';

/** Collect log records emitted during a call, so warnings can be asserted. */
function captureLogs(): { records: ServerLogRecord[]; stop: () => void } {
  const records: ServerLogRecord[] = [];
  const stop = subscribeToServerLogs((record) => records.push(record));
  return { records, stop };
}

describe('resolveStorageBackend', () => {
  afterEach(() => {
    resetServerLogSubscribers();
    vi.restoreAllMocks();
  });

  it('defaults to memory when unset', () => {
    expect(resolveStorageBackend(undefined)).toBe('memory');
  });

  /**
   * An unset var and an empty one arrive identically often enough — a shell
   * `STORAGE_BACKEND=` or a task definition with a blank value — that treating
   * empty as "unrecognised" would emit a spurious warning on every boot.
   */
  it('treats an empty string as unset, without warning', () => {
    const { records, stop } = captureLogs();
    expect(resolveStorageBackend('')).toBe('memory');
    stop();
    expect(records).toHaveLength(0);
  });

  it('accepts dynamodb', () => {
    expect(resolveStorageBackend('dynamodb')).toBe('dynamodb');
  });

  it('accepts an explicit memory', () => {
    expect(resolveStorageBackend('memory')).toBe('memory');
  });

  it('is forgiving about case and surrounding whitespace', () => {
    expect(resolveStorageBackend('  DynamoDB \n')).toBe('dynamodb');
  });

  /**
   * The important half of this: a typo must not throw (that takes the server
   * down over an env var) and must not pass silently (the failure mode is data
   * quietly evaporating on every restart, which looks like nothing at all).
   */
  it('falls back to memory on an unrecognised value, and says so', () => {
    const { records, stop } = captureLogs();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(resolveStorageBackend('dynamo')).toBe('memory');

    stop();
    const warning = records.find((r) => r.event === 'storage.backend.unrecognized');
    expect(warning).toBeDefined();
    expect(warning?.level).toBe('warn');
    expect(warning?.data).toMatchObject({ requested: 'dynamo', fallback: 'memory' });
  });

  it('reads process.env when given no argument', () => {
    vi.stubEnv('STORAGE_BACKEND', 'dynamodb');
    expect(resolveStorageBackend()).toBe('dynamodb');
  });
});

describe('createStore', () => {
  afterEach(() => {
    resetServerLogSubscribers();
    vi.restoreAllMocks();
  });

  it('builds an InMemoryStore for the memory backend', () => {
    expect(createStore('memory')).toBeInstanceOf(InMemoryStore);
  });

  it('builds a DynamoDBStore for the dynamodb backend', () => {
    expect(createStore('dynamodb')).toBeInstanceOf(DynamoDBStore);
  });

  /**
   * Which backend is live is invisible once the server is running — everything
   * downstream sees only `StorageInterface`. One log line at boot is the only
   * way to tell a durable deployment from an amnesiac one.
   */
  it('announces which backend it built', () => {
    const { records, stop } = captureLogs();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    createStore('dynamodb');

    stop();
    expect(records).toEqual([
      expect.objectContaining({
        event: 'storage.initialized',
        data: { backend: 'dynamodb' },
      }),
    ]);
  });

  /**
   * The default is what every existing test and every credential-less developer
   * relies on. If this ever flips, the whole suite starts reaching for AWS.
   */
  it('defaults to memory with no argument and no env var', () => {
    vi.stubEnv('STORAGE_BACKEND', '');
    expect(createStore()).toBeInstanceOf(InMemoryStore);
  });
});
