import { createStore } from './persistence/create-store';
import { InMemoryConversationMemory } from './persistence/conversation-memory';
import { AwsBedrockClient } from './agent/bedrock-client';
import { StubAgentCoreAdapter } from './agent/agentcore-adapter';
import { AgentOrchestrator } from './agent/agent-orchestrator';
import { PreferenceExtractor } from './extraction/preference-extractor';
import { EventRouter } from './api/event-router';
import { WsGateway } from './api/ws-gateway';
import { createHttpRoutes } from './api/http-routes';
import { startSpanBridge } from './telemetry/span-bridge';
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

/** Initialize all dependencies and start the server */
export function createServer() {
  // Persistence — in-memory unless STORAGE_BACKEND says otherwise
  const store = createStore();
  const memory = new InMemoryConversationMemory(store);

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

  // Preference extractor with callback wired to event router
  let eventRouter: EventRouter | null = null;
  const extractor = new PreferenceExtractor(bedrockClient, store, (pref, isNew) => {
    if (eventRouter) {
      eventRouter.emitPreferenceUpdate(pref, isNew);
    }
  });

  // Agent orchestrator
  const orchestrator = new AgentOrchestrator(
    store,
    memory,
    bedrockClient,
    agentCore,
    extractor,
  );

  // Telemetry — turns the server's own log lines into `aws_span` events. Not
  // load-bearing: remove this and the drawer still opens and still highlights
  // from WebSocket events, it just loses the measured durations.
  startSpanBridge(emit);

  // API layer
  eventRouter = new EventRouter(orchestrator, emit);
  gateway = new WsGateway(eventRouter);
  const httpRoutes = createHttpRoutes(store);

  // Register agent with AgentCore on startup
  agentCore.registerAgent().then((agentId) => {
    console.log(`[server] Valentin agent registered: ${agentId}`);
  }).catch((err) => {
    console.error('[server] Failed to register agent:', err);
  });

  return {
    gateway,
    httpRoutes,
    orchestrator,
    store,
  };
}

// TODO(yellow): add proper server startup with HTTP listener when @types/node is available
