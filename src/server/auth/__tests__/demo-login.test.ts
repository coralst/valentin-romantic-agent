import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config } from '../../config';
import { DemoLoginService, TokenBucket, type DemoLoginDeps } from '../demo-login';
import { DEFAULT_PERSONA_ID } from '../../fixtures/demo-personas';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { StorageInterface } from '../../persistence/storage-interface';
import type { AuthContext, TokenVerifier } from '../token-verifier';

const DEMO_SUB = 'demo-sub-123';

const verifier: TokenVerifier = {
  async verify(token: string): Promise<AuthContext> {
    if (token !== 'minted-access-token') throw new Error('unexpected token');
    return {
      userId: DEMO_SUB,
      isDemo: true,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
  },
};

/** Mimics AdminInitiateAuth's success shape */
function cognitoStub(result: unknown = {
  AuthenticationResult: {
    AccessToken: 'minted-access-token',
    RefreshToken: 'minted-refresh-token',
    ExpiresIn: 3600,
  },
}) {
  return { send: vi.fn().mockResolvedValue(result) };
}

function secretsStub(
  secretString = JSON.stringify({ username: 'demo@valentin.local', password: 'sw0rdf!sh' }),
) {
  return { send: vi.fn().mockResolvedValue({ SecretString: secretString }) };
}

interface BuildOverrides {
  cognito?: ReturnType<typeof cognitoStub>;
  secrets?: ReturnType<typeof secretsStub>;
  bucket?: TokenBucket;
}

function build(overrides: BuildOverrides = {}) {
  const factory = new InMemoryStoreFactory();
  const store = factory.forUser(DEMO_SUB);
  const cognito = overrides.cognito ?? cognitoStub();
  const secrets = overrides.secrets ?? secretsStub();
  const seedSession = vi.fn((storage: StorageInterface) => storage.createSession());

  const service = new DemoLoginService({
    cognito: cognito as unknown as DemoLoginDeps['cognito'],
    secrets: secrets as unknown as DemoLoginDeps['secrets'],
    verifier,
    storeFor: () => store,
    seedSession,
    bucket: overrides.bucket,
  });

  return { service, factory, store, cognito, secrets, seedSession };
}

const original = { ...config.cognito };

beforeEach(() => {
  Object.assign(config.cognito, {
    userPoolId: 'us-east-1_TEST',
    spaClientId: 'spa-client',
    demoClientId: 'demo-client',
    demoSecretArn: 'arn:aws:secretsmanager:us-east-1:1:secret:valentin/dev/demo-user',
  });
});

afterEach(() => {
  Object.assign(config.cognito, original);
  vi.restoreAllMocks();
});

describe('DemoLoginService.login', () => {
  it('returns real Cognito tokens plus a seeded session', async () => {
    const { service } = build();

    const result = await service.login();

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      accessToken: 'minted-access-token',
      refreshToken: 'minted-refresh-token',
      expiresIn: 3600,
    });
    expect((result.body as { sessionId: string }).sessionId).toBeTruthy();
  });

  it('passes the requested persona to the seeder and reports it back', async () => {
    const { service, seedSession } = build();

    const result = await service.login('fresh');

    expect(seedSession).toHaveBeenCalledWith(expect.anything(), 'fresh');
    expect(result.body).toMatchObject({ persona: 'fresh' });
  });

  it('seeds the default persona when the caller names none', async () => {
    // Every caller that predates personas posts an empty body.
    const { service, seedSession } = build();

    const result = await service.login();

    expect(seedSession).toHaveBeenCalledWith(
      expect.anything(),
      DEFAULT_PERSONA_ID,
    );
    expect(result.body).toMatchObject({ persona: DEFAULT_PERSONA_ID });
  });

  it('seeds the default persona rather than failing on an unknown id', async () => {
    // The id comes off an unauthenticated request body, so a stranger's typo
    // must not turn into a 500.
    const { service, seedSession } = build();

    const result = await service.login('someone-else');

    expect(result.status).toBe(200);
    expect(seedSession).toHaveBeenCalledWith(
      expect.anything(),
      DEFAULT_PERSONA_ID,
    );
  });

  it('signs in through the server-only client with the admin password flow', async () => {
    const { service, cognito } = build();

    await service.login();

    const command = cognito.send.mock.calls[0][0] as {
      input: Record<string, unknown>;
    };
    expect(command.input).toMatchObject({
      UserPoolId: 'us-east-1_TEST',
      ClientId: 'demo-client',
      // Not USER_PASSWORD_AUTH: that flow is callable without AWS credentials
      // and is deliberately disabled on this client.
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
    });
  });

  it('never puts the password in the response', async () => {
    const { service } = build();

    const result = await service.login();

    expect(JSON.stringify(result.body)).not.toContain('sw0rdf!sh');
  });

  it('reads the secret once and caches it', async () => {
    const { service, secrets } = build();

    await service.login();
    await service.login();

    expect(secrets.send).toHaveBeenCalledTimes(1);
  });

  it('reports 502 when Cognito answers with a challenge instead of tokens', async () => {
    // What a non-permanent password looks like: NEW_PASSWORD_REQUIRED and no
    // AuthenticationResult at all.
    const { service } = build({
      cognito: cognitoStub({ ChallengeName: 'NEW_PASSWORD_REQUIRED' }),
    });

    expect((await service.login()).status).toBe(502);
  });

  it('reports 503 when the deployment has no demo account', async () => {
    Object.assign(config.cognito, { demoSecretArn: undefined });
    const { service, cognito } = build();

    expect((await service.login()).status).toBe(503);
    expect(cognito.send).not.toHaveBeenCalled();
  });

  it('rejects a flood with 429 rather than paying for it', async () => {
    // The risk is Bedrock spend, not privacy.
    const { service } = build({ bucket: new TokenBucket(2, 60_000) });

    expect((await service.login()).status).toBe(200);
    expect((await service.login()).status).toBe(200);
    expect((await service.login()).status).toBe(429);
  });

  it('rejects a secret that is missing a password', async () => {
    const { service } = build({
      secrets: secretsStub(JSON.stringify({ username: 'demo@valentin.local' })),
    });

    await expect(service.login()).rejects.toThrow(/missing username or password/);
  });
});

