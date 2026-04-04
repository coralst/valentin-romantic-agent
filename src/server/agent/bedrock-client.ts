import type { ChatMessage } from '../../shared/interfaces/message';
import { LlmError } from '../../shared/errors/llm-error';

/** Schema definition for a Bedrock tool-use call */
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Response from a standard Bedrock conversation call */
export interface LlmResponse {
  content: string;
}

/** Response from a Bedrock tool-use call */
export interface ToolUseResponse {
  toolName: string;
  input: Record<string, unknown>;
}

/** Abstract interface for LLM interactions — implementations can be real Bedrock SDK or stubs */
export interface BedrockClient {
  /** Generate a conversational response given message history and system prompt */
  generateResponse(
    messages: ChatMessage[],
    systemPrompt: string,
  ): Promise<LlmResponse>;

  /** Call the LLM with a tool-use schema and return structured output */
  extractWithTool(
    message: ChatMessage,
    history: ChatMessage[],
    toolSchema: ToolSchema,
  ): Promise<ToolUseResponse>;
}

// TODO(yellow): integrate real AWS Bedrock SDK — replace this stub with actual SDK calls
/** Stub Bedrock client that returns placeholder responses for local development */
export class StubBedrockClient implements BedrockClient {
  async generateResponse(
    messages: ChatMessage[],
    _systemPrompt: string,
  ): Promise<LlmResponse> {
    try {
      const lastMessage = messages[messages.length - 1];
      const content = lastMessage
        ? `That's wonderful to hear! Tell me more about your partner's interests — I'd love to help you build a thoughtful profile of what they enjoy.`
        : `Hello! I'm Valentin, your romantic concierge. Tell me about your special someone, and I'll help you remember every little detail that makes them unique.`;

      return { content };
    } catch (err) {
      throw new LlmError('Stub Bedrock generateResponse failed', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async extractWithTool(
    _message: ChatMessage,
    _history: ChatMessage[],
    _toolSchema: ToolSchema,
  ): Promise<ToolUseResponse> {
    try {
      // Stub returns empty preferences — real implementation would parse LLM tool output
      return {
        toolName: 'extract_preferences',
        input: { preferences: [] },
      };
    } catch (err) {
      throw new LlmError('Stub Bedrock extractWithTool failed', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
