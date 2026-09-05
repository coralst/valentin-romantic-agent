import type { ChatMessage } from '../../shared/interfaces/message';
import type { StorageInterface } from '../persistence/storage-interface';
import type { ConversationMemory } from '../persistence/conversation-memory';
import { logger } from '../logging';
import {
  adoptableMessageId,
  buildWelcomeMessage,
  MAX_CONTEXT_TOKENS,
  type AgentOrchestratorInterface,
  type TurnOptions,
  type InitSessionResult,
  type OnPreferenceUpdate,
} from './agent-orchestrator';
import { buildSystemPrompt, partnerNameFrom } from './prompts';
import { readKnownFacts, readVisitedPlaces } from './partner-profile';
import type {
  AgentCoreRuntime,
  GatewayProposal,
  RememberedPreference,
} from './agentcore-adapter';
import { PendingProposalStore, ProposalUnavailableError } from './pending-proposals';
import type { GatewayToolClient } from './gateway-client';
import { recordOuting } from './outing-recorder';
import type { ActionProposal, IntegrationId } from '../integrations/tool-registry';
import type { Outing } from '../../shared/interfaces/outing';

/**
 * The MCP target the integration tools live behind.
 *
 * Gateway prefixes every tool with its target name and a triple underscore, so a
 * confirm is `valentin-integrations___confirm_reservation`. Named here rather than
 * built at each call site, and matching `infra/lib/agentcore-stack.ts`'s target
 * name — renaming one without the other makes every confirm a "tool not found".
 */
const INTEGRATIONS_TARGET = 'valentin-integrations';

