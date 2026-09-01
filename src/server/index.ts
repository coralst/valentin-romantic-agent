import { resolveStorageBackend } from './persistence/create-store';
import { InMemoryStoreFactory } from './persistence/in-memory-store';
import { DynamoDBStoreFactory } from './persistence/dynamodb-store';
import { InMemoryConversationMemory } from './persistence/conversation-memory';
import { AwsBedrockClient } from './agent/bedrock-client';
import { LocalValentinRuntime } from './agent/valentin-runtime';
import {
  BedrockAgentCoreRuntime,
  StubAgentCoreAdapter,
  type AgentCoreRuntime,
} from './agent/agentcore-adapter';
import {
  AgentOrchestrator,
  type AgentOrchestratorInterface,
} from './agent/agent-orchestrator';
import { AgentCoreOrchestrator } from './agent/agentcore-orchestrator';
import { resolveEngine, type AgentEngine } from './agent/engine';
import { PreferenceExtractor } from './extraction/preference-extractor';
import { EventRouter } from './api/event-router';
import { WsGateway } from './api/ws-gateway';
import { createHttpRoutes } from './api/http-routes';
import { buildToolRegistry } from './integrations';
import { probeBrowserReadiness } from './integrations/browser/session';
import { startSpanBridge } from './telemetry/span-bridge';
import {
  ANONYMOUS_USER_ID,
  createTokenVerifier,
  type TokenVerifier,
} from './auth/token-verifier';
import { DemoLoginService } from './auth/demo-login';
import type {
  ScopedStorageFactory,
  ScopedStorageOptions,
  StorageInterface,
} from './persistence/storage-interface';
import { config } from './config';
import { logger } from './logging';
import type { ServerEvent } from '../shared/interfaces/ws-events';

/**
 * Resolve the session a ServerEvent should be broadcast to.
 *
 * Different event types carry the sessionId in different places:
 * - `typing_start` / `typing_stop` put it at the top level of the payload
 * - `agent_message` nests it inside `payload.message`
 * - `preference_update` nests it inside `payload.preference`
 *
 * Returns undefined when no session can be determined, in which case the event
 * cannot be routed to any client.
 */
export function resolveBroadcastSessionId(
  payload: Record<string, unknown>,
): string | undefined {
  const nested = (key: string): string | undefined =>
    (payload[key] as Record<string, unknown> | undefined)?.sessionId as
      | string
      | undefined;

  return (
    (payload.sessionId as string | undefined) ??
    nested('message') ??
    nested('preference')
  );
}

/** Injectable collaborators, so tests never reach a real AWS account */
export interface ServerDeps {
  /**
   * Where user data lives. Defaults to DynamoDB in production and to memory
   * everywhere else.
   *
   * Injection is not a nicety here: `__tests__/index.test.ts` calls
   * `createServer()` eight times and three of those exercise storage for real.
   * A production default with no seam would turn `npm test` into live traffic
   * against `ValentinTable-dev`.
   */
  store?: ScopedStorageFactory;

  /**
   * How bearer tokens become user ids. Defaults to Cognito when the pool is
   * configured and to the dev bypass otherwise — see createTokenVerifier, which
   * refuses the bypass in production.
   */
  verifier?: TokenVerifier;

  /**
   * Which engine to serve. Defaults to `resolveEngine()`, i.e. `AGENT_ENGINE`.
   *
   * Overridable so a test can exercise engine B without setting a process-wide
   * environment variable — vitest runs files in one process per pool worker, so
   * an `AGENT_ENGINE` set by one test would leak into the next.
   */
  engine?: AgentEngine;

  /**
   * The AgentCore data plane, when engine B is being served.
   *
   * Required for any test of engine B: the real client is constructed from
   * `config.agentCore` and would reach a live Runtime.
   */
  agentCoreRuntime?: AgentCoreRuntime;
}

export { ANONYMOUS_USER_ID };

/**
 * How long the shared demo account's data lives before DynamoDB expires it.
 *
 * A backstop, not the mechanism: TTL deletion is best-effort and can lag by
 * up to 48 hours, so DemoLoginService reaps stale sessions explicitly. This
 * catches whatever a reap misses — for instance if nobody clicks the demo
 * button again for a month.
 */
const DEMO_TTL_SECONDS = 24 * 60 * 60;

/**
 * The per-user half of the object graph.
 *
 * Bedrock client, agent runtime and WsGateway are process singletons; these
 * five are not, because each closes over a user-scoped store. All are
 * constructor-only, so building them per connection costs nothing measurable.
 */
