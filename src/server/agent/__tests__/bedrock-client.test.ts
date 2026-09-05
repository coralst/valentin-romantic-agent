import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AwsBedrockClient, guardrailPoliciesFrom } from '../bedrock-client';
import { config } from '../../config';
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
      // Plain text: no guardrail is configured here, and `guardContent` without
      // an accompanying `guardrailConfig` is rejected by Bedrock. The tagging is
      // covered under 'with a guardrail configured'.
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

    /*
     * A live run refused four turns in a row with "I can only help with learning
     * about your partner" — to "Her shoe size is 32" and "Ask me about her love
     * language", both of which pass the guardrail on their own. The cause was
     * scope: with no guardContent block Bedrock screens every block in the
     * request, so one earlier sentence ("she's been saving for Kyoto", read as a
     * street address) was re-screened on every later turn and blocked all of them.
     */
    describe('guardrail scope', () => {
      // Tagging only happens when there is a guardrail to scope, so these need
      // the id that the rest of this describe deliberately leaves unset.
      beforeEach(() => {
        config.bedrockGuardrailId = 'gr-test';
      });

      afterEach(() => {
        config.bedrockGuardrailId = undefined;
      });

      it('guards only the newest user turn, leaving history as plain text', async () => {
        mockSend.mockResolvedValueOnce({
          output: { message: { content: [{ text: 'Response' }] } },
          stopReason: 'end_turn',
        });

        const history: ChatMessage[] = [
          { ...sampleMessage, id: 'm1', content: "She's been saving for Kyoto." },
          { ...sampleMessage, id: 'm2', sender: 'agent', content: 'A Kyoto trip is lovely.' },
        ];

        await client.generateResponse([...history, sampleMessage], 'prompt');

        const cmd = mockSend.mock.calls[0][0];
        expect(cmd.messages).toEqual([
          { role: 'user', content: [{ text: "She's been saving for Kyoto." }] },
          { role: 'assistant', content: [{ text: 'A Kyoto trip is lovely.' }] },
          {
            role: 'user',
            content: [{ guardContent: { text: { text: 'My partner loves Italian food' } } }],
          },
        ]);
      });

      it('still tags a turn when the history ends on an agent message', async () => {
        mockSend.mockResolvedValueOnce({
          output: { message: { content: [{ text: 'Response' }] } },
          stopReason: 'end_turn',
        });

        // An untagged request silently reverts to screening everything, so the
        // last *user* turn is tagged rather than simply the last turn.
        await client.generateResponse(
          [sampleMessage, { ...sampleMessage, id: 'm2', sender: 'agent', content: 'Go on.' }],
          'prompt',
        );

        const cmd = mockSend.mock.calls[0][0];
        expect(cmd.messages[0].content).toEqual([
          { guardContent: { text: { text: 'My partner loves Italian food' } } },
        ]);
        expect(cmd.messages[1].content).toEqual([{ text: 'Go on.' }]);
      });

      it('guards the newest user turn on the extraction call too', async () => {
        mockSend.mockResolvedValueOnce({
          output: {
            message: { content: [{ toolUse: { name: 'extract', input: { preferences: [] } } }] },
          },
          stopReason: 'tool_use',
        });

        await client.extractWithTool(sampleMessage, sampleHistory, {
          name: 'extract',
          description: 'extract',
          input_schema: {},
        });

        const cmd = mockSend.mock.calls[0][0];
        const last = cmd.messages[cmd.messages.length - 1];
        expect(last.content).toEqual([
          { guardContent: { text: { text: 'My partner loves Italian food' } } },
        ]);
      });
    });

    it('logs which policies fired when the guardrail intervenes', async () => {
      // trace: 'enabled' was always set, but nothing read the trace back, so a
      // refusal left no record of its cause anywhere.
      const records: ServerLogRecord[] = [];
      subscribeToServerLogs((record) => records.push(record));

      mockSend.mockResolvedValueOnce({
        output: { message: { content: [{ text: 'Blocked.' }] } },
        stopReason: 'guardrail_intervened',
        trace: {
          guardrail: {
            inputAssessment: {
              gr1: {
                sensitiveInformationPolicy: {
                  piiEntities: [{ type: 'ADDRESS', match: 'Kyoto', action: 'BLOCKED' }],
                },
                topicPolicy: { topics: [{ name: 'off-topic', type: 'DENY', action: 'BLOCKED' }] },
              },
            },
          },
        },
      });

      await client.generateResponse([sampleMessage], 'prompt');

      const intervened = records.find((r) => r.event === 'bedrock.guardrail_intervened');
      expect(intervened?.level).toBe('warn');
      expect(intervened?.data?.policies).toEqual(['pii:ADDRESS', 'topic:off-topic']);

      resetServerLogSubscribers();
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

  /**
   * A reply cut off mid-word is the one failure an audience spots instantly, and
   * it shipped: the token ceiling was low enough that any question inviting
   * detail overran it, and nothing trimmed the remains.
   */
  describe('a reply that runs out of tokens', () => {
    it('ends on a sentence instead of mid-word', async () => {
      mockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [
              { text: 'She sounds wonderful. I would start with the jazz — does she prefer live sets o' },
            ],
          },
        },
        stopReason: 'max_tokens',
      });

      const result = await client.generateResponse([sampleMessage], 'You are Valentin.');

      expect(result.content).toBe('She sounds wonderful.');
    });

    it('leaves a reply that finished on its own completely alone', async () => {
      const whole = 'She sounds wonderful. Tell me about the jazz — live sets or vinyl?';
      mockSend.mockResolvedValueOnce({
        output: { message: { content: [{ text: whole }] } },
        stopReason: 'end_turn',
      });

      const result = await client.generateResponse([sampleMessage], 'You are Valentin.');

      expect(result.content).toBe(whole);
    });

    /**
     * Half a sentence still beats an empty bubble, so a reply with no boundary
     * to cut back to is passed through rather than emptied.
     */
    it('passes through a reply with no sentence boundary at all', async () => {
      mockSend.mockResolvedValueOnce({
        output: { message: { content: [{ text: 'She sounds like someone who' }] } },
        stopReason: 'max_tokens',
      });

      const result = await client.generateResponse([sampleMessage], 'You are Valentin.');

      expect(result.content).toBe('She sounds like someone who');
    });
  });

  /**
   * What the guardrail reads, and what it says when it refuses.
   *
   * These run with a guardrail id in `config`, which the rest of the file
   * deliberately leaves unset — local development has no guardrail, and the
   * client must send no `guardContent` at all in that case, because Bedrock
   * rejects it without an accompanying `guardrailConfig`.
   */
  describe('with a guardrail configured', () => {
    beforeEach(() => {
      config.bedrockGuardrailId = 'gr-test';
    });

    afterEach(() => {
      config.bedrockGuardrailId = undefined;
      resetServerLogSubscribers();
    });

    it('guards the newest user turn and nothing else', async () => {
      // The system prompt now carries her whole profile — her birthday, her
      // sizes, "Kyoto during cherry blossom season". Guarded, every turn would
      // be scored as sensitive information and blocked before the model saw it.
      mockSend.mockResolvedValueOnce({
        output: { message: { content: [{ text: 'Lovely.' }] } },
        stopReason: 'end_turn',
      });

      await client.generateResponse(
        [
          { ...sampleMessage, id: 'msg-a', sender: 'user', content: 'Go on.' },
          sampleMessage,
        ],
        'You are Valentin. Her birthday is 1994-06-12.',
      );

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.system).toEqual([
        { text: 'You are Valentin. Her birthday is 1994-06-12.' },
      ]);
      expect(cmd.messages[0].content).toEqual([{ text: 'Go on.' }]);
      expect(cmd.messages[1].content).toEqual([
        { guardContent: { text: { text: 'My partner loves Italian food' } } },
      ]);
    });

    it('guards the newest user turn on the extraction call too', async () => {
      mockSend.mockResolvedValueOnce({
        output: {
          message: { content: [{ toolUse: { name: 'extract', input: { preferences: [] } } }] },
        },
        stopReason: 'tool_use',
      });

      await client.extractWithTool(sampleMessage, sampleHistory, {
        name: 'extract',
        description: 'extract',
        input_schema: {},
      });

      const cmd = mockSend.mock.calls[0][0];
      const last = cmd.messages[cmd.messages.length - 1];
      expect(last.content).toEqual([
        { guardContent: { text: { text: 'My partner loves Italian food' } } },
      ]);
    });

    it('guards the typed question, not the tool result, on later tool-loop turns', async () => {
      // Bedrock puts tool output in a `user` turn, so from the second iteration
      // on the newest user message holds `toolResult` blocks and no text. Tagging
      // "the newest user turn" therefore tagged nothing, and with nothing tagged
      // Bedrock guards the last message by default — so the policies were aimed
      // at a tool-result blob. That is what refused
      // "send gmail with link to <address>": `propose_email` ran, the second call
      // scored the tool's own JSON, and `off-topic` blocked it.
      mockSend.mockResolvedValueOnce({
        output: { message: { content: [{ text: 'Sent.' }] } },
        stopReason: 'end_turn',
      });

      await client.converseWithTools(
        [
          { role: 'user', content: [{ text: 'send gmail with link to her@example.com' }] },
          {
            role: 'assistant',
            content: [{ toolUse: { toolUseId: 'tu-1', name: 'propose_email', input: {} } }],
          },
          {
            role: 'user',
            content: [
              { toolResult: { toolUseId: 'tu-1', content: [{ text: '{"delivered":true}' }] } },
            ],
          },
        ],
        'You are Valentin.',
        [{ name: 'propose_email', description: 'email', input_schema: {} }],
        'session-1',
      );

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.messages[0].content).toEqual([
        { guardContent: { text: { text: 'send gmail with link to her@example.com' } } },
      ]);
      // The tool-result turn is passed through untouched.
      expect(cmd.messages[2].content).toEqual([
        { toolResult: { toolUseId: 'tu-1', content: [{ text: '{"delivered":true}' }] } },
      ]);
    });

    it('logs which policies fired when the guardrail intervenes', async () => {
      // `trace: 'enabled'` was always set and nothing ever read the trace back,
      // so a refusal left no record of its cause anywhere. Finding out why he
      // declined an anniversary question meant reconstructing the call by hand
      // against the live guardrail.
      const records: ServerLogRecord[] = [];
      subscribeToServerLogs((record) => records.push(record));

      mockSend.mockResolvedValueOnce({
        output: { message: { content: [{ text: 'Blocked.' }] } },
        stopReason: 'guardrail_intervened',
        trace: {
          guardrail: {
            inputAssessment: {
              'gr-test': {
                sensitiveInformationPolicy: {
                  piiEntities: [{ type: 'ADDRESS', match: 'Kyoto', action: 'BLOCKED' }],
                },
              },
            },
            outputAssessments: {
              'gr-test': [
                { topicPolicy: { topics: [{ name: 'off-topic', type: 'DENY', action: 'BLOCKED' }] } },
              ],
            },
          },
        },
      });

      await client.generateResponse([sampleMessage], 'prompt');

      const intervened = records.find((r) => r.event === 'bedrock.guardrail_intervened');
      expect(intervened?.level).toBe('warn');
      expect(intervened?.data?.policies).toEqual(['pii:ADDRESS', 'topic:off-topic']);
      expect(intervened?.data?.sessionId).toBe('session-1');
    });

    it('logs an intervention it cannot explain rather than throwing', async () => {
      // A guardrail can block with no trace attached. An empty policy list is a
      // worse log line than a full one and a much better one than a crash.
      const records: ServerLogRecord[] = [];
      subscribeToServerLogs((record) => records.push(record));

      mockSend.mockResolvedValueOnce({
        output: { message: { content: [] } },
        stopReason: 'guardrail_intervened',
      });

      const result = await client.generateResponse([sampleMessage], 'prompt');

      expect(result.content).toBeTruthy();
      expect(
        records.find((r) => r.event === 'bedrock.guardrail_intervened')?.data?.policies,
      ).toEqual([]);
    });
  });

  it('sends no guardContent when no guardrail is configured', async () => {
    // `guardContent` is only legal alongside a `guardrailConfig`; sending it
    // without one makes Bedrock reject the request, which would break every
    // local run.
    mockSend.mockResolvedValueOnce({
      output: { message: { content: [{ text: 'Lovely.' }] } },
      stopReason: 'end_turn',
    });

    await client.generateResponse([sampleMessage], 'prompt');

    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.guardrailConfig).toBeUndefined();
    expect(cmd.messages[0].content).toEqual([{ text: 'My partner loves Italian food' }]);
  });

  /**
   * Extended thinking is opt-in per turn, and the default path must stay exactly
   * as it was: `temperature: 0.8` is what tunes Valentin's voice, and thinking
   * forces it to 1. Both call sites are asserted because `callBedrockWithRetry`
   * falls back to `generateResponse` whenever the tool registry is empty — every
   * local run without integration credentials, and every test.
   */
  describe('extended thinking', () => {
    const okReply = {
      output: { message: { content: [{ text: 'Lovely.' }] } },
      stopReason: 'end_turn',
    };

    it('leaves the default generateResponse request untouched', async () => {
      mockSend.mockResolvedValueOnce(okReply);

      await client.generateResponse([sampleMessage], 'prompt');

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.additionalModelRequestFields).toBeUndefined();
      expect(cmd.inferenceConfig).toEqual({ maxTokens: 1024, temperature: 0.8 });
    });

    it('leaves the default converseWithTools request untouched', async () => {
      mockSend.mockResolvedValueOnce(okReply);

      await client.converseWithTools([], 'prompt', [], 'session-1');

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.additionalModelRequestFields).toBeUndefined();
      expect(cmd.inferenceConfig).toEqual({ maxTokens: 1024, temperature: 0.8 });
    });

    it('enables thinking on generateResponse when asked', async () => {
      mockSend.mockResolvedValueOnce(okReply);

      await client.generateResponse([sampleMessage], 'prompt', { thinking: true });

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.additionalModelRequestFields).toEqual({
        thinking: { type: 'enabled', budget_tokens: 1024 },
      });
      // Anthropic rejects any other temperature with thinking on, and rejects a
      // maxTokens that does not exceed the budget the scratchpad spends first.
      expect(cmd.inferenceConfig.temperature).toBe(1);
      expect(cmd.inferenceConfig.maxTokens).toBeGreaterThan(1024);
    });

    it('enables thinking on converseWithTools when asked', async () => {
      mockSend.mockResolvedValueOnce(okReply);

      await client.converseWithTools([], 'prompt', [], 'session-1', { thinking: true });

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.additionalModelRequestFields).toEqual({
        thinking: { type: 'enabled', budget_tokens: 1024 },
      });
      expect(cmd.inferenceConfig.temperature).toBe(1);
      expect(cmd.inferenceConfig.maxTokens).toBeGreaterThan(1024);
    });

    it('reads reasoning out of a reasoningContent block without it reaching the reply', async () => {
      mockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [
              { reasoningContent: { reasoningText: { text: 'She said peonies twice.' } } },
              { text: 'Peonies it is.' },
            ],
          },
        },
        stopReason: 'end_turn',
      });

      const result = await client.generateResponse([sampleMessage], 'prompt', {
        thinking: true,
      });

      expect(result.reasoning).toBe('She said peonies twice.');
      // The chat bubble must never show thinking; `extractTextFromBlocks` filters
      // on `'text' in b`, which is what keeps them apart.
      expect(result.content).toBe('Peonies it is.');
    });

    it('claims no reasoning for a redacted block', async () => {
      // `redactedContent` is ciphertext. Rendering it would be noise presented as
      // insight, so the frame simply does not go out.
      mockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [
              { reasoningContent: { redactedContent: new Uint8Array([1, 2, 3]) } },
              { text: 'Peonies it is.' },
            ],
          },
        },
        stopReason: 'end_turn',
      });

      const result = await client.generateResponse([sampleMessage], 'prompt', {
        thinking: true,
      });

      expect(result.reasoning).toBeUndefined();
      expect(result.content).toBe('Peonies it is.');
    });

    it('surfaces reasoning on a tool turn while leaving the assistant message whole', async () => {
      const reasoningBlock = {
        reasoningContent: { reasoningText: { text: 'Heavy metal, eighties.' } },
      };
      mockSend.mockResolvedValueOnce({
        output: { message: { role: 'assistant', content: [reasoningBlock, { text: 'One sec.' }] } },
        stopReason: 'end_turn',
      });

      const turn = await client.converseWithTools([], 'prompt', [], 'session-1', {
        thinking: true,
      });

      expect(turn.reasoning).toBe('Heavy metal, eighties.');
      expect(turn.text).toBe('One sec.');
      // The block goes back to Bedrock verbatim on the next iteration — a stripped
      // thinking block is rejected outright.
      expect(turn.message.content).toContain(reasoningBlock);
    });
  });
});

