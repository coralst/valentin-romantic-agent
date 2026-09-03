import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mintShareToken, verifyShareToken } from '../share-token';
import { buildSharedConversation } from '../shared-conversation';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import { SHARE_TTL_DAYS } from '../../../shared/constants/share-link';
import { config } from '../../config';

/**
 * The signature is what makes the one authorisation exception in this codebase safe,
 * so the failure cases are the point of this file: a tampered payload, an expired
 * token and a token pointing at another user's session all have to fail closed.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const originalSecret = config.shareTokenSecret;

beforeAll(() => {
  // Pinned, so the tests do not depend on whether the per-process fallback has
  // already been minted by another file in the same worker.
  config.shareTokenSecret = 'test-share-secret';
});

afterAll(() => {
  config.shareTokenSecret = originalSecret;
});

function tamper(token: string, payload: object): string {
  const [, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${forged}.${signature}`;
}

describe('mintShareToken / verifyShareToken', () => {
  it('round-trips the owner and the session', () => {
    const { token } = mintShareToken('user-a', 'session-1');

    expect(verifyShareToken(token)).toMatchObject({
      userId: 'user-a',
      sessionId: 'session-1',
    });
  });

  it('reports an expiry SHARE_TTL_DAYS out, matching the shared contract', () => {
    const now = Date.parse('2026-03-01T12:00:00.000Z');

    const { expiresAt } = mintShareToken('user-a', 'session-1', now);

    expect(Date.parse(expiresAt)).toBe(now + SHARE_TTL_DAYS * DAY_MS);
  });

  it('is two base64url segments and not a JWT', () => {
    // Deliberately not a JWT: no `alg` header segment, so there is no algorithm to
    // be confused about.
    const { token } = mintShareToken('user-a', 'session-1');

    expect(token.split('.')).toHaveLength(2);
  });

  it('rejects a payload edited to name another session', () => {
    const { token } = mintShareToken('user-a', 'session-1');
    const exp = verifyShareToken(token)?.exp ?? 0;

    const forged = tamper(token, { userId: 'user-a', sessionId: 'session-2', exp });

    expect(verifyShareToken(forged)).toBeNull();
  });

  it('rejects a payload edited to name another user', () => {
    // The whole reason the owner id lives inside the signature.
    const { token } = mintShareToken('user-a', 'session-1');
    const exp = verifyShareToken(token)?.exp ?? 0;

    const forged = tamper(token, { userId: 'user-b', sessionId: 'session-1', exp });

    expect(verifyShareToken(forged)).toBeNull();
  });

  it('rejects a payload edited to extend its own expiry', () => {
    const { token } = mintShareToken('user-a', 'session-1');

    const forged = tamper(token, {
      userId: 'user-a',
      sessionId: 'session-1',
      exp: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60,
    });

    expect(verifyShareToken(forged)).toBeNull();
  });

  it('rejects a token past its expiry', () => {
    const now = Date.parse('2026-03-01T12:00:00.000Z');
    const { token } = mintShareToken('user-a', 'session-1', now);

    expect(verifyShareToken(token, now + (SHARE_TTL_DAYS - 1) * DAY_MS)).not.toBeNull();
    expect(verifyShareToken(token, now + (SHARE_TTL_DAYS + 1) * DAY_MS)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = mintShareToken('user-a', 'session-1');

    config.shareTokenSecret = 'a-different-secret';
    try {
      expect(verifyShareToken(token)).toBeNull();
    } finally {
      config.shareTokenSecret = 'test-share-secret';
    }
  });

  it('returns null rather than throwing on garbage', () => {
    // Called before any authentication, so a hostile string must never become a 500.
    for (const bad of ['', 'nonsense', 'a.b.c', 'a.', '.b', '!!!.???', 'a'.repeat(5000)]) {
      expect(verifyShareToken(bad)).toBeNull();
    }
    expect(verifyShareToken(undefined)).toBeNull();
  });

  it('rejects a truncated signature without throwing on the length mismatch', () => {
    // `timingSafeEqual` throws on differing lengths; the guard in front of it is why
    // this is a null rather than a stack trace.
    const { token } = mintShareToken('user-a', 'session-1');
    const [encoded, signature] = token.split('.');

    expect(verifyShareToken(`${encoded}.${signature.slice(0, -4)}`)).toBeNull();
  });
});

describe('a verified token resolves only its own owner', () => {
  it("reaches user A's session and misses an identical id under user B", async () => {
    const factory = new InMemoryStoreFactory();
    const alice = factory.forUser('alice');
    const bob = factory.forUser('bob');
    const aliceSession = await alice.createSession();
    const bobSession = await bob.createSession();

    const payload = verifyShareToken(mintShareToken('alice', aliceSession).token);
    expect(payload).not.toBeNull();

    // The read the guest route performs: the owner from the signed payload, then
    // that owner's own scoped store.
    const resolved = factory.forUser(payload?.userId ?? '');
    expect(await resolved.getSession(aliceSession)).not.toBeNull();
    // Bob's session id is a perfectly real id — it is simply not in this partition,
    // so the structural miss still does the authorising.
    expect(await resolved.getSession(bobSession)).toBeNull();
  });
});

describe('buildSharedConversation', () => {
  it('carries no dossier keys — the type is the allowlist', async () => {
    const store = new InMemoryStoreFactory().forUser('alice');
    const sessionId = await store.createSession();
    await store.updateSessionMeta(sessionId, { title: 'Her birthday', partnerName: 'Samantha' });
    await store.saveMessage({
      id: 'm1',
      sessionId,
      sender: 'user',
      content: 'She loves Italian',
      timestamp: new Date().toISOString(),
    });
    const session = await store.getSession(sessionId);

    const shared = buildSharedConversation(
      session!,
      await store.getMessagesBySession(sessionId),
      '2026-03-08T00:00:00.000Z',
    );

    expect(Object.keys(shared).sort()).toEqual(['expiresAt', 'messages', 'title']);
    expect(Object.keys(shared.messages[0]).sort()).toEqual(['content', 'role', 'timestamp']);
    // Not even the session id: a guest has no use for one, and publishing it would
    // only invite trying it against `/?s=`.
    expect(JSON.stringify(shared)).not.toContain(sessionId);
  });

  it("prefers the user's own title, then her name, then a neutral heading", async () => {
    const store = new InMemoryStoreFactory().forUser('alice');
    const sessionId = await store.createSession();
    const messages = await store.getMessagesBySession(sessionId);
    const expires = '2026-03-08T00:00:00.000Z';

    const bare = await store.getSession(sessionId);
    expect(buildSharedConversation(bare!, messages, expires).title).toBe(
      'A conversation with Valentin',
    );

    await store.updateSessionMeta(sessionId, { partnerName: 'Samantha' });
    const named = await store.getSession(sessionId);
    expect(buildSharedConversation(named!, messages, expires).title).toContain('Samantha');

    await store.updateSessionMeta(sessionId, { title: 'The 4th' });
    const titled = await store.getSession(sessionId);
    expect(buildSharedConversation(titled!, messages, expires).title).toBe('The 4th');
  });

  it("renames storage's `agent` sender to the guest vocabulary", async () => {
    const store = new InMemoryStoreFactory().forUser('alice');
    const sessionId = await store.createSession();
    await store.saveMessage({
      id: 'm1',
      sessionId,
      sender: 'agent',
      content: 'Here is what I found',
      timestamp: new Date().toISOString(),
    });
    const session = await store.getSession(sessionId);

    const shared = buildSharedConversation(
      session!,
      await store.getMessagesBySession(sessionId),
      '2026-03-08T00:00:00.000Z',
    );

    expect(shared.messages[0].role).toBe('assistant');
  });
});