export interface UserServices {
  store: StorageInterface;
  memory: InMemoryConversationMemory;
  /**
   * Built on both engines, invoked only on engine A.
   *
   * Engine B gets preference extraction from AgentCore Memory's managed
   * strategy instead of from this hand-written pipeline — that substitution is
   * most of what the comparison is about. It is still constructed here because
   * it is constructor-only and costs nothing, and because `forUser` returning a
   * different shape per engine would push the branch into every caller.
   */
  extractor: PreferenceExtractor;
  /** {@link AgentOrchestrator} on engine A, {@link AgentCoreOrchestrator} on B. */
  orchestrator: AgentOrchestratorInterface;
  /** Which engine `orchestrator` actually is, for `/api/config` to report. */
  engine: AgentEngine;
  eventRouter: EventRouter;
  httpRoutes: ReturnType<typeof createHttpRoutes>;
}

/**
 * Pick a storage backend from the environment.
 *
 * Keyed on `STORAGE_BACKEND`, not on `NODE_ENV`. The deployed container runs
 * with `NODE_ENV=production` in a *dev* AWS account, so the two are not
 * interchangeable — and `infra/lib/compute-stack.ts` sets `STORAGE_BACKEND`
 * explicitly, which would be a lie in the task definition if nothing read it.
 * `resolveStorageBackend` also normalises case and falls back to memory with a
 * warning on a typo rather than taking the server down.
 */
function defaultStoreFactory(): ScopedStorageFactory {
  const backend = resolveStorageBackend();

  // Which backend is live is invisible once the server is running — everything
  // downstream sees only `StorageInterface`. This one line at boot is the only
  // way to tell a durable deployment from an amnesiac one.
  logger.info('storage.initialized', { backend });

  return backend === 'dynamodb'
    ? new DynamoDBStoreFactory()
    : new InMemoryStoreFactory();
}

