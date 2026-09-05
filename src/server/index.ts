import { resolveStorageBackend } from './persistence/create-store';
import { countingStore } from './persistence/counting-store';
import { InMemoryStoreFactory } from './persistence/in-memory-store';
import { DynamoDBStoreFactory } from './persistence/dynamodb-store';
import { InMemoryConversationMemory } from './persistence/conversation-memory';
import { AwsBedrockClient } from './agent/bedrock-client';
import {
  checkBedrockReadiness,
  describeReadiness,
  type BedrockReadiness,
} from './agent/bedrock-preflight';
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
import {
  GatewayToolClient,
  gatewayClientConfigFromEnv,
} from './agent/gateway-client';
import { DEFAULT_ENGINE, resolveEngine, type AgentEngine } from './agent/engine';
import { PreferenceExtractor } from './extraction/preference-extractor';
import { EventRouter } from './api/event-router';
import { WsGateway } from './api/ws-gateway';
import { createHttpRoutes } from './api/http-routes';
import { buildToolRegistry } from './integrations';
import type { ActionProposal } from './integrations/tool-registry';
import type { Outing } from '../shared/interfaces/outing';
import { loadRemoteCredentials } from './integrations/credential-store';
import { probeBrowserReadiness } from './integrations/browser/session';
import { primePlacesKey } from './integrations/google-places/client';
import { startSpanBridge } from './telemetry/span-bridge';
import {
  ANONYMOUS_USER_ID,
  createTokenVerifier,
  type TokenVerifier,
} from './auth/token-verifier';
import { DemoLoginService } from './auth/demo-login';
import type {
  ReminderIndexReader,
  ScopedStorageFactory,
  ScopedStorageOptions,
  StorageInterface,
} from './persistence/storage-interface';
import { startReminderScheduler } from './reminders/scheduler';
import { resolveSender } from './reminders/sender';
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
function defaultStoreFactory(): ScopedStorageFactory & ReminderIndexReader {
  const backend = resolveStorageBackend();

  // Which backend is live is invisible once the server is running — everything
  // downstream sees only `StorageInterface`. This one line at boot is the only
  // way to tell a durable deployment from an amnesiac one.
  logger.info('storage.initialized', { backend });

  const factory = backend === 'dynamodb' ? new DynamoDBStoreFactory() : new InMemoryStoreFactory();

  // Wrapped here, at the one place a store is constructed, so BOTH engines' stores
  // are counted identically. `agentcore-orchestrator.ts` documents which variables are
  // held constant between the engines so a measured difference is attributable to
  // AgentCore; instrumenting one engine's reads and not the other's would make this
  // counter the difference.
  return {
    forUser: (userId, opts) => countingStore(factory.forUser(userId, opts)),
    // The due-index passes straight through uncounted: it is not user-scoped, so
    // there is no per-user counter that could wrap it.
    dueBefore: (at, limit) => factory.dueBefore(at, limit),
    markSent: (reminder, sentAt) => factory.markSent(reminder, sentAt),
    recordFailure: (reminder, error) => factory.recordFailure(reminder, error),
  };
}

/**
 * The store factory to serve requests from, and the due-index to sweep — which is
 * only ever the server's own factory. An injected store is a `ScopedStorageFactory`
 * and carries no cross-user index by design, so a test that supplies one gets a
 * null index and therefore no timer, which is what every existing test expects.
 */
function resolveStores(deps: ServerDeps): {
  storeFactory: ScopedStorageFactory;
  reminderIndex: ReminderIndexReader | null;
} {
  if (deps.store) return { storeFactory: deps.store, reminderIndex: null };
  const own = defaultStoreFactory();
  return { storeFactory: own, reminderIndex: own };
}

