import { describe, it, expect, afterEach, vi } from 'vitest';
import { logger, subscribeToServerLogs, resetServerLogSubscribers } from '../logging';

afterEach(() => {
  resetServerLogSubscribers();
  vi.restoreAllMocks();
});

/** Silence the console writes the logger makes so test output stays readable. */
function muteConsole() {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('subscribeToServerLogs', () => {
  it('delivers an info log with its event and data', () => {
    muteConsole();
    const seen: unknown[] = [];
    subscribeToServerLogs((record) => seen.push(record));

    logger.info('preference.saved', { sessionId: 'sess-1', category: 'music', key: 'genre' });

    expect(seen).toEqual([
      {
        level: 'info',
        event: 'preference.saved',
        data: { sessionId: 'sess-1', category: 'music', key: 'genre' },
      },
    ]);
  });

  it('delivers warn and error levels too', () => {
    muteConsole();
    const levels: string[] = [];
    subscribeToServerLogs((record) => levels.push(record.level));

    logger.info('a');
    logger.warn('b');
    logger.error('c');

    expect(levels).toEqual(['info', 'warn', 'error']);
  });

  it('still writes to the console when nobody is subscribed', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.info('unobserved');

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('unobserved');
  });

  it('fans out to every subscriber', () => {
    muteConsole();
    const first: string[] = [];
    const second: string[] = [];
    subscribeToServerLogs((r) => first.push(r.event));
    subscribeToServerLogs((r) => second.push(r.event));

    logger.info('bedrock.converse');

    expect(first).toEqual(['bedrock.converse']);
    expect(second).toEqual(['bedrock.converse']);
  });

  it('does not let a throwing subscriber break the caller', () => {
    muteConsole();
    subscribeToServerLogs(() => {
      throw new Error('telemetry exploded');
    });

    expect(() => logger.info('still.fine')).not.toThrow();
  });

  it('still reaches the other subscribers when one throws', () => {
    muteConsole();
    const survived: string[] = [];
    subscribeToServerLogs(() => {
      throw new Error('first one dies');
    });
    subscribeToServerLogs((r) => survived.push(r.event));

    logger.info('dynamodb.put');

    expect(survived).toEqual(['dynamodb.put']);
  });

  it('still writes to the console when a subscriber throws', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    subscribeToServerLogs(() => {
      throw new Error('boom');
    });

    logger.info('logged.anyway');

    expect(log).toHaveBeenCalledTimes(1);
  });

  it('stops delivering after unsubscribe', () => {
    muteConsole();
    const seen: string[] = [];
    const unsubscribe = subscribeToServerLogs((r) => seen.push(r.event));

    logger.info('before');
    unsubscribe();
    logger.info('after');

    expect(seen).toEqual(['before']);
  });

  it('unsubscribing twice is harmless', () => {
    muteConsole();
    const unsubscribe = subscribeToServerLogs(() => {});

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
    expect(() => logger.info('fine')).not.toThrow();
  });

  it('passes undefined data through rather than inventing an object', () => {
    muteConsole();
    const seen: Array<Record<string, unknown> | undefined> = [];
    subscribeToServerLogs((r) => seen.push(r.data));

    logger.info('no.data');

    expect(seen).toEqual([undefined]);
  });
});
