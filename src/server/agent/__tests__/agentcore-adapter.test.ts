import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AgentCoreNotConfiguredError,
  BedrockAgentCoreRuntime,
  memoryNamespace,
  parseMemoryRecord,
  parseRuntimeReply,
  runtimeSessionIdFor,
  StubAgentCoreAdapter,
} from '../agentcore-adapter';

describe('StubAgentCoreAdapter', () => {
  it('still answers, because engine A calls createSession for symmetry', async () => {
    const stub = new StubAgentCoreAdapter();
    await expect(stub.registerAgent()).resolves.toBe('stub-agent-valentin-001');
    await expect(stub.createSession('sess-1')).resolves.toBe('agentcore-session-sess-1');
  });
});

describe('parseRuntimeReply', () => {
  it('reads the documented JSON contract', () => {
    expect(parseRuntimeReply('{"content":"Hello","tools_used":["get_partner_profile"]}')).toEqual({
      content: 'Hello',
      toolsUsed: ['get_partner_profile'],
    });
  });

  it('accepts camelCase tools, so a mid-rollout image mismatch still reports them', () => {
    expect(parseRuntimeReply('{"content":"Hi","toolsUsed":["save_preference"]}').toolsUsed).toEqual([
      'save_preference',
    ]);
  });

  it('falls back through output and result before giving up on the field name', () => {
    expect(parseRuntimeReply('{"output":"from output"}').content).toBe('from output');
    expect(parseRuntimeReply('{"result":"from result"}').content).toBe('from result');
  });

  it('surfaces plain text rather than throwing on a text/plain error page', () => {
    expect(parseRuntimeReply('Internal Server Error')).toEqual({
      content: 'Internal Server Error',
      toolsUsed: [],
    });
  });

  it('drops non-string tool entries instead of leaking them into a span', () => {
    expect(parseRuntimeReply('{"content":"x","tools_used":["a",7,null]}').toolsUsed).toEqual(['a']);
  });

  it('treats an empty body as an empty answer, not an exception', () => {
    expect(parseRuntimeReply('   ')).toEqual({ content: '', toolsUsed: [] });
  });
});

describe('parseMemoryRecord', () => {
  it('maps a record with an explicit category and key', () => {
    expect(
      parseMemoryRecord(
        'rec-1',
        JSON.stringify({ category: 'music', key: 'favorite genre', preference: 'jazz' }),
      ),
    ).toEqual({
      category: 'music',
      key: 'favorite_genre',
      value: 'jazz',
      confidence: 0.8,
      recordId: 'rec-1',
    });
  });

  it('takes the first recognised entry from a categories array', () => {
    const record = parseMemoryRecord(
      'rec-2',
      JSON.stringify({ categories: ['not_a_category', 'travel'], preference: 'Kyoto' }),
    );
    expect(record?.category).toBe('travel');
  });

  it('falls back to personality_traits rather than dropping an uncategorised fact', () => {
    // Undercounting engine B would read as an AgentCore result. See the note on
    // pickCategory for why the vaguest category is the right home.
    const record = parseMemoryRecord('rec-3', JSON.stringify({ preference: 'laughs easily' }));
    expect(record?.category).toBe('personality_traits');
    expect(record?.key).toBe('personality_traits_note');
  });

  it('defaults confidence to 0.8 instead of claiming certainty', () => {
    expect(parseMemoryRecord('rec-4', JSON.stringify({ preference: 'x' }))?.confidence).toBe(0.8);
  });

  it('honours a reported confidence in range and rejects one outside it', () => {
    expect(
      parseMemoryRecord('rec-5', JSON.stringify({ preference: 'x', confidence: 0.42 }))?.confidence,
    ).toBe(0.42);
    expect(
      parseMemoryRecord('rec-6', JSON.stringify({ preference: 'x', confidence: 7 }))?.confidence,
    ).toBe(0.8);
  });

  it('skips a record it cannot place, so one bad row costs one fact', () => {
    expect(parseMemoryRecord('rec-7', 'not json at all')).toBeNull();
    expect(parseMemoryRecord('rec-8', JSON.stringify({ nothing: 'useful' }))).toBeNull();
    expect(parseMemoryRecord('rec-9', JSON.stringify(['a', 'list']))).toBeNull();
    expect(parseMemoryRecord(undefined, JSON.stringify({ preference: 'x' }))).toBeNull();
    expect(parseMemoryRecord('rec-10', undefined)).toBeNull();
  });
});

describe('memoryNamespace', () => {
  it('matches the namespace agentcore-stack.ts configures', () => {
    // A mismatch here returns zero records rather than erroring, which would
    // make engine B look as though it had extracted nothing.
    expect(memoryNamespace('user-abc', 'sess-1')).toBe('/valentin/user-abc/sess-1');
  });
});