/** Initialize all dependencies and start the server */
export function createServer(deps: ServerDeps = {}) {
  const { storeFactory, reminderIndex } = resolveStores(deps);
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
  const requestedEngine = deps.engine ?? resolveEngine();

  /*
   * Built only on engine B, and only once — the client holds a connection pool,
   * so one per user would open a pool per signed-in visitor. Constructing it on
   * engine A would try to read config that is deliberately unset there and throw
   * `AgentCoreNotConfiguredError` at boot.
   *
   * Caught rather than allowed to propagate, because `resolveEngine`'s promise is
   * that a requested-but-unavailable engine downgrades loudly instead of taking
   * the task down — and it can only keep half of that promise on its own. It
   * checks `runtimeArn`, but `BedrockAgentCoreRuntime` also requires
   * `AGENTCORE_MEMORY_ID`, and `deps.engine` bypasses the check altogether. So
   * the construction itself is the honest place to decide availability: whatever
   * is missing, engine A answers and `agent.engine` reports what actually ran.
   */
  let engine = requestedEngine;
  let agentCoreRuntime: AgentCoreRuntime | null = null;
  if (engine === 'agentcore') {
    try {
      agentCoreRuntime = deps.agentCoreRuntime ?? new BedrockAgentCoreRuntime();
    } catch (err) {
      logger.error('agent.engine.unavailable', {
        requested: 'agentcore',
        resolved: DEFAULT_ENGINE,
        reason: err instanceof Error ? err.message : String(err),
      });
      engine = DEFAULT_ENGINE;
    }
  }

  /*
   * Engine B's way back into the Gateway, built once for the process.
   *
   * Shared across users on purpose, unlike everything inside `forUser`: what it
   * caches is a machine client's token and secret, which belong to the task and
   * not to any caller. It carries no user state — the ids travel as arguments on
   * each call — so one instance is right, and a per-user one would mean a Cognito
   * token exchange per visitor.
   *
   * Null when the wiring is absent, which is the normal state locally and in
   * tests: `confirmAction` then says it cannot complete the booking instead of
   * failing at boot, because reading and proposing still work without it.
   */
  const gatewayConfig = engine === 'agentcore' ? gatewayClientConfigFromEnv() : null;
  const gatewayToolClient = gatewayConfig ? new GatewayToolClient(gatewayConfig) : null;
  if (engine === 'agentcore' && !gatewayToolClient) {
    logger.warn('agent.gateway.unwired', {
      reason:
        'GATEWAY_CLIENT_ID / GATEWAY_TOKEN_URL / AGENTCORE_GATEWAY_URL / COGNITO_USER_POOL_ID incomplete',
    });
  }

  logger.info('agent.engine', { requested: process.env.AGENT_ENGINE ?? null, resolved: engine });

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

    /*
     * Both engines emit the same two events, so both get the same two callbacks.
     *
     * Declared once above the branch rather than twice inside it: these are the
     * client's only notice that a card should appear and that a booking landed,
     * and a copy per engine is how one of them ends up a field behind the other.
     * Note the field-by-field mapping in `onProposal` — never a spread.
     * `ActionProposal.payload` is opaque and occasionally sensitive, and on
     * engine B it never even reached this process; listing the fields is what
     * keeps a later addition to the type from silently going to the browser.
     *
     * The late-closed edge on `eventRouter` is the same one the extractor's
     * callbacks use above, and for the same reason: the router is built from the
     * orchestrator that is built from these.
     */
    const onProposal = (proposal: ActionProposal): void => {
      eventRouter?.emitActionProposal({
        sessionId: proposal.sessionId,
        proposalId: proposal.id,
        service: proposal.service,
        title: proposal.title,
        summary: proposal.summary,
        url: proposal.url,
        expiresAt: proposal.expiresAt,
      });
    };

    // The counterpart to `onProposal`: a proposal is the question, this is the
    // answer having happened. It fires after the confirm succeeded and the row is
    // written, so the history on screen gains the place he just booked without
    // waiting for a reload.
    const onBooking = (sessionId: string, outing: Outing): void => {
      eventRouter?.emitOutingUpdate(sessionId, outing);
    };

    // The one place the two engines diverge. Everything either side of this —
    // the store, the conversation memory, the event router, the HTTP routes and
    // the socket — is shared, so a difference in behaviour has exactly one
    // possible source.
    //
    // Engine A carries the integration tool registry in-process; engine B reaches
    // the same tools through the AgentCore Gateway, so what it carries instead is
    // a client for the one call the application makes itself — the confirm.
    const orchestrator: AgentOrchestratorInterface = agentCoreRuntime
      ? new AgentCoreOrchestrator(
          store,
          memory,
          agentCoreRuntime,
          userId,
          (pref, isNew) => {
            eventRouter?.emitPreferenceUpdate(pref, isNew);
          },
          {
            onProposal,
            onBooking,
            ...(gatewayToolClient ? { gateway: gatewayToolClient } : {}),
          },
        )
      : new AgentOrchestrator(
          store,
          memory,
          bedrockClient,
          runtime,
          extractor,
          {
            registry: toolRegistry,
            // Reaches tools as `ToolContext.userId`. `create_conversation_link`
            // needs it because a share token names the owner as well as the
            // session; nothing else reads it, and no tool can change it.
            userId,
            onProposal,
            onBooking,
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
      // The user id is passed as well as the scoped store, and only so that
      // `shareSession` can mint a token naming an owner — see the factory's header
      // for why that beats injecting a `mintShare` callback from here.
      httpRoutes: createHttpRoutes(store, userId),
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

  /*
   * Pick up any credential this task did not get from its environment.
   *
   * Not awaited, for the same reason and by the same mechanism as the browser
   * probe above: `buildToolRegistry` refills the registry map *in place*, so
   * every holder — including the orchestrator built before this resolves — sees
   * the new tools. Until it lands, a service with no env credential reports
   * unready, which is the safe direction to be briefly wrong in.
   *
   * Deliberately NOT blocking. Awaiting it would put Secrets Manager in the boot
   * path of a layer whose stated contract is "absent rather than broken", and
   * turn a Secrets Manager blip into a health check the load balancer never sees
   * answered. `loadRemoteCredentials` also never rejects, so the `.then` is
   * reached either way.
   */
  void loadRemoteCredentials().then(() => {
    buildToolRegistry();
  });

  /*
   * Same shape, same reasoning: read the Maps key out of Secrets Manager and, if it
   * is there, register the tool that needs it.
   *
   * Not awaited, because a Secrets Manager round trip is not something the health
   * check should wait behind, and not a boot failure, because a deployment with no
   * Maps key should lose place search and nothing else.
   *
   * Independent of `loadRemoteCredentials` above rather than chained to it: the two
   * read different secrets, and `buildToolRegistry` refills the registry map in
   * place, so whichever resolves second simply adds its tools to what the first
   * registered. Ordering does not matter; both landing does.
   */
  void primePlacesKey().then((ready) => {
    if (ready) buildToolRegistry();
  });

  /*
   * Ask once, at boot, whether this process can actually reach the model.
   *
   * Same not-awaited shape and the same reasoning as the probes above: the health
   * check backs the ALB target group, and putting a Converse round trip in front
   * of `listen()` would let a Bedrock blip stall a deploy. Until it resolves,
   * `/api/health` reports the model as `checking`.
   *
   * The value is entirely in *where the news arrives*. Without this, a process
   * that cannot invoke the model looks identical to a healthy one until somebody
   * types into the chat and gets the "having a little trouble" fallback — a
   * sentence that reads like a transient blip, so the actual cause (usually a
   * missing AWS_PROFILE or a stray AWS_REGION locally) gets diagnosed live, on
   * stage. Here it is a labelled banner in the boot log instead.
   */
  let bedrockReadiness: BedrockReadiness | null = null;
  void checkBedrockReadiness(bedrockClient).then((readiness) => {
    bedrockReadiness = readiness;
    const banner = describeReadiness(
      readiness,
      bedrockClient.getModelId(),
      process.env.AWS_REGION ?? 'us-east-1',
    );
    if (readiness.ok) console.log(banner);
    else console.error(banner);
  });

  // Register the agent on startup
  runtime.registerAgent().then((agentId) => {
    console.log(`[server] Valentin agent registered: ${agentId}`);
  }).catch((err) => {
    console.error('[server] Failed to register agent:', err);
  });

  /*
   * Started here rather than in `dev-server.ts` so both the deployed task and a
   * local run sweep identically — a reminder path that only exists in production is
   * one nobody has watched fire.
   */
  const reminderScheduler =
    reminderIndex && config.reminders.enabled
      ? startReminderScheduler({
          reader: reminderIndex,
          sender: resolveSender(config.reminders.channel),
          intervalMs: config.reminders.intervalMs,
          origin: config.publicOrigin,
          // What turns "her birthday is a week away" into a mail with restaurants in
          // it: the sweeper scopes this per row, so the composer reads one profile.
          storeFactory,
        })
      : null;

  return {
    gateway,
    reminderScheduler,
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
    /**
     * What the boot-time model probe found, or `null` while it is still in
     * flight. A getter rather than a value because it resolves after
     * `createServer` returns.
     */
    bedrockReadiness: () => bedrockReadiness,
    httpRoutes: anonymous.httpRoutes,
    orchestrator: anonymous.orchestrator,
    store: anonymous.store,
  };
}

// TODO(yellow): add proper server startup with HTTP listener when @types/node is available
