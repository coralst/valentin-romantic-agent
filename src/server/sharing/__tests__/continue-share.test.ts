import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { continueSharedConversation, type ShareContinueDeps } from '../continue-share';
import { mintShareToken } from '../share-token';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { ShareContinueResponse } from '../../../shared/constants/share-link';
import { config } from '../../config';

/**
 * This is the second unauthenticated write endpoint in the server, and the only one
 * that writes for a caller with no account. Two things are therefore worth pinning:
 * every unresolvable link gets one indistinguishable answer, and no credential is
 * minted for a link that was never going to resolve.
 */

const NOW = Date.parse('2026-03-01T12:00:00.000Z');
const originalSecret = config.shareTokenSecret;

beforeAll(() => {
  config.shareTokenSecret = 'test-continue-secret';
});

afterAll(() => {
  config.shareTokenSecret = originalSecret;
});

async function ownedConversation() {
  const factory = new InMemoryStoreFactory();
  const owner = factory.forUser('alice');
  const sessionId = await owner.createSession();
  await owner.updateSessionMeta(sessionId, { title: 'The anniversary' });
  await owner.saveMessage({
    id: 'm1',
    sessionId,
    sender: 'user',
    content: 'What should I plan?',
    timestamp: new Date(NOW - 60_000).toISOString(),
  });
  return { factory, owner, sessionId };
}

function demoLogin() {
  return {
    isConfigured: true,
    issueVisitorCredentials: vi.fn(async () => ({
      accessToken: 'visitor-token',
      refreshToken: 'visitor-refresh',
      expiresIn: 3600,
      visitorId: '11111111-1111-4111-8111-111111111111',
      storageUserId: 'demo#11111111-1111-4111-8111-111111111111',
    })),
  };
}

function depsFor(
  factory: InMemoryStoreFactory,
  overrides: Partial<ShareContinueDeps> = {},
): ShareContinueDeps {
  return {
    forUser: (userId) => ({ store: factory.forUser(userId) }),
    authDisabled: false,
    now: NOW,
    demoLogin: demoLogin(),
    ...overrides,
  };
}

describe('continuing a shared conversation', () => {
  it('forks it into a visitor’s own store and hands back a way in', async () => {
    const { factory, sessionId } = await ownedConversation();
    const { token } = mintShareToken('alice', sessionId, NOW);

    const result = await continueSharedConversation(token, depsFor(factory));
    expect(result.status).toBe(200);

    const body = result.body as ShareContinueResponse;
    expect(body.accessToken).toBe('visitor-token');
    expect(body.visitorId).toBe('11111111-1111-4111-8111-111111111111');
    expect(body.demo).toBe(true);
    expect(body.title).toBe('The anniversary (continued)');
    expect(body.copied).toBe(1);
    expect(body.advanced).toBe(false);
    expect(body.sessionId).not.toBe(sessionId);

    // Where it actually landed: the visitor's partition, not the owner's.
    const visitor = factory.forUser('demo#11111111-1111-4111-8111-111111111111');
    expect(await visitor.getMessagesBySession(body.sessionId)).toHaveLength(1);
    expect(await factory.forUser('alice').listSessions()).toHaveLength(1);
  });

  it('mints a local guest when the deployment runs without Cognito', async () => {
    const { factory, sessionId } = await ownedConversation();
    const { token } = mintShareToken('alice', sessionId, NOW);
    const demo = demoLogin();

    const result = await continueSharedConversation(
      token,
      depsFor(factory, { authDisabled: true, demoLogin: demo }),
    );

    const body = result.body as ShareContinueResponse;
    expect(result.status).toBe(200);
    expect(body.demo).toBe(false);
    expect(body.visitorId).toBeNull();
    expect(body.refreshToken).toBeNull();
    // A dev-bypass token for its own user, and never `anonymous` — that partition
    // belongs to every other local caller.
    expect(body.accessToken).toMatch(/^dev:share-guest-/);
    expect(body.accessToken).not.toContain('anonymous');
    // The bypass does not go anywhere near the demo account.
    expect(demo.issueVisitorCredentials).not.toHaveBeenCalled();
  });

  it('gives one identical 404 to every link that cannot resolve', async () => {
    const { factory, owner, sessionId } = await ownedConversation();
    const valid = mintShareToken('alice', sessionId, NOW);
    const expired = mintShareToken('alice', sessionId, NOW - 30 * 24 * 60 * 60 * 1000);
    const forOther = mintShareToken('bob', sessionId, NOW);

    await owner.deleteSession(sessionId);

    const answers = await Promise.all(
      [valid.token, expired.token, forOther.token, 'nonsense', undefined].map((token) =>
        continueSharedConversation(token, depsFor(factory)),
      ),
    );

    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(answer.body).toEqual({ error: 'This link has expired or is not valid' });
    }
  });

  it('does not spend a credential on a link that was never going to resolve', async () => {
    const { factory } = await ownedConversation();
    const demo = demoLogin();

    await continueSharedConversation('nonsense', depsFor(factory, { demoLogin: demo }));

    // Otherwise every scan of /api/share/<garbage>/continue costs a Cognito call and
    // a rate-limit slot.
    expect(demo.issueVisitorCredentials).not.toHaveBeenCalled();
  });

  it('says so plainly when the deployment has no account to lend', async () => {
    const { factory, sessionId } = await ownedConversation();
    const { token } = mintShareToken('alice', sessionId, NOW);

    const missing = await continueSharedConversation(
      token,
      depsFor(factory, { demoLogin: undefined }),
    );
    const unconfigured = await continueSharedConversation(
      token,
      depsFor(factory, { demoLogin: { ...demoLogin(), isConfigured: false } }),
    );

    // 503 and not 404: the link is fine, the deployment cannot honour it, and the
    // read-only fallback view is the right thing for the client to show.
    expect(missing.status).toBe(503);
    expect(unconfigured.status).toBe(503);
  });

  it('passes a credential failure through with its own status', async () => {
    const { factory, sessionId } = await ownedConversation();
    const { token } = mintShareToken('alice', sessionId, NOW);

    const result = await continueSharedConversation(
      token,
      depsFor(factory, {
        demoLogin: {
          isConfigured: true,
          issueVisitorCredentials: async () => ({
            error: { status: 429, body: { error: 'Too many demo logins, try again shortly' } },
          }),
        },
      }),
    );

    expect(result.status).toBe(429);
  });

  it('cuts the branch where the link was made, not at the latest turn', async () => {
    const { factory, owner, sessionId } = await ownedConversation();
    const { token } = mintShareToken('alice', sessionId, NOW);
    await owner.saveMessage({
      id: 'm2',
      sessionId,
      sender: 'user',
      content: 'Said after the link went out',
      timestamp: new Date(NOW + 600_000).toISOString(),
    });

    // Verified a day later, so the token is still good and the conversation has moved.
    const result = await continueSharedConversation(
      token,
      depsFor(factory, { now: NOW + 24 * 60 * 60 * 1000 }),
    );

    const body = result.body as ShareContinueResponse;
    expect(body.advanced).toBe(true);
    expect(body.copied).toBe(1);
  });
});
