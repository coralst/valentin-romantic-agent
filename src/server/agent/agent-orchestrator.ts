import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import type { StorageInterface } from '../persistence/storage-interface';
import type { ConversationMemory } from '../persistence/conversation-memory';
import type { BedrockClient } from './bedrock-client';
import { toLlmMessages } from './bedrock-client';
import type { ValentinRuntime } from './valentin-runtime';
import { runToolLoop, type ActivityEmitter } from './tool-loop';
import { summariseToolOutcome } from './activity-summary';
import type {
  ActionProposal,
  AgentTool,
  ToolRegistry,
} from '../integrations/tool-registry';
import { runTool } from '../integrations/tool-registry';
import {
  buildSystemPrompt,
  partnerNameFrom,
  type KnownFact,
} from './prompts';
import { readKnownFacts, readVisitedPlaces } from './partner-profile';
import { recordOuting } from './outing-recorder';
import {
  PendingProposalStore,
  ProposalUnavailableError,
} from './pending-proposals';
import type { Outing } from '../../shared/interfaces/outing';
import { LlmError } from '../../shared/errors/llm-error';
import { logger } from '../logging';

/** Callback invoked when a preference is extracted */
export type OnPreferenceUpdate = (
  preference: PreferenceWithHistory,
  isNew: boolean,
) => void;

/** Interface for the preference extraction pipeline */
export interface PreferenceExtractorRef {
  extract(
    message: ChatMessage,
    history: ChatMessage[],
  ): Promise<void>;
}

/** Result of session initialization */
export interface InitSessionResult {
  sessionId: string;
  welcomeMessage: ChatMessage;
}

/**
 * What the client asked for about *this* turn, as opposed to the conversation.
 *
 * All three fields are optional and all three describe presentation or identity,
 * never authority — a turn with none of them behaves exactly as turns did before
 * any of this existed.
 */
export interface TurnOptions {
  /**
   * The id the client already gave this turn in its own transcript.
   *
   * Adopting it is what makes `Preference.sourceMessageId` name a message the
   * transcript can actually find; see {@link adoptableMessageId} for why it is
   * validated first rather than trusted.
   */
  messageId?: string;
  /** Reveal the model's real reasoning for this turn. Costs tokens; retunes voice. */
  showThinking?: boolean;
  /** Where to send the narration. Absent means narrate nothing. */
  onActivity?: ActivityEmitter;
}

/**
 * A client-supplied message id we are willing to adopt, or `undefined`.
 *
 * This is a validation boundary, not a formality: the adopted id becomes part of
 * a DynamoDB **sort key** via `msgSk(timestamp, id)`, so an unbounded string is
 * key injection with a `#` in it. A v4 uuid is exactly what the client generates,
 * so anything else is a bug or an attack and both get the same answer — ignore it
 * and mint server-side, which is what happened before this field existed.
 */
