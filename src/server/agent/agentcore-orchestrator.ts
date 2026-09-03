import type { ChatMessage } from '../../shared/interfaces/message';
import type { StorageInterface } from '../persistence/storage-interface';
import type { ConversationMemory } from '../persistence/conversation-memory';
import { logger } from '../logging';
import {
  buildWelcomeMessage,
  MAX_CONTEXT_TOKENS,
  type AgentOrchestratorInterface,
  type InitSessionResult,
  type OnPreferenceUpdate,
} from './agent-orchestrator';
import { buildSystemPrompt, partnerNameFrom } from './prompts';
import { readKnownFacts } from './partner-profile';
import type { AgentCoreRuntime, RememberedPreference } from './agentcore-adapter';

/**
 * Engine B: the same conversation, run on AgentCore.
 *
 * WHAT IS DELIBERATELY IDENTICAL TO ENGINE A
 *
 * The greeting ({@link buildWelcomeMessage}), the system prompt
 * ({@link buildSystemPrompt}), the facts it is built from
 * ({@link readKnownFacts}) and the history budget ({@link MAX_CONTEXT_TOKENS}).
 * None of that is code reuse for its own sake — this class exists so that a
 * measured difference between the two engines is attributable to AgentCore, and
 * every one of those four is a confound if the engines are allowed to differ on
 * it. `agent-orchestrator.ts` owns them; this file imports them and adds none of
 * its own.
 *
 * WHAT IS DIFFERENT, WHICH IS THE POINT
 *
 * Engine A calls Bedrock Converse directly, then runs a hand-written tool-use
 * pipeline (`extraction/preference-extractor.ts`) to pull preferences out of the
 * turn. Engine B hands the turn to a Runtime that reaches its tools through the
 * Gateway, and gets preference extraction from AgentCore Memory's managed
 * strategy instead of writing an extractor at all.
 *
 * DynamoDB stays the source of truth for the profile. AgentCore's extracted
 * records are mirrored into it after each turn (see {@link mirrorPreferences}),
 * so the existing profile UI and `GET /api/session/:id/preferences` work
 * unchanged on both engines and neither engine needs a second read path.
 */
export class AgentCoreOrchestrator implements AgentOrchestratorInterface {
  constructor(
    private readonly storage: StorageInterface,
    private readonly memory: ConversationMemory,
    private readonly runtime: AgentCoreRuntime,
    /**
     * Who this conversation belongs to — the raw `storageId`, threaded in from
     * `forUser(userId)`.
     *
     * `StorageInterface` needs no user because an instance carries one
     * internally, but AgentCore is not our store, so this has to be passed
     * explicitly. See `agentcore-adapter.ts` for what goes wrong if a session id
     * is passed here instead.
     *
     * Named `storageId` rather than `actorId` because it now feeds two contracts
     * that disagree about spelling: Memory partitions by a sanitised `actorId`
     * (no `#`, applied downstream by `actorIdFor`), while the Gateway's profile
     * tools key the DynamoDB partition and need this value *raw*. Holding the
     * raw form here and sanitising at the single point of use is what keeps the
     * two from drifting.
     */
    private readonly storageId: string,
    private readonly onPreferenceUpdate: OnPreferenceUpdate | null,
  ) {}

  async initSession(): Promise<InitSessionResult> {
    const sessionId = await this.storage.createSession();

    // No AgentCore call here on purpose. The Runtime session and the Memory
    // partition are both created lazily by the first invoke and CreateEvent, so
    // a session the user never speaks in costs nothing — and engine A's
    // `agentCore.createSession` is a stub, so calling something real here would
    // put an extra round trip on engine B's session-creation latency and make
    // the comparison read worse than the engine is.
    const welcomeMessage = buildWelcomeMessage(sessionId);
    await this.memory.addMessage(sessionId, welcomeMessage);

    return { sessionId, welcomeMessage };
  }

  /** Identical to engine A's, down to the words. See {@link buildWelcomeMessage}. */
  async greetIfEmpty(sessionId: string): Promise<ChatMessage | null> {
    const history = await this.memory.getHistory(sessionId);
    if (history.length > 0) return null;

    const welcomeMessage = buildWelcomeMessage(
      sessionId,
      partnerNameFrom(await readKnownFacts(this.storage, sessionId)),
    );
    await this.memory.addMessage(sessionId, welcomeMessage);
    return welcomeMessage;
  }

