import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventRouter } from '../event-router';
import type { AgentOrchestratorInterface } from '../../agent/agent-orchestrator';
import type {
  AgentActivityPayload,
  ServerEvent,
} from '../../../shared/interfaces/ws-events';
import type { ChatMessage } from '../../../shared/interfaces/message';

function createMockOrchestrator(): AgentOrchestratorInterface {
  return {
    initSession: vi.fn(),
    // Nothing in the event router greets; a session that already exists has a
    // transcript, so the honest stub is "nothing to say".
    greetIfEmpty: vi.fn(async () => null),
    handleMessage: vi.fn(),
    confirmAction: vi.fn(),
  };
}

function createMockEmit(): { emit: (event: ServerEvent) => void; events: ServerEvent[] } {
  const events: ServerEvent[] = [];
  return {
    emit: (event: ServerEvent) => events.push(event),
    events,
  };
}

describe('EventRouter', () => {
  let orchestrator: AgentOrchestratorInterface;
  let emitter: ReturnType<typeof createMockEmit>;
  let router: EventRouter;

  beforeEach(() => {
    orchestrator = createMockOrchestrator();
    emitter = createMockEmit();
    router = new EventRouter(orchestrator, emitter.emit);
  });

  describe('send_message routing', () => {
    it('routes send_message to orchestrator.handleMessage', async () => {
      const agentMsg: ChatMessage = {
        id: 'msg-1',
        sessionId: 'sess-1',
        sender: 'agent',
        content: 'Hello!',
        timestamp: new Date().toISOString(),
      };
      vi.mocked(orchestrator.handleMessage).mockResolvedValue(agentMsg);

      await router.routeEvent('send_message', {
        sessionId: 'sess-1',
        content: 'Hi there',
      });

      expect(orchestrator.handleMessage).toHaveBeenCalledWith('sess-1', 'Hi there', {
        messageId: undefined,
        showThinking: false,
        onActivity: expect.any(Function),
      });
    });

    it('emits typing_start before orchestrator call and typing_stop after', async () => {
      const agentMsg: ChatMessage = {
        id: 'msg-1',
        sessionId: 'sess-1',
        sender: 'agent',
        content: 'Response',
        timestamp: new Date().toISOString(),
      };
      vi.mocked(orchestrator.handleMessage).mockResolvedValue(agentMsg);

      await router.routeEvent('send_message', {
        sessionId: 'sess-1',
        content: 'Hello',
      });

      const types = emitter.events.map((e) => e.type);
      expect(types[0]).toBe('typing_start');
      expect(types[1]).toBe('typing_stop');
      expect(types[2]).toBe('agent_message');
    });

    it('emits agent_message with orchestrator response', async () => {
      const agentMsg: ChatMessage = {
        id: 'msg-1',
        sessionId: 'sess-1',
        sender: 'agent',
        content: 'Great to hear!',
        timestamp: new Date().toISOString(),
      };
      vi.mocked(orchestrator.handleMessage).mockResolvedValue(agentMsg);

      await router.routeEvent('send_message', {
        sessionId: 'sess-1',
        content: 'My partner loves sushi',
      });

      const agentEvent = emitter.events.find((e) => e.type === 'agent_message');
      expect(agentEvent).toBeDefined();
      expect((agentEvent!.payload as { message: ChatMessage }).message.content).toBe(
        'Great to hear!',
      );
    });

    it('emits typing_stop and error when orchestrator throws', async () => {
      vi.mocked(orchestrator.handleMessage).mockRejectedValue(
        new Error('Bedrock down'),
      );

      await router.routeEvent('send_message', {
        sessionId: 'sess-1',
        content: 'Hello',
      });

      const types = emitter.events.map((e) => e.type);
      expect(types).toContain('typing_start');
      expect(types).toContain('typing_stop');
      expect(types).toContain('error');
    });

    it('emits validation error when sessionId is missing', async () => {
      await router.routeEvent('send_message', { content: 'Hello' });

      expect(emitter.events).toHaveLength(1);
      expect(emitter.events[0].type).toBe('error');
      expect(
        (emitter.events[0].payload as { code: string }).code,
      ).toBe('VALIDATION_ERROR');
    });
  });

  describe('ping handling', () => {
    it('responds to ping with pong', async () => {
      await router.routeEvent('ping', {});

      expect(emitter.events).toHaveLength(1);
      expect(emitter.events[0].type).toBe('pong');
    });
  });

  describe('unknown event type', () => {
    it('emits error for unknown event type', async () => {
      await router.routeEvent('unknown_event', {});

      expect(emitter.events).toHaveLength(1);
      expect(emitter.events[0].type).toBe('error');
      expect(
        (emitter.events[0].payload as { code: string }).code,
      ).toBe('UNKNOWN_EVENT');
    });
  });

  describe('confirm_action routing', () => {
    const confirmed: ChatMessage = {
      id: 'msg-9',
      sessionId: 'sess-1',
      sender: 'agent',
      content: 'Booked — 21:00 on Saturday.',
      timestamp: new Date().toISOString(),
    };

    it('routes confirm_action to orchestrator.confirmAction', async () => {
      vi.mocked(orchestrator.confirmAction).mockResolvedValue(confirmed);

      await router.routeEvent('confirm_action', {
        sessionId: 'sess-1',
        proposalId: 'prop-1',
      });

      expect(orchestrator.confirmAction).toHaveBeenCalledWith(
        'sess-1',
        'prop-1',
        expect.any(Function),
      );
    });

    it('brackets the confirmation with typing indicators and answers', async () => {
      vi.mocked(orchestrator.confirmAction).mockResolvedValue(confirmed);

      await router.routeEvent('confirm_action', {
        sessionId: 'sess-1',
        proposalId: 'prop-1',
      });

      expect(emitter.events.map((e) => e.type)).toEqual([
        'typing_start',
        'typing_stop',
        'agent_message',
      ]);
      const message = emitter.events.find((e) => e.type === 'agent_message');
      expect((message!.payload as { message: ChatMessage }).message.content).toBe(
        'Booked — 21:00 on Saturday.',
      );
    });

    it('tells the client when the confirmation blows up', async () => {
      vi.mocked(orchestrator.confirmAction).mockRejectedValue(
        new Error('Ontopo unreachable'),
      );

      await router.routeEvent('confirm_action', {
        sessionId: 'sess-1',
        proposalId: 'prop-1',
      });

      // Someone who just authorised a reservation must never be left looking at
      // a card that silently did nothing.
      const error = emitter.events.find((e) => e.type === 'error');
      expect(error).toBeDefined();
      expect((error!.payload as { code: string }).code).toBe('CONFIRM_FAILED');
      expect(emitter.events.map((e) => e.type)).toContain('typing_stop');
    });

    it('rejects a confirmation with no proposalId', async () => {
      await router.routeEvent('confirm_action', { sessionId: 'sess-1' });

      expect(orchestrator.confirmAction).not.toHaveBeenCalled();
      expect(emitter.events).toHaveLength(1);
      expect((emitter.events[0].payload as { code: string }).code).toBe(
        'VALIDATION_ERROR',
      );
    });
  });

  describe('action proposal emission', () => {
    it('emits action_proposal with the session id at the top level', () => {
      router.emitActionProposal({
        sessionId: 'sess-1',
        proposalId: 'prop-1',
        service: 'ontopo',
        title: 'Ouzeria, Saturday 21:00',
        summary: 'Table for two',
        url: 'https://s1.ontopo.com/checkout/abc',
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      });

      expect(emitter.events).toHaveLength(1);
      expect(emitter.events[0].type).toBe('action_proposal');
      // The broadcast path resolves its target from a top-level sessionId and
      // drops anything without one, which would render as a reply promising a
      // card the user never sees.
      expect(
        (emitter.events[0].payload as { sessionId: string }).sessionId,
      ).toBe('sess-1');
    });
  });

  describe('preference update emission', () => {
    it('emits preference_update event', () => {
      const pref = {
        id: 'pref-1',
        sessionId: 'sess-1',
        category: 'food' as const,
        key: 'favorite_cuisine',
        value: 'Italian',
        confidence: 0.9,
        sourceMessageId: 'msg-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [],
      };

      router.emitPreferenceUpdate(pref, true);

      expect(emitter.events).toHaveLength(1);
      expect(emitter.events[0].type).toBe('preference_update');
    });
  });

  describe('person and task emission', () => {
    it('puts the session id at the top of a person_update payload', () => {
      // Load-bearing, not cosmetic: `resolveBroadcastSessionId` reads
      // `payload.sessionId` to pick a socket, and a `Person` does not carry one.
      // Nested or missing, the event would be dropped before it reached anyone.
      router.emitPersonUpdate('sess-1', {
        id: 'person-1',
        name: 'Nadia',
        relationship: 'Her sister',
        generation: 'peer',
        source: 'discovered',
        updatedAt: new Date().toISOString(),
      }, true);

      expect(emitter.events).toHaveLength(1);
      expect(emitter.events[0].type).toBe('person_update');
      expect(emitter.events[0].payload).toMatchObject({
        sessionId: 'sess-1',
        isNew: true,
        person: { name: 'Nadia' },
      });
    });

    it('emits task_update with the session id and the tick state', () => {
      const now = new Date().toISOString();

      router.emitTaskUpdate('sess-1', {
        id: 'task-1',
        title: 'Book the table',
        done: false,
        source: 'discovered',
        createdAt: now,
        updatedAt: now,
      }, false);

      expect(emitter.events[0].type).toBe('task_update');
      expect(emitter.events[0].payload).toMatchObject({
        sessionId: 'sess-1',
        isNew: false,
        task: { title: 'Book the table', done: false },
      });
    });
  });

  describe('narration', () => {
    const agentMsg: ChatMessage = {
      id: 'msg-1',
      sessionId: 'sess-1',
      sender: 'agent',
      content: 'Hello!',
      timestamp: new Date().toISOString(),
    };

    /** Run a turn and hand the orchestrator's emitter back to the test. */
    async function turnEmitting(activity: AgentActivityPayload) {
      vi.mocked(orchestrator.handleMessage).mockImplementation(async (_s, _c, options) => {
        options?.onActivity?.(activity);
        return agentMsg;
      });
      await router.routeEvent('send_message', { sessionId: 'sess-1', content: 'hi' });
    }

    it('puts an activity frame on the wire with a top-level sessionId', async () => {
      // `resolveBroadcastSessionId` reads `payload.sessionId` and silently drops an
      // event without one — `pong` and `error` are already dead in practice for
      // exactly this reason. A frame nested one level deeper would never arrive.
      await turnEmitting({
        kind: 'tool_start',
        sessionId: 'sess-1',
        id: 'use-0',
        iteration: 1,
        tool: 'search_tracks',
        service: 'spotify',
        inputSummary: 'query: heavy metal',
      });

      const frame = emitter.events.find((e) => e.type === 'agent_activity');
      expect(frame?.payload).toMatchObject({ sessionId: 'sess-1', kind: 'tool_start' });
    });

    it('narrates while the turn is still running, not after it', async () => {
      await turnEmitting({
        kind: 'tool_start',
        sessionId: 'sess-1',
        id: 'use-0',
        iteration: 1,
        tool: 'search_tracks',
        service: 'spotify',
        inputSummary: '',
      });

      const types = emitter.events.map((e) => e.type);
      expect(types).toEqual(['typing_start', 'agent_activity', 'typing_stop', 'agent_message']);
    });

    it('passes the client-supplied message id straight through', async () => {
      // Validation lives in `adoptableMessageId`, not here: the router's job is to
      // read the field without casting, and the orchestrator's is to refuse a
      // value it would put in a sort key.
      vi.mocked(orchestrator.handleMessage).mockResolvedValue(agentMsg);

      await router.routeEvent('send_message', {
        sessionId: 'sess-1',
        content: 'hi',
        messageId: '3f6d1f0e-8c2a-4b71-9f2e-1d0a5b7c8e91',
      });

      expect(orchestrator.handleMessage).toHaveBeenCalledWith(
        'sess-1',
        'hi',
        expect.objectContaining({ messageId: '3f6d1f0e-8c2a-4b71-9f2e-1d0a5b7c8e91' }),
      );
    });

    it('will not let a truthy non-boolean turn thinking on', async () => {
      // Thinking forces `temperature: 1`, which retunes Valentin's voice. It must
      // be on because someone pressed a toggle, never because a field was a
      // non-empty string.
      vi.mocked(orchestrator.handleMessage).mockResolvedValue(agentMsg);

      await router.routeEvent('send_message', {
        sessionId: 'sess-1',
        content: 'hi',
        showThinking: 'yes',
      });

      expect(orchestrator.handleMessage).toHaveBeenCalledWith(
        'sess-1',
        'hi',
        expect.objectContaining({ showThinking: false }),
      );
    });

    it('gives the confirm path a tool trail and no display settings', async () => {
      // A confirm never calls the model with tools, so there is no reasoning to
      // reveal — and an authorisation frame is the wrong place to carry a
      // preference about what the user wants to look at.
      vi.mocked(orchestrator.confirmAction).mockImplementation(async (s, id, narrate) => {
        narrate?.({
          kind: 'tool_end',
          sessionId: s,
          id,
          iteration: 1,
          tool: 'confirm_reservation',
          service: 'ontopo',
          durationMs: 2400,
          ok: true,
          outcome: 'Table held for two.',
        });
        return agentMsg;
      });

      await router.routeEvent('confirm_action', { sessionId: 'sess-1', proposalId: 'prop-1' });

      const frames = emitter.events.filter((e) => e.type === 'agent_activity');
      expect(frames).toHaveLength(1);
      expect(frames[0].payload).toMatchObject({ kind: 'tool_end', durationMs: 2400 });
      expect(frames.some((f) => (f.payload as AgentActivityPayload).kind === 'thinking')).toBe(
        false,
      );
    });
  });
});
