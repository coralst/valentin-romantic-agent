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

  it('returns exactly the six documented keys', async () => {
    // The landing page reads this before it has a token. Anything added here is
    // public, so the key list is asserted rather than merely matched.
    const body = (await (await get('/api/config')).json()) as object;

    expect(Object.keys(body).sort()).toEqual([
      'authDisabled',
      'clientId',
      'cognitoDomain',
      'demoAvailable',
      'demoPersonas',
      // Which of the two backends answered. Public, and safely so: it names an
      // engine, not any of its wiring.
      'engine',
    ]);
  });

  it('reports engine A when the app was built without an engine', async () => {
    const { engine } = (await (await get('/api/config')).json()) as { engine: string };
    expect(engine).toBe('valentin');
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

/*
 * These exist because `listIntegrations` shipped fully written, fully unit-tested,
 * and not mounted. `http-routes.test.ts` called the handler directly and passed;
 * the route table never referenced it, so the panel fetched a 404 and rendered
 * every capability as "readiness unknown" — no error, just quietly blank badges.
 * A handler is not an endpoint until the route table says so, and only a test that
 * goes over the socket can tell the difference.
 */
describe('GET /api/integrations', () => {
  it('is actually mounted, and lists every integration', async () => {
    const res = await get('/api/integrations', 'grace');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      integrations: { id: string; label: string; configured: boolean }[];
    };
    // Order is `INTEGRATION_IDS`, not whatever the readiness object enumerates in,
    // so the panel's rows cannot reshuffle underneath a visitor.
    expect(body.integrations.map((i) => i.id)).toEqual([
      'hebcal',
      'ontopo',
      'amadeus',
      'google-calendar',
      'gmail',
      'whatsapp',
      // The browser tier. `browser` is a dependency rather than a destination —
      // nothing is booked on it — but it carries its own readiness, because a
      // deployment may simply not have Chromium.
      'browser',
      'wolt',
      'spotify',
      'events',
    ]);
    // Hebcal is arithmetic in-process, so it is configured on every deployment.
    expect(body.integrations.find((i) => i.id === 'hebcal')?.configured).toBe(true);
  });

  it('carries booleans and labels only — never a credential', async () => {
    const raw = await (await get('/api/integrations', 'grace')).text();

    // Whole-response check rather than per-field, because the risk is a *new*
    // field leaking, and a per-field assertion cannot see one it does not know
    // about. Not even a masked prefix: a prefix of a refresh token is still a
    // piece of a refresh token, in a payload the browser logs.
    expect(raw).not.toMatch(/token|secret|refresh|client_?id|password|\bkey\b/i);

    const body = (await (await get('/api/integrations', 'grace')).json()) as {
      integrations: Record<string, unknown>[];
    };
    for (const entry of body.integrations) {
      // `transport` says whether reaching this needs a browser. Sent rather than
      // inferred client-side so the panel's relay layout follows the deployment.
      expect(Object.keys(entry).sort()).toEqual([
        'configured', 'id', 'label', 'transport',
      ]);
      expect(typeof entry.configured).toBe('boolean');
    }
  });

  it('requires a token like every other /api route', async () => {
    expect((await get('/api/integrations')).status).toBe(401);
  });
});

/*
 * Credential intake. These are the routes that accept a secret, so what is tested
 * is mostly what they *refuse*: an unknown service, an unauthenticated caller, and
 * — for the OAuth callback, which cannot be authenticated at all — a `state` that
 * this server did not mint.
 *
 * No test here supplies a real credential, and none should. The provider probe is
 * a live network call by design, so a test that exercised the happy path would
 * either need real keys in CI or a mocked `fetch` proving only that a mock was
 * called. The parts worth pinning are reachable without either.
 */
describe('credential intake', () => {
  function postJson(path: string, body: unknown, token?: string) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it('refuses to connect a service that is not connectable', async () => {
    // Hebcal is arithmetic and Ontopo needs no auth, so neither has anything to
    // connect. A 404 rather than a 400 because the *route* does not exist for
    // them, and inventing a credential slot would imply one could matter.
    for (const id of ['hebcal', 'ontopo', 'not-a-service']) {
      const res = await postJson(`/api/integrations/${id}/connect`, {}, 'grace');
      expect(res.status).toBe(404);
    }
  });

  it('rejects a connect with missing fields before contacting anyone', async () => {
    const res = await postJson('/api/integrations/amadeus/connect', {}, 'grace');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    // Names what is missing, since the visitor can act on that.
    expect(body.error).toMatch(/clientId|API key|both/i);
  });

  it('requires a token to hand over or withdraw a credential', async () => {
    expect((await postJson('/api/integrations/amadeus/connect', {})).status).toBe(401);
    expect((await postJson('/api/integrations/amadeus/disconnect', {})).status).toBe(401);
    expect((await get('/api/integrations/google/auth-url')).status).toBe(401);
  });

  it('will not build a Google consent URL with no OAuth client saved', async () => {
    const saved = config.integrations.googleClientId;
    config.integrations.googleClientId = undefined;
    try {
      const res = await get('/api/integrations/google/auth-url', 'grace');
      expect(res.status).toBe(400);
      // Not a bare failure: it says what to do first.
      expect(((await res.json()) as { error: string }).error).toMatch(/client id/i);
    } finally {
      config.integrations.googleClientId = saved;
    }
  });

  /*
   * The callback is the one unauthenticated route that can change what this
   * server holds, so `state` is the whole of its security. These three assert
   * that an attacker-supplied redirect gets nowhere.
   */
  describe('the Google OAuth callback', () => {
    it('is reachable without a token, because Google has none to send', async () => {
      // A 400 and not a 401: it ran, and refused on the state.
      const res = await get('/api/integrations/google/callback?code=x&state=forged');
      expect(res.status).toBe(400);
    });

    it('refuses a state this server did not mint, and stores nothing', async () => {
      const before = config.integrations.googleRefreshToken;
      const res = await get('/api/integrations/google/callback?code=stolen&state=forged');
      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/expired or was not started here/i);
      // The code is never exchanged, so nothing can have been written.
      expect(config.integrations.googleRefreshToken).toBe(before);
    });

    it('reports a declined consent as a closeable page, not an error', async () => {
      const res = await get('/api/integrations/google/callback?error=access_denied');
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toMatch(/cancelled/i);
      expect(html).toMatch(/close this window/i);
    });

    it('never puts a credential in the page it renders', async () => {
      // The code is in the query string, so the obvious mistake is echoing it
      // back into the "something went wrong" text.
      const html = await (
        await get('/api/integrations/google/callback?code=SECRET-CODE-123&state=forged')
      ).text();
      expect(html).not.toContain('SECRET-CODE-123');
    });
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

describe('her people, his tasks and his corrections over HTTP', () => {
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

  async function ownSession(token: string): Promise<string> {
    const { sessionId } = (await (await post('/api/session', token)).json()) as {
      sessionId: string;
    };
    return sessionId;
  }

  it('round trips a person through the real route table', async () => {
    // Registered as its own path rather than being folded into the session PATCH,
    // and over a socket rather than by calling the handler, because the failure
    // this guards is a route-ordering one: '/api/session/:id' would swallow
    // '/api/session/:id/people' if it were registered first.
    const sessionId = await ownSession('ivan');

    const created = await send(`/api/session/${sessionId}/people`, 'POST', 'ivan', {
      name: 'Leah',
      relationship: 'Older sister',
      generation: 'peer',
      birthday: '1988-09-09',
    });
    expect(created.status).toBe(200);

    const { people } = (await (
      await get(`/api/session/${sessionId}/people`, 'ivan')
    ).json()) as { people: { name: string; birthday: string }[] };
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ name: 'Leah', birthday: '1988-09-09' });
  });

  it('deletes a person by id', async () => {
    const sessionId = await ownSession('ivan');
    const created = await send(`/api/session/${sessionId}/people`, 'POST', 'ivan', {
      relationship: 'Brother',
    });
    const { person } = (await created.json()) as { person: { id: string } };

    const removed = await send(
      `/api/session/${sessionId}/people/${person.id}`,
      'DELETE',
      'ivan',
    );
    expect(removed.status).toBe(200);

    const { people } = (await (
      await get(`/api/session/${sessionId}/people`, 'ivan')
    ).json()) as { people: unknown[] };
    expect(people).toEqual([]);
  });

  it('ticks a task and the tick survives a fresh read', async () => {
    const sessionId = await ownSession('ivan');
    const created = await send(`/api/session/${sessionId}/tasks`, 'POST', 'ivan', {
      title: 'Book somewhere for the anniversary',
      due: '2026-09-11',
    });
    const { task } = (await created.json()) as { task: Record<string, unknown> };

    await send(`/api/session/${sessionId}/tasks`, 'POST', 'ivan', {
      ...task,
      done: true,
    });

    const { tasks } = (await (
      await get(`/api/session/${sessionId}/tasks`, 'ivan')
    ).json()) as { tasks: { done: boolean }[] };
    expect(tasks).toHaveLength(1);
    expect(tasks[0].done).toBe(true);
  });

  it('stores and clears a manual correction', async () => {
    const sessionId = await ownSession('ivan');

    const put = await send(
      `/api/session/${sessionId}/manual/bra_size`,
      'PUT',
      'ivan',
      { value: '34B' },
    );
    expect(put.status).toBe(200);

    const stored = (await (
      await get(`/api/session/${sessionId}/manual`, 'ivan')
    ).json()) as { manualValues: Record<string, string> };
    expect(stored.manualValues).toEqual({ bra_size: '34B' });

    await send(`/api/session/${sessionId}/manual/bra_size`, 'DELETE', 'ivan');

    const cleared = (await (
      await get(`/api/session/${sessionId}/manual`, 'ivan')
    ).json()) as { manualValues: Record<string, string> };
    expect(cleared.manualValues).toEqual({});
  });

  it('serves the whole dossier in one session detail read', async () => {
    // The board needs all of it to draw a single frame; four separate fetches
    // would show it filling in visible stages.
    const sessionId = await ownSession('ivan');
    await send(`/api/session/${sessionId}/people`, 'POST', 'ivan', {
      relationship: 'Sister',
      name: 'Leah',
    });
    await send(`/api/session/${sessionId}/tasks`, 'POST', 'ivan', {
      title: 'Draft the card',
    });
    await send(`/api/session/${sessionId}/manual/bra_size`, 'PUT', 'ivan', {
      value: '34B',
    });

    const detail = (await (await get(`/api/session/${sessionId}`, 'ivan')).json()) as {
      people: unknown[];
      tasks: unknown[];
      manualValues: Record<string, string>;
    };
    expect(detail.people).toHaveLength(1);
    expect(detail.tasks).toHaveLength(1);
    expect(detail.manualValues).toEqual({ bra_size: '34B' });
  });

  it("hides another caller's people, tasks and corrections", async () => {
    const sessionId = await ownSession('ivan');
    await send(`/api/session/${sessionId}/people`, 'POST', 'ivan', {
      relationship: 'Sister',
      name: 'Leah',
    });

    // 404, not an empty list: the key names the caller, so a session belonging to
    // someone else simply misses, and saying "no people" would imply it existed.
    expect((await get(`/api/session/${sessionId}/people`, 'judy')).status).toBe(404);
    expect((await get(`/api/session/${sessionId}/tasks`, 'judy')).status).toBe(404);
    expect((await get(`/api/session/${sessionId}/manual`, 'judy')).status).toBe(404);
  });

  it('requires a token like every other /api route', async () => {
    const sessionId = await ownSession('ivan');

    expect((await get(`/api/session/${sessionId}/people`)).status).toBe(401);
    expect((await get(`/api/session/${sessionId}/tasks`)).status).toBe(401);
  });

  it('rejects a field id the registry does not have', async () => {
    const sessionId = await ownSession('ivan');

    const res = await send(
      `/api/session/${sessionId}/manual/favourite_dinosaur`,
      'PUT',
      'ivan',
      { value: 'Stegosaurus' },
    );
    expect(res.status).toBe(400);
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
