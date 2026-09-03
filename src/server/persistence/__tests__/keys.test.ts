import { describe, it, expect } from 'vitest';
import {
  sessionPk,
  META_SK,
  MSG_PREFIX,
  PREF_PREFIX,
  msgSk,
  outingSk,
  prefSk,
  OUTING_PREFIX,
  userGsi1pk,
  sessionGsi1sk,
} from '../keys';

/**
 * These assert exact strings on purpose.
 *
 * The key format is a storage contract: once real conversations are written,
 * changing any of these silently orphans every existing item. A test that
 * asserts "starts with USER#" would let that through. So each case pins the
 * whole literal, and a diff here is a migration, not a refactor.
 */
describe('keys', () => {
  const USER = '9f8e7d6c-1234-4abc-8def-000000000001';
  const SESSION = 'aabbccdd-5678-4eff-9012-000000000002';

  describe('sessionPk', () => {
    it('places the user id ahead of the session id', () => {
      expect(sessionPk(USER, SESSION)).toBe(
        'USER#9f8e7d6c-1234-4abc-8def-000000000001#SESSION#aabbccdd-5678-4eff-9012-000000000002',
      );
    });

    // This is the isolation guarantee in its smallest form: two users naming the
    // same session id land in different partitions, so neither can read the
    // other's items even with no ownership check anywhere in the code.
    it('yields different partitions for the same session id under different users', () => {
      expect(sessionPk('user-a', SESSION)).not.toBe(sessionPk('user-b', SESSION));
    });

    it.each([
      ['empty user id', '', SESSION],
      ['empty session id', USER, ''],
    ])('rejects an %s', (_label, user, session) => {
      expect(() => sessionPk(user, session)).toThrow(/non-empty string/);
    });
  });

  describe('constants', () => {
    it('pins the metadata sort key and the two prefixes', () => {
      expect(META_SK).toBe('META');
      expect(MSG_PREFIX).toBe('MSG#');
      expect(PREF_PREFIX).toBe('PREF#');
    });
  });

  describe('msgSk', () => {
    it('puts the timestamp first so a Query reads back in order', () => {
      expect(msgSk('2026-08-21T10:00:00.000Z', 'msg-1')).toBe(
        'MSG#2026-08-21T10:00:00.000Z#msg-1',
      );
    });

    it('sorts lexicographically in chronological order', () => {
      const early = msgSk('2026-08-21T10:00:00.000Z', 'zzz');
      const late = msgSk('2026-08-21T10:00:01.000Z', 'aaa');
      // 'zzz' > 'aaa', so an id-first key would order these backwards.
      expect([late, early].sort()).toEqual([early, late]);
    });

    it('distinguishes two messages written in the same millisecond', () => {
      const ts = '2026-08-21T10:00:00.000Z';
      expect(msgSk(ts, 'msg-1')).not.toBe(msgSk(ts, 'msg-2'));
    });

    it('shares the prefix used to query a session’s messages', () => {
      expect(msgSk('2026-08-21T10:00:00.000Z', 'm').startsWith(MSG_PREFIX)).toBe(true);
    });
  });

  describe('prefSk', () => {
    it('keys a preference by its natural identity', () => {
      expect(prefSk('food', 'favourite_cuisine')).toBe('PREF#food#favourite_cuisine');
    });

    it('is stable, so re-saving the same preference overwrites rather than duplicates', () => {
      expect(prefSk('music', 'artist')).toBe(prefSk('music', 'artist'));
    });

    it('separates categories that share a key name', () => {
      expect(prefSk('food', 'favourite')).not.toBe(prefSk('music', 'favourite'));
    });

    // The key is model-derived text and may contain the delimiter. Category
    // comes first and is a closed union with no '#', so the boundary holds.
    it('tolerates a delimiter inside a model-derived key', () => {
      expect(prefSk('gifts', 'wants#soon')).toBe('PREF#gifts#wants#soon');
      expect(prefSk('gifts', 'wants#soon')).not.toBe(prefSk('gifts', 'wants'));
    });

    it('shares the prefix used to query a session’s preferences', () => {
      expect(prefSk('travel', 'destination').startsWith(PREF_PREFIX)).toBe(true);
    });

    it('rejects a key that would exceed the sort key byte limit', () => {
      expect(() => prefSk('food', 'x'.repeat(1100))).toThrow(/1024-byte sort key limit/);
    });

    it('measures the limit in bytes, not characters', () => {
      // Each emoji is 4 UTF-8 bytes, so 300 of them are 1200 bytes but only
      // 600 UTF-16 code units — a .length check would wave this through.
      expect(() => prefSk('food', '\u{1F600}'.repeat(300))).toThrow(/sort key limit/);
    });
  });

  describe('userGsi1pk', () => {
    it('is the sparse index partition holding one user’s sessions', () => {
      expect(userGsi1pk(USER)).toBe('USER#9f8e7d6c-1234-4abc-8def-000000000001');
    });

    // If the GSI partition equalled the table partition, listing sessions would
    // also sweep up every message and preference.
    it('differs from the table partition key', () => {
      expect(userGsi1pk(USER)).not.toBe(sessionPk(USER, SESSION));
    });
  });

  describe('sessionGsi1sk', () => {
    it('orders sessions by creation time', () => {
      expect(sessionGsi1sk('2026-08-21T10:00:00.000Z', SESSION)).toBe(
        'TS#2026-08-21T10:00:00.000Z#aabbccdd-5678-4eff-9012-000000000002',
      );
    });

    it('is derived only from immutable inputs', () => {
      // Called twice with the same createdAt it must not drift, or every message
      // would rewrite the GSI row.
      const a = sessionGsi1sk('2026-08-21T10:00:00.000Z', SESSION);
      const b = sessionGsi1sk('2026-08-21T10:00:00.000Z', SESSION);
      expect(a).toBe(b);
    });
  });
  describe('outingSk', () => {
    it('pins the literal', () => {
      expect(outingSk('out-1')).toBe('OUTING#out-1');
      expect(OUTING_PREFIX).toBe('OUTING#');
    });

    it('does not collide with a task carrying the same id', () => {
      // Both are keyed by a uuid in the same partition, so a shared prefix would
      // have one entity overwrite the other.
      expect(outingSk('shared-id').startsWith('TASK#')).toBe(false);
    });

    it('rejects an empty id', () => {
      expect(() => outingSk('')).toThrow(/non-empty string/);
    });
  });
});
