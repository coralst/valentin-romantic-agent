import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import type { StorageInterface } from '../persistence/storage-interface';
import type { ConversationMemory } from '../persistence/conversation-memory';
import type { BedrockClient } from './bedrock-client';
import type { AgentCoreAdapter } from './agentcore-adapter';
import { VALENTIN_SYSTEM_PROMPT } from './prompts';
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
  handleMessage(sessionId: string, content: string): Promise<ChatMessage>;
}

/** Maximum tokens for context window */
const MAX_CONTEXT_TOKENS = 4096;

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

    const welcomeMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId,
      sender: 'agent',
      content:
        "Hello! I'm Valentin, your romantic concierge. I'm here to help you build a thoughtful profile of your special someone. Tell me — what's something your partner absolutely loves?",
      timestamp: new Date().toISOString(),
    };

    await this.memory.addMessage(sessionId, welcomeMessage);

    return { sessionId, welcomeMessage };
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

    // Call Bedrock with retry
    let responseContent: string;
    try {
      const response = await this.callBedrockWithRetry(
        context.recentMessages,
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

  /** Call Bedrock, retry once on failure, throw on second failure */
  private async callBedrockWithRetry(
    messages: ChatMessage[],
  ): Promise<string> {
    try {
      const response = await this.bedrockClient.generateResponse(
        messages,
        VALENTIN_SYSTEM_PROMPT,
      );
      return response.content;
    } catch (firstError) {
      console.warn('[orchestrator] Bedrock first attempt failed, retrying:', 
        firstError instanceof Error ? firstError.message : firstError);
      // Retry once
      try {
        const response = await this.bedrockClient.generateResponse(
          messages,
          VALENTIN_SYSTEM_PROMPT,
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