describe('DemoLoginService session reaping', () => {
  it('drops sessions older than thirty minutes', async () => {
    const { service, store } = build();
    const stale = await store.createSession();
    // Reach past the interface to age the session — nothing in it lets a caller
    // set createdAt, which is correct.
    await store.saveMessage({
      id: 'm1',
      sessionId: stale,
      sender: 'user',
      content: 'from a demo an hour ago',
      timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    await service.login();

    expect(await store.getSession(stale)).toBeNull();
  });

  it('leaves a demo someone is still in alone', async () => {
    // Two people clicking "Try the demo" seconds apart must not wipe each
    // other mid-conversation, which is what deleting everything would do.
    const { service, store } = build();
    const active = await store.createSession();
    await store.saveMessage({
      id: 'm1',
      sessionId: active,
      sender: 'user',
      content: 'still talking',
      timestamp: new Date().toISOString(),
    });

    await service.login();

    expect(await store.getSession(active)).not.toBeNull();
  });

  it('still returns a session when the reap fails', async () => {
    const { service, store } = build();
    const stale = await store.createSession();
    await store.saveMessage({
      id: 'm1',
      sessionId: stale,
      sender: 'user',
      content: 'old',
      timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    vi.spyOn(store, 'deleteSession').mockRejectedValue(new Error('throttled'));

    // Best-effort cleanup must not cost someone their demo.
    expect((await service.login()).status).toBe(200);
  });
});

describe('TokenBucket', () => {
  it('refills once the window has passed', () => {
    const bucket = new TokenBucket(1, 1_000);

    expect(bucket.tryConsume(0)).toBe(true);
    expect(bucket.tryConsume(500)).toBe(false);
    expect(bucket.tryConsume(1_500)).toBe(true);
  });
});
