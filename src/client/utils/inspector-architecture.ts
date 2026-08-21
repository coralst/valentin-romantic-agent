import type { ServerEvent } from '../../shared/interfaces/ws-events';

/**
 * The architecture model rendered by the Valentin Inspector.
 *
 * Node ids are stable and structural; every human-visible string lives in
 * `ARCHITECTURE_NODES` below so the diagram can be retuned for a different
 * talk framing (the app, the method, or the AWS architecture) by editing
 * labels here and nowhere else. The event→node mapping is unaffected by
 * relabelling.
 *
 * Names are verified against the real implementation:
 *   src/client/hooks/use-websocket.ts        → browser
 *   src/server/api/ws-gateway.ts             → WsGateway
 *   src/server/api/event-router.ts           → EventRouter
 *   src/server/agent/agent-orchestrator.ts   → AgentOrchestrator
 *   src/server/agent/bedrock-client.ts       → AwsBedrockClient
 *   src/server/extraction/preference-extractor.ts → PreferenceExtractor
 *   src/server/persistence/in-memory-store.ts / dynamodb-store.ts → Store
 */

/** Stable identifier for an architecture node. */
export type ArchitectureNodeId =
  | 'browser'
  | 'wsGateway'
  | 'eventRouter'
  | 'orchestrator'
  | 'bedrockClient'
  | 'preferenceExtractor'
  | 'store';

/** Which visual row a node occupies — the diagram is a 4-row pipeline. */
export type ArchitectureTier = 'edge' | 'transport' | 'reasoning' | 'state';

/** A single node in the rendered architecture diagram. */
export interface ArchitectureNode {
  id: ArchitectureNodeId;
  /** Primary label — the component name. */
  label: string;
  /** Secondary label — what the component does, in plain language. */
  caption: string;
  tier: ArchitectureTier;
}

/**
 * The architecture, in render order.
 *
 * Retuning for a different thesis is a label-only edit: change `label` /
 * `caption` and the diagram, highlights, and feed all follow.
 */
export const ARCHITECTURE_NODES: readonly ArchitectureNode[] = [
  { id: 'browser', label: 'Browser', caption: 'React client', tier: 'edge' },
  { id: 'wsGateway', label: 'WsGateway', caption: 'WebSocket connections', tier: 'transport' },
  { id: 'eventRouter', label: 'EventRouter', caption: 'Event fan-out', tier: 'transport' },
  { id: 'orchestrator', label: 'AgentOrchestrator', caption: 'Conversation flow', tier: 'reasoning' },
  { id: 'bedrockClient', label: 'BedrockClient', caption: 'Amazon Bedrock', tier: 'reasoning' },
  { id: 'preferenceExtractor', label: 'PreferenceExtractor', caption: 'Tool-use extraction', tier: 'reasoning' },
  { id: 'store', label: 'Store', caption: 'Session + preferences', tier: 'state' },
] as const;

/** Directed edges between nodes, drawn as connectors in the diagram. */
export const ARCHITECTURE_EDGES: readonly (readonly [ArchitectureNodeId, ArchitectureNodeId])[] = [
  ['browser', 'wsGateway'],
  ['wsGateway', 'eventRouter'],
  ['eventRouter', 'orchestrator'],
  ['orchestrator', 'bedrockClient'],
  ['orchestrator', 'preferenceExtractor'],
  ['preferenceExtractor', 'store'],
  ['orchestrator', 'store'],
] as const;

/** Human-readable label for each event type, shown in the feed. */
export const EVENT_LABELS: Record<string, string> = {
  session_init: 'Session started',
  send_message: 'Message sent',
  typing_start: 'Agent thinking',
  typing_stop: 'Agent ready',
  agent_message: 'Agent replied',
  preference_update: 'Preference learned',
  connection_status: 'Connection',
  error: 'Error',
  ping: 'Heartbeat',
  pong: 'Heartbeat ack',
};

/**
 * Which nodes light up for a given event type — the path that event
 * travelled through the system.
 */
const EVENT_NODE_PATHS: Record<string, readonly ArchitectureNodeId[]> = {
  session_init: ['browser', 'wsGateway', 'eventRouter', 'orchestrator', 'store'],
  send_message: ['browser', 'wsGateway', 'eventRouter'],
  typing_start: ['eventRouter', 'orchestrator'],
  typing_stop: ['eventRouter', 'orchestrator'],
  agent_message: ['orchestrator', 'bedrockClient', 'eventRouter', 'wsGateway', 'browser'],
  preference_update: ['preferenceExtractor', 'store', 'eventRouter', 'wsGateway', 'browser'],
  connection_status: ['browser', 'wsGateway'],
  error: ['eventRouter', 'browser'],
  ping: ['browser', 'wsGateway'],
  pong: ['wsGateway', 'browser'],
};

/** Nodes to highlight for an event type. Unknown types highlight nothing. */
export function nodesForEventType(eventType: string): readonly ArchitectureNodeId[] {
  return EVENT_NODE_PATHS[eventType] ?? [];
}

/** Display label for an event type, falling back to the raw type. */
export function labelForEventType(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

/**
 * A short, human-readable detail line for an event — the "what actually
 * happened" that makes the feed legible from the back of a room.
 */
export function describeEvent(event: ServerEvent | { type: string; payload: unknown }): string {
  const payload = event.payload as Record<string, unknown> | undefined;
  if (!payload) return '';

  switch (event.type) {
    case 'preference_update':
      return describePreference(payload);
    case 'agent_message':
      return truncate(readMessageContent(payload));
    case 'send_message':
      return truncate(typeof payload.content === 'string' ? payload.content : '');
    case 'session_init':
      return typeof payload.sessionId === 'string' ? shortId(payload.sessionId) : '';
    case 'connection_status':
      return typeof payload.status === 'string' ? payload.status : '';
    case 'error':
      return typeof payload.message === 'string' ? truncate(payload.message) : '';
    default:
      return '';
  }
}

const MAX_DETAIL_LENGTH = 72;

function describePreference(payload: Record<string, unknown>): string {
  const preference = payload.preference as Record<string, unknown> | undefined;
  if (!preference) return '';
  const verb = payload.isNew === true ? 'new' : 'updated';
  return `${verb} · ${String(preference.category)}: ${String(preference.value)}`;
}

function readMessageContent(payload: Record<string, unknown>): string {
  const message = payload.message as Record<string, unknown> | undefined;
  return typeof message?.content === 'string' ? message.content : '';
}

function truncate(text: string): string {
  if (text.length <= MAX_DETAIL_LENGTH) return text;
  return `${text.slice(0, MAX_DETAIL_LENGTH)}…`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
