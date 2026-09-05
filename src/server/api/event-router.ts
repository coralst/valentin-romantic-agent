import type { ChatMessage } from '../../shared/interfaces/message';
import type { Outing } from '../../shared/interfaces/outing';
import type { Person } from '../../shared/interfaces/person';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import type { Task } from '../../shared/interfaces/task';
import type {
  ActionProposalPayload,
  AgentActivityPayload,
  ServerEvent,
} from '../../shared/interfaces/ws-events';
import type {
  AgentOrchestratorInterface,
  TurnOptions,
} from '../agent/agent-orchestrator';

/** Callback to emit a ServerEvent to the client */
export type EmitFn = (event: ServerEvent) => void;

/** Routes incoming client events to the appropriate backend services */
export class EventRouter {
  constructor(
    private readonly orchestrator: AgentOrchestratorInterface,
    private readonly emit: EmitFn,
  ) {}

  /**
   * Push one activity frame to this socket.
   *
   * Fire-and-forget and never awaited: the frames narrate a turn that is still
   * running, so anything that made the turn wait on them would defeat the point.
   *
   * These payloads carry redacted tool summaries. They are **not** logged, here or
   * anywhere downstream — see `activity-summary.ts`.
   */
  private emitActivity(activity: AgentActivityPayload): void {
    this.emit({
      type: 'agent_activity',
      payload: activity,
      timestamp: new Date().toISOString(),
    });
  }

  /** Handle a send_message event from the client */
  async handleSendMessage(
    sessionId: string,
    content: string,
    options: TurnOptions = {},
  ): Promise<void> {
    // Emit typing_start
    this.emit({
      type: 'typing_start',
      payload: { sessionId },
      timestamp: new Date().toISOString(),
    });

    try {
      const agentMessage: ChatMessage = await this.orchestrator.handleMessage(
        sessionId,
        content,
        { ...options, onActivity: (activity) => this.emitActivity(activity) },
      );

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

  /**
   * Handle a confirm_action event from the client.
   *
   * Shaped like {@link handleSendMessage} on purpose — typing indicators and all
   * — because from the user's side accepting a proposal is a turn: they click,
   * Valentin thinks, Valentin answers. The `error` path matters more here than
   * elsewhere: someone who has just authorised a reservation must not be left
   * looking at a card that did nothing.
   */
  async handleConfirmAction(
    sessionId: string,
    proposalId: string,
  ): Promise<void> {
    this.emit({
      type: 'typing_start',
      payload: { sessionId },
      timestamp: new Date().toISOString(),
    });

    try {
      // The tool trail, and no thinking: a confirm never calls the model with
      // tools, so there is nothing to reason about, and a display preference has
      // no business riding on an authorisation frame.
      const agentMessage = await this.orchestrator.confirmAction(
        sessionId,
        proposalId,
        (activity) => this.emitActivity(activity),
      );

      this.emit({
        type: 'typing_stop',
        payload: { sessionId },
        timestamp: new Date().toISOString(),
      });

      this.emit({
        type: 'agent_message',
        payload: { message: agentMessage },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.emit({
        type: 'typing_stop',
        payload: { sessionId },
        timestamp: new Date().toISOString(),
      });

      this.emit({
        type: 'error',
        payload: {
          code: 'CONFIRM_FAILED',
          message:
            err instanceof Error ? err.message : 'An unexpected error occurred',
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** Emit an action_proposal event to the client */
  emitActionProposal(payload: ActionProposalPayload): void {
    this.emit({
      type: 'action_proposal',
      payload,
      timestamp: new Date().toISOString(),
    });
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

  /**
   * Emit a person_update event to the client.
   *
   * The session id is passed in rather than read off the record: a `Person` is
   * stored under a session partition and does not carry the id (see
   * `ws-events.ts`), and the broadcast path needs it to pick a socket.
   */
  emitPersonUpdate(sessionId: string, person: Person, isNew: boolean): void {
    this.emit({
      type: 'person_update',
      payload: { sessionId, person, isNew },
      timestamp: new Date().toISOString(),
    });
  }

  /** Emit a task_update event to the client */
  emitTaskUpdate(sessionId: string, task: Task, isNew: boolean): void {
    this.emit({
      type: 'task_update',
      payload: { sessionId, task, isNew },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit an outing_update event to the client.
   *
   * No `isNew` counterpart to its neighbours, because this only ever fires on
   * creation: the other write to an outing row is the survey, which the client
   * makes itself and already holds the answer to. See `ws-events.ts`.
   */
  emitOutingUpdate(sessionId: string, outing: Outing): void {
    this.emit({
      type: 'outing_update',
      payload: { sessionId, outing },
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

        // Both read defensively rather than cast. `messageId` is validated
        // downstream by `adoptableMessageId` because it lands in a DynamoDB sort
        // key; `showThinking` is coerced to a real boolean so a truthy string
        // cannot turn thinking on and retune Valentin's voice by accident.
        await this.handleSendMessage(sessionId, content, {
          messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined,
          showThinking: payload.showThinking === true,
        });
        break;
      }

      case 'confirm_action': {
        const sessionId = payload.sessionId as string | undefined;
        const proposalId = payload.proposalId as string | undefined;

        if (!sessionId || !proposalId) {
          this.emit({
            type: 'error',
            payload: {
              code: 'VALIDATION_ERROR',
              message: 'confirm_action requires sessionId and proposalId',
            },
            timestamp: new Date().toISOString(),
          });
          return;
        }

        await this.handleConfirmAction(sessionId, proposalId);
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