describe('guardrailPoliciesFrom', () => {
  it('is empty when there is no guardrail trace at all', () => {
    expect(guardrailPoliciesFrom(undefined)).toEqual([]);
    expect(guardrailPoliciesFrom({})).toEqual([]);
  });

  it('reads content filters and custom words', () => {
    expect(
      guardrailPoliciesFrom({
        guardrail: {
          inputAssessment: {
            g: {
              contentPolicy: { filters: [{ type: 'PROMPT_ATTACK', action: 'BLOCKED' }] },
              wordPolicy: { customWords: [{ match: 'nope', action: 'BLOCKED' }] },
            },
          },
        },
      }),
    ).toEqual(['content:PROMPT_ATTACK', 'word:nope']);
  });

  it('ignores a policy that detected something and let it through', () => {
    expect(
      guardrailPoliciesFrom({
        guardrail: {
          inputAssessment: {
            g: { topicPolicy: { topics: [{ name: 'off-topic', action: 'NONE' }] } },
          },
        },
      }),
    ).toEqual([]);
  });

  it('reports an anonymised entity, which is a rewrite the audience can see', () => {
    expect(
      guardrailPoliciesFrom({
        guardrail: {
          outputAssessments: {
            g: [
              {
                sensitiveInformationPolicy: {
                  piiEntities: [{ type: 'NAME', action: 'ANONYMIZED' }],
                },
              },
            ],
          },
        },
      }),
    ).toEqual(['pii:NAME']);
  });
});
