import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventRouter } from '../event-router';
import type { AgentOrchestratorInterface } from '../../agent/agent-orchestrator';
import type { ServerEvent } from '../../../shared/interfaces/ws-events';
import type { ChatMessage } from '../../../shared/interfaces/message';

function createMockOrchestrator(): AgentOrchestratorInterface {
  return {
    initSession: vi.fn(),
    handleMessage: vi.fn(),
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

      expect(orchestrator.handleMessage).toHaveBeenCalledWith('sess-1', 'Hi there');
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
});
