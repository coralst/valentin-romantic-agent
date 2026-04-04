import { InMemoryStore } from './persistence/in-memory-store';
import { InMemoryConversationMemory } from './persistence/conversation-memory';
import { StubBedrockClient } from './agent/bedrock-client';
import { StubAgentCoreAdapter } from './agent/agentcore-adapter';
import { AgentOrchestrator } from './agent/agent-orchestrator';
import { PreferenceExtractor } from './extraction/preference-extractor';
import { EventRouter } from './api/event-router';
import { WsGateway } from './api/ws-gateway';
import { createHttpRoutes } from './api/http-routes';
import type { ServerEvent } from '../shared/interfaces/ws-events';

// TODO(yellow): replace stub Bedrock/AgentCore with real SDK when AWS credentials are available

/** Initialize all dependencies and start the server */
export function createServer() {
  // Persistence
  const store = new InMemoryStore();
  const memory = new InMemoryConversationMemory(store);

  // AWS service stubs
  const bedrockClient = new StubBedrockClient();
  const agentCore = new StubAgentCoreAdapter();

  // Emit function — will be wired to WsGateway after creation
  let gateway: WsGateway | null = null;
  const emit = (event: ServerEvent): void => {
    if (!gateway) return;

    // Broadcast to session — sessionId may be at top level or nested in message
    const payload = event.payload as Record<string, unknown>;
    const sessionId =
      (payload.sessionId as string | undefined) ??
      ((payload.message as Record<string, unknown> | undefined)?.sessionId as string | undefined);

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
