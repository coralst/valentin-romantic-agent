import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveStorageBackend } from '../create-store';
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

  /**
   * The default is what every existing test and every credential-less developer
   * relies on. If this ever flips, the whole suite starts reaching for AWS.
   */
  it('defaults to memory when the env var is blank', () => {
    vi.stubEnv('STORAGE_BACKEND', '');
    expect(resolveStorageBackend()).toBe('memory');
  });
});
