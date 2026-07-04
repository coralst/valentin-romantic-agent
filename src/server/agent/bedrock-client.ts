import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type SystemContentBlock,
  type Tool,
  type ContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
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

/**
 * Default model. Claude 3 Haiku was retired ("Legacy") by the provider, so we
 * target the current active Sonnet via its cross-region inference profile.
 * Newer Claude models are only invokable through an inference-profile ID
 * (region-prefixed), not a bare foundation-model ID.
 */
const DEFAULT_MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

/** Map ChatMessage array to Bedrock Converse API message format.
 *  Bedrock requires conversations to start with a user message,
 *  so we skip any leading agent/assistant messages. */
function toBedrockMessages(messages: ChatMessage[]): Message[] {
  // Drop leading assistant messages — Bedrock requires user-first
  const startIdx = messages.findIndex((m) => m.sender === 'user');
  const trimmed = startIdx >= 0 ? messages.slice(startIdx) : messages;

  return trimmed.map((msg) => ({
    role: msg.sender === 'user' ? 'user' as const : 'assistant' as const,
    content: [{ text: msg.content }],
  }));
}

/** Extract text content from Bedrock response content blocks */
function extractTextFromBlocks(blocks: ContentBlock[] | undefined): string {
  if (!blocks) return '';
  return blocks
    .filter((b): b is ContentBlock & { text: string } => 'text' in b && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

/** Real AWS Bedrock client using the Converse API */
export class AwsBedrockClient implements BedrockClient {
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor(region?: string, modelId?: string) {
    this.client = new BedrockRuntimeClient({
      region: region ?? process.env.AWS_REGION ?? 'us-east-1',
    });
    this.modelId = modelId ?? process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;
  }

  async generateResponse(
    messages: ChatMessage[],
    systemPrompt: string,
  ): Promise<LlmResponse> {
    try {
      const system: SystemContentBlock[] = [{ text: systemPrompt }];
      const bedrockMessages = toBedrockMessages(messages);

      const command = new ConverseCommand({
        modelId: this.modelId,
        system,
        messages: bedrockMessages,
      });

      const response = await this.client.send(command);
      const content = extractTextFromBlocks(response.output?.message?.content);

      if (!content) {
        throw new LlmError('Bedrock returned empty response', {
          modelId: this.modelId,
          stopReason: response.stopReason,
        });
      }

      return { content };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      const errMsg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : 'Unknown';
      console.error(`[bedrock] generateResponse failed: ${errName}: ${errMsg}`);
      throw new LlmError('Bedrock generateResponse failed', {
        modelId: this.modelId,
        errorName: errName,
        cause: errMsg,
      });
    }
  }

  async extractWithTool(
    message: ChatMessage,
    history: ChatMessage[],
    toolSchema: ToolSchema,
  ): Promise<ToolUseResponse> {
    try {
      const allMessages = [...history, message];
      const bedrockMessages = toBedrockMessages(allMessages);

      const tool: Tool = {
        toolSpec: {
          name: toolSchema.name,
          description: toolSchema.description,
          inputSchema: {
            // Bedrock SDK expects DocumentType which is a broad union — safe to cast here
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            json: toolSchema.input_schema as any,
          },
        },
      };

      const system: SystemContentBlock[] = [{
        text: `Analyze the latest message in the conversation and extract any spouse/partner preferences using the ${toolSchema.name} tool. Only extract preferences that are clearly stated or strongly implied.`,
      }];

      const command = new ConverseCommand({
        modelId: this.modelId,
        system,
        messages: bedrockMessages,
        toolConfig: {
          tools: [tool],
          toolChoice: { tool: { name: toolSchema.name } },
        },
      });

      const response = await this.client.send(command);
      const blocks = response.output?.message?.content;

      if (!blocks) {
        throw new LlmError('Bedrock tool-use returned no content blocks', {
          modelId: this.modelId,
          stopReason: response.stopReason,
        });
      }

      const toolUseBlock = blocks.find(
        (b): b is ContentBlock & { toolUse: { name: string; input: Record<string, unknown> } } =>
          'toolUse' in b && b.toolUse !== undefined,
      );

      if (!toolUseBlock) {
        throw new LlmError('Bedrock response contained no tool-use block', {
          modelId: this.modelId,
          blockTypes: blocks.map((b) => Object.keys(b)).flat(),
        });
      }

      return {
        toolName: toolUseBlock.toolUse.name,
        input: toolUseBlock.toolUse.input as Record<string, unknown>,
      };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      const errMsg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : 'Unknown';
      console.error(`[bedrock] extractWithTool failed: ${errName}: ${errMsg}`);
      throw new LlmError('Bedrock extractWithTool failed', {
        modelId: this.modelId,
        errorName: errName,
        cause: errMsg,
      });
    }
  }
}

