import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer as createHttpServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { createExpressApp } from '../express-app';
import { config } from '../../config';
import { createServer } from '../../index';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { AuthContext, TokenVerifier } from '../../auth/token-verifier';
import { TokenVerificationError } from '../../auth/token-verifier';

/**
 * The route table is exercised over a real socket rather than by calling
 * handlers, because the things worth checking here are middleware ordering
 * facts: that `/api/health` is reachable without a token and that everything
 * under `/api` is not.
 */

/** A verifier where the token *is* the user id, and 'bad' is always rejected */
const verifier: TokenVerifier = {
  async verify(token: string): Promise<AuthContext> {
    if (!token || token === 'bad') throw new TokenVerificationError('nope');
    return {
      userId: token,
      isDemo: false,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
  },
};

let server: Server;
let baseUrl: string;
const originalPool = config.cognito.userPoolId;

function get(path: string, token?: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function post(path: string, token?: string) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeAll(async () => {
  // Pretend Cognito is configured, so the bypass is off and a missing token is
  // a 401 rather than an anonymous caller.
  config.cognito.userPoolId = 'us-east-1_TEST';

  const { forUser, gateway } = createServer({
    store: new InMemoryStoreFactory(),
    verifier,
  });

  const app = createExpressApp({
    verifier,
    forUser,
    connectionCount: () => gateway.connectionCount,
    log: () => {},
  });

  server = createHttpServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  config.cognito.userPoolId = originalPool;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/health', () => {
  it('answers 200 with no token', async () => {
    // The ALB target group and the container health check both hit this and
    // neither can present a JWT. Gate it and ECS rolls back in a loop.
    const res = await get('/api/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'healthy' });
  });

  it('reports that authentication is on', async () => {
    const body = (await (await get('/api/health')).json()) as {
      authenticated: boolean;
    };
    expect(body.authenticated).toBe(true);
  });
});

describe('the /api auth gate', () => {
  it('rejects a request with no Authorization header', async () => {
    expect((await post('/api/session')).status).toBe(401);
  });

  it('rejects a request with an unverifiable token', async () => {
    expect((await post('/api/session', 'bad')).status).toBe(401);
  });

  it('rejects a token that is not a Bearer credential', async () => {
    const res = await fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: { authorization: 'alice' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts a verified token', async () => {
    const res = await post('/api/session', 'alice');

    expect(res.status).toBe(201);
    expect((await res.json()) as { sessionId: string }).toHaveProperty(
      'sessionId',
    );
  });
});

describe('per-caller scoping', () => {
  it("returns 404 for another user's session rather than its contents", async () => {
    const created = (await (await post('/api/session', 'alice')).json()) as {
      sessionId: string;
    };

    // Bob holds a *valid* session id. Isolation must not rest on him not
    // knowing it.
    const asBob = await get(
      `/api/session/${created.sessionId}/preferences`,
      'bob',
    );
    expect(asBob.status).toBe(404);

    const asAlice = await get(
      `/api/session/${created.sessionId}/preferences`,
      'alice',
    );
    expect(asAlice.status).toBe(200);
  });

  it("cannot reset another user's session", async () => {
    const created = (await (await post('/api/session/seed', 'alice')).json()) as {
      sessionId: string;
      preferenceCount: number;
    };
    expect(created.preferenceCount).toBeGreaterThan(0);

    expect(
      (await post(`/api/session/${created.sessionId}/reset`, 'bob')).status,
    ).toBe(404);

    const stillThere = (await (
      await get(`/api/session/${created.sessionId}/preferences`, 'alice')
    ).json()) as { preferences: unknown[] };
    expect(stillThere.preferences).toHaveLength(created.preferenceCount);
  });

  it('keeps the seed route from being read as a session id', async () => {
    // Registered before '/api/session/:id', so 'seed' is never captured.
    const res = await post('/api/session/seed', 'alice');
    expect(res.status).toBe(201);
  });
});

describe('the session list', () => {
  it('shows a caller only their own sessions', async () => {
    await post('/api/session/seed', 'carol');

    const mine = (await (await get('/api/sessions', 'carol')).json()) as {
      sessions: { id: string }[];
    };
    const theirs = (await (await get('/api/sessions', 'dave')).json()) as {
      sessions: { id: string }[];
    };

    expect(mine.sessions.length).toBeGreaterThan(0);
    expect(theirs.sessions).toEqual([]);
  });

  it('serves a session detail to its owner and 404 to anyone else', async () => {
    const { sessionId } = (await (
      await post('/api/session/seed', 'erin')
    ).json()) as { sessionId: string };

    const owner = await get(`/api/session/${sessionId}`, 'erin');
    expect(owner.status).toBe(200);
    expect(await owner.json()).toMatchObject({ session: { id: sessionId } });

    expect((await get(`/api/session/${sessionId}`, 'frank')).status).toBe(404);
  });

  it('requires a token like every other /api route', async () => {
    expect((await get('/api/sessions')).status).toBe(401);
  });
});

describe('POST /api/demo/login', () => {
  it('reports 503 when the deployment has no demo account', async () => {
    // The app under test was built without a demoLogin dependency. 503 rather
    // than 404 is the truth the client should show.
    expect((await post('/api/demo/login')).status).toBe(503);
  });

  it('needs no token, since it is what hands one out', async () => {
    const { forUser, gateway } = createServer({
      store: new InMemoryStoreFactory(),
      verifier,
    });
    const app = createExpressApp({
      verifier,
      forUser,
      connectionCount: () => gateway.connectionCount,
      log: () => {},
      demoLogin: {
        login: async () => ({
          status: 200,
          body: { accessToken: 'demo-token', sessionId: 's1' },
        }),
      },
    });
    const demoServer = createHttpServer(app);
    await new Promise<void>((resolve) => demoServer.listen(0, resolve));
    const url = `http://127.0.0.1:${(demoServer.address() as AddressInfo).port}`;

    try {
      const res = await fetch(`${url}/api/demo/login`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ accessToken: 'demo-token' });
    } finally {
      await new Promise<void>((resolve) => demoServer.close(() => resolve()));
    }
  });
});

describe('with the dev bypass active', () => {
  let bypassServer: Server;
  let bypassUrl: string;

  beforeEach(async () => {
    config.cognito.userPoolId = undefined;
    config.nodeEnv = 'development';

    const { forUser, gateway } = createServer({
      store: new InMemoryStoreFactory(),
    });
    const app = createExpressApp({
      verifier: (await import('../../auth/token-verifier')).createTokenVerifier(),
      forUser,
      connectionCount: () => gateway.connectionCount,
      log: () => {},
    });

    bypassServer = createHttpServer(app);
    await new Promise<void>((resolve) => bypassServer.listen(0, resolve));
    bypassUrl = `http://127.0.0.1:${(bypassServer.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    config.cognito.userPoolId = 'us-east-1_TEST';
    await new Promise<void>((resolve) => bypassServer.close(() => resolve()));
  });

  it('serves an unauthenticated request as a development user', async () => {
    // What keeps rehearsal.mjs and e2e/tests/* working with no edits.
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await fetch(`${bypassUrl}/api/session`, { method: 'POST' });
    expect(res.status).toBe(201);
  });

  it('says so on the health endpoint', async () => {
    const body = (await (await fetch(`${bypassUrl}/api/health`)).json()) as {
      authenticated: boolean;
    };
    expect(body.authenticated).toBe(false);
  });
});
