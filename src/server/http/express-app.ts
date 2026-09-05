import express, { type Express, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import type { HttpResponse } from '../api/http-routes';
import type { UserServices } from '../index';
import type { AuthContext, TokenVerifier } from '../auth/token-verifier';
import { isAuthDisabled } from '../auth/token-verifier';
import { config } from '../config';
import type { DemoLoginService } from '../auth/demo-login';
import { storageUserId } from '../auth/demo-login';
import { describePersonas } from '../fixtures/demo-personas';
import { DEFAULT_ENGINE, type AgentEngine } from '../agent/engine';
import { consumeState, exchangeCode } from '../integrations/google/oauth';
import { consumeSpotifyState, exchangeSpotifyCode } from '../integrations/spotify/oauth';
import { applyGoogleRefreshToken, applySpotifyRefreshToken } from '../integrations/credentials';
import { buildToolRegistry } from '../integrations';
import { verifyShareToken } from '../sharing/share-token';
import { buildSharedConversation } from '../sharing/shared-conversation';
import { continueSharedConversation } from '../sharing/continue-share';
import type { BedrockReadiness } from '../agent/bedrock-preflight';

/**
 * Escape text destined for the OAuth callback's HTML page.
 *
 * All of the messages it renders are our own constants today, so nothing here is
 * attacker-controlled — but this page is assembled by string concatenation, and
 * the next person to add a message to it should not have to notice that.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Structured log sink, so the two entry points keep their own formats */
export type LogFn = (
  level: 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>,
) => void;

export interface ExpressAppDeps {
  verifier: TokenVerifier;
  /** Builds the caller's scoped object graph once their identity is known */
  forUser: (userId: string) => UserServices;
  /** Live connection count, for the health payload */
  connectionCount: () => number;
  log: LogFn;
  /**
   * Which engine this task serves, for `/api/config` to report.
   *
   * Optional so the existing app tests need no new argument; absent reads as
   * engine A, which is what an untouched deployment is.
   */
  engine?: AgentEngine;
  /**
   * Backs the one-click demo button. Omitted in tests that only care about the
   * authenticated surface; the route then reports 503 rather than 404, since
   * "not configured on this deployment" is the truth the client should show.
   */
  demoLogin?: Pick<DemoLoginService, 'login' | 'isConfigured' | 'issueVisitorCredentials'>;
  /**
   * What the boot-time Bedrock probe found, for `/api/health` to report.
   *
   * Optional, and absent reads as "not probed" rather than as a failure: a test
   * app that never wired a real client has nothing to say about the model, and
   * saying "broken" there would be a lie.
   */
  bedrockReadiness?: () => BedrockReadiness | null;
}

/** What a verified request carries, hung off `res.locals` */
interface RequestContext {
  auth: AuthContext;
  services: UserServices;
}

/**
 * Read a path parameter as a single string.
 *
 * Express 5 types params as `string | string[]`, since a pattern can repeat a
 * name. Ours never do, so collapse it rather than threading the union outwards.
 */
function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

function contextOf(res: Response): RequestContext {
  // Set by requireAuth, which every route below is registered after.
  return res.locals as unknown as RequestContext;
}

/**
 * Reject anything without a valid bearer token.
 *
 * When the dev bypass is active a missing header is *not* an error — the bypass
 * verifier maps it to a development user. That is what keeps `npm test`,
 * `e2e/tests/*` and `rehearsal.mjs` working with no edits. In production
 * `isAuthDisabled()` is false, so a missing header is a 401 like any other.
 */
function requireAuth(deps: ExpressAppDeps) {
  return async (req: Request, res: Response, next: express.NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!token && !isAuthDisabled()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let auth: AuthContext;
    try {
      auth = await deps.verifier.verify(token);
    } catch (err) {
      deps.log('warn', 'Rejected request with an invalid token', {
        path: req.path,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const context: RequestContext = {
      auth,
      services: deps.forUser(storageUserId(auth, req.headers['x-demo-visitor'])),
    };
    Object.assign(res.locals, context);
    next();
  };
}

/**
 * Adapt one of the framework-agnostic route handlers to Express.
 *
 * The handler receives the caller's *own* store, so none of them takes a user
 * id and none of them can forget an ownership check.
 */
function scoped(
  deps: ExpressAppDeps,
  handler: (
    routes: UserServices['httpRoutes'],
    req: Request,
  ) => Promise<HttpResponse>,
) {
  return async (req: Request, res: Response) => {
    const { services, auth } = contextOf(res);
    try {
      const result = await handler(services.httpRoutes, req);
      res.status(result.status).json(result.body);
    } catch (err) {
      deps.log('error', 'Request failed', {
        path: req.path,
        userId: auth.userId,
        requestId: req.headers['x-request-id'],
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

/**
 * The HTTP surface, shared by both entry points.
 *
 * `prod-server.ts` and `dev-server.ts` each carried their own copy of this route
 * table and had already drifted apart — different `/api/health` shapes, request
 * ids in one and not the other. Authentication is exactly the kind of change
 * that must not land in one copy only.
 */
export function createExpressApp(deps: ExpressAppDeps): Express {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.headers['x-request-id'] =
      (req.headers['x-request-id'] as string) || randomUUID();
    next();
  });

  // --- Open endpoints, registered before requireAuth ---

  /**
   * Health check. **Must stay unauthenticated**: compute-stack.ts uses it for
   * both the container health check and the ALB target group, and neither can
   * present a JWT. Gate this and ECS rolls back in a loop.
   */
  app.get('/api/health', (_req, res) => {
    // Reported, deliberately not gated on: a task that cannot reach Bedrock still
    // serves share links, the dossier and the login page, and failing the health
    // check would turn a degraded chat into a rolling outage. `model` is here so
    // "is chat actually going to work" is answerable with one curl, before a demo
    // rather than during it.
    const readiness = deps.bedrockReadiness?.() ?? null;
    res.status(200).json({
      status: 'healthy',
      uptime: process.uptime(),
      connections: deps.connectionCount(),
      environment: process.env.NODE_ENV ?? 'development',
      authenticated: !isAuthDisabled(),
      model: !deps.bedrockReadiness
        ? 'unprobed'
        : readiness === null
          ? 'checking'
          : readiness.ok
            ? 'reachable'
            : readiness.kind,
    });
  });

  /**
   * Everything the browser needs to sign someone in, discovered at runtime.
   *
   * The alternative — `VITE_*` variables baked in at build time — would mean
   * copying pool ids out of the AWS console into a `.env` before the frontend
   * could be built, and a different bundle per environment. Here one bundle
   * works everywhere, and locally (where no Cognito env is set) the client is
   * simply told authentication is off.
   *
   * Only public values: a Cognito domain and a public PKCE client id, both of
   * which appear in the browser's address bar during a normal login.
   *
   * The persona list is here for the same reason — this is the only route the
   * landing page can reach before it has a token, so it is the only place it can
   * learn which demo profiles exist. Names, blurbs and *counts* only: the
   * preference values themselves stay behind the token.
   */
  app.get('/api/config', (_req, res) => {
    res.status(200).json({
      authDisabled: isAuthDisabled(),
      cognitoDomain: config.cognito.domain ?? null,
      clientId: config.cognito.spaClientId ?? null,
      demoAvailable: Boolean(deps.demoLogin),
      demoPersonas: describePersonas(),
      /*
       * Which engine actually answered, not which one the caller routed to.
       *
       * The two matter separately. A browser reaching `/ws/agentcore` knows what
       * it *asked* for, but `resolveEngine` downgrades to engine A when the
       * AgentCore wiring is missing — and a comparison that labelled those
       * answers "AgentCore" would be reporting engine A's numbers under engine
       * B's name. This is the value the label should come from.
       */
      engine: deps.engine ?? DEFAULT_ENGINE,
    });
  });

  /**
   * The one unauthenticated write endpoint: it *hands out* a token, so it
   * cannot require one. See auth/demo-login.ts for the rate limit.
   */
  app.post('/api/demo/login', async (req, res) => {
    if (!deps.demoLogin) {
      res
        .status(503)
        .json({ error: 'The demo account is not configured on this deployment' });
      return;
    }

    try {
      // Optional: the button shipped before personas existed and still sends no
      // body, which `login` reads as the default persona.
      const persona = (req.body as { persona?: unknown } | undefined)?.persona;
      const result = await deps.demoLogin.login(persona);
      deps.log('info', 'Demo login', {
        status: result.status,
        requestId: req.headers['x-request-id'],
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      // Deliberately not forwarded to the client: the failure modes here name
      // Cognito clients and secret ARNs.
      deps.log('error', 'Demo login failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Demo login failed' });
    }
  });

  /**
   * Where Google sends the visitor back after they approve the scopes.
   *
   * Unauthenticated of necessity: Google performs this navigation and has no
   * bearer token for our API, so `requireAuth` would turn every consent into a
   * 401. The `state` parameter carries the security instead — server-minted,
   * single-use, ten-minute TTL — and a mismatch exchanges nothing and stores
   * nothing. See `integrations/google/oauth.ts` for why that is sufficient.
   *
   * Responds with a small HTML page rather than JSON because a human is looking
   * at it: this is a popup window, and the page's job is to say what happened
   * and close itself.
   */
  app.get('/api/integrations/google/callback', async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;

    const finish = (ok: boolean, message: string) => {
      // Told to the opener so the panel can refresh its readiness immediately
      // rather than waiting for the visitor to reopen it. `origin: '*'` is safe
      // for this payload — it is a boolean and a sentence, no token — and the
      // popup's own origin is ours anyway.
      res.status(ok ? 200 : 400).type('html').send(
        `<!doctype html><meta charset="utf-8"><title>${ok ? 'Connected' : 'Not connected'}</title>` +
          `<body style="font:16px/1.5 system-ui;padding:2rem;color:#2a2226">` +
          `<p>${escapeHtml(message)}</p>` +
          `<p style="color:#8a7f85">You can close this window.</p>` +
          `<script>try{window.opener&&window.opener.postMessage(` +
          `{source:'valentin-google-oauth',ok:${ok ? 'true' : 'false'}},'*');}catch(e){}` +
          `setTimeout(function(){window.close()},${ok ? 1200 : 6000});</script>`,
      );
    };

    if (error) {
      finish(false, 'Google sign-in was cancelled. Nothing was changed.');
      return;
    }
    // State first, before the code is used for anything. An unrecognised state
    // means this redirect was not one we started.
    if (!consumeState(state)) {
      deps.log('warn', 'Rejected a Google OAuth callback with an unknown state');
      finish(false, 'This sign-in link has expired or was not started here. Press Connect again.');
      return;
    }
    if (!code) {
      finish(false, 'Google did not return an authorisation code.');
      return;
    }

    try {
      const result = await exchangeCode(code);
      if (!result.ok || !result.refreshToken) {
        finish(false, result.message);
        return;
      }
      applyGoogleRefreshToken(result.refreshToken);
      // Calendar and Gmail have tools now; register them without a restart.
      buildToolRegistry();
      deps.log('info', 'Google connected via OAuth', { integration: 'google' });
      finish(true, 'Google is connected. Valentin can read your occasions and draft mail for you to approve.');
    } catch (err) {
      deps.log('error', 'Google OAuth callback failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      finish(false, 'Something went wrong finishing the sign-in.');
    }
  });

  /**
   * Where Spotify sends the visitor back after they approve the scope.
   *
   * Unauthenticated for exactly the reason the Google callback above is, and
   * secured the same way: a server-minted single-use `state` with a ten-minute
   * TTL. Kept deliberately parallel to that handler — two OAuth callbacks that
   * differ only where the providers differ are far easier to audit than two that
   * were each invented once.
   */
  app.get('/api/integrations/spotify/callback', async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;

    const finish = (ok: boolean, message: string) => {
      res.status(ok ? 200 : 400).type('html').send(
        `<!doctype html><meta charset="utf-8"><title>${ok ? 'Connected' : 'Not connected'}</title>` +
          `<body style="font:16px/1.5 system-ui;padding:2rem;color:#2a2226">` +
          `<p>${escapeHtml(message)}</p>` +
          `<p style="color:#8a7f85">You can close this window.</p>` +
          `<script>try{window.opener&&window.opener.postMessage(` +
          `{source:'valentin-spotify-oauth',ok:${ok ? 'true' : 'false'}},'*');}catch(e){}` +
          `setTimeout(function(){window.close()},${ok ? 1200 : 6000});</script>`,
      );
    };

    if (error) {
      finish(false, 'Spotify sign-in was cancelled. Nothing was changed.');
      return;
    }
    if (!consumeSpotifyState(state)) {
      deps.log('warn', 'Rejected a Spotify OAuth callback with an unknown state');
      finish(false, 'This sign-in link has expired or was not started here. Press Connect again.');
      return;
    }
    if (!code) {
      finish(false, 'Spotify did not return an authorisation code.');
      return;
    }

    try {
      const result = await exchangeSpotifyCode(code);
      if (!result.ok || !result.refreshToken) {
        finish(false, result.message);
        return;
      }
      applySpotifyRefreshToken(result.refreshToken);
      // The playlist tool can save now rather than hand over links; re-register
      // so that takes effect without a restart.
      buildToolRegistry();
      deps.log('info', 'Spotify connected via OAuth', { integration: 'spotify' });
      finish(
        true,
        'Spotify is connected. Valentin can now save the playlists he offers you, as private playlists.',
      );
    } catch (err) {
      deps.log('error', 'Spotify OAuth callback failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      finish(false, 'Something went wrong finishing the sign-in.');
    }
  });

  /**
   * A shared conversation, read by somebody with no account.
   *
   * Unauthenticated of necessity, and this is the one route in the app where that
   * sentence is about a *person* rather than about a machine: the reader was sent a
   * link by the owner and has never signed in here. `requireAuth` would turn every
   * shared link into a 401, and there is nothing they could present to fix it.
   *
   * **The token is the credential instead.** It is HMAC-signed by this server, it
   * names the owner as well as the session, and it expires — see
   * `sharing/share-token.ts` for what that trades away. Because the owner's id comes
   * out of a payload we signed rather than out of anything the caller said, the read
   * below still goes through that owner's own scoped store: this route reads
   * `deps.forUser(payload.userId)` and cannot reach any other partition.
   *
   * It also cannot go through `scoped`, and not merely by preference — `scoped`
   * reads the store out of `res.locals`, which only `requireAuth` populates. A
   * guest route registered there would dereference an empty context.
   *
   * Every failure is **404, never 401**: an expired token, a forged token, a token
   * for a deleted session and a string of nonsense all get the identical body. An
   * unauthenticated caller must not be able to tell from the response whether they
   * are holding something that used to work, which is what a 401-versus-404 split
   * would tell them.
   */
  app.get('/api/share/:token', async (req, res) => {
    const payload = verifyShareToken(pathParam(req, 'token'));
    if (!payload) {
      deps.log('info', 'Rejected a share link', { reason: 'invalid or expired' });
      res.status(404).json({ error: 'This link has expired or is not valid' });
      return;
    }

    try {
      const { store } = deps.forUser(payload.userId);
      const session = await store.getSession(payload.sessionId);
      if (!session) {
        // The conversation was deleted, or renamed out of existence by a reset. Same
        // answer as a bad token, for the same reason.
        res.status(404).json({ error: 'This link has expired or is not valid' });
        return;
      }

      const messages = await store.getMessagesBySession(payload.sessionId);
      // `buildSharedConversation` is the allowlist: title, transcript, expiry. No
      // session id, no preferences, no people, tasks, outings or manual values.
      res.status(200).json(
        buildSharedConversation(session, messages, new Date(payload.exp * 1000).toISOString()),
      );
      // Neither the token nor the owner's id is logged — the first is a credential
      // and the second is a Cognito `sub` this route was handed by a stranger's URL.
      deps.log('info', 'Served a shared conversation', {
        sessionId: payload.sessionId,
        messages: messages.length,
      });
    } catch (err) {
      deps.log('error', 'Failed to serve a shared conversation', {
        sessionId: payload.sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Turn a share link into a live conversation of the visitor's own.
   *
   * Unauthenticated, like the route above it and for the same reason — the caller has
   * no account and the token is their credential — but this one *writes*, so it is
   * worth being explicit about what it can touch: the owner's store is opened
   * read-only and the fork is written into a freshly minted visitor's store. See
   * `sharing/continue-share.ts` for the identities involved and
   * `sharing/branch-conversation.ts` for why it is a fork.
   *
   * Registered above `requireAuth` deliberately. Below it, a guest has no token yet
   * and would 401 on the one route whose whole job is to give them one.
   */
  app.post('/api/share/:token/continue', async (req, res) => {
    try {
      const result = await continueSharedConversation(pathParam(req, 'token'), {
        forUser: deps.forUser,
        demoLogin: deps.demoLogin,
        authDisabled: isAuthDisabled(),
      });
      // Neither the token nor the owner's id: the first is a credential, the second
      // a `sub` this route was handed by a stranger's URL.
      deps.log('info', 'Continued a shared conversation', {
        status: result.status,
        requestId: req.headers['x-request-id'],
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      deps.log('error', 'Failed to continue a shared conversation', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Everything below requires a token ---

  app.use('/api', requireAuth(deps));

  /*
   * Which outside services this deployment can actually reach.
   *
   * Behind the token even though the body is booleans and labels with no
   * credential in it, because "which integrations are wired up" is a fact about
   * the deployment and the only caller is the panel inside the app. `/api/config`
   * is unauthenticated for a reason that does not apply here — the landing page
   * cannot sign anyone in without it.
   *
   * The handler needs no storage; it goes through `scoped` anyway so it stays in
   * the one route table that `http-routes.test.ts` covers, rather than growing a
   * second inline copy that can drift.
   */
  app.get(
    '/api/integrations',
    scoped(deps, (routes) => routes.listIntegrations()),
  );

  /*
   * Credential intake, from the panel's Connect form.
   *
   * Behind the token, and that is the whole access control: anyone who can reach
   * this can point the deployment's Amadeus or WhatsApp integration at an account
   * of their choosing. In a single-account demo the token is the right boundary;
   * a multi-tenant version of this would need per-user credential storage, which
   * is exactly the identity problem Version B exists to solve.
   *
   * Registered before the `/api/session/*` routes for no reason other than
   * grouping — the paths cannot collide.
   */
  app.post(
    '/api/integrations/:id/connect',
    scoped(deps, async (routes, req) => {
      const id = pathParam(req, 'id');
      const result = await routes.connectIntegration(id, req.body);
      // The id and the outcome, never the body — the body is the credential.
      deps.log('info', 'Integration connect attempted', {
        integration: id,
        status: result.status,
      });
      return result;
    }),
  );

  app.post(
    '/api/integrations/:id/disconnect',
    scoped(deps, async (routes, req) => {
      const id = pathParam(req, 'id');
      const result = await routes.disconnectIntegration(id);
      deps.log('info', 'Integration disconnected', {
        integration: id,
        status: result.status,
      });
      return result;
    }),
  );

  /*
   * Where to send the visitor to consent. Authenticated — unlike the callback,
   * which Google itself performs and which therefore cannot present a token.
   */
  app.get(
    '/api/integrations/google/auth-url',
    scoped(deps, (routes) => routes.googleAuthUrl()),
  );

  // Same for Spotify: authenticated, because the panel asks for it, while the
  // callback above cannot be.
  app.get(
    '/api/integrations/spotify/auth-url',
    scoped(deps, (routes) => routes.spotifyAuthUrl()),
  );

  app.get(
    '/api/sessions',
    scoped(deps, (routes) => routes.listSessions()),
  );

  // Registered before any '/api/session/:id' route so the literal 'seed'
  // segment can never be captured as a session id.
  app.post(
    '/api/session/seed',
    scoped(deps, async (routes, req) => {
      const result = await routes.seedSession(
        (req.body as { persona?: unknown } | undefined)?.persona,
      );
      deps.log('info', 'Demo session seeded', {
        ...(result.body as Record<string, unknown>),
      });
      return result;
    }),
  );

  app.post(
    '/api/session',
    scoped(deps, (routes) => routes.createSession()),
  );

  app.post(
    '/api/session/:id/reset',
    scoped(deps, async (routes, req) => {
      const sessionId = pathParam(req, 'id');
      const result = await routes.resetSession(sessionId);
      deps.log('info', 'Session reset requested', {
        sessionId,
        status: result.status,
      });
      return result;
    }),
  );

  app.get(
    '/api/session/:id/preferences',
    scoped(deps, (routes, req) =>
      routes.getSessionPreferences(pathParam(req, 'id')),
    ),
  );

  // --- Her people, his tasks, his corrections ---
  //
  // All three used to live in localStorage, so the family tree and the to-do
  // ticks vanished on a new device and a hand-typed correction never left the
  // browser. These are the routes that make them real.

  app.get(
    '/api/session/:id/people',
    scoped(deps, (routes, req) => routes.getSessionPeople(pathParam(req, 'id'))),
  );

  app.post(
    '/api/session/:id/people',
    scoped(deps, (routes, req) => routes.savePerson(pathParam(req, 'id'), req.body)),
  );

  app.delete(
    '/api/session/:id/people/:personId',
    scoped(deps, (routes, req) =>
      routes.deletePerson(pathParam(req, 'id'), pathParam(req, 'personId')),
    ),
  );

  app.get(
    '/api/session/:id/tasks',
    scoped(deps, (routes, req) => routes.getSessionTasks(pathParam(req, 'id'))),
  );

  app.post(
    '/api/session/:id/tasks',
    scoped(deps, (routes, req) => routes.saveTask(pathParam(req, 'id'), req.body)),
  );

  app.delete(
    '/api/session/:id/tasks/:taskId',
    scoped(deps, (routes, req) =>
      routes.deleteTask(pathParam(req, 'id'), pathParam(req, 'taskId')),
    ),
  );

  // Where he has taken her. The POST is both "record this" and "here is how it
  // went" — the survey resends the whole row with a rating on it.
  app.get(
    '/api/session/:id/outings',
    scoped(deps, (routes, req) => routes.getSessionOutings(pathParam(req, 'id'))),
  );

  app.post(
    '/api/session/:id/outings',
    scoped(deps, (routes, req) => routes.saveOuting(pathParam(req, 'id'), req.body)),
  );

  app.delete(
    '/api/session/:id/outings/:outingId',
    scoped(deps, (routes, req) =>
      routes.deleteOuting(pathParam(req, 'id'), pathParam(req, 'outingId')),
    ),
  );

  app.get(
    '/api/session/:id/manual',
    scoped(deps, (routes, req) => routes.getManualValues(pathParam(req, 'id'))),
  );

  app.put(
    '/api/session/:id/manual/:fieldId',
    scoped(deps, (routes, req) =>
      routes.setManualValue(pathParam(req, 'id'), pathParam(req, 'fieldId'), req.body),
    ),
  );

  app.delete(
    '/api/session/:id/manual/:fieldId',
    scoped(deps, (routes, req) =>
      routes.clearManualValue(pathParam(req, 'id'), pathParam(req, 'fieldId')),
    ),
  );

  // Writes a home city, not a coordinate — see `setLocation` for why.
  app.post(
    '/api/session/:id/location',
    scoped(deps, (routes, req) => routes.setLocation(pathParam(req, 'id'), req.body)),
  );

  /*
   * Hand one conversation to somebody else, and post one conversation to yourself.
   *
   * Both authenticated: only the owner may mint a share link, and the only address a
   * conversation is ever mailed to is the owner's own `notify_email`. The guest half
   * of sharing is `GET /api/share/:token`, up in the open block.
   *
   * `sessionId` and the status are logged and the token never is. A share token is a
   * seven-day bearer credential for a read of that conversation; logging one would
   * put it in CloudWatch, which is retained longer and read more widely than the
   * link itself.
   */
  app.post(
    '/api/session/:id/share',
    scoped(deps, async (routes, req) => {
      const sessionId = pathParam(req, 'id');
      const result = await routes.shareSession(sessionId);
      deps.log('info', 'Share link minted', { sessionId, status: result.status });
      return result;
    }),
  );

  app.post(
    '/api/session/:id/email',
    scoped(deps, async (routes, req) => {
      const sessionId = pathParam(req, 'id');
      const result = await routes.emailSession(sessionId);
      deps.log('info', 'Conversation emailed', { sessionId, status: result.status });
      return result;
    }),
  );

  // Registered last of the /api/session routes, so the more specific patterns
  // above are matched first.
  app.get(
    '/api/session/:id',
    scoped(deps, (routes, req) => routes.getSessionDetail(pathParam(req, 'id'))),
  );

  app.patch(
    '/api/session/:id',
    scoped(deps, (routes, req) =>
      routes.renameSession(
        pathParam(req, 'id'),
        (req.body as { title?: unknown } | undefined)?.title,
      ),
    ),
  );

  app.delete(
    '/api/session/:id',
    scoped(deps, async (routes, req) => {
      const sessionId = pathParam(req, 'id');
      const result = await routes.deleteSession(sessionId);
      deps.log('info', 'Session deleted', { sessionId, status: result.status });
      return result;
    }),
  );

  return app;
}
