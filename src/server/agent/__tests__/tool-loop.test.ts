import { describe, it, expect, vi } from 'vitest';
import { runToolLoop, MAX_TOOL_ITERATIONS } from '../tool-loop';
import type {
  BedrockClient,
  LlmContentBlock,
  ToolTurn,
} from '../bedrock-client';
import type {
  ActionProposal,
  AgentTool,
  ToolRegistry,
} from '../../integrations/tool-registry';
import type { AgentActivityPayload } from '../../../shared/interfaces/ws-events';

/** A turn in which the model just answers. */
function textTurn(text: string): ToolTurn {
  return {
    message: { role: 'assistant', content: [{ text }] },
    text,
    reasoning: '',
    toolUses: [],
    stopReason: 'end_turn',
  };
}

/** A turn in which the model asks for one or more tools. */
function toolTurn(
  ...calls: Array<{ name: string; input?: Record<string, unknown> }>
): ToolTurn {
  return {
    message: {
      role: 'assistant',
      // Cast because Bedrock's ContentBlock is a discriminated union whose
      // members each forbid the other keys; an object literal in a `.map` widens
      // to the wrong member. The shape below is the real `toolUse` block.
      content: calls.map(
        (call, i) =>
          ({
            toolUse: {
              toolUseId: `use-${i}`,
              name: call.name,
              input: call.input ?? {},
            },
          }) as unknown as LlmContentBlock,
      ),
    },
    text: '',
    reasoning: '',
    toolUses: calls.map((call, i) => ({
      toolUseId: `use-${i}`,
      name: call.name,
      input: call.input ?? {},
    })),
    stopReason: 'tool_use',
  };
}

/** A client that returns the given turns in order, then repeats the last one. */
function clientReturning(turns: ToolTurn[]): {
  client: BedrockClient;
  calls: Array<{ messages: unknown[] }>;
} {
  const calls: Array<{ messages: unknown[] }> = [];
  let index = 0;
  const client = {
    generateResponse: vi.fn(),
    extractWithTool: vi.fn(),
    converseWithTools: vi.fn(async (messages: unknown[]) => {
      calls.push({ messages: [...messages] });
      const turn = turns[Math.min(index, turns.length - 1)];
      index += 1;
      return turn;
    }),
  } as unknown as BedrockClient;
  return { client, calls };
}

function registryOf(...tools: AgentTool[]): ToolRegistry {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function readTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: 'check_shabbat',
    description: 'When Shabbat begins and ends',
    input_schema: { type: 'object', properties: {} },
    service: 'hebcal',
    requiresConfirmation: false,
    execute: vi.fn(async () => ({ ok: true, summary: 'Havdalah at 18:03' })),
    ...overrides,
  };
}

const PROPOSAL: ActionProposal = {
  id: 'prop-1',
  sessionId: 'sess-1',
  service: 'ontopo',
  title: 'Ouzeria, Saturday 21:00',
  summary: 'Table for two',
  url: 'https://s1.ontopo.com/checkout/abc',
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
};

function run(registry: ToolRegistry, client: BedrockClient) {
  return runToolLoop({
    client,
    messages: [{ role: 'user', content: [{ text: 'plan me a date' }] }],
    systemPrompt: 'be Valentin',
    registry,
    sessionId: 'sess-1',
    userId: 'user-1',
  });
}

