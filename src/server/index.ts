import { resolveStorageBackend } from './persistence/create-store';
import { InMemoryStoreFactory } from './persistence/in-memory-store';
import { DynamoDBStoreFactory } from './persistence/dynamodb-store';
import { InMemoryConversationMemory } from './persistence/conversation-memory';
import { AwsBedrockClient } from './agent/bedrock-client';
import { StubAgentCoreAdapter } from './agent/agentcore-adapter';
import { AgentOrchestrator } from './agent/agent-orchestrator';
import { PreferenceExtractor } from './extraction/preference-extractor';
import { EventRouter } from './api/event-router';
import { WsGateway } from './api/ws-gateway';
import { createHttpRoutes } from './api/http-routes';
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
 * Bedrock client, AgentCore adapter and WsGateway are process singletons; these
 * five are not, because each closes over a user-scoped store. All are
 * constructor-only, so building them per connection costs nothing measurable.
 */
export interface UserServices {
  store: StorageInterface;
  memory: InMemoryConversationMemory;
  extractor: PreferenceExtractor;
  orchestrator: AgentOrchestrator;
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
  const agentCore = new StubAgentCoreAdapter();

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

    const orchestrator = new AgentOrchestrator(
      store,
      memory,
      bedrockClient,
      agentCore,
      extractor,
    );

    eventRouter = new EventRouter(orchestrator, emit);

    return {
      store,
      memory,
      extractor,
      orchestrator,
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

  // Register agent with AgentCore on startup
  agentCore.registerAgent().then((agentId) => {
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
    httpRoutes: anonymous.httpRoutes,
    orchestrator: anonymous.orchestrator,
    store: anonymous.store,
  };
}

// TODO(yellow): add proper server startup with HTTP listener when @types/node is available