/** The outside world engine B talks to when a proposal is accepted. */
export interface AgentCoreToolSupport {
  /** Called once per proposal raised, after the agent's reply has been stored. */
  onProposal?: (proposal: ActionProposal) => void;
  /** Called once per outing recorded, so the dossier updates without a reload. */
  onBooking?: (sessionId: string, outing: Outing) => void;
  /**
   * How a confirm reaches the Gateway. Absent ⇒ this deployment has no Gateway
   * wiring, and confirming says so plainly instead of throwing.
   */
  gateway?: GatewayToolClient;
}

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
    /**
     * Optional, and every existing caller and test omits it — which gets the
     * behaviour engine B had before it could confirm anything.
     */
    private readonly tools: AgentCoreToolSupport = {},
  ) {}

  /**
   * Proposals this conversation has raised and nobody has answered yet.
   *
   * The same store engine A uses, so ownership and expiry are checked in one place
   * and refused in one set of words. Note what it does *not* hold here: the
   * payload. That lives in the Lambda's `PROPOSAL#` row, keyed by user and
   * session, and this store is the proxy's record that the card was offered — the
   * thing that stops a confirm for a proposal from another conversation ever
   * reaching the Gateway.
   */
  private readonly pendingProposals = new PendingProposalStore();

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

  /**
   * `messageId` is adopted; `showThinking` and `onActivity` are deliberately
   * ignored.
   *
   * Not an oversight and not a TODO. Reasoning and tool calls happen inside the
   * AgentCore Runtime, which reports back a reply and a list of tool names and
   * nothing about when or how long — `agentcore/agent.py` returns `content` and
   * `tools_used`. Engine B's honest answer is therefore no trail rather than a
   * reconstructed one, which is the same reason its `AwsSpan`s carry no
   * `durationMs`. The id is different: it is minted before either engine is
   * chosen, so adopting it costs nothing and keeps the "Noted" badge working on
   * whichever engine happens to be serving.
   */
  async handleMessage(
    sessionId: string,
    content: string,
    options: TurnOptions = {},
  ): Promise<ChatMessage> {
    const userMessage: ChatMessage = {
      id: adoptableMessageId(options.messageId) ?? crypto.randomUUID(),
      sessionId,
      sender: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    await this.memory.addMessage(sessionId, userMessage);

    const context = await this.memory.getContextWindow(sessionId, MAX_CONTEXT_TOKENS);

    let responseContent: string;
    let raised: GatewayProposal[] = [];
    try {
      const reply = await this.runtime.invoke({
        sessionId,
        actorId: this.storageId,
        // Same value, two contracts: `actorId` gets sanitised for Memory inside
        // the adapter, `userId` travels raw because the Gateway's profile tools
        // key DynamoDB with it. See `AgentCoreTurn.userId`.
        userId: this.storageId,
        prompt: content,
        systemPrompt: buildSystemPrompt(
          await readKnownFacts(this.storage, sessionId),
          // No tools on this engine, so no tool guidance — but the history is
          // read side only, and this is where engine B gets it for free.
          false,
          await readVisitedPlaces(this.storage, sessionId),
        ),
        history: context.recentMessages,
      });
      responseContent = reply.content;
      raised = reply.proposals ?? [];
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

    // After the reply is stored, matching engine A's ordering: the card is a
    // follow-up to a message the client already has, and emitting it first would
    // put a proposal on screen for a turn the transcript has not caught up to.
    this.announce(sessionId, raised);

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
   * Carry out a proposal the user accepted — through the Gateway, not the model.
   *
   * The whole shape of this method is the point. The proposal was raised inside a
   * Lambda behind the Gateway and the opaque payload never left it, so confirming
   * is a second Gateway call naming only the proposal's id. It is made *here*, by
   * the application, because the alternative — a `confirm_*` tool the agent may
   * call — puts a language model in the authority path for spending someone's
   * money, which is exactly what propose→confirm exists to prevent. `agent.py`
   * filters the confirm tools out of the list it shows Bedrock for that reason.
   *
   * Ownership and expiry are checked before anything leaves the process, by the
   * same store engine A uses. A proposal raised on the *other* engine still fails
   * here, and honestly so: the store is per-process and per-engine, so a client
   * that switched engines with a card on screen gets "I've lost track of that
   * one" rather than a cross-engine confirm nobody has tested.
   */
  async confirmAction(sessionId: string, proposalId: string): Promise<ChatMessage> {
    let pending;
    try {
      pending = this.pendingProposals.take(sessionId, proposalId);
    } catch (error) {
      if (!(error instanceof ProposalUnavailableError)) throw error;

      if (error.reason === 'expired') {
        logger.warn('agentcore.proposal_expired', {
          sessionId,
          integration: error.service,
        });
      }
      return this.say(sessionId, error.message);
    }

    const gateway = this.tools.gateway;
    if (!gateway || !pending.confirmTool) {
      // Either no Gateway wiring in this deployment — locally, or in a test — or a
      // proposal that arrived without naming its confirm tool, which is what an
      // older tool Lambda mid-rolling-deploy looks like. Neither is guessed at.
      // Said rather than thrown: the card is already on screen, and an unhandled
      // throw would leave it spinning with nothing in the transcript to explain it.
      logger.warn('agentcore.confirm_unwired', {
        sessionId,
        hasGateway: Boolean(gateway),
        service: pending.proposal.service,
      });
      return this.say(
        sessionId,
        "I can't complete that here — this deployment has no route to my booking tools. Would you like me to look again?",
      );
    }

    const tool = `${INTEGRATIONS_TARGET}___${pending.confirmTool}`;

    let result;
    try {
      result = await gateway.callTool(tool, {
        user_id: this.storageId,
        session_id: sessionId,
        proposal_id: proposalId,
      });
    } catch (err) {
      // The Gateway itself was unreachable, which is different from a booking
      // that failed — and the user has just clicked Confirm on something that may
      // or may not have happened. Says so in those terms rather than claiming it
      // did not.
      logger.error('agentcore.confirm.failed', {
        sessionId,
        tool,
        error: err instanceof Error ? err.message : String(err),
      });
      return this.say(
        sessionId,
        "I couldn't reach the booking service just then, so I can't tell you whether that went through. Give me a moment and ask me to check.",
      );
    }

    // Same as engine A's, and awaited for the same reason: the row must exist by
    // the time the client re-reads the session. `recordOuting` never throws and
    // never fails the turn — the booking has already happened.
    if (result.ok && result.booking) {
      const outing = await recordOuting(this.storage, sessionId, result.booking);
      if (outing) this.tools.onBooking?.(sessionId, outing);
    }

    return this.say(
      sessionId,
      result.ok
        ? (result.summary ?? 'Done — that is booked.')
        : `I couldn't complete that: ${result.summary ?? result.error ?? 'the service refused it.'} Would you like me to try something else?`,
    );
  }

  /**
   * Remember each proposal, and tell whoever is listening about it.
   *
   * Field by field into `ActionProposal`, never a spread — the same rule as
   * `onProposal` in `index.ts`. There is no `payload` to leak here (it stayed in
   * the Lambda), and building the object explicitly is what keeps that true if the
   * reply shape ever grows.
   */
  private announce(sessionId: string, raised: readonly GatewayProposal[]): void {
    for (const p of raised) {
      const proposal: ActionProposal = {
        id: p.id,
        // The proxy's own session id, never the reply's: a malformed answer must
        // not be able to address a card at another conversation.
        sessionId,
        service: p.service as IntegrationId,
        title: p.title,
        summary: p.summary,
        ...(p.url ? { url: p.url } : {}),
        expiresAt: p.expiresAt,
      };
      this.pendingProposals.remember(proposal, { confirmTool: p.confirm });
      this.tools.onProposal?.(proposal);
    }
  }

  /** Store and return an agent turn the model had no part in writing. */
  private async say(sessionId: string, content: string): Promise<ChatMessage> {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId,
      sender: 'agent',
      content,
      timestamp: new Date().toISOString(),
    };
    await this.memory.addMessage(sessionId, message);
    return message;
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