describe('runtimeSessionIdFor', () => {
  it('passes a UUID through untouched', () => {
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(runtimeSessionIdFor(uuid)).toBe(uuid);
  });

  it('pads a short id to the 33 characters the API requires', () => {
    const padded = runtimeSessionIdFor('sess-1');
    expect(padded.length).toBeGreaterThanOrEqual(33);
    expect(padded.startsWith('valentin-session-sess-1')).toBe(true);
  });
});

describe('BedrockAgentCoreRuntime configuration', () => {
  it('refuses to construct without a Runtime ARN, naming what is missing', () => {
    expect(() => new BedrockAgentCoreRuntime(undefined, 'mem-1')).toThrow(
      AgentCoreNotConfiguredError,
    );
    expect(() => new BedrockAgentCoreRuntime(undefined, 'mem-1')).toThrow(
      /AGENTCORE_RUNTIME_ARN/,
    );
  });

  it('refuses to construct without a Memory id', () => {
    expect(() => new BedrockAgentCoreRuntime('arn:aws:bedrock-agentcore:::runtime/r', undefined))
      .toThrow(/AGENTCORE_MEMORY_ID/);
  });
});

describe('BedrockAgentCoreRuntime wire calls', () => {
  const arn = 'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/valentin-dev';
  let send: ReturnType<typeof vi.fn>;
  let runtime: BedrockAgentCoreRuntime;

  beforeEach(() => {
    send = vi.fn();
    runtime = new BedrockAgentCoreRuntime(arn, 'mem-dev', { send } as never);
  });

  it('sends the prompt, the shared system prompt and the history as JSON', async () => {
    send.mockResolvedValue({
      response: '{"content":"Lovely."}',
      runtimeSessionId: 'rt-1',
      traceId: 'trace-1',
    });

    const reply = await runtime.invoke({
      sessionId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      actorId: 'user-abc',
      prompt: 'She loves jazz',
      systemPrompt: 'You are Valentin',
      history: [
        {
          id: 'm1',
          sessionId: 's',
          sender: 'agent',
          content: 'Hello!',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(reply).toEqual({
      content: 'Lovely.',
      toolsUsed: [],
      runtimeSessionId: 'rt-1',
      traceId: 'trace-1',
    });

    const input = send.mock.calls[0][0].input;
    expect(input.agentRuntimeArn).toBe(arn);
    expect(input.runtimeUserId).toBe('user-abc');
    const payload = JSON.parse(new TextDecoder().decode(input.payload));
    expect(payload.prompt).toBe('She loves jazz');
    expect(payload.system_prompt).toBe('You are Valentin');
    expect(payload.actor_id).toBe('user-abc');
    expect(payload.memory_id).toBe('mem-dev');
    // 'agent' must arrive as 'assistant' — a Runtime that sees an unknown role
    // drops the turn, which silently shortens engine B's context.
    expect(payload.history).toEqual([{ role: 'assistant', content: 'Hello!' }]);
  });

  it('reads a streaming body through transformToString', async () => {
    send.mockResolvedValue({
      response: { transformToString: () => Promise.resolve('{"content":"streamed"}') },
    });
    const reply = await runtime.invoke({
      sessionId: 's',
      actorId: 'u',
      prompt: 'p',
      systemPrompt: 'sp',
      history: [],
    });
    expect(reply.content).toBe('streamed');
  });

  it('records both halves of the turn in one event, so the extractor sees the pair', async () => {
    send.mockResolvedValue({});
    await runtime.recordTurn('sess-1', 'user-abc', 'she loves jazz', 'noted!');

    const input = send.mock.calls[0][0].input;
    expect(input.memoryId).toBe('mem-dev');
    expect(input.actorId).toBe('user-abc');
    expect(input.sessionId).toBe('sess-1');
    expect(input.payload).toHaveLength(2);
    expect(input.payload[0].conversational.role).toBe('USER');
    expect(input.payload[0].conversational.content.text).toBe('she loves jazz');
    expect(input.payload[1].conversational.role).toBe('ASSISTANT');
  });

  it('lists the whole namespace rather than searching it', async () => {
    send.mockResolvedValue({
      memoryRecordSummaries: [
        { memoryRecordId: 'r1', content: { text: JSON.stringify({ category: 'music', preference: 'jazz' }) } },
        { memoryRecordId: 'r2', content: { text: 'unparseable' } },
      ],
    });

    const records = await runtime.recallPreferences('sess-1', 'user-abc');

    // A searchQuery-ranked top-k would answer "what is relevant now", not
    // "what has been learned" — the mirror needs the latter.
    expect(send.mock.calls[0][0].input.namespace).toBe('/valentin/user-abc/sess-1');
    expect(send.mock.calls[0][0].input.searchQuery).toBeUndefined();
    expect(records).toHaveLength(1);
    expect(records[0].value).toBe('jazz');
  });

  it('propagates an invoke failure instead of inventing an answer', async () => {
    send.mockRejectedValue(new Error('AccessDeniedException'));
    await expect(
      runtime.invoke({ sessionId: 's', actorId: 'u', prompt: 'p', systemPrompt: 'sp', history: [] }),
    ).rejects.toThrow('AccessDeniedException');
  });
});
