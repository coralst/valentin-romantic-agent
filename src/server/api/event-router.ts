import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import type { ServerEvent } from '../../shared/interfaces/ws-events';
import type { AgentOrchestratorInterface } from '../agent/agent-orchestrator';

/** Callback to emit a ServerEvent to the client */
export type EmitFn = (event: ServerEvent) => void;

/** Routes incoming client events to the appropriate backend services */
export class EventRouter {
  constructor(
    private readonly orchestrator: AgentOrchestratorInterface,
    private readonly emit: EmitFn,
  ) {}

  /** Handle a send_message event from the client */
  async handleSendMessage(
    sessionId: string,
    content: string,
  ): Promise<void> {
    // Emit typing_start
    this.emit({
      type: 'typing_start',
      payload: { sessionId },
      timestamp: new Date().toISOString(),
    });

    try {
      const agentMessage: ChatMessage =
        await this.orchestrator.handleMessage(sessionId, content);

      // Emit typing_stop
      this.emit({
        type: 'typing_stop',
        payload: { sessionId },
        timestamp: new Date().toISOString(),
      });

      // Emit agent_message
      this.emit({
        type: 'agent_message',
        payload: { message: agentMessage },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      // Emit typing_stop even on error
      this.emit({
        type: 'typing_stop',
        payload: { sessionId },
        timestamp: new Date().toISOString(),
      });

      // Emit error event
      this.emit({
        type: 'error',
        payload: {
          code: 'ORCHESTRATOR_ERROR',
          message:
            err instanceof Error ? err.message : 'An unexpected error occurred',
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** Emit a preference_update event to the client */
  emitPreferenceUpdate(
    preference: PreferenceWithHistory,
    isNew: boolean,
  ): void {
    this.emit({
      type: 'preference_update',
      payload: { preference, isNew },
      timestamp: new Date().toISOString(),
    });
  }

  /** Route a raw client event by type */
  async routeEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    switch (eventType) {
      case 'send_message': {
        const sessionId = payload.sessionId as string | undefined;
        const content = payload.content as string | undefined;

        if (!sessionId || !content) {
          this.emit({
            type: 'error',
            payload: {
              code: 'VALIDATION_ERROR',
              message: 'send_message requires sessionId and content',
            },
            timestamp: new Date().toISOString(),
          });
          return;
        }

        await this.handleSendMessage(sessionId, content);
        break;
      }

      case 'ping':
        this.emit({
          type: 'pong',
          payload: {},
          timestamp: new Date().toISOString(),
        });
        break;

      default:
        this.emit({
          type: 'error',
          payload: {
            code: 'UNKNOWN_EVENT',
            message: `Unknown event type: ${eventType}`,
          },
          timestamp: new Date().toISOString(),
        });
    }
  }
}
