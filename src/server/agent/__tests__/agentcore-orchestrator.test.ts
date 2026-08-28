import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentCoreOrchestrator } from '../agentcore-orchestrator';
import { buildWelcomeMessage, MAX_CONTEXT_TOKENS } from '../agent-orchestrator';
import type { AgentCoreRuntime } from '../agentcore-adapter';
import type { StorageInterface } from '../../persistence/storage-interface';
import type { ConversationMemory, ContextWindow } from '../../persistence/conversation-memory';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

function createMockStorage(): StorageInterface {
  return {
    createSession: vi.fn().mockResolvedValue('sess-123'),
    getSession: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
    updateSessionMeta: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    saveMessage: vi.fn().mockResolvedValue(undefined),
    getMessagesBySession: vi.fn().mockResolvedValue([]),
    savePreference: vi.fn().mockImplementation((pref) => Promise.resolve(pref)),
    savePreferencesBatch: vi.fn().mockResolvedValue([]),
    updatePreference: vi.fn().mockImplementation((ref, update) =>
      Promise.resolve({ ...ref, ...update }),
    ),
    getPreferencesBySession: vi.fn().mockResolvedValue([]),
    findPreference: vi.fn().mockResolvedValue(null),
  } as unknown as StorageInterface;
}

function createMockMemory(): ConversationMemory {
  const context: ContextWindow = { summary: null, recentMessages: [], totalMessages: 0 };
  return {
    addMessage: vi.fn().mockResolvedValue(undefined),
    getHistory: vi.fn().mockResolvedValue([]),
    getContextWindow: vi.fn().mockResolvedValue(context),
  };
}

function createMockRuntime(): AgentCoreRuntime {
  return {
    invoke: vi.fn().mockResolvedValue({ content: 'From AgentCore', toolsUsed: [] }),
    recordTurn: vi.fn().mockResolvedValue(undefined),
    recallPreferences: vi.fn().mockResolvedValue([]),
  };
}

