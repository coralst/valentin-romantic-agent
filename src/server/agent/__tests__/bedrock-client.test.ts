import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AwsBedrockClient } from '../bedrock-client';
import { LlmError } from '../../../shared/errors/llm-error';
import type { ChatMessage } from '../../../shared/interfaces/message';
import {
  subscribeToServerLogs,
  resetServerLogSubscribers,
  type ServerLogRecord,
} from '../../logging';

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

    it('skips leading agent messages and maps roles correctly', async () => {
      mockSend.mockResolvedValueOnce({
        output: { message: { content: [{ text: 'Response' }] } },
      });

      await client.generateResponse([...sampleHistory, sampleMessage], 'System prompt');

      const cmd = mockSend.mock.calls[0][0];
      // Leading agent message is skipped — only user message remains
      expect(cmd.messages).toHaveLength(1);
      expect(cmd.messages[0].role).toBe('user');
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

    it('skips leading agent messages in history', async () => {
      mockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [{ toolUse: { name: 'extract_preferences', input: { preferences: [] } } }],
          },
        },
      });

      await client.extractWithTool(sampleMessage, sampleHistory, toolSchema);

      const cmd = mockSend.mock.calls[0][0];
      // Leading agent message from history is skipped, only user message remains
      expect(cmd.messages).toHaveLength(1);
      expect(cmd.messages[0].role).toBe('user');
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

  /**
   * The duration around `client.send` is the one number in the system nobody can
   * estimate, and it is what the architecture drawer shows for the Bedrock node.
   * These assert the log line `span-bridge.ts` reads — the client itself has no
   * idea the bridge exists, which is the point of the log seam.
   */
  describe('Converse timing', () => {
    function captureConverseLogs(): { records: ServerLogRecord[]; stop: () => void } {
      const records: ServerLogRecord[] = [];
      const stop = subscribeToServerLogs((record) => {
        if (record.event === 'bedrock.converse') records.push(record);
      });
      return { records, stop };
    }

    const timingToolSchema = {
      name: 'extract_preferences',
      description: 'Extract partner preferences',
      input_schema: { type: 'object', properties: {} },
    };

    beforeEach(() => {
      // Not `clearAllMocks`: that resets call records but leaves the
      // `mockResolvedValueOnce` queue intact, so one test failing before it
      // consumes its queued response shifts the mock for every test after it.
      mockSend.mockReset();
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      resetServerLogSubscribers();
    });

    it('logs a measured reply call, attributed to its session', async () => {
      mockSend.mockResolvedValueOnce({
        output: { message: { content: [{ text: 'Lovely.' }] } },
        stopReason: 'end_turn',
      });
      const { records, stop } = captureConverseLogs();

      await client.generateResponse([sampleMessage], 'You are Valentin.');

      stop();
      expect(records).toHaveLength(1);
      expect(records[0].data).toMatchObject({
        sessionId: 'session-1',
        operation: 'chat-reply',
        modelId: 'test-model-id',
        ok: true,
      });
      expect(typeof records[0].data?.durationMs).toBe('number');
    });

    it('logs the extraction call under its own operation name', async () => {
      mockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [{ toolUse: { name: 'extract_preferences', input: { preferences: [] } } }],
          },
        },
        stopReason: 'tool_use',
      });
      const { records, stop } = captureConverseLogs();

      await client.extractWithTool(sampleMessage, sampleHistory, timingToolSchema);

      stop();
      expect(records[0].data).toMatchObject({
        sessionId: 'session-1',
        operation: 'extract-preferences',
        ok: true,
      });
    });

    /**
     * A call that took four seconds and *then* threw is the most useful thing to
     * see on stage, and precisely what a success-only wrapper hides. The error
     * must still propagate unchanged.
     */
    it('logs a failed call with ok:false, and still throws', async () => {
      mockSend.mockRejectedValueOnce(new Error('Service unavailable'));
      const { records, stop } = captureConverseLogs();

      await expect(
        client.generateResponse([sampleMessage], 'You are Valentin.'),
      ).rejects.toThrow(LlmError);

      stop();
      expect(records).toHaveLength(1);
      expect(records[0].data).toMatchObject({ operation: 'chat-reply', ok: false });
      expect(typeof records[0].data?.durationMs).toBe('number');
    });

    /**
     * Trimming leading agent messages can leave a batch starting anywhere, so
     * the session is read off the last message. An unattributable span is worth
     * less than an attributed one, but not so little that it should be allowed
     * to break the reply it was measuring.
     */
    it('falls back to an unknown session rather than throwing on an empty batch', async () => {
      mockSend.mockResolvedValueOnce({
        output: { message: { content: [{ text: 'Hi.' }] } },
        stopReason: 'end_turn',
      });
      const { records, stop } = captureConverseLogs();

      await client.generateResponse([], 'You are Valentin.');

      stop();
      expect(records[0].data).toMatchObject({ sessionId: 'unknown' });
    });
  });
});