export function adoptableMessageId(candidate: unknown): string | undefined {
  if (typeof candidate !== 'string') return undefined;
  return UUID_V4.test(candidate) ? candidate : undefined;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Abstract orchestrator interface */
export interface AgentOrchestratorInterface {
  initSession(): Promise<InitSessionResult>;
  /**
   * Open the conversation, unless someone already has. See the implementation.
   */
  greetIfEmpty(sessionId: string): Promise<ChatMessage | null>;
  handleMessage(
    sessionId: string,
    content: string,
    options?: TurnOptions,
  ): Promise<ChatMessage>;
  /**
   * Carry out a proposal the user accepted. See the implementation for why this
   * exists as its own entry point rather than as another turn of conversation.
   */
  confirmAction(
    sessionId: string,
    proposalId: string,
    /**
     * The tool trail only — a confirm never calls the model with tools, so there
     * is no reasoning to reveal, and a display setting has no business riding on
     * an authorisation frame.
     */
    narrate?: ActivityEmitter,
  ): Promise<ChatMessage>;
}

/**
 * The optional half of the orchestrator's dependencies: the outside world.
 *
 * One options object rather than two more positional parameters. The
 * constructor already takes five collaborators, and `new AgentOrchestrator(a, b,
 * c, d, e, f, g)` is a long parameter list in which transposing two arguments
 * type-checks. It is also genuinely optional — every existing caller and test
 * omits it and gets today's behaviour, a conversation with no tools.
 */
export interface ToolSupport {
  /** Empty or absent ⇒ no tools are offered and the model is never given a `toolConfig`. */
  registry?: ToolRegistry;
  /** Called once per proposal raised, after the agent's reply has been stored. */
  onProposal?: (proposal: ActionProposal) => void;
  /**
   * Called once per outing recorded, so the dossier updates without a reload.
   *
   * Separate from `onProposal` because the two are opposite halves of the same
   * exchange: a proposal is a question, an outing is a thing that has happened.
   * Optional like the rest of this interface — the HTTP path has no socket to
   * push down, and the row is on her file either way.
   */
  onBooking?: (sessionId: string, outing: Outing) => void;
  /**
   * Who this orchestrator belongs to, passed to every tool via `ToolContext`.
   *
   * An orchestrator is already built per user (`forUser` in `index.ts`), so this
   * is constructor-time knowledge rather than anything a turn decides. Optional
   * only so the existing tests that construct one with no tools keep compiling;
   * a tool that needs it — `create_conversation_link` — fails loudly rather than
   * minting a link naming the empty string.
   */
  userId?: string;
}

/**
 * Valentin's opening turn.
 *
 * One function, so every route into a new conversation greets with the same
 * words: the socket minting a session, the socket resuming an empty one, and a
 * session the demo login or "+ New conversation" created over HTTP. A second
 * copy of this text somewhere else would drift, and the greeting is the first
 * thing an audience reads.
 */
export function buildWelcomeMessage(
  sessionId: string,
  partnerName?: string | null,
): ChatMessage {
  // A session that already carries a profile must not be greeted as a stranger.
  // The demo login seeds a complete partner *before* the browser has loaded, so
  // the transcript is empty while the profile is full — and the introduction
  // then reads as though Valentin had forgotten her between visits.
  const content = partnerName
    ? `Welcome back. I've got ${partnerName} on file and I'm keeping an eye on the dates that matter. Anything you'd like to plan, or anything new I should know about her?`
    : "Hello! I'm Valentin, your romantic concierge. I'm here to help you build a thoughtful profile of your special someone. Tell me — what's something your partner absolutely loves?";

  return {
    id: crypto.randomUUID(),
    sessionId,
    sender: 'agent',
    content,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Maximum tokens for context window.
 *
 * Exported because engine B sends the same budget: a difference in how much
 * history each engine sees would show up as a difference in answer quality that
 * has nothing to do with AgentCore.
 */
export const MAX_CONTEXT_TOKENS = 4096;

/**
 * How long to wait before the one retry, and how much to spread it.
 *
 * Short enough that a user who is owed a reply is not left watching the typing
 * indicator — the SDK has already spent its own backoff by the time we get here,
 * so this is the last pause before the fallback, not the first.
 */
const RETRY_BASE_MS = 400;
const RETRY_JITTER_MS = 600;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Orchestrates conversation flow between user, Bedrock LLM, and preference extraction */
export class AgentOrchestrator implements AgentOrchestratorInterface {
  constructor(
    private readonly storage: StorageInterface,
    private readonly memory: ConversationMemory,
    private readonly bedrockClient: BedrockClient,
    private readonly runtime: ValentinRuntime,
    private readonly extractor: PreferenceExtractorRef | null,
    private readonly tools: ToolSupport = {},
  ) {}

  /**
   * Proposals this conversation has raised and nobody has answered yet.
   *
   * The store, its ownership check and its expiry rule are shared with engine B
   * — see {@link PendingProposalStore} — so a proposal is refused in the same
   * words whichever engine raised it.
   */
  private readonly pendingProposals = new PendingProposalStore();

  async initSession(): Promise<InitSessionResult> {
    const sessionId = await this.storage.createSession();
    await this.runtime.createSession(sessionId);

    const welcomeMessage = buildWelcomeMessage(sessionId);
    await this.memory.addMessage(sessionId, welcomeMessage);

    return { sessionId, welcomeMessage };
  }

  /**
   * Greet a session that has nothing in it yet, and persist the greeting.
   *
   * Sessions do not only come from `initSession`: the demo login seeds one
   * before the browser has loaded, "+ New conversation" POSTs one, and the
   * client creates one when a user has none. All of those used to open on a
   * blank transcript, because only the *minting* path greeted — so a brand-new
   * account met an empty screen and had to speak first.
   *
   * Keyed on "no messages at all" rather than on "no agent messages", which is
   * what makes it safe to call on every resume: the second call sees the
   * greeting the first one wrote and does nothing. It is persisted like any
   * other agent turn, so it survives a reload and a session switch, and it is
   * `sender: 'agent'`, so nothing downstream mistakes it for the user having
   * spoken.
   */
  async greetIfEmpty(sessionId: string): Promise<ChatMessage | null> {
    const history = await this.memory.getHistory(sessionId);
    if (history.length > 0) return null;

    const welcomeMessage = buildWelcomeMessage(
      sessionId,
      partnerNameFrom(await this.knownFacts(sessionId)),
    );
    await this.memory.addMessage(sessionId, welcomeMessage);
    return welcomeMessage;
  }

  async handleMessage(
    sessionId: string,
    content: string,
    options: TurnOptions = {},
  ): Promise<ChatMessage> {
    // Store the user message, under the client's own id where it gave us a usable
    // one. That is what lets an extracted preference point at a message the live
    // transcript can find — see `adoptableMessageId`.
    const userMessage: ChatMessage = {
      id: adoptableMessageId(options.messageId) ?? crypto.randomUUID(),
      sessionId,
      sender: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    await this.memory.addMessage(sessionId, userMessage);

    // Get context window for LLM
    const context = await this.memory.getContextWindow(
      sessionId,
      MAX_CONTEXT_TOKENS,
    );

    // Call Bedrock with retry, with her profile in the system prompt
    let responseContent: string;
    let proposals: ActionProposal[] = [];
    try {
      const reply = await this.callBedrockWithRetry(
        context.recentMessages,
        buildSystemPrompt(
          await this.knownFacts(sessionId),
          (this.tools.registry?.size ?? 0) > 0,
          await readVisitedPlaces(this.storage, sessionId),
        ),
        sessionId,
        options,
      );
      responseContent = reply.text;
      proposals = reply.proposals;
    } catch (err) {
      console.error('[orchestrator] Bedrock failed after retry:', err);
      responseContent =
        "I'm sorry, I'm having a little trouble right now. Could you try saying that again? I really want to hear about your partner.";
    }

    // Store the agent response
    const agentMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId,
      sender: 'agent',
      content: responseContent,
      timestamp: new Date().toISOString(),
    };
    await this.memory.addMessage(sessionId, agentMessage);

    // After the reply is stored, so the card lands beneath the sentence that
    // introduces it rather than above it.
    this.announce(proposals);

    // Trigger async preference extraction — does not block response
    if (this.extractor) {
      const history = await this.memory.getHistory(sessionId);
      this.extractor.extract(userMessage, history).catch(() => {
        // Extraction errors are logged inside the extractor; never propagate
      });
    }

    return agentMessage;
  }

  /**
   * What Valentin knows about her, for the prompt.
   *
   * Delegates to {@link readKnownFacts}, which engine B calls too. See the long
   * note there for why the account-wide read matters and why it is best-effort.
   */
  private knownFacts(sessionId: string): Promise<KnownFact[]> {
    return readKnownFacts(this.storage, sessionId);
  }

  /**
   * Carry out a proposal the user accepted.
   *
   * Its own entry point rather than another turn of conversation, because a
   * click is not a sentence: routing "yes" back through the model would make
   * whether the reservation happens depend on whether it re-selected the same
   * tool with the same arguments a second time. Here the accepted proposal *is*
   * the authority, and the tool that raised it is the one that executes it.
   *
   * Fails closed on all four ways this can go wrong — unknown id, wrong session,
   * expired link, tool error — and each one produces a specific sentence rather
   * than a silent no-op, because the user is looking at a card they just clicked
   * and needs to know whether the table is theirs.
   */
  async confirmAction(
    sessionId: string,
    proposalId: string,
    narrate?: ActivityEmitter,
  ): Promise<ChatMessage> {
    let pending;
    try {
      pending = this.pendingProposals.take(sessionId, proposalId);
    } catch (error) {
      if (!(error instanceof ProposalUnavailableError)) throw error;

      if (error.reason === 'expired') {
        logger.warn('agent.proposal_expired', {
          sessionId,
          // `integration`, not `service`: formatLog already writes
          // service: 'valentin-backend' into every record, and reusing the key
          // overwrites it.
          integration: error.service,
        });
      }
      return this.say(sessionId, error.message);
    }

    // Engine A always stores a tool alongside the proposal — `announce` skips
    // any proposal it cannot find one for — so this is a type narrowing, not a
    // case that happens. Engine B is the reason the field is optional at all.
    if (!pending.tool) {
      return this.say(
        sessionId,
        "I've lost track of that one, I'm afraid — it may have already been dealt with. Shall I look again?",
      );
    }

    // `storage` because a confirming tool may need to write our own table, not
    // just a third party's. Nothing needs it today — `set_reminder` writes
    // immediately and has no confirm step — but the two ctx sites have to agree,
    // or a tool that works from chat fails from a card.
    const ctx = { sessionId, userId: this.tools.userId ?? '', storage: this.storage };

    // This is where the trail earns its keep most: the user has just authorised a
    // booking and is watching a card, and the reservation is a multi-second round
    // trip to Ontopo. `proposalId` is the correlation id because there is no
    // `toolUseId` here — no model asked for this, a person did.
    const startedAt = Date.now();
    // Named for the confirm rather than the tool, so the two halves of a
    // propose→confirm pair are distinguishable in the trail. Matches the
    // `operation` `runToolConfirm` logs.
    const confirmName = `confirm_${pending.tool.name.replace(/^propose_/, '')}`;
    narrate?.({
      kind: 'tool_start',
      sessionId,
      id: proposalId,
      iteration: 1,
      tool: confirmName,
      service: pending.tool.service,
      // The proposal's own title, which the user is looking at already, rather
      // than the opaque `payload` the tool kept for itself.
      inputSummary: pending.proposal.title,
    });

    const result = pending.tool.confirm
      ? await pending.tool.confirm(pending.proposal, ctx)
      : await runTool(pending.tool, { confirm: proposalId }, ctx);

    narrate?.({
      kind: 'tool_end',
      sessionId,
      id: proposalId,
      iteration: 1,
      tool: confirmName,
      service: pending.tool.service,
      durationMs: Date.now() - startedAt,
      ok: result.ok,
      outcome: summariseToolOutcome(result.summary, result.ok),
    });

    // Write down where he has taken her, before the reply goes out.
    //
    // Awaited rather than fired and forgotten so the row exists by the time the
    // client, reading the reply, refetches the session — but `recordOuting`
    // never throws and never rejects the turn, because the booking already
    // happened. Gated on `result.ok`: a failed confirm reserved nothing.
    if (result.ok) {
      const outing = await recordOuting(this.storage, sessionId, result.booking);
      if (outing) this.tools.onBooking?.(sessionId, outing);
    }

    return this.say(
      sessionId,
      result.ok
        ? result.summary
        : `I couldn't complete that: ${result.summary} Would you like me to try something else?`,
    );
  }

  /** Remember each proposal, and tell whoever is listening about it. */
  private announce(proposals: readonly ActionProposal[]): void {
    for (const proposal of proposals) {
      const tool = this.toolFor(proposal);
      if (!tool) continue;

      this.pendingProposals.remember(proposal, { tool });
      this.tools.onProposal?.(proposal);
    }
  }

  /** The registered tool that would carry a proposal out, if it still exists. */
  private toolFor(proposal: ActionProposal): AgentTool | undefined {
    for (const tool of this.tools.registry?.values() ?? []) {
      if (tool.service === proposal.service && tool.requiresConfirmation) {
        return tool;
      }
    }
    return undefined;
  }

  /** Store and return an agent turn that the model had no part in writing. */
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

  /**
   * Produce one reply, retrying once on failure and throwing on the second.
   *
   * Takes the tool loop when there are tools to offer and the plain single-shot
   * call when there are not. That branch is not an optimisation: Bedrock rejects
   * a `toolConfig` carrying an empty tool list, so a deployment with no
   * integration credentials — which is every test run and every local session
   * without secrets — genuinely must not go through the loop.
   *
   * The retry is deliberately of the whole loop and not of one Converse call.
   * A mid-chain failure leaves a transcript whose last turn is a `toolUse` with
   * no answer, which Bedrock will reject; starting over is the only correct
   * recovery, and read-only tools re-run harmlessly. The write tools cannot
   * double-fire, because they propose rather than act.
   */
  private async callBedrockWithRetry(
    messages: ChatMessage[],
    systemPrompt: string,
    sessionId: string,
    options: TurnOptions = {},
  ): Promise<{ text: string; proposals: ActionProposal[] }> {
    const attempt = async (): Promise<{
      text: string;
      proposals: ActionProposal[];
    }> => {
      const registry = this.tools.registry;
      if (!registry || registry.size === 0) {
        const response = await this.bedrockClient.generateResponse(
          messages,
          systemPrompt,
          { thinking: options.showThinking },
        );
        // The tool-less path has no iterations to number, so it narrates as one.
        // It is not a rare branch: it is every local run without integration
        // credentials, which is where this feature is usually demonstrated.
        if (response.reasoning) {
          options.onActivity?.({
            kind: 'thinking',
            sessionId,
            id: 'thinking:1',
            iteration: 1,
            text: response.reasoning,
          });
        }
        return { text: response.content, proposals: [] };
      }

      const result = await runToolLoop({
        client: this.bedrockClient,
        messages: toLlmMessages(messages),
        systemPrompt,
        registry,
        sessionId,
        userId: this.tools.userId ?? '',
        storage: this.storage,
        onActivity: options.onActivity,
        showThinking: options.showThinking,
      });
      return { text: result.text, proposals: result.proposals };
    };

    try {
      return await attempt();
    } catch (firstError) {
      console.warn('[orchestrator] Bedrock first attempt failed, retrying:',
        firstError instanceof Error ? firstError.message : firstError);
      // Wait before retrying, rather than immediately.
      //
      // The failure worth surviving here is a throttle: several turns in flight
      // at once — a chat turn and the extractor that follows it — is enough to
      // trip Bedrock's per-account rate limit during a demo. An immediate second
      // attempt lands inside the same throttle window and fails for the same
      // reason, spending the retry for nothing and answering with the fallback.
      // Jittered, so two turns that were throttled together do not both come
      // back at the same instant and throttle each other again.
      await sleep(RETRY_BASE_MS + Math.random() * RETRY_JITTER_MS);
      try {
        return await attempt();
      } catch (secondError) {
        throw new LlmError('Bedrock call failed after retry', {
          firstError:
            firstError instanceof Error
              ? firstError.message
              : String(firstError),
          secondError:
            secondError instanceof Error
              ? secondError.message
              : String(secondError),
        });
      }
    }
  }
}