/** Initialize all dependencies and start the server */
export function createServer(deps: ServerDeps = {}) {
  const storeFactory = deps.store ?? defaultStoreFactory();
  const verifier = deps.verifier ?? createTokenVerifier();

  // AWS Bedrock — always use real LLM, no stubs
  const bedrockClient = new AwsBedrockClient();
  const runtime = new LocalValentinRuntime();

  // Built once: the tools are stateless and credential-gated at boot, so there
  // is nothing per-user about them. What *is* per-user is the proposal store,
  // which lives on the orchestrator.
  const toolRegistry = buildToolRegistry();

  /*
   * Decided once, at boot, and logged.
   *
   * Which engine a task serves is invisible from the outside once it is running —
   * both services run the same image, listen on the same port and answer the same
   * routes — so this line is the only thing that distinguishes the two in the
   * logs. `resolveEngine` also downgrades to engine A rather than throwing when
   * the AgentCore wiring is missing, so the value logged here is what actually
   * ran, not what was asked for.
   */
  const engine = deps.engine ?? resolveEngine();
  logger.info('agent.engine', { requested: process.env.AGENT_ENGINE ?? null, resolved: engine });

  /*
   * Built only on engine B, and only once — the client holds a connection pool,
   * so one per user would open a pool per signed-in visitor. Constructing it on
   * engine A would try to read config that is deliberately unset there and throw
   * `AgentCoreNotConfiguredError` at boot.
   */
  const agentCoreRuntime: AgentCoreRuntime | null =
    engine === 'agentcore' ? (deps.agentCoreRuntime ?? new BedrockAgentCoreRuntime()) : null;

  console.log(`[server] AWS Bedrock (region: ${process.env.AWS_REGION ?? 'us-east-1'}, model: ${process.env.BEDROCK_MODEL_ID ?? 'claude-3-haiku'})`);

  // Wired to WsGateway after creation. Built per user, because a session id
  // alone no longer identifies a broadcast target — two users may legitimately
  // hold the same session id, since the user is part of the storage key.
  let gateway: WsGateway | null = null;
  const emitFor = (userId: string) => (event: ServerEvent): void => {
    if (!gateway) return;

    const sessionId = resolveBroadcastSessionId(
      event.payload as Record<string, unknown>,
    );

    if (sessionId) {
      gateway.broadcastToSession(userId, sessionId, event);
    }
  };

  /** Build the user-scoped graph for one caller */
  function forUser(userId: string, opts?: ScopedStorageOptions): UserServices {
    const store = storeFactory.forUser(userId, opts);
    const emit = emitFor(userId);
    const memory = new InMemoryConversationMemory(store);

    // The extractor's callback needs the router that is built from the
    // orchestrator that is built from the extractor, so one of the three edges
    // has to be closed late. This is that edge.
    let eventRouter: EventRouter | null = null;
    const extractor = new PreferenceExtractor(bedrockClient, store, {
      onPreference: (pref, isNew) => {
        eventRouter?.emitPreferenceUpdate(pref, isNew);
      },
      // Pushed for the same reason preferences are: the family tree and the
      // to-do list are on screen while he is talking, and a card that only
      // appears after a reload reads as the app not having listened.
      onPerson: (sessionId, person, isNew) => {
        eventRouter?.emitPersonUpdate(sessionId, person, isNew);
      },
      onTask: (sessionId, task, isNew) => {
        eventRouter?.emitTaskUpdate(sessionId, task, isNew);
      },
    });

    // The one place the two engines diverge. Everything either side of this —
    // the store, the conversation memory, the event router, the HTTP routes and
    // the socket — is shared, so a difference in behaviour has exactly one
    // possible source.
    //
    // Engine A carries the integration tool registry; engine B reaches the same
    // tools through the AgentCore Gateway instead, so the registry and the
    // proposal callback belong on this side of the branch only.
    const orchestrator: AgentOrchestratorInterface = agentCoreRuntime
      ? new AgentCoreOrchestrator(store, memory, agentCoreRuntime, userId, (pref, isNew) => {
          eventRouter?.emitPreferenceUpdate(pref, isNew);
        })
      : new AgentOrchestrator(
          store,
          memory,
          bedrockClient,
          runtime,
          extractor,
          {
            registry: toolRegistry,
            // The same late-closed edge as the extractor's callback above, and
            // for the same reason: the router is built from the orchestrator.
            onProposal: (proposal) => {
              eventRouter?.emitActionProposal({
                sessionId: proposal.sessionId,
                proposalId: proposal.id,
                service: proposal.service,
                title: proposal.title,
                summary: proposal.summary,
                url: proposal.url,
                expiresAt: proposal.expiresAt,
              });
            },
          },
        );

    eventRouter = new EventRouter(orchestrator, emit);

    return {
      store,
      memory,
      extractor,
      orchestrator,
      engine,
      eventRouter,
      httpRoutes: createHttpRoutes(store),
    };
  }

  gateway = new WsGateway({ verifier, forUser });

  // Only built when the deployment actually has a demo account. Left undefined
  // the route answers 503, which is the truth — and it keeps the AWS SDK
  // clients from being constructed during `npm test`.
  const demoLogin = config.cognito.demoSecretArn
    ? new DemoLoginService({
        verifier,
        // Demo data expires on its own, as a backstop to the explicit reap.
        // Real users' history must never evaporate, so only this store gets a
        // ttl.
        storeFor: (userId) =>
          storeFactory.forUser(userId, { ttlSeconds: DEMO_TTL_SECONDS }),
        seedSession: async (storage, persona) => {
          const result = await createHttpRoutes(storage).seedSession(persona);
          return (result.body as { sessionId: string }).sessionId;
        },
      })
    : undefined;

  // The graph for callers that present no token at all. Only reachable when the
  // dev bypass is active — in production `requireAuth` rejects them before any
  // route runs — but it is also what the existing createServer tests exercise.
  const anonymous = forUser(ANONYMOUS_USER_ID);

  // Telemetry — turns the server's own log lines into `aws_span` events.
  //
  // One subscription for the whole process, deliberately: `startSpanBridge`
  // returns the only unsubscribe handle, so calling it per connection would leak
  // a subscriber per socket. It routes by the userId the log record carries,
  // which `logging.ts` supplies from the ambient scope `WsGateway` sets.
  //
  // Not load-bearing: remove this and the drawer still opens and still
  // highlights from WebSocket events, it just loses the measured durations.
  startSpanBridge((userId, event) => emitFor(userId)(event));

  /*
   * Find out whether this deployment can drive a browser, and register the tools
   * that depend on it if so.
   *
   * Deliberately not awaited. Launching Chromium takes a second or two and no
   * request needs the answer to be served — `integrationReadiness()` reports the
   * browser as unready until this lands, which is the safe direction to be briefly
   * wrong in. Blocking boot on it would delay the health check the load balancer is
   * waiting for, on behalf of a capability that may not even be installed.
   */
  void probeBrowserReadiness().then((ready) => {
    if (ready) buildToolRegistry();
  });

  // Register the agent on startup
  runtime.registerAgent().then((agentId) => {
    console.log(`[server] Valentin agent registered: ${agentId}`);
  }).catch((err) => {
    console.error('[server] Failed to register agent:', err);
  });

  return {
    gateway,
    storeFactory,
    verifier,
    demoLogin,
    forUser,
    /**
     * Handed to `createExpressApp` so `/api/config` can report it.
     *
     * Returned rather than recomputed there because `resolveEngine` logs when it
     * downgrades, and a per-request call would repeat that warning on every hit.
     */
    engine,
    httpRoutes: anonymous.httpRoutes,
    orchestrator: anonymous.orchestrator,
    store: anonymous.store,
  };
}

// TODO(yellow): add proper server startup with HTTP listener when @types/node is available