/** Let the fire-and-forget memory work settle before asserting on it. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('AgentCoreOrchestrator', () => {
  let storage: StorageInterface;
  let memory: ConversationMemory;
  let runtime: AgentCoreRuntime;
  let onPreferenceUpdate: ReturnType<typeof vi.fn>;
  let orchestrator: AgentCoreOrchestrator;

  beforeEach(() => {
    storage = createMockStorage();
    memory = createMockMemory();
    runtime = createMockRuntime();
    onPreferenceUpdate = vi.fn();
    orchestrator = new AgentCoreOrchestrator(
      storage,
      memory,
      runtime,
      'user-abc',
      onPreferenceUpdate,
    );
  });

  describe('parity with engine A', () => {
    it('greets with exactly engine A’s words', async () => {
      const result = await orchestrator.initSession();
      // Compared against the shared builder rather than a copied string, so this
      // test cannot pass while the two engines have drifted apart.
      expect(result.welcomeMessage.content).toBe(
        buildWelcomeMessage(result.sessionId).content,
      );
    });

    it('asks for the same history budget engine A does', async () => {
      await orchestrator.handleMessage('sess-1', 'hello');
      expect(memory.getContextWindow).toHaveBeenCalledWith('sess-1', MAX_CONTEXT_TOKENS);
    });

    it('reads the profile account-wide, like engine A', async () => {
      await orchestrator.handleMessage('sess-1', 'hello');
      // readKnownFacts walks other sessions too; if engine B read only the
      // active session it would see fewer facts and the comparison would be
      // measuring the read, not the engine.
      expect(storage.listSessions).toHaveBeenCalled();
    });

    it('does not create an AgentCore session up front', async () => {
      // Both the Runtime session and the Memory partition are lazy, so an extra
      // round trip here would only add latency to engine B's session creation.
      await orchestrator.initSession();
      expect(runtime.invoke).not.toHaveBeenCalled();
      expect(runtime.recordTurn).not.toHaveBeenCalled();
    });
  });

  describe('greetIfEmpty', () => {
    it('greets a session with nothing in it and persists the greeting', async () => {
      const greeting = await orchestrator.greetIfEmpty('sess-1');
      expect(greeting?.sender).toBe('agent');
      expect(memory.addMessage).toHaveBeenCalledWith('sess-1', greeting);
    });

    it('stays quiet when someone already spoke', async () => {
      memory.getHistory = vi.fn().mockResolvedValue([{ id: 'm1' }]);
      await expect(orchestrator.greetIfEmpty('sess-1')).resolves.toBeNull();
    });
  });

  describe('handleMessage', () => {
    it('returns the Runtime’s answer and stores both turns', async () => {
      const reply = await orchestrator.handleMessage('sess-1', 'she loves jazz');
      expect(reply.content).toBe('From AgentCore');
      expect(reply.sender).toBe('agent');
      expect(memory.addMessage).toHaveBeenCalledTimes(2);
    });

    it('passes the actor id through, not the session id', async () => {
      await orchestrator.handleMessage('sess-1', 'hi');
      expect(runtime.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'user-abc', sessionId: 'sess-1' }),
      );
    });

    it('apologises rather than falling back to Bedrock when the Runtime fails', async () => {
      // Engine B's task role has no bedrock:InvokeModel, so a fallback would
      // fail with AccessDenied anyway. An engine-B outage must read as one.
      runtime.invoke = vi.fn().mockRejectedValue(new Error('ThrottlingException'));
      const reply = await orchestrator.handleMessage('sess-1', 'hi');
      expect(reply.content).toContain("having a little trouble");
    });

    it('does not retry the Runtime, so the measured latency is the real one', async () => {
      runtime.invoke = vi.fn().mockRejectedValue(new Error('boom'));
      await orchestrator.handleMessage('sess-1', 'hi');
      expect(runtime.invoke).toHaveBeenCalledTimes(1);
    });

    it('answers before the memory work finishes', async () => {
      let released: (() => void) | undefined;
      runtime.recordTurn = vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          released = resolve;
        }),
      );
      const reply = await orchestrator.handleMessage('sess-1', 'hi');
      expect(reply.content).toBe('From AgentCore');
      released?.();
    });

    it('files the exchange with Memory after the answer', async () => {
      await orchestrator.handleMessage('sess-1', 'she loves jazz');
      await settle();
      expect(runtime.recordTurn).toHaveBeenCalledWith(
        'sess-1',
        'user-abc',
        'she loves jazz',
        'From AgentCore',
      );
    });

    it('survives a Memory outage with the reply already delivered', async () => {
      runtime.recordTurn = vi.fn().mockRejectedValue(new Error('memory down'));
      const reply = await orchestrator.handleMessage('sess-1', 'hi');
      await settle();
      expect(reply.content).toBe('From AgentCore');
    });
  });

  describe('mirroring extracted preferences into DynamoDB', () => {
    const remembered = [
      {
        category: 'music' as const,
        key: 'favorite_genre',
        value: 'jazz',
        confidence: 0.8,
        recordId: 'rec-1',
      },
    ];

    beforeEach(() => {
      runtime.recallPreferences = vi.fn().mockResolvedValue(remembered);
    });

    it('saves a fact DynamoDB has not seen and reports it as new', async () => {
      await orchestrator.handleMessage('sess-1', 'she loves jazz');
      await settle();

      expect(storage.savePreference).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-1',
          category: 'music',
          key: 'favorite_genre',
          value: 'jazz',
          confidence: 0.8,
        }),
      );
      expect(onPreferenceUpdate).toHaveBeenCalledWith(expect.anything(), true);
    });

    it('updates in place so the revision history survives', async () => {
      // savePreference on an existing key would drop the history the profile
      // UI's "revised from" display reads.
      storage.findPreference = vi
        .fn()
        .mockResolvedValue({ value: 'rock' } as PreferenceWithHistory);

      await orchestrator.handleMessage('sess-1', 'actually jazz');
      await settle();

      expect(storage.savePreference).not.toHaveBeenCalled();
      expect(storage.updatePreference).toHaveBeenCalledWith(
        { sessionId: 'sess-1', category: 'music', key: 'favorite_genre' },
        expect.objectContaining({ value: 'jazz' }),
      );
      expect(onPreferenceUpdate).toHaveBeenCalledWith(expect.anything(), false);
    });

    it('skips an unchanged value rather than growing a fake revision trail', async () => {
      storage.findPreference = vi
        .fn()
        .mockResolvedValue({ value: 'jazz' } as PreferenceWithHistory);

      await orchestrator.handleMessage('sess-1', 'hi again');
      await settle();

      expect(storage.updatePreference).not.toHaveBeenCalled();
      expect(storage.savePreference).not.toHaveBeenCalled();
      expect(onPreferenceUpdate).not.toHaveBeenCalled();
    });

    it('lets one failing record cost one fact, not the whole mirror', async () => {
      runtime.recallPreferences = vi.fn().mockResolvedValue([
        { ...remembered[0], key: 'bad' },
        { ...remembered[0], key: 'good' },
      ]);
      storage.savePreference = vi
        .fn()
        .mockRejectedValueOnce(new Error('conditional check failed'))
        .mockImplementation((pref) => Promise.resolve(pref));

      await orchestrator.handleMessage('sess-1', 'hi');
      await settle();

      expect(storage.savePreference).toHaveBeenCalledTimes(2);
      expect(onPreferenceUpdate).toHaveBeenCalledTimes(1);
    });

    it('attributes the fact to the user message that produced it', async () => {
      const reply = await orchestrator.handleMessage('sess-1', 'she loves jazz');
      await settle();

      const userMessage = (memory.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const saved = (storage.savePreference as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(saved.sourceMessageId).toBe(userMessage.id);
      expect(saved.sourceMessageId).not.toBe(reply.id);
    });
  });
});
