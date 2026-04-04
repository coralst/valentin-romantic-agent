import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AwsBedrockClient } from '../bedrock-client';
import { LlmError } from '../../../shared/errors/llm-error';
import type { ChatMessage } from '../../../shared/interfaces/message';

// Mock the entire AWS SDK module
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(() => ({ send: mockSend })),
  ConverseCommand: vi.fn((input: unknown) => input),
}));

const sampleMessage: ChatMessage = {
  id: 'msg-1',
  sessionId: 'session-1',
  sender: 'user',
  content: 'My partner loves Italian food',
  timestamp: new Date().toISOString(),
};

const sampleHistory: ChatMessage[] = [
  {
    id: 'msg-0',
    sessionId: 'session-1',
    sender: 'agent',
    content: 'Tell me about your partner.',
    timestamp: new Date().toISOString(),
  },
];

describe('AwsBedrockClient', () => {
  let client: AwsBedrockClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new AwsBedrockClient('us-east-1', 'test-model-id');
  });

  describe('generateResponse', () => {
    it('calls Bedrock Converse API with correct message format and system prompt', async () => {
      mockSend.mockResolvedValueOnce({
        output: {
          message: { content: [{ text: 'That sounds lovely!' }] },
        },
        stopReason: 'end_turn',
      });

      const result = await client.generateResponse([sampleMessage], 'You are Valentin.');

      expect(result.content).toBe('That sounds lovely!');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.modelId).toBe('test-model-id');
      expect(cmd.system).toEqual([{ text: 'You are Valentin.' }]);
      expect(cmd.messages).toEqual([
        { role: 'user', content: [{ text: 'My partner loves Italian food' }] },
      ]);
    });

    it('maps agent messages to assistant role', async () => {
      mockSend.mockResolvedValueOnce({
        output: { message: { content: [{ text: 'Response' }] } },
      });

      await client.generateResponse([...sampleHistory, sampleMessage], 'System prompt');

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.messages[0].role).toBe('assistant');
      expect(cmd.messages[1].role).toBe('user');
    });

    it('throws LlmError when Bedrock returns empty response', async () => {
      mockSend.mockResolvedValueOnce({
        output: { message: { content: [] } },
      });

      await expect(client.generateResponse([sampleMessage], 'prompt')).rejects.toThrow(LlmError);
    });

    it('wraps SDK errors in LlmError with context', async () => {
      mockSend.mockRejectedValue(new Error('Throttling'));

      try {
        await client.generateResponse([sampleMessage], 'prompt');
      } catch (err) {
        expect(err).toBeInstanceOf(LlmError);
        expect((err as LlmError).context.modelId).toBe('test-model-id');
        expect((err as LlmError).context.cause).toBe('Throttling');
      }
    });
  });

  describe('extractWithTool', () => {
    const toolSchema = {
      name: 'extract_preferences',
      description: 'Extract preferences',
      input_schema: {
        type: 'object',
        properties: {
          preferences: { type: 'array', items: { type: 'object' } },
        },
        required: ['preferences'],
      },
    };

    it('sends tool schema and parses tool-use response', async () => {
      const extractedPrefs = {
        preferences: [
          { category: 'food', key: 'favorite_cuisine', value: 'Italian', confidence: 0.9 },
        ],
      };

      mockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [{ toolUse: { name: 'extract_preferences', input: extractedPrefs } }],
          },
        },
        stopReason: 'tool_use',
      });

      const result = await client.extractWithTool(sampleMessage, sampleHistory, toolSchema);

      expect(result.toolName).toBe('extract_preferences');
      expect(result.input).toEqual(extractedPrefs);

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.toolConfig.tools).toHaveLength(1);
      expect(cmd.toolConfig.tools[0].toolSpec.name).toBe('extract_preferences');
      expect(cmd.toolConfig.toolChoice).toEqual({ tool: { name: 'extract_preferences' } });
    });

    it('includes full history plus current message in request', async () => {
      mockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [{ toolUse: { name: 'extract_preferences', input: { preferences: [] } } }],
          },
        },
      });

      await client.extractWithTool(sampleMessage, sampleHistory, toolSchema);

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.messages).toHaveLength(2);
    });

    it('throws LlmError when no tool-use block in response', async () => {
      mockSend.mockResolvedValueOnce({
        output: {
          message: { content: [{ text: 'I cannot extract preferences.' }] },
        },
      });

      await expect(
        client.extractWithTool(sampleMessage, sampleHistory, toolSchema),
      ).rejects.toThrow(LlmError);
    });

    it('throws LlmError when response has no content blocks', async () => {
      mockSend.mockResolvedValueOnce({
        output: { message: { content: undefined } },
      });

      await expect(
        client.extractWithTool(sampleMessage, sampleHistory, toolSchema),
      ).rejects.toThrow(LlmError);
    });

    it('wraps SDK errors in LlmError', async () => {
      mockSend.mockRejectedValueOnce(new Error('Service unavailable'));

      await expect(
        client.extractWithTool(sampleMessage, sampleHistory, toolSchema),
      ).rejects.toThrow(LlmError);
    });
  });
});
