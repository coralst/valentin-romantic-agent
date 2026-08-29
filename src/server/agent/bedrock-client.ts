import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
  type Message,
  type SystemContentBlock,
  type Tool,
  type ContentBlock,
  type GuardrailConfiguration,
} from '@aws-sdk/client-bedrock-runtime';
import type { ChatMessage } from '../../shared/interfaces/message';
import { LlmError } from '../../shared/errors/llm-error';
import { config } from '../config';
import { logger } from '../logging';

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

/**
 * One turn of a conversation, in Bedrock's own shape.
 *
 * Re-exported so the tool loop and its tests can hold a transcript without
 * importing the AWS SDK. That matters more than it looks: the loop appends
 * `toolUse` and `toolResult` content blocks, which {@link ChatMessage} cannot
 * represent — it has a single `content` string — so the loop genuinely has to
 * work in this type and not in ours. Keeping the alias here means exactly one
 * file knows the SDK exists.
 */
export type LlmMessage = Message;

/** One block of a turn: prose, a tool request, or a tool's answer. */
export type LlmContentBlock = ContentBlock;

/** A tool the model asked to run, and the id its result must be tagged with. */
export interface ToolUseRequest {
  /** Bedrock's correlation id. A `toolResult` without the matching id is rejected. */
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
}

/** The outcome of one tool-aware Converse call. */
export interface ToolTurn {
  /**
   * The assistant message verbatim, to append to the transcript unmodified.
   *
   * Reconstructing it from `text` and `toolUses` would drop block ordering and
   * any block type this code does not know about, and Bedrock validates that a
   * `toolResult` follows the exact `toolUse` block it answers.
   */
  message: LlmMessage;
  /** Whatever prose accompanied the call. Often empty on a tool-use turn. */
  text: string;
  /** Empty when the model chose to answer rather than to call anything. */
  toolUses: ToolUseRequest[];
  /** `tool_use`, `end_turn`, `max_tokens`, `guardrail_intervened`, … */
  stopReason: string;
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

  /**
   * One turn of a tool-enabled conversation.
   *
   * Deliberately a single call and not the loop: the caller owns iteration,
   * because deciding whether to run a requested tool, and what to do when it
   * fails, is policy and does not belong in a transport class. See
   * `tool-loop.ts`.
   *
   * Unlike {@link extractWithTool}, which forces one named tool, this offers all
   * of them and lets the model choose — including choosing none.
   */
  converseWithTools(
    messages: LlmMessage[],
    systemPrompt: string,
    tools: readonly ToolSchema[],
    sessionId: string,
  ): Promise<ToolTurn>;
}

/** Lift a ChatMessage transcript into the shape the tool loop works in. */
export function toLlmMessages(messages: ChatMessage[]): LlmMessage[] {
  return toBedrockMessages(messages);
}

/**
 * Default model. Claude 3 Haiku was retired ("Legacy") by the provider, so we
 * target the current active Sonnet via its cross-region inference profile.
 * Newer Claude models are only invokable through an inference-profile ID
 * (region-prefixed), not a bare foundation-model ID.
 */
const DEFAULT_MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

/**
 * Map ChatMessage array to Bedrock Converse API message format.
 *
 * Bedrock requires conversations to start with a user message, so we skip any
 * leading agent/assistant messages.
 *
 * Scoping the guardrail to the newest user turn is `guardNewestUserTurn`'s job,
 * not this one's: it is only legal alongside a `guardrailConfig`, and this
 * function has no way of knowing whether one was built.
 */
function toBedrockMessages(messages: ChatMessage[]): Message[] {
  // Drop leading assistant messages — Bedrock requires user-first
  const startIdx = messages.findIndex((m) => m.sender === 'user');
  const trimmed = startIdx >= 0 ? messages.slice(startIdx) : messages;

  return trimmed.map((msg) => ({
    role: msg.sender === 'user' ? 'user' as const : 'assistant' as const,
    content: [{ text: msg.content }],
  }));
}

/**
 * The policies a guardrail intervention actually fired on, as a flat list like
 * `['pii:ADDRESS', 'filter:SEXUAL', 'topic:off-topic']`.
 *
 * `trace: 'enabled'` was set on every request from the start, but nothing ever
 * read the trace back. An intervention therefore reached the user as a refusal
 * with no recorded cause, and the only way to find out that Bedrock was reading
 * "Kyoto" as a street address was to replay the transcript by hand against
 * `ApplyGuardrail`. One log line makes the next false positive self-explaining.
 */
