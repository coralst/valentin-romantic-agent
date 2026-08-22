import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer as createHttpServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { createExpressApp } from '../express-app';
import { config } from '../../config';
import { createServer } from '../../index';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { AuthContext, TokenVerifier } from '../../auth/token-verifier';
import { TokenVerificationError } from '../../auth/token-verifier';
import { DEMO_PERSONAS } from '../../fixtures/demo-personas';
import { DEMO_PROFILE_PREFERENCES } from '../../fixtures/demo-profile';

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

describe('GET /api/config', () => {
  it('hands the browser what it needs to sign in, with no token', async () => {
    // The SPA has no build-time AWS configuration; this is where it learns the
    // pool it should talk to. Both values are public — they appear in the
    // address bar during a normal login.
    const res = await get('/api/config');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      authDisabled: false,
      demoAvailable: false,
    });
  });

  it('does not carry a secret arn or the demo client id', async () => {
    const body = JSON.stringify(await (await get('/api/config')).json());

    expect(body).not.toContain('secret');
    expect(body).not.toContain('demoClientId');
  });

  it('returns exactly the five documented keys', async () => {
    // The landing page reads this before it has a token. Anything added here is
    // public, so the key list is asserted rather than merely matched.
    const body = (await (await get('/api/config')).json()) as object;

    expect(Object.keys(body).sort()).toEqual([
      'authDisabled',
      'clientId',
      'cognitoDomain',
      'demoAvailable',
      'demoPersonas',
    ]);
  });

  it('advertises the demo personas, with counts but no values', async () => {
    const { demoPersonas } = (await (await get('/api/config')).json()) as {
      demoPersonas: unknown[];
    };

    expect(demoPersonas).toEqual(
      DEMO_PERSONAS.map((persona) => ({
        id: persona.id,
        name: persona.name,
        // The person signed in when the persona loads — "Ralf", not "Samantha".
        // The account chip reads this one; see `demo-personas.ts`.
        userName: persona.userName,
        blurb: persona.blurb,
        fieldCount: persona.preferences.length,
      })),
    );
  });

  it('offers a persona seeding the whole fixture and one seeding nothing', async () => {
    const { demoPersonas } = (await (await get('/api/config')).json()) as {
      demoPersonas: { id: string; fieldCount: number }[];
    };
    const counts = Object.fromEntries(
      demoPersonas.map((persona) => [persona.id, persona.fieldCount]),
    );

    expect(counts.samantha).toBe(DEMO_PROFILE_PREFERENCES.length);
    expect(counts.fresh).toBe(0);
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

/**
 * Every demo visitor authenticates as the *same* Cognito account, so the `sub`
 * in their tokens is byte-identical and cannot tell them apart. This is the only
 * thing that can, and without it a visitor clicking "Create an Account" opens
 * onto whoever last clicked "Login".
 *
 * Gets its own server because the shared one's verifier reports `isDemo: false`,
 * which is exactly the case where the header must be ignored.
 */
describe('separating visitors inside the shared demo account', () => {
  const SUB = 'the-one-demo-account';
  const ALICE = '11111111-2222-3333-4444-555555555555';
  const BOB = '66666666-7777-8888-9999-aaaaaaaaaaaa';

  const demoVerifier: TokenVerifier = {
    async verify(token: string): Promise<AuthContext> {
      if (!token) throw new TokenVerificationError('nope');
      return {
        userId: SUB,
        isDemo: true,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };
    },
  };

  let demoServer: Server;
  let demoUrl: string;

  /** Every request a demo browser makes: one shared token, one visitor id */
  function asVisitor(path: string, visitorId?: string, method = 'GET') {
    return fetch(`${demoUrl}${path}`, {
      method,
      headers: {
        authorization: 'Bearer demo-token',
        ...(visitorId ? { 'x-demo-visitor': visitorId } : {}),
      },
    });
  }

  async function sessionCount(visitorId?: string): Promise<number> {
    const body = (await (await asVisitor('/api/sessions', visitorId)).json()) as {
      sessions: unknown[];
    };
    return body.sessions.length;
  }

  beforeAll(async () => {
    const { forUser, gateway } = createServer({
      store: new InMemoryStoreFactory(),
      verifier: demoVerifier,
    });
    const app = createExpressApp({
      verifier: demoVerifier,
      forUser,
      connectionCount: () => gateway.connectionCount,
      log: () => {},
    });
    demoServer = createHttpServer(app);
    await new Promise<void>((resolve) => demoServer.listen(0, resolve));
    demoUrl = `http://127.0.0.1:${(demoServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => demoServer.close(() => resolve()));
  });

  it('gives each visitor their own conversations', async () => {
    await asVisitor('/api/session', ALICE, 'POST');
    await asVisitor('/api/session', ALICE, 'POST');
    await asVisitor('/api/session', BOB, 'POST');

    expect(await sessionCount(ALICE)).toBe(2);
    expect(await sessionCount(BOB)).toBe(1);
  });

  it("keeps one visitor out of another's session", async () => {
    const { sessionId } = (await (
      await asVisitor('/api/session', ALICE, 'POST')
    ).json()) as { sessionId: string };

    // Bob holds a valid id and a valid token for the same account. The only
    // thing standing between him and Alice's conversation is the scoping.
    expect((await asVisitor(`/api/session/${sessionId}`, BOB)).status).toBe(404);
    expect((await asVisitor(`/api/session/${sessionId}`, ALICE)).status).toBe(200);
  });

  /**
   * A crafted suffix is the one way this could be turned into a cross-tenant
   * read: the value is concatenated into a DynamoDB partition key, so a string
   * carrying the key grammar's own `#SESSION#` separator could address a
   * neighbour's rows. Rejected values fall back to the unscoped id, which is
   * the shared pile — never someone else's corner.
   */
  it('ignores a visitor id that is not one it minted', async () => {
    const forged = ['${A}#SESSION#x', '${A}#', 'not-a-uuid', '../..'];
    for (const value of forged) {
      // Falls back to the shared, unscoped account rather than erroring, so an
      // older client still works -- but it lands nowhere near Alice's corner.
      expect(await sessionCount(value.replace('${A}', ALICE))).toBe(0);
    }
    expect(await sessionCount(ALICE)).toBeGreaterThan(0);
  });

  it('ignores the header entirely for a caller with their own account', async () => {
    // The shared server's verifier reports isDemo: false. A real account's `sub`
    // already separates it, so honouring the header there would let anyone
    // partition -- or hide -- their own data by sending a different value.
    const created = (await (await post('/api/session', 'erin')).json()) as {
      sessionId: string;
    };

    const res = await fetch(`${baseUrl}/api/session/${created.sessionId}`, {
      headers: {
        authorization: 'Bearer erin',
        'x-demo-visitor': ALICE,
      },
    });

    expect(res.status).toBe(200);
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

describe('renaming and deleting a conversation', () => {
  function send(path: string, method: string, token: string, body?: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  it('renames a conversation for its owner', async () => {
    const { sessionId } = (await (
      await post('/api/session/seed', 'grace')
    ).json()) as { sessionId: string };

    const res = await send(`/api/session/${sessionId}`, 'PATCH', 'grace', {
      title: 'Anniversary',
    });
    expect(res.status).toBe(200);

    const { sessions } = (await (await get('/api/sessions', 'grace')).json()) as {
      sessions: { id: string; title: string | null }[];
    };
    expect(sessions.find((s) => s.id === sessionId)?.title).toBe('Anniversary');
  });

  it("answers 404 when renaming someone else's conversation", async () => {
    const { sessionId } = (await (
      await post('/api/session/seed', 'heidi')
    ).json()) as { sessionId: string };

    const res = await send(`/api/session/${sessionId}`, 'PATCH', 'ivan', {
      title: 'Ivan was here',
    });

    expect(res.status).toBe(404);
  });

  it('deletes a conversation, and only for its owner', async () => {
    const { sessionId } = (await (
      await post('/api/session/seed', 'judy')
    ).json()) as { sessionId: string };

    expect((await send(`/api/session/${sessionId}`, 'DELETE', 'karl')).status).toBe(
      404,
    );
    // Still there after the refused attempt — a 404 must mean untouched.
    expect((await get(`/api/session/${sessionId}`, 'judy')).status).toBe(200);

    expect((await send(`/api/session/${sessionId}`, 'DELETE', 'judy')).status).toBe(
      200,
    );
    expect((await get(`/api/session/${sessionId}`, 'judy')).status).toBe(404);
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
