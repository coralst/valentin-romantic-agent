import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentOrchestrator } from '../agent-orchestrator';
import type { BedrockClient, LlmResponse } from '../bedrock-client';
import type { AgentCoreAdapter } from '../agentcore-adapter';
import type { StorageInterface } from '../../persistence/storage-interface';
import type { ConversationMemory, ContextWindow } from '../../persistence/conversation-memory';
import type { PreferenceExtractorRef } from '../agent-orchestrator';

function createMockStorage(): StorageInterface {
  return {
    createSession: vi.fn().mockResolvedValue('sess-123'),
    getSession: vi.fn().mockResolvedValue(null),
    endSession: vi.fn().mockResolvedValue(undefined),
    saveMessage: vi.fn().mockResolvedValue(undefined),
    getMessagesBySession: vi.fn().mockResolvedValue([]),
    savePreference: vi.fn(),
    updatePreference: vi.fn(),
    getPreferencesBySession: vi.fn().mockResolvedValue([]),
    findPreference: vi.fn().mockResolvedValue(null),
  };
}

function createMockMemory(): ConversationMemory {
  const defaultContext: ContextWindow = {
    summary: null,
    recentMessages: [],
    totalMessages: 0,
  };
  return {
    addMessage: vi.fn().mockResolvedValue(undefined),
    getHistory: vi.fn().mockResolvedValue([]),
    getContextWindow: vi.fn().mockResolvedValue(defaultContext),
  };
}

function createMockBedrock(): BedrockClient {
  return {
    generateResponse: vi.fn().mockResolvedValue({ content: 'Mock response' } as LlmResponse),
    extractWithTool: vi.fn().mockResolvedValue({
      toolName: 'extract_preferences',
      input: { preferences: [] },
    }),
  };
}

function createMockAgentCore(): AgentCoreAdapter {
  return {
    registerAgent: vi.fn().mockResolvedValue('agent-001'),
    createSession: vi.fn().mockResolvedValue('ac-sess-123'),
  };
}

function createMockExtractor(): PreferenceExtractorRef {
  return {
    extract: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AgentOrchestrator', () => {
  let storage: StorageInterface;
  let memory: ConversationMemory;
  let bedrock: BedrockClient;
  let agentCore: AgentCoreAdapter;
  let extractor: PreferenceExtractorRef;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    storage = createMockStorage();
    memory = createMockMemory();
    bedrock = createMockBedrock();
    agentCore = createMockAgentCore();
    extractor = createMockExtractor();
    orchestrator = new AgentOrchestrator(storage, memory, bedrock, agentCore, extractor);
  });

  describe('initSession', () => {
    it('returns sessionId and welcome message', async () => {
      const result = await orchestrator.initSession();

      expect(result.sessionId).toBe('sess-123');
      expect(result.welcomeMessage.sender).toBe('agent');
      expect(result.welcomeMessage.content).toBeTruthy();
      expect(result.welcomeMessage.sessionId).toBe('sess-123');
    });

    it('creates session via storage', async () => {
      await orchestrator.initSession();
      expect(storage.createSession).toHaveBeenCalled();
    });

    it('creates AgentCore session', async () => {
      await orchestrator.initSession();
      expect(agentCore.createSession).toHaveBeenCalledWith('sess-123');
    });

    it('stores welcome message in memory', async () => {
      await orchestrator.initSession();
      expect(memory.addMessage).toHaveBeenCalledWith(
        'sess-123',
        expect.objectContaining({ sender: 'agent' }),
      );
    });
  });

  describe('handleMessage', () => {
    it('stores user message in memory', async () => {
      await orchestrator.handleMessage('sess-1', 'She loves pasta');

      expect(memory.addMessage).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          sender: 'user',
          content: 'She loves pasta',
          sessionId: 'sess-1',
        }),
      );
    });

    it('calls Bedrock and returns agent response', async () => {
      vi.mocked(bedrock.generateResponse).mockResolvedValue({
        content: 'Pasta is wonderful!',
      });

      const result = await orchestrator.handleMessage('sess-1', 'She loves pasta');

      expect(bedrock.generateResponse).toHaveBeenCalled();
      expect(result.sender).toBe('agent');
      expect(result.content).toBe('Pasta is wonderful!');
    });

    it('stores agent response in memory', async () => {
      vi.mocked(bedrock.generateResponse).mockResolvedValue({
        content: 'Lovely!',
      });

      await orchestrator.handleMessage('sess-1', 'Hello');

      // addMessage called twice: once for user msg, once for agent msg
      expect(memory.addMessage).toHaveBeenCalledTimes(2);
      expect(memory.addMessage).toHaveBeenLastCalledWith(
        'sess-1',
        expect.objectContaining({ sender: 'agent', content: 'Lovely!' }),
      );
    });

    it('retries once on Bedrock failure then returns error message', async () => {
      vi.mocked(bedrock.generateResponse)
        .mockRejectedValueOnce(new Error('First fail'))
        .mockRejectedValueOnce(new Error('Second fail'));

      const result = await orchestrator.handleMessage('sess-1', 'Hello');

      expect(bedrock.generateResponse).toHaveBeenCalledTimes(2);
      expect(result.content).toContain('trouble');
    });

    it('succeeds on retry after first failure', async () => {
      vi.mocked(bedrock.generateResponse)
        .mockRejectedValueOnce(new Error('Transient'))
        .mockResolvedValueOnce({ content: 'Recovered!' });

      const result = await orchestrator.handleMessage('sess-1', 'Hello');

      expect(result.content).toBe('Recovered!');
    });

    it('triggers preference extraction asynchronously', async () => {
      vi.mocked(bedrock.generateResponse).mockResolvedValue({
        content: 'Nice!',
      });

      await orchestrator.handleMessage('sess-1', 'She loves hiking');

      // Extraction is called but doesn't block
      // Use a small delay to let the async fire-and-forget resolve
      await new Promise((r) => setTimeout(r, 10));

      expect(extractor.extract).toHaveBeenCalledWith(
        expect.objectContaining({ sender: 'user', content: 'She loves hiking' }),
        expect.any(Array),
      );
    });

    it('does not throw when extraction fails', async () => {
      vi.mocked(bedrock.generateResponse).mockResolvedValue({
        content: 'Nice!',
      });
      vi.mocked(extractor.extract).mockRejectedValue(new Error('Extraction boom'));

      // Should not throw
      const result = await orchestrator.handleMessage('sess-1', 'Hello');
      expect(result.content).toBe('Nice!');
    });
  });
});