function firedPolicies(response: ConverseCommandOutput): string[] {
  const guardrail = response.trace?.guardrail;
  if (!guardrail) return [];

  const assessments = [
    ...Object.values(guardrail.inputAssessment ?? {}),
    ...Object.values(guardrail.outputAssessments ?? {}).flat(),
  ];

  const fired = assessments.flatMap((assessment) => [
    ...(assessment.sensitiveInformationPolicy?.piiEntities ?? []).map(
      (entity) => `pii:${entity.type}`,
    ),
    ...(assessment.contentPolicy?.filters ?? []).map((filter) => `filter:${filter.type}`),
    ...(assessment.topicPolicy?.topics ?? []).map((topic) => `topic:${topic.name}`),
    ...(assessment.wordPolicy?.customWords ?? []).map((word) => `word:${word.match}`),
  ]);

  return [...new Set(fired)];
}

/**
 * How many tokens a single reply may use.
 *
 * Was 512, which Sonnet routinely overran on any question inviting detail —
 * the reply then arrived cut off mid-word ("…a quiet intimate dinner o"), on
 * screen, with no indication anything was missing. 1024 covers the replies this
 * agent actually writes; `trimToLastSentence` handles the rest.
 */
const MAX_REPLY_TOKENS = 1024;

/**
 * Cut a reply back to its last complete sentence.
 *
 * Only used when Bedrock reports it stopped because it ran out of tokens. A
 * mid-word stop is the one failure the audience notices immediately, and ending
 * a beat early reads as brevity rather than as a bug. Returns the text
 * unchanged when no sentence boundary can be found — half a sentence still
 * beats an empty bubble.
 */
export function trimToLastSentence(text: string): string {
  const lastEnd = Math.max(
    text.lastIndexOf('. '),
    text.lastIndexOf('! '),
    text.lastIndexOf('? '),
    // Trailing terminator with no space after it: the reply ended cleanly.
    /[.!?]$/.test(text.trimEnd()) ? text.trimEnd().length - 1 : -1,
  );
  if (lastEnd < 0) return text;
  return text.slice(0, lastEnd + 1).trimEnd();
}

