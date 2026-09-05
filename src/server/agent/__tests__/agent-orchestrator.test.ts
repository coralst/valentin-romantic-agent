import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentOrchestrator } from '../agent-orchestrator';
import type {
  BedrockClient,
  LlmContentBlock,
  LlmResponse,
} from '../bedrock-client';
import type { ChatMessage } from '../../../shared/interfaces/message';
import type {
  ActionProposal,
  AgentTool,
} from '../../integrations/tool-registry';
import type { ValentinRuntime } from '../valentin-runtime';
import type { StorageInterface } from '../../persistence/storage-interface';
import type { ConversationMemory, ContextWindow } from '../../persistence/conversation-memory';
import type { PreferenceExtractorRef } from '../agent-orchestrator';

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
    savePreference: vi.fn(),
    savePreferencesBatch: vi.fn().mockResolvedValue([]),
    updatePreference: vi.fn(),
    getPreferencesBySession: vi.fn().mockResolvedValue([]),
    findPreference: vi.fn().mockResolvedValue(null),
    savePerson: vi.fn(),
    savePeopleBatch: vi.fn().mockResolvedValue([]),
    getPeopleBySession: vi.fn().mockResolvedValue([]),
    deletePerson: vi.fn().mockResolvedValue(undefined),
    saveTask: vi.fn(),
    saveTasksBatch: vi.fn().mockResolvedValue([]),
    getTasksBySession: vi.fn().mockResolvedValue([]),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    saveOuting: vi.fn().mockImplementation(async (_s, outing) => outing),
    saveOutingsBatch: vi.fn().mockImplementation(async (_s, outings) => outings),
    getOutingsBySession: vi.fn().mockResolvedValue([]),
    deleteOuting: vi.fn().mockResolvedValue(undefined),
    saveReminder: vi.fn().mockImplementation(async (_sessionId, reminder) => reminder),
    getRemindersBySession: vi.fn().mockResolvedValue([]),
    deleteReminder: vi.fn().mockResolvedValue(undefined),
    setManualValue: vi.fn().mockResolvedValue(undefined),
    getManualValues: vi.fn().mockResolvedValue({}),
    clearManualValue: vi.fn().mockResolvedValue(undefined),
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
    // Never reached by these tests: they build the orchestrator without a tool
    // registry, which is what sends it down the `generateResponse` path.
    converseWithTools: vi.fn().mockResolvedValue({
      message: { role: 'assistant', content: [{ text: 'Mock response' }] },
      text: 'Mock response',
      toolUses: [],
      stopReason: 'end_turn',
    }),
  };
}

