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
  demoLogin?: Pick<DemoLoginService, 'login'>;
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
    res.status(200).json({
      status: 'healthy',
      uptime: process.uptime(),
      connections: deps.connectionCount(),
      environment: process.env.NODE_ENV ?? 'development',
      authenticated: !isAuthDisabled(),
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

  // --- Everything below requires a token ---

  app.use('/api', requireAuth(deps));

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
