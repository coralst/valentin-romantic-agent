import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import type { StorageInterface } from '../persistence/storage-interface';
import type { ConversationMemory } from '../persistence/conversation-memory';
import type { BedrockClient } from './bedrock-client';
import type { AgentCoreAdapter } from './agentcore-adapter';
import {
  buildSystemPrompt,
  partnerNameFrom,
  type KnownFact,
} from './prompts';
import { LlmError } from '../../shared/errors/llm-error';

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

/** Abstract orchestrator interface */
export interface AgentOrchestratorInterface {
  initSession(): Promise<InitSessionResult>;
  /**
   * Open the conversation, unless someone already has. See the implementation.
   */
  greetIfEmpty(sessionId: string): Promise<ChatMessage | null>;
  handleMessage(sessionId: string, content: string): Promise<ChatMessage>;
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

/** Maximum tokens for context window */
const MAX_CONTEXT_TOKENS = 4096;

/**
 * How many other conversations to gather the partner's profile from.
 *
 * `listSessions` returns newest first, so this takes the recent ones. One query
 * each, on every turn — see {@link AgentOrchestrator.knownFacts}.
 */
const MAX_PROFILE_SESSIONS = 6;

/** Orchestrates conversation flow between user, Bedrock LLM, and preference extraction */
export class AgentOrchestrator implements AgentOrchestratorInterface {
  constructor(
    private readonly storage: StorageInterface,
    private readonly memory: ConversationMemory,
    private readonly bedrockClient: BedrockClient,
    private readonly agentCore: AgentCoreAdapter,
    private readonly extractor: PreferenceExtractorRef | null,
  ) {}

  async initSession(): Promise<InitSessionResult> {
    const sessionId = await this.storage.createSession();
    await this.agentCore.createSession(sessionId);

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
  ): Promise<ChatMessage> {
    // Store the user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
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
    try {
      const response = await this.callBedrockWithRetry(
        context.recentMessages,
        buildSystemPrompt(await this.knownFacts(sessionId)),
      );
      responseContent = response;
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
   * ACCOUNT-WIDE, NOT PER-CONVERSATION. Preferences are stored under a session,
   * but the partner they describe belongs to the account: opening a second
   * conversation does not give someone a second partner. Reading only
   * `sessionId` meant a brand-new chat inside a fully-profiled account was
   * treated as a first meeting — the exact thing that made him ask a user who
   * had twenty-one known fields to tell him about his partner.
   *
   * The active session is merged last so it wins on conflicts: it holds the most
   * recent turn, and a fact just corrected there must not be overwritten by the
   * older copy of it sitting in another conversation.
   *
   * Bounded to the most recent handful of conversations. This runs on every turn
   * and each session is its own query, so it is capped rather than left to grow
   * with the account's history; the latest conversations are where a current
   * profile actually lives.
   *
   * Best-effort throughout: a store that fails here must cost a personalised
   * reply, not the reply itself. Falling back to less knowledge degrades him to
   * the getting-to-know-you register, which is wrong but harmless; propagating
   * would put an apology on screen instead of an answer.
   */
  private async knownFacts(sessionId: string): Promise<KnownFact[]> {
    const merged = new Map<string, KnownFact>();

    for (const id of await this.recentSessionIds(sessionId)) {
      for (const fact of await this.factsIn(id)) {
        merged.set(fact.fieldId ?? fact.key, fact);
      }
    }

    return [...merged.values()];
  }

  /** The sessions worth reading, oldest first, with the active one last */
  private async recentSessionIds(activeId: string): Promise<string[]> {
    let others: string[] = [];
    try {
      others = (await this.storage.listSessions())
        .map((session) => session.id)
        .filter((id) => id !== activeId)
        .slice(0, MAX_PROFILE_SESSIONS)
        .reverse();
    } catch (err) {
      console.warn(
        '[orchestrator] could not list sessions for the prompt:',
        err instanceof Error ? err.message : err,
      );
    }
    return [...others, activeId];
  }

  private async factsIn(sessionId: string): Promise<KnownFact[]> {
    try {
      return await this.storage.getPreferencesBySession(sessionId);
    } catch (err) {
      console.warn(
        '[orchestrator] could not read the profile for the prompt:',
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  }

  /** Call Bedrock, retry once on failure, throw on second failure */
  private async callBedrockWithRetry(
    messages: ChatMessage[],
    systemPrompt: string,
  ): Promise<string> {
    try {
      const response = await this.bedrockClient.generateResponse(
        messages,
        systemPrompt,
      );
      return response.content;
    } catch (firstError) {
      console.warn('[orchestrator] Bedrock first attempt failed, retrying:', 
        firstError instanceof Error ? firstError.message : firstError);
      // Retry once
      try {
        const response = await this.bedrockClient.generateResponse(
          messages,
          systemPrompt,
        );
        return response.content;
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