/** Extract text content from Bedrock response content blocks */
function extractTextFromBlocks(blocks: ContentBlock[] | undefined): string {
  if (!blocks) return '';
  return blocks
    .filter((b): b is ContentBlock & { text: string } => 'text' in b && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

/**
 * The session a batch of messages belongs to.
 *
 * Every message in a Converse call comes from one conversation, so any of them
 * will do; the last is used because a trimmed history can start anywhere. Falls
 * back to `'unknown'` rather than throwing — a span that cannot be attributed
 * is worth less than one that can, but not so little that it should be allowed
 * to break the reply it was measuring.
 */
function sessionIdOf(messages: ChatMessage[]): string {
  return messages[messages.length - 1]?.sessionId ?? 'unknown';
}

/** Our tool shape as Bedrock's `toolSpec`. */
function toBedrockTool(schema: ToolSchema): Tool {
  return {
    toolSpec: {
      name: schema.name,
      description: schema.description,
      inputSchema: {
        // Bedrock SDK expects DocumentType, a broad union — safe to cast here.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        json: schema.input_schema as any,
      },
    },
  };
}

/** Build guardrail config if environment variables are set */
function buildGuardrailConfig(): GuardrailConfiguration | undefined {
  if (!config.bedrockGuardrailId) return undefined;
  return {
    guardrailIdentifier: config.bedrockGuardrailId,
    guardrailVersion: config.bedrockGuardrailVersion ?? 'DRAFT',
    trace: 'enabled' as const,
  };
}

/**
 * Mark the newest user turn as the part of the request the guardrail should read.
 *
 * Bedrock's default, with no `guardContent` anywhere, is to guard only the last
 * message — a live trace showed `guarded: 42` of `total: 3752` characters, the 42
 * being the user's question. That default is doing the right thing, and this
 * makes it explicit rather than inherited, because what the other 3710 characters
 * now contain is Samantha's entire profile. Guard that and her birthday, her
 * sizes and "Kyoto during cherry blossom season" all get scored as sensitive
 * information on every single turn, and the request the visitor typed never
 * reaches the model.
 *
 * A no-op when no guardrail is configured: `guardContent` is only legal alongside
 * a `guardrailConfig`, and local development runs without one.
 *
 * The last *user* turn rather than the last turn outright. A caller passing
 * history that ends on an assistant message would otherwise leave the request
 * untagged, and untagged means Bedrock silently reverts to screening every block
 * — the whole transcript, her profile included, on every turn.
 */
function guardNewestUserTurn(
  messages: Message[],
  guardrail: GuardrailConfiguration | undefined,
): Message[] {
  if (!guardrail || messages.length === 0) return messages;

  let lastUserIdx = -1;
  messages.forEach((msg, i) => {
    if (msg.role === 'user') lastUserIdx = i;
  });
  if (lastUserIdx === -1) return messages;

  return messages.map((msg, i) =>
    i === lastUserIdx
      ? {
          ...msg,
          content: (msg.content ?? []).map((block) =>
            'text' in block && typeof block.text === 'string'
              ? { guardContent: { text: { text: block.text } } }
              : block,
          ),
        }
      : msg,
  );
}

/**
 * Which guardrail policies fired, as `kind:name` labels.
 *
 * `trace: 'enabled'` was always set and nothing ever read the trace back, so a
 * refusal left no record of its cause anywhere — the only way to find out why
 * Valentin had declined to answer a question about an anniversary gift was to
 * reconstruct the call by hand against the live guardrail. That is not something
 * anyone can do from a CloudWatch log at the time it matters, so the assessment
 * is flattened into labels and logged.
 *
 * Both directions are read. Which side blocked is the first thing worth knowing:
 * an input block is usually the visitor, an output block is usually the policy
 * being wrong about the model.
 */
export function guardrailPoliciesFrom(trace: unknown): string[] {
  const guardrail = (trace as { guardrail?: Record<string, unknown> } | undefined)
    ?.guardrail;
  if (!guardrail) return [];

  const labels = new Set<string>();

  const readAssessment = (assessment: any): void => {
    for (const pii of assessment?.sensitiveInformationPolicy?.piiEntities ?? []) {
      if (pii?.action === 'BLOCKED' || pii?.action === 'ANONYMIZED') {
        labels.add(`pii:${pii.type}`);
      }
    }
    for (const topic of assessment?.topicPolicy?.topics ?? []) {
      if (topic?.action === 'BLOCKED') labels.add(`topic:${topic.name}`);
    }
    for (const filter of assessment?.contentPolicy?.filters ?? []) {
      if (filter?.action === 'BLOCKED') labels.add(`content:${filter.type}`);
    }
    for (const word of assessment?.wordPolicy?.customWords ?? []) {
      if (word?.action === 'BLOCKED') labels.add(`word:${word.match}`);
    }
  };

  // `inputAssessment` is one assessment per guardrail; `outputAssessments` is a
  // list per guardrail, one entry per chunk the model produced.
  for (const assessment of Object.values<any>((guardrail as any).inputAssessment ?? {})) {
    readAssessment(assessment);
  }
  for (const list of Object.values<any>((guardrail as any).outputAssessments ?? {})) {
    for (const assessment of list ?? []) readAssessment(assessment);
  }

  return [...labels].sort();
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

  /** The Bedrock model id this client is configured to invoke. */
  getModelId(): string {
    return this.modelId;
  }

  /**
   * Send a Converse command, timing it and logging the result.
   *
   * The duration has to be measured around the SDK call itself — this is the
   * one number in the system nobody can estimate, and it is the number the
   * architecture drawer shows for the Bedrock node. `span-bridge.ts` turns this
   * log line into an `aws_span`; nothing here knows that, which is the point of
   * routing telemetry through the log seam rather than wiring an emitter in.
   *
   * Logs on the failure path too, and before rethrowing: a Converse call that
   * took four seconds and then threw is the single most useful thing to see on
   * stage, and it is exactly what a success-only wrapper hides.
   */
  private async sendTimed(
    command: ConverseCommand,
    operation: string,
    sessionId: string,
  ): Promise<ConverseCommandOutput> {
    const startedAt = Date.now();
    try {
      const response = await this.client.send(command);
      // Logged here rather than at the two call sites that handle the block, so
      // no future caller can add a third and lose the only record of the cause.
      if (response.stopReason === 'guardrail_intervened') {
        logger.warn('bedrock.guardrail_intervened', {
          sessionId,
          operation,
          policies: firedPolicies(response),
        });
      }
      logger.info('bedrock.converse', {
        sessionId,
        operation,
        modelId: this.modelId,
        durationMs: Date.now() - startedAt,
        ok: true,
      });
      return response;
    } catch (err) {
      logger.info('bedrock.converse', {
        sessionId,
        operation,
        modelId: this.modelId,
        durationMs: Date.now() - startedAt,
        ok: false,
      });
      throw err;
    }
  }

  async generateResponse(
    messages: ChatMessage[],
    systemPrompt: string,
  ): Promise<LlmResponse> {
    try {
      const system: SystemContentBlock[] = [{ text: systemPrompt }];
      const guardrailConfig = buildGuardrailConfig();
      const bedrockMessages = guardNewestUserTurn(
        toBedrockMessages(messages),
        guardrailConfig,
      );

      const command = new ConverseCommand({
        modelId: this.modelId,
        system,
        messages: bedrockMessages,
        inferenceConfig: {
          maxTokens: MAX_REPLY_TOKENS,
          // Claude Sonnet 4.5 rejects temperature and topP together — use temperature only.
          temperature: 0.8,
        },
        guardrailConfig,
      });

      const response = await this.sendTimed(
        command,
        'chat-reply',
        sessionIdOf(messages),
      );

      // Handle guardrail intervention — return the blocked message instead of throwing
      if (response.stopReason === 'guardrail_intervened') {
        logger.warn('bedrock.guardrail_intervened', {
          sessionId: sessionIdOf(messages),
          operation: 'chat-reply',
          policies: guardrailPoliciesFrom(response.trace),
        });
        const blockedContent = extractTextFromBlocks(response.output?.message?.content);
        // Worded as Valentin declining *this* turn, not as him announcing the
        // limits of his job. The old line ("I can only help with learning about
        // your partner. Could you tell me more about their preferences?") landed
        // on people mid-conversation about a partner he already knew, and read as
        // though he had forgotten her and could do nothing else.
        return {
          content:
            blockedContent ||
            "That one I'd rather not go into — but I'm still right here. Shall we talk about her instead?",
        };
      }

      const raw = extractTextFromBlocks(response.output?.message?.content);

      if (!raw) {
        throw new LlmError('Bedrock returned empty response', {
          modelId: this.modelId,
          stopReason: response.stopReason,
        });
      }

      // `max_tokens` means the model was still writing. Ending on a sentence is
      // the difference between "he was concise" and "the app is broken".
      const content =
        response.stopReason === 'max_tokens' ? trimToLastSentence(raw) : raw;

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

  async converseWithTools(
    messages: LlmMessage[],
    systemPrompt: string,
    tools: readonly ToolSchema[],
    sessionId: string,
  ): Promise<ToolTurn> {
    try {
      const guardrailConfig = buildGuardrailConfig();

      const command = new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: systemPrompt }],
        // Not passed through `toBedrockMessages`: the caller's transcript already
        // contains toolUse/toolResult blocks by the second iteration, and that
        // function only knows how to build text blocks.
        messages: guardNewestUserTurn(messages, guardrailConfig),
        inferenceConfig: {
          maxTokens: MAX_REPLY_TOKENS,
          // Claude Sonnet 4.5 rejects temperature and topP together.
          temperature: 0.8,
        },
        toolConfig: {
          tools: tools.map(toBedrockTool),
          // The whole difference from `extractWithTool`, which pins one tool.
          // Here the model picks, and "none of them" is a valid pick — most
          // turns in this product are conversation, not action.
          toolChoice: { auto: {} },
        },
        guardrailConfig,
      });

      const response = await this.sendTimed(command, 'chat-tools', sessionId);

      if (response.stopReason === 'guardrail_intervened') {
        logger.warn('bedrock.guardrail_intervened', {
          sessionId,
          operation: 'chat-tools',
          policies: guardrailPoliciesFrom(response.trace),
        });
      }

      const blocks = response.output?.message?.content ?? [];

      return {
        message: response.output?.message ?? { role: 'assistant', content: blocks },
        text: extractTextFromBlocks(blocks),
        // A single turn may request several tools at once — "check Shabbat and
        // search restaurants" is one natural sentence and Bedrock will emit two
        // blocks for it. Collecting all of them is what lets the loop answer in
        // one round trip instead of three.
        toolUses: blocks.flatMap((block) =>
          'toolUse' in block && block.toolUse
            ? [
                {
                  toolUseId: block.toolUse.toolUseId ?? '',
                  name: block.toolUse.name ?? '',
                  input: (block.toolUse.input ?? {}) as Record<string, unknown>,
                },
              ]
            : [],
        ),
        stopReason: response.stopReason ?? 'unknown',
      };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      const errMsg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : 'Unknown';
      console.error(`[bedrock] converseWithTools failed: ${errName}: ${errMsg}`);
      throw new LlmError('Bedrock converseWithTools failed', {
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
      const guardrailConfig = buildGuardrailConfig();
      const bedrockMessages = guardNewestUserTurn(
        toBedrockMessages(allMessages),
        guardrailConfig,
      );

      const tool = toBedrockTool(toolSchema);

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
        guardrailConfig,
      });

      const response = await this.sendTimed(
        command,
        'extract-preferences',
        message.sessionId,
      );

      // Handle guardrail intervention — return empty extraction
      if (response.stopReason === 'guardrail_intervened') {
        logger.warn('bedrock.guardrail_intervened', {
          sessionId: message.sessionId,
          operation: 'extract-preferences',
          policies: guardrailPoliciesFrom(response.trace),
        });
        return {
          toolName: toolSchema.name,
          input: { preferences: [] },
        };
      }

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