describe('runToolLoop', () => {
  it('returns the answer without touching a tool when the model does not ask', async () => {
    const tool = readTool();
    const { client } = clientReturning([textTurn('How about Sunday?')]);

    const result = await run(registryOf(tool), client);

    expect(result.text).toBe('How about Sunday?');
    expect(result.iterations).toBe(1);
    expect(result.truncated).toBe(false);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('runs a requested tool and feeds the result back for a second turn', async () => {
    const tool = readTool();
    const { client, calls } = clientReturning([
      toolTurn({ name: 'check_shabbat', input: { city: 'Tel Aviv' } }),
      textTurn('Saturday after 18:03 then.'),
    ]);

    const result = await run(registryOf(tool), client);

    expect(result.text).toBe('Saturday after 18:03 then.');
    expect(result.iterations).toBe(2);
    expect(tool.execute).toHaveBeenCalledWith(
      { city: 'Tel Aviv' },
      { sessionId: 'sess-1', userId: 'user-1' },
    );

    // The second call must carry the assistant turn verbatim and a toolResult
    // tagged with the id Bedrock issued — a mismatch is rejected outright.
    expect(calls[1].messages).toHaveLength(3);
    expect(calls[1].messages[2]).toEqual({
      role: 'user',
      content: [
        {
          toolResult: {
            toolUseId: 'use-0',
            content: [{ text: 'Havdalah at 18:03' }],
            status: 'success',
          },
        },
      ],
    });
  });

  it('answers two tools requested in one turn, in one round trip', async () => {
    const shabbat = readTool();
    const search = readTool({
      name: 'search_restaurants',
      service: 'ontopo',
      execute: vi.fn(async () => ({ ok: true, summary: 'Three places open' })),
    });
    const { client, calls } = clientReturning([
      toolTurn({ name: 'check_shabbat' }, { name: 'search_restaurants' }),
      textTurn('Ouzeria at nine.'),
    ]);

    const result = await run(registryOf(shabbat, search), client);

    expect(result.iterations).toBe(2);
    expect(shabbat.execute).toHaveBeenCalledOnce();
    expect(search.execute).toHaveBeenCalledOnce();
    const results = (calls[1].messages[2] as { content: unknown[] }).content;
    expect(results).toHaveLength(2);
  });

  it('turns a thrown tool into an error result instead of failing the reply', async () => {
    const tool = readTool({
      execute: vi.fn(async () => {
        throw new Error('ontopo returned 502');
      }),
    });
    const { client, calls } = clientReturning([
      toolTurn({ name: 'check_shabbat' }),
      textTurn("I couldn't check — shall we try Sunday?"),
    ]);

    const result = await run(registryOf(tool), client);

    expect(result.text).toBe("I couldn't check — shall we try Sunday?");
    const block = (calls[1].messages[2] as { content: Array<{ toolResult: { status: string; content: Array<{ text: string }> } }> })
      .content[0];
    expect(block.toolResult.status).toBe('error');
    expect(block.toolResult.content[0].text).toContain('ontopo returned 502');
  });

  it('tells the model when it invents a tool, rather than leaving it waiting', async () => {
    const tool = readTool();
    const { client, calls } = clientReturning([
      toolTurn({ name: 'order_flowers' }),
      textTurn('I cannot order flowers, but I can find dinner.'),
    ]);

    const result = await run(registryOf(tool), client);

    expect(result.text).toBe('I cannot order flowers, but I can find dinner.');
    const block = (calls[1].messages[2] as { content: Array<{ toolResult: { status: string; content: Array<{ text: string }> } }> })
      .content[0];
    expect(block.toolResult.status).toBe('error');
    expect(block.toolResult.content[0].text).toContain('order_flowers');
    // The message names what it *may* call, so the next turn can recover.
    expect(block.toolResult.content[0].text).toContain('check_shabbat');
  });

  it('collects proposals and tells the model nothing has happened yet', async () => {
    const tool = readTool({
      name: 'propose_reservation',
      service: 'ontopo',
      requiresConfirmation: true,
      execute: vi.fn(async () => ({
        ok: true,
        summary: 'Held a table at Ouzeria',
        proposal: PROPOSAL,
      })),
    });
    const { client, calls } = clientReturning([
      toolTurn({ name: 'propose_reservation' }),
      textTurn('Shall I confirm Ouzeria at nine?'),
    ]);

    const result = await run(registryOf(tool), client);

    expect(result.proposals).toEqual([PROPOSAL]);
    const block = (calls[1].messages[2] as { content: Array<{ toolResult: { content: Array<{ text: string }> } }> })
      .content[0];
    expect(block.toolResult.content[0].text).toContain('nothing has happened yet');
    expect(block.toolResult.content[0].text).toMatch(/do not say it is booked/i);
  });

  it('stops at the iteration cap and returns the last thing the model said', async () => {
    const tool = readTool();
    // A model stuck calling the same tool forever, with one line of prose.
    const stuck: ToolTurn = {
      ...toolTurn({ name: 'check_shabbat' }),
      text: 'Let me check that.',
    };
    const { client } = clientReturning([stuck]);

    const result = await run(registryOf(tool), client);

    expect(result.truncated).toBe(true);
    expect(result.iterations).toBe(MAX_TOOL_ITERATIONS);
    expect(client.converseWithTools).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS);
    expect(result.text).toBe('Let me check that.');
  });

  it('falls back to a sentence when the cap is hit with no prose at all', async () => {
    const tool = readTool();
    const { client } = clientReturning([toolTurn({ name: 'check_shabbat' })]);

    const result = await run(registryOf(tool), client);

    expect(result.truncated).toBe(true);
    // Never an empty bubble.
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('offers every registered tool to the model', async () => {
    const shabbat = readTool();
    const search = readTool({ name: 'search_restaurants', service: 'ontopo' });
    const { client } = clientReturning([textTurn('ok')]);

    await run(registryOf(shabbat, search), client);

    expect(client.converseWithTools).toHaveBeenCalledWith(
      expect.anything(),
      'be Valentin',
      [
        expect.objectContaining({ name: 'check_shabbat' }),
        expect.objectContaining({ name: 'search_restaurants' }),
      ],
      'sess-1',
      { thinking: undefined },
    );
  });

  /**
   * The trail is derived from real calls, so it cannot invent a step. What it can
   * get wrong is *when* it speaks: a row that appears only once the tool has
   * returned narrates the past and leaves the wait unexplained, which is the bug
   * this feature exists to fix.
   */
  describe('narration', () => {
    it('opens the row before the tool resolves and closes it after', async () => {
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tool = readTool({
        execute: vi.fn(async () => {
          await blocked;
          return { ok: true, summary: 'Havdalah at 18:03.' };
        }),
      });
      const { client } = clientReturning([
        toolTurn({ name: 'check_shabbat', input: { city: 'Tel Aviv' } }),
        textTurn('Saturday after 18:03 then.'),
      ]);
      const activity: AgentActivityPayload[] = [];

      const pending = runToolLoop({
        client,
        messages: [{ role: 'user', content: [{ text: 'plan me a date' }] }],
        systemPrompt: 'be Valentin',
        registry: registryOf(tool),
        sessionId: 'sess-1',
        userId: 'user-1',
        onActivity: (a) => activity.push(a),
      });

      // Still in flight: the start frame must already be out.
      await vi.waitFor(() => expect(activity).toHaveLength(1));
      expect(activity[0]).toMatchObject({
        kind: 'tool_start',
        sessionId: 'sess-1',
        id: 'use-0',
        iteration: 1,
        tool: 'check_shabbat',
        service: 'hebcal',
        inputSummary: 'city: Tel Aviv',
      });

      release();
      await pending;

      expect(activity).toHaveLength(2);
      expect(activity[1]).toMatchObject({
        kind: 'tool_end',
        // The same id, so the client completes the line it drew instead of
        // appending a second row under the reader's eyes.
        id: 'use-0',
        tool: 'check_shabbat',
        ok: true,
        outcome: 'Havdalah at 18:03.',
      });
    });

    it('narrates a tool the model invented', async () => {
      // It costs the user a round trip, so it is a visible beat rather than an
      // unexplained pause — and no partner is blamed for it.
      const { client } = clientReturning([
        toolTurn({ name: 'book_a_hot_air_balloon' }),
        textTurn('Let me think again.'),
      ]);
      const activity: AgentActivityPayload[] = [];

      await runToolLoop({
        client,
        messages: [{ role: 'user', content: [{ text: 'surprise her' }] }],
        systemPrompt: 'be Valentin',
        registry: registryOf(readTool()),
        sessionId: 'sess-1',
        userId: 'user-1',
        onActivity: (a) => activity.push(a),
      });

      expect(activity.map((a) => a.kind)).toEqual(['tool_start', 'tool_end']);
      expect(activity[1]).toMatchObject({ ok: false, outcome: 'no such tool', service: 'unknown' });
    });

    it('says nothing about reasoning that was never asked for', async () => {
      const { client } = clientReturning([textTurn('How about Sunday?')]);
      const activity: AgentActivityPayload[] = [];

      await runToolLoop({
        client,
        messages: [{ role: 'user', content: [{ text: 'hi' }] }],
        systemPrompt: 'be Valentin',
        registry: registryOf(readTool()),
        sessionId: 'sess-1',
        userId: 'user-1',
        onActivity: (a) => activity.push(a),
      });

      expect(activity).toEqual([]);
      expect(client.converseWithTools).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'sess-1',
        { thinking: undefined },
      );
    });

    it('emits the reasoning the model actually produced', async () => {
      const turn = textTurn('Sunday, then.');
      const { client } = clientReturning([{ ...turn, reasoning: 'She hates crowds.' }]);
      const activity: AgentActivityPayload[] = [];

      await runToolLoop({
        client,
        messages: [{ role: 'user', content: [{ text: 'hi' }] }],
        systemPrompt: 'be Valentin',
        registry: registryOf(readTool()),
        sessionId: 'sess-1',
        userId: 'user-1',
        showThinking: true,
        onActivity: (a) => activity.push(a),
      });

      expect(activity).toEqual([
        {
          kind: 'thinking',
          sessionId: 'sess-1',
          id: 'thinking:1',
          iteration: 1,
          text: 'She hates crowds.',
        },
      ]);
      expect(client.converseWithTools).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'sess-1',
        { thinking: true },
      );
    });

    it('runs a normal turn with no emitter at all', async () => {
      const tool = readTool();
      const { client } = clientReturning([
        toolTurn({ name: 'check_shabbat' }),
        textTurn('Saturday works.'),
      ]);

      const result = await run(registryOf(tool), client);

      expect(result.text).toBe('Saturday works.');
    });
  });
});