function createMockRuntime(): ValentinRuntime {
  return {
    registerAgent: vi.fn().mockResolvedValue('valentin-001'),
    createSession: vi.fn().mockResolvedValue('valentin-session-123'),
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
  let runtime: ValentinRuntime;
  let extractor: PreferenceExtractorRef;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    storage = createMockStorage();
    memory = createMockMemory();
    bedrock = createMockBedrock();
    runtime = createMockRuntime();
    extractor = createMockExtractor();
    orchestrator = new AgentOrchestrator(storage, memory, bedrock, runtime, extractor);
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

    it('creates a runtime session', async () => {
      await orchestrator.initSession();
      expect(runtime.createSession).toHaveBeenCalledWith('sess-123');
    });

    it('stores welcome message in memory', async () => {
      await orchestrator.initSession();
      expect(memory.addMessage).toHaveBeenCalledWith(
        'sess-123',
        expect.objectContaining({ sender: 'agent' }),
      );
    });
  });

  /**
   * The greeting for a session nobody minted here.
   *
   * `initSession` greets, but it is only one of the ways a conversation comes into
   * being: the demo login seeds one, `POST /api/session` creates one, and the
   * client opens one for a brand-new account. Those all arrived silent — the
   * visitor faced an empty transcript and had to speak first — which is why the
   * greeting is its own step, taken when a connection resumes an empty session.
   */
  describe('greetIfEmpty', () => {
    it('greets a session with no history, and persists the greeting', async () => {
      const greeting = await orchestrator.greetIfEmpty('sess-1');

      expect(greeting).not.toBeNull();
      expect(greeting?.sender).toBe('agent');
      expect(greeting?.sessionId).toBe('sess-1');
      expect(greeting?.content).toBeTruthy();
      // Persisted like any other turn, or it would vanish on reload.
      expect(memory.addMessage).toHaveBeenCalledWith('sess-1', greeting);
    });

    it('introduces Valentin and asks about the partner', async () => {
      const greeting = await orchestrator.greetIfEmpty('sess-1');

      expect(greeting?.content).toContain('Valentin');
      expect(greeting?.content).toContain('?');
    });

    it('says nothing to a session that already has a transcript', async () => {
      vi.mocked(memory.getHistory).mockResolvedValue([
        {
          id: 'msg-1',
          sessionId: 'sess-1',
          sender: 'user',
          content: 'She loves peonies',
          timestamp: new Date().toISOString(),
        },
      ]);

      // A reconnect must not re-greet: the greeting is persisted now, so a second
      // one would be saved and the transcript would grow a greeting per reload.
      expect(await orchestrator.greetIfEmpty('sess-1')).toBeNull();
      expect(memory.addMessage).not.toHaveBeenCalled();
    });

    it('welcomes back by name when the session already carries a profile', async () => {
      // The demo login seeds a complete partner before the browser loads, so the
      // transcript is empty while the profile is full. Introducing himself here
      // reads as though he had forgotten her.
      vi.mocked(storage.getPreferencesBySession).mockResolvedValue([
        {
          id: 'pref-1',
          sessionId: 'sess-1',
          category: 'personality_traits',
          key: 'partner_name',
          fieldId: 'partner_name',
          value: 'Samantha',
          confidence: 1,
          sourceMessageId: 'seed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: [],
        },
      ]);

      const greeting = await orchestrator.greetIfEmpty('sess-1');

      expect(greeting?.content).toContain('Samantha');
      expect(greeting?.content).not.toMatch(/what's something your partner absolutely loves/i);
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

    it('sends the stored profile to Bedrock in the system prompt', async () => {
      // The whole product is the profile, and it used to be invisible to the one
      // component that most needed it: only the recent messages and a static
      // prompt were sent, so a complete profile still got a stranger's reply.
      vi.mocked(storage.getPreferencesBySession).mockResolvedValue([
        {
          id: 'pref-1',
          sessionId: 'sess-1',
          category: 'food',
          key: 'favorite_cuisine',
          fieldId: 'favorite_cuisine',
          value: 'Northern Italian',
          confidence: 1,
          sourceMessageId: 'seed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: [],
        },
      ]);

      await orchestrator.handleMessage('sess-1', 'Where should we eat?');

      const systemPrompt = vi.mocked(bedrock.generateResponse).mock.calls[0][1];
      expect(systemPrompt).toContain('Northern Italian');
      expect(systemPrompt).toMatch(/GOAL 2 is live/);
    });

    it('knows her in a brand-new conversation on the same account', async () => {
      // The screenshot case: a fresh chat inside a fully-profiled account. The
      // partner belongs to the account, not to one conversation, so opening a
      // second chat must not turn her into a stranger.
      vi.mocked(storage.listSessions).mockResolvedValue([
        { id: 'sess-new' },
        { id: 'sess-old' },
      ] as never);
      vi.mocked(storage.getPreferencesBySession).mockImplementation(
        async (id: string) =>
          id === 'sess-old'
            ? ([
                {
                  id: 'pref-1',
                  sessionId: 'sess-old',
                  category: 'personality_traits',
                  key: 'partner_name',
                  fieldId: 'partner_name',
                  value: 'Samantha',
                  confidence: 1,
                  sourceMessageId: 'seed',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  history: [],
                },
              ] as never)
            : ([] as never),
      );

      await orchestrator.handleMessage('sess-new', 'What should I plan?');

      const systemPrompt = vi.mocked(bedrock.generateResponse).mock.calls[0][1];
      expect(systemPrompt).toContain('Samantha');
      expect(systemPrompt).toMatch(/GOAL 2 is live/);
    });

    it('lets the active conversation win when a fact was just corrected', async () => {
      vi.mocked(storage.listSessions).mockResolvedValue([
        { id: 'sess-1' },
        { id: 'sess-old' },
      ] as never);
      const pref = (sessionId: string, value: string) => ({
        id: `pref-${sessionId}`,
        sessionId,
        category: 'food',
        key: 'favorite_cuisine',
        fieldId: 'favorite_cuisine',
        value,
        confidence: 1,
        sourceMessageId: 'msg',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [],
      });
      vi.mocked(storage.getPreferencesBySession).mockImplementation(
        async (id: string) =>
          [pref(id, id === 'sess-1' ? 'Northern Italian' : 'Thai')] as never,
      );

      await orchestrator.handleMessage('sess-1', 'Where should we eat?');

      const systemPrompt = vi.mocked(bedrock.generateResponse).mock.calls[0][1];
      expect(systemPrompt).toContain('Northern Italian');
      expect(systemPrompt).not.toContain('Thai');
    });

    it('still answers when the session list cannot be read', async () => {
      vi.mocked(storage.listSessions).mockRejectedValue(new Error('GSI down'));
      vi.mocked(bedrock.generateResponse).mockResolvedValue({ content: 'Certainly.' });

      const result = await orchestrator.handleMessage('sess-1', 'Hello');

      expect(result.content).toBe('Certainly.');
    });

    it('still answers when the profile cannot be read', async () => {
      // A store failure should cost personalisation, not the reply.
      vi.mocked(storage.getPreferencesBySession).mockRejectedValue(
        new Error('table unavailable'),
      );
      vi.mocked(bedrock.generateResponse).mockResolvedValue({ content: 'Of course.' });

      const result = await orchestrator.handleMessage('sess-1', 'Hello');

      expect(result.content).toBe('Of course.');
      expect(vi.mocked(bedrock.generateResponse).mock.calls[0][1]).toMatch(
        /You are Valentin/,
      );
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

  /**
   * Adopting the client's id for the user's turn.
   *
   * Why it matters beyond tidiness: `Preference.sourceMessageId` is the join the
   * permanent "Noted" badge is drawn from, and the transcript renders an
   * optimistic copy the client minted. Unless the server writes the row against
   * the id the client is already showing, the join misses every time.
   *
   * Why it is validated: the id lands in a DynamoDB sort key via
   * `msgSk(timestamp, id)`, so an unbounded client string is key injection with a
   * `#` in it.
   */
  describe('message id adoption', () => {
    const CLIENT_ID = '3f6d1f0e-8c2a-4b71-9f2e-1d0a5b7c8e91';

    beforeEach(() => {
      vi.mocked(bedrock.generateResponse).mockResolvedValue({ content: 'Noted.' });
    });

    /** The message handed to the extractor is the one its rows will point at. */
    async function extractedFrom(messageId: unknown): Promise<ChatMessage> {
      await orchestrator.handleMessage('sess-1', 'She loves peonies', {
        messageId: messageId as string | undefined,
      });
      await new Promise((r) => setTimeout(r, 10));
      return vi.mocked(extractor.extract).mock.calls[0][0];
    }

    it('files the preference against the id the client is already rendering', async () => {
      const message = await extractedFrom(CLIENT_ID);

      // `preference-extractor.ts` writes `sourceMessageId: message.id`, so this
      // is the server-side end of the badge's join.
      expect(message.id).toBe(CLIENT_ID);
      expect(vi.mocked(memory.addMessage).mock.calls[0][1].id).toBe(CLIENT_ID);
    });

    it.each([
      ['not a uuid', 'x'],
      ['a sort-key separator', 'a#b'],
      ['an unbounded string', 'a'.repeat(500)],
      ['a v1 uuid', '2c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d'],
      ['a non-string', 42],
      ['nothing at all', undefined],
    ])('mints its own id when given %s', async (_label, candidate) => {
      const message = await extractedFrom(candidate);

      expect(message.id).not.toBe(candidate);
      // Rejection is not an error path — it is exactly the behaviour every
      // caller had before the field existed.
      expect(message.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  /**
   * The confirmation half of the propose/confirm contract.
   *
   * Every case here is a way for the click to fail, because the success path is
   * one line and the failure paths are where a user either loses a table they
   * think they have or gets two of them.
   */
  describe('confirmAction', () => {
    /** A tool that proposes rather than acts, and records what it confirmed. */
    function reservationTool(overrides: Partial<AgentTool> = {}): AgentTool {
      return {
        name: 'propose_reservation',
        description: 'Hold a table, pending a yes',
        input_schema: { type: 'object', properties: {} },
        service: 'ontopo',
        requiresConfirmation: true,
        execute: vi.fn(async (_input, ctx) => ({
          ok: true,
          summary: 'Held a table at Ouzeria',
          proposal: {
            id: 'prop-1',
            sessionId: ctx.sessionId,
            service: 'ontopo' as const,
            title: 'Ouzeria, Saturday 21:00',
            summary: 'Table for two',
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
          },
        })),
        confirm: vi.fn(async () => ({ ok: true, summary: 'Booked — 21:00 on Saturday.' })),
        ...overrides,
      };
    }

    /**
     * Build an orchestrator whose next turn raises a proposal, and run that turn
     * so the proposal is pending. Returns the tool so tests can assert on it.
     */
    async function withPendingProposal(
      tool: AgentTool = reservationTool(),
      sessionId = 'sess-1',
    ): Promise<{ tool: AgentTool; subject: AgentOrchestrator; proposals: ActionProposal[] }> {
      const proposals: ActionProposal[] = [];
      const registry = new Map([[tool.name, tool]]);
      vi.mocked(bedrock.converseWithTools)
        .mockResolvedValueOnce({
          message: {
            role: 'assistant',
            content: [
              {
                toolUse: { toolUseId: 'use-0', name: tool.name, input: {} },
              } as unknown as LlmContentBlock,
            ],
          },
          text: '',
          reasoning: '',
          toolUses: [{ toolUseId: 'use-0', name: tool.name, input: {} }],
          stopReason: 'tool_use',
        })
        .mockResolvedValueOnce({
          message: { role: 'assistant', content: [{ text: 'Shall I confirm?' }] },
          text: 'Shall I confirm?',
          reasoning: '',
          toolUses: [],
          stopReason: 'end_turn',
        });

      const subject = new AgentOrchestrator(storage, memory, bedrock, runtime, extractor, {
        registry,
        onProposal: (p) => proposals.push(p),
        // Reaches the tool as `ToolContext.userId`. Set here rather than left to
        // the fallback so the assertion below pins the threading — a share link
        // owned by the empty string is the bug this argument exists to prevent.
        userId: 'user-1',
      });
      await subject.handleMessage(sessionId, 'book us dinner');
      return { tool, subject, proposals };
    }

    it('announces the proposal only after the reply is stored', async () => {
      const { proposals } = await withPendingProposal();

      expect(proposals).toHaveLength(1);
      expect(proposals[0].id).toBe('prop-1');
      // The card must land beneath the sentence that introduces it, so the
      // agent turn has to be in the transcript first.
      const storedBeforeAnnounce = vi.mocked(memory.addMessage).mock.calls.some(
        (call) => (call[1] as ChatMessage).content === 'Shall I confirm?',
      );
      expect(storedBeforeAnnounce).toBe(true);
    });

    it('runs the tool\'s confirm and replies with what happened', async () => {
      const { tool, subject } = await withPendingProposal();

      const reply = await subject.confirmAction('sess-1', 'prop-1');

      expect(tool.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'prop-1' }),
        // `objectContaining` because the ctx also carries `storage`, and asserting
        // the exact object would make every future first-party tool dependency a
        // failing test here rather than in the tool that needed it.
        expect.objectContaining({ sessionId: 'sess-1', userId: 'user-1' }),
      );
      expect(reply.content).toBe('Booked — 21:00 on Saturday.');
      expect(reply.sender).toBe('agent');
    });

    it('does not book twice when the card is clicked twice', async () => {
      const { tool, subject } = await withPendingProposal();

      await subject.confirmAction('sess-1', 'prop-1');
      const second = await subject.confirmAction('sess-1', 'prop-1');

      expect(tool.confirm).toHaveBeenCalledTimes(1);
      expect(second.content).toMatch(/lost track/i);
    });

    it('refuses an id it has never seen, rather than silently doing nothing', async () => {
      const { subject } = await withPendingProposal();

      const reply = await subject.confirmAction('sess-1', 'prop-does-not-exist');

      expect(reply.content).toMatch(/lost track/i);
    });

    it('refuses a proposal raised in another conversation', async () => {
      const { tool, subject } = await withPendingProposal();

      const reply = await subject.confirmAction('sess-OTHER', 'prop-1');

      expect(tool.confirm).not.toHaveBeenCalled();
      // Same sentence as an unknown id: a guessed id must not be
      // distinguishable from one belonging to someone else's session.
      expect(reply.content).toMatch(/lost track/i);
    });

    it('fails closed on an expired hold instead of posting a dead link', async () => {
      const expired = reservationTool({
        execute: vi.fn(async (_input, ctx) => ({
          ok: true,
          summary: 'Held a table',
          proposal: {
            id: 'prop-1',
            sessionId: ctx.sessionId,
            service: 'ontopo' as const,
            title: 'Ouzeria',
            summary: 'Table for two',
            url: 'https://s1.ontopo.com/checkout/stale',
            expiresAt: new Date(Date.now() - 1_000).toISOString(),
          },
        })),
      });
      const { tool, subject } = await withPendingProposal(expired);

      const reply = await subject.confirmAction('sess-1', 'prop-1');

      expect(tool.confirm).not.toHaveBeenCalled();
      expect(reply.content).toMatch(/expired/i);
    });

    it('says so plainly when the confirmation itself fails', async () => {
      const failing = reservationTool({
        confirm: vi.fn(async () => ({
          ok: false,
          summary: 'Ontopo rejected the hold.',
        })),
      });
      const { subject } = await withPendingProposal(failing);

      const reply = await subject.confirmAction('sess-1', 'prop-1');

      expect(reply.content).toContain('Ontopo rejected the hold.');
      expect(reply.content).not.toMatch(/booked/i);
    });
  });
});