  async handleMessage(sessionId: string, content: string): Promise<ChatMessage> {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId,
      sender: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    await this.memory.addMessage(sessionId, userMessage);

    const context = await this.memory.getContextWindow(sessionId, MAX_CONTEXT_TOKENS);

    let responseContent: string;
    try {
      const reply = await this.runtime.invoke({
        sessionId,
        actorId: this.storageId,
        // Same value, two contracts: `actorId` gets sanitised for Memory inside
        // the adapter, `userId` travels raw because the Gateway's profile tools
        // key DynamoDB with it. See `AgentCoreTurn.userId`.
        userId: this.storageId,
        prompt: content,
        systemPrompt: buildSystemPrompt(await readKnownFacts(this.storage, sessionId)),
        history: context.recentMessages,
      });
      responseContent = reply.content;
    } catch (err) {
      // No retry, and no Bedrock fallback.
      //
      // Engine A retries once inside `callBedrockWithRetry`, and matching that
      // here would be the symmetrical thing to do — but the Runtime has already
      // applied its own retry and this is the number the comparison is meant to
      // expose. A second attempt hidden at this layer would report AgentCore's
      // p99 as though the first failure had not happened.
      //
      // Falling back to Bedrock is impossible by design: engine B's task role
      // has no `bedrock:InvokeModel` (see compute-stack.ts), so an engine-B
      // outage shows up as an engine-B outage rather than as engine A quietly
      // answering under engine B's label.
      logger.error('agentcore.invoke.failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      responseContent =
        "I'm sorry, I'm having a little trouble right now. Could you try saying that again? I really want to hear about your partner.";
    }

    const agentMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId,
      sender: 'agent',
      content: responseContent,
      timestamp: new Date().toISOString(),
    };
    await this.memory.addMessage(sessionId, agentMessage);

    // Engine A's extractor is fire-and-forget for the same reason: memory work
    // must not sit between the model's answer and the user seeing it, and a
    // Memory outage must cost the profile update rather than the reply.
    void this.rememberTurn(sessionId, userMessage, agentMessage);

    return agentMessage;
  }

  /**
   * File the turn with Memory, then mirror whatever it has extracted.
   *
   * The two calls are sequential rather than parallel because the second is only
   * meaningful after the first, but note the recall does *not* see this turn's
   * facts: managed extraction is asynchronous on AWS's side and takes seconds.
   * So each mirror lands the previous turn's extractions, and the profile drawer
   * on engine B trails engine A's by about one message.
   *
   * That lag is real and worth stating plainly rather than papering over with a
   * sleep-and-poll: it is a property of the managed strategy, and hiding it
   * would misrepresent the thing being compared.
   */
  /**
   * Not available on engine B, and deliberately loud about it.
   *
   * Propose-then-confirm is engine A's: the proposal is raised by the hand-written
   * tool loop, which holds the pending write in memory until the user presses
   * Confirm. Engine B's tools are called inside the Runtime through the Gateway,
   * so there is no pending proposal here to accept — the id the client sent
   * belongs to a turn that happened on the other engine.
   *
   * A throw rather than a silent no-op or a friendly refusal message, because the
   * only way to reach this is a client that switched engines with a proposal card
   * still on screen. That is a wiring bug worth seeing in the logs, not something
   * to absorb: the router catches it and the card reports the failure.
   */
  async confirmAction(sessionId: string, proposalId: string): Promise<ChatMessage> {
    throw new Error(
      `Engine B has no proposal to confirm (session ${sessionId}, proposal ${proposalId}): ` +
        'propose-then-confirm runs in engine A’s tool loop. Switch back to engine A.',
    );
  }

  private async rememberTurn(
    sessionId: string,
    userMessage: ChatMessage,
    agentMessage: ChatMessage,
  ): Promise<void> {
    try {
      await this.runtime.recordTurn(
        sessionId,
        this.storageId,
        userMessage.content,
        agentMessage.content,
      );
      const remembered = await this.runtime.recallPreferences(sessionId, this.storageId);
      await this.mirrorPreferences(sessionId, userMessage.id, remembered);
    } catch (err) {
      logger.error('agentcore.memory.failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Write AgentCore's extracted preferences into DynamoDB.
   *
   * Upsert per record, using `findPreference` before deciding, because
   * `savePreference` on an existing (session, category, key) would lose the
   * change history that the profile UI's "revised from" display reads. An
   * unchanged value is skipped entirely rather than re-saved: `updatePreference`
   * appends the old value to the history, so re-saving an identical value on
   * every turn would grow a fake revision trail.
   *
   * Per-record `try` so one bad record costs one fact. These writes emit
   * `preference.saved` from inside `dynamodb-store.ts`, so they appear in the
   * telemetry drawer exactly as engine A's do — with the engine visible from the
   * log group they land in.
   */
  private async mirrorPreferences(
    sessionId: string,
    sourceMessageId: string,
    remembered: readonly RememberedPreference[],
  ): Promise<void> {
    for (const pref of remembered) {
      try {
        const existing = await this.storage.findPreference(
          sessionId,
          pref.category,
          pref.key,
        );

        if (!existing) {
          const saved = await this.storage.savePreference({
            sessionId,
            category: pref.category,
            key: pref.key,
            value: pref.value,
            confidence: pref.confidence,
            sourceMessageId,
          });
          this.onPreferenceUpdate?.(saved, true);
          continue;
        }

        if (existing.value === pref.value) continue;

        const updated = await this.storage.updatePreference(
          { sessionId, category: pref.category, key: pref.key },
          {
            value: pref.value,
            confidence: pref.confidence,
            sourceMessageId,
          },
        );
        this.onPreferenceUpdate?.(updated, false);
      } catch (err) {
        logger.warn('agentcore.memory.mirror_failed', {
          sessionId,
          category: pref.category,
          key: pref.key,
          recordId: pref.recordId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
