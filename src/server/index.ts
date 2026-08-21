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
import type {
  ScopedStorageFactory,
  ScopedStorageOptions,
  StorageInterface,
} from './persistence/storage-interface';
import { config } from './config';
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
}

/**
 * The user whose data an unauthenticated request touches.
 *
 * A placeholder, and the *only* remaining hardcoded user id in the codebase —
 * the store it replaces built `USER#anonymous` inline at four separate sites.
 * PR 3 wires JWT verification and passes the Cognito `sub` here instead; until
 * then everything still lands in one partition, but it does so in one place.
 */
export const ANONYMOUS_USER_ID = 'anonymous';

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

/** Pick a storage backend from the environment */
function defaultStoreFactory(): ScopedStorageFactory {
  if (config.nodeEnv === 'production') {
    return new DynamoDBStoreFactory();
  }
  return new InMemoryStoreFactory();
}

/** Initialize all dependencies and start the server */
export function createServer(deps: ServerDeps = {}) {
  const storeFactory = deps.store ?? defaultStoreFactory();

  // AWS Bedrock — always use real LLM, no stubs
  const bedrockClient = new AwsBedrockClient();
  const agentCore = new StubAgentCoreAdapter();

  console.log(`[server] AWS Bedrock (region: ${process.env.AWS_REGION ?? 'us-east-1'}, model: ${process.env.BEDROCK_MODEL_ID ?? 'claude-3-haiku'})`);

  // Emit function — will be wired to WsGateway after creation
  let gateway: WsGateway | null = null;
  const emit = (event: ServerEvent): void => {
    if (!gateway) return;

    const sessionId = resolveBroadcastSessionId(
      event.payload as Record<string, unknown>,
    );

    if (sessionId) {
      gateway.broadcastToSession(sessionId, event);
    }
  };

  /** Build the user-scoped graph for one caller */
  function forUser(userId: string, opts?: ScopedStorageOptions): UserServices {
    const store = storeFactory.forUser(userId, opts);
    const memory = new InMemoryConversationMemory(store);

    // The extractor's callback needs the router that is built from the
    // orchestrator that is built from the extractor, so one of the three edges
    // has to be closed late. This is that edge.
    let eventRouter: EventRouter | null = null;
    const extractor = new PreferenceExtractor(bedrockClient, store, (pref, isNew) => {
      eventRouter?.emitPreferenceUpdate(pref, isNew);
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

  // Until PR 3 lands JWT verification there is one caller, so the returned
  // graph is that caller's. `forUser` is what the auth handler will use.
  const anonymous = forUser(ANONYMOUS_USER_ID);
  gateway = new WsGateway(anonymous.eventRouter);

  // Register agent with AgentCore on startup
  agentCore.registerAgent().then((agentId) => {
    console.log(`[server] Valentin agent registered: ${agentId}`);
  }).catch((err) => {
    console.error('[server] Failed to register agent:', err);
  });

  return {
    gateway,
    storeFactory,
    forUser,
    httpRoutes: anonymous.httpRoutes,
    orchestrator: anonymous.orchestrator,
    store: anonymous.store,
  };
}

// TODO(yellow): add proper server startup with HTTP listener when @types/node is available
