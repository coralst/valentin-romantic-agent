import type { ChatMessage } from '../../shared/interfaces/message';
import type { StorageInterface } from './storage-interface';

/** Summarised context window for LLM prompts */
export interface ContextWindow {
  /** Summary of older messages, or null if full history fits within budget */
  summary: string | null;
  /** Recent messages that fit within the token budget */
  recentMessages: ChatMessage[];
  /** Total number of messages in the session */
  totalMessages: number;
}

/** Manages conversation history and context window truncation */
export interface ConversationMemory {
  addMessage(sessionId: string, message: ChatMessage): Promise<void>;
  getHistory(sessionId: string): Promise<ChatMessage[]>;
  getContextWindow(
    sessionId: string,
    maxTokens: number,
  ): Promise<ContextWindow>;
}

/** Rough token estimation: ~4 characters per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: ChatMessage): number {
  // Account for role label overhead + content
  return estimateTokens(msg.sender) + estimateTokens(msg.content) + 4;
}

/** In-memory ConversationMemory backed by a StorageInterface */
export class InMemoryConversationMemory implements ConversationMemory {
  constructor(private readonly store: StorageInterface) {}

  async addMessage(sessionId: string, message: ChatMessage): Promise<void> {
    await this.store.saveMessage(message);
  }

  async getHistory(sessionId: string): Promise<ChatMessage[]> {
    return this.store.getMessagesBySession(sessionId);
  }

  async getContextWindow(
    sessionId: string,
    maxTokens: number,
  ): Promise<ContextWindow> {
    const allMessages = await this.store.getMessagesBySession(sessionId);
    const totalMessages = allMessages.length;

    // Check if full history fits
    const totalTokens = allMessages.reduce(
      (sum, msg) => sum + estimateMessageTokens(msg),
      0,
    );

    if (totalTokens <= maxTokens) {
      return { summary: null, recentMessages: allMessages, totalMessages };
    }

    // Need to truncate — reserve tokens for summary placeholder
    const summaryPlaceholder =
      '[Earlier conversation summarised — user is discussing spouse preferences with Valentin]';
    const summaryTokens = estimateTokens(summaryPlaceholder);
    const budgetForMessages = Math.max(0, maxTokens - summaryTokens);

    // Take as many recent messages as fit within the remaining budget
    const recentMessages: ChatMessage[] = [];
    let usedTokens = 0;

    for (let i = allMessages.length - 1; i >= 0; i--) {
      const msgTokens = estimateMessageTokens(allMessages[i]);
      if (usedTokens + msgTokens > budgetForMessages) break;
      recentMessages.unshift(allMessages[i]);
      usedTokens += msgTokens;
    }

    // If no messages fit alongside the summary, return just the most recent
    // messages that fit within the full budget (no summary)
    if (recentMessages.length === 0) {
      let fallbackTokens = 0;
      for (let i = allMessages.length - 1; i >= 0; i--) {
        const msgTokens = estimateMessageTokens(allMessages[i]);
        if (fallbackTokens + msgTokens > maxTokens) break;
        recentMessages.unshift(allMessages[i]);
        fallbackTokens += msgTokens;
      }
      return {
        summary: null,
        recentMessages,
        totalMessages,
      };
    }

    return {
      summary: summaryPlaceholder,
      recentMessages,
      totalMessages,
    };
  }
}
