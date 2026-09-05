import type {
  BedrockClient,
  LlmContentBlock,
  LlmMessage,
  ToolSchema,
  ToolUseRequest,
} from './bedrock-client';
import {
  runTool,
  type ActionProposal,
  type ToolContext,
  type ToolRegistry,
} from '../integrations/tool-registry';
import type { StorageInterface } from '../persistence/storage-interface';
import type { AgentActivityPayload } from '../../shared/interfaces/ws-events';
import { logger } from '../logging';
import { summariseToolInput, summariseToolOutcome } from './activity-summary';
import { config } from '../config';
import { shareLink } from '../../shared/constants/share-link';
import { mintShareToken } from '../sharing/share-token';
import {
  expandConversationLinkText,
  expandConversationLinks,
} from '../sharing/link-placeholder';
import { stripToolMarkup } from './strip-tool-markup';

/**
 * How many model round trips one user turn may take.
 *
 * Each iteration is a Converse call, so this is a latency budget as much as a
 * safety net: five is enough for the deepest real chain in this product —
 * "is Saturday free of Shabbat, what is the Hebrew date, find a restaurant,
 * check availability, draft the reservation" — and small enough that a model
 * stuck calling the same tool forever costs seconds rather than a bill.
 */
export const MAX_TOOL_ITERATIONS = 5;

/** What a completed loop hands back to the orchestrator. */
export interface ToolLoopResult {
  /** The prose to show the user. */
  text: string;
  /** Proposals raised this turn, in the order they were raised. */
  proposals: ActionProposal[];
  /** Model round trips actually made. */
  iterations: number;
  /** True when {@link MAX_TOOL_ITERATIONS} was reached before the model finished. */
  truncated: boolean;
}

/**
 * Where an activity frame goes on its way to the user's socket.
 *
 * Synchronous and returning nothing, so a slow or throwing subscriber cannot
 * stall or break the turn it is describing — the emitter is a narrator, and a
 * narrator failing must not stop the story.
 */
export type ActivityEmitter = (activity: AgentActivityPayload) => void;

export interface ToolLoopOptions {
  client: BedrockClient;
  /** The transcript so far, user-first. Not mutated. */
  messages: LlmMessage[];
  systemPrompt: string;
  registry: ToolRegistry;
  sessionId: string;
  /** Passed straight through to every tool as `ToolContext.userId`. */
  userId: string;
  /**
   * This user's store, for first-party tools that write our own rows.
   *
   * Optional so every existing caller and test compiles unchanged; a tool that
   * needs it refuses politely when it is absent. See `ToolContext.storage`.
   */
  storage?: StorageInterface;
  /**
   * Narrate this turn as it happens. Absent means narrate nothing.
   *
   * Emitted here rather than derived from the `integration.*` log line that
   * `span-bridge.ts` already reads, for three reasons: that line is written
   * *after* the call, so it can never produce the "started" half that makes the
   * trail feel live; `runTool`'s docblock is an explicit promise that nothing from
   * `input` is logged, and inputs are half of what makes a row worth reading; and
   * it carries no reasoning.
   */
  onActivity?: ActivityEmitter;
  /**
   * Ask the model for its reasoning and emit it.
   *
   * Off unless the user pressed the toggle for this turn: it forces
   * `temperature: 1`, which retunes Valentin's voice, and spends thinking tokens
   * on every iteration.
   */
  showThinking?: boolean;
}

/** What the user sees if the cap is hit before the model has written anything. */
const NO_TEXT_FALLBACK =
  "I looked into a few things and got a little tangled up. Could you tell me again what you'd like me to arrange?";

/**
 * Talk to the model until it stops asking for tools.
 *
 * The shape is Bedrock's documented tool-use protocol: call, and if the reply
 * contains `toolUse` blocks, append the assistant turn verbatim, run the tools,
 * append one `toolResult` block per request in a user turn, and call again. The
 * `toolUseId` correlation matters — Bedrock rejects a `toolResult` that does not
 * answer a `toolUse` it just emitted, so results are built from the requests
 * rather than from the tool names.
 *
 * Three properties worth stating, because each one is a bug that would otherwise
 * only show up in front of an audience:
 *
 * - **Nothing here throws on a tool's behalf.** {@link runTool} converts every
 *   failure into `{ok: false}` with prose, so a dead Ontopo costs a sentence
 *   ("I couldn't reach the restaurant's system") rather than the whole reply.
 * - **A tool name the model invented is answered, not ignored.** Silently
 *   dropping it leaves the model waiting for a result that never comes and it
 *   spends the rest of the budget repeating itself.
 * - **A confirmation-gated tool does not act.** It returns a proposal, the loop
 *   tells the model as much, and nothing reaches the outside world until a human
 *   accepts it. That is the point of the design, so the message fed back is
 *   explicit that Valentin must not claim to have booked anything.
 *
 * Requires a non-empty registry: Bedrock rejects a `toolConfig` with no tools,
 * so a deployment with zero credentials must use `generateResponse` instead.
 * The orchestrator makes that choice.
 */
export async function runToolLoop({
  client,
  messages,
  systemPrompt,
  registry,
  sessionId,
  userId,
  storage,
  onActivity,
  showThinking,
}: ToolLoopOptions): Promise<ToolLoopResult> {
  const tools: ToolSchema[] = [...registry.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));

  const transcript = [...messages];
  const proposals: ActionProposal[] = [];
  let lastText = '';

  /**
   * Mint a real share URL for this turn's conversation.
   *
   * Called only where a `{{conversation_link}}` placeholder was actually found,
   * so a turn that never mentions sharing signs nothing. An empty `userId` is the
   * anonymous deployment: there is no owner for a token to name, and
   * `create_conversation_link` already refuses there, so no placeholder should
   * reach this — the guard is here so a stray one degrades to plain words rather
   * than to a token signed over an empty string.
   */
  const mintLink = (): string =>
    userId
      ? shareLink(config.publicOrigin, mintShareToken(userId, sessionId).token)
      : 'a shareable link (unavailable on this deployment)';

  /**
   * Every path that returns prose goes through here — see `mintLink`.
   *
   * It is also where tool markup the model typed as prose is removed, for the
   * same reason: this is the single choke point every returning branch shares, so
   * a reply cannot reach a bubble without passing it. If stripping leaves nothing
   * — the whole turn was markup, which is what the live report looked like — the
   * user gets the same honest fallback as an empty turn rather than a blank
   * bubble.
   */
  const withLinks = (text: string): string => {
    const prose = stripToolMarkup(text);
    if (prose !== text) {
      logger.warn('agent.tool_markup_in_prose', {
        sessionId,
        // Enough to recognise which call the model narrated, without logging the
        // whole reply — the arguments can carry her name and her address.
        removedChars: text.length - prose.length,
        emptyAfterStrip: prose === '',
      });
    }
    return expandConversationLinkText(prose || NO_TEXT_FALLBACK, mintLink);
  };

  for (let iteration = 1; iteration <= MAX_TOOL_ITERATIONS; iteration += 1) {
    const turn = await client.converseWithTools(
      transcript,
      systemPrompt,
      tools,
      sessionId,
      { thinking: showThinking },
    );

    // Only ever real reasoning the model actually produced. `turn.reasoning` is
    // `''` unless thinking was asked for, so nothing is invented and nothing is
    // announced on a turn the user did not opt into.
    if (turn.reasoning) {
      onActivity?.({
        kind: 'thinking',
        sessionId,
        id: `thinking:${iteration}`,
        iteration,
        text: turn.reasoning,
      });
    }

    // Kept even when it is empty prose accompanying a tool call — it is often
    // the "Let me check whether Saturday works" the user should see if the
    // chain later falls apart.
    if (turn.text) lastText = turn.text;

    if (turn.toolUses.length === 0) {
      return {
        text: withLinks(turn.text || lastText),
        proposals,
        iterations: iteration,
        truncated: false,
      };
    }

    transcript.push(turn.message);
    transcript.push({
      role: 'user',
      content: await Promise.all(
        turn.toolUses.map((request) =>
          resolveToolUse(request, registry, { sessionId, userId, storage }, proposals, mintLink, {
            onActivity,
            iteration,
          }),
        ),
      ),
    });
  }

  // The cap, not an error. The model was mid-chain, so there may be no finished
  // sentence anywhere; returning the last thing it said beats an empty bubble,
  // and both beat an exception, which would replace a partly-useful answer with
  // an apology.
  logger.warn('agent.tool_loop_truncated', {
    sessionId,
    iterations: MAX_TOOL_ITERATIONS,
    proposals: proposals.length,
  });

  return {
    text: withLinks(lastText || NO_TEXT_FALLBACK),
    proposals,
    iterations: MAX_TOOL_ITERATIONS,
    truncated: true,
  };
}

/**
 * What a row says the service is when the model called a tool that does not exist.
 *
 * There is no integration to name — the tool was invented — and a plausible guess
 * would attribute a failure to a partner that was never contacted.
 */
const UNKNOWN_TOOL_SERVICE = 'unknown';

/** The names the model may legally call, for the "no such tool" message. */
function knownToolNames(registry: ToolRegistry): string {
  return [...registry.keys()].join(', ');
}

/**
 * Run one requested tool and package the answer as a `toolResult` block.
 *
 * Appends to `proposals` as a side effect. That is deliberate rather than
 * returned: the caller needs both the content block (for Bedrock) and the
 * proposal (for the UI), and threading a tuple through `Promise.all` to carry
 * the second obscured the first.
 */
async function resolveToolUse(
  request: ToolUseRequest,
  registry: ToolRegistry,
  ctx: ToolContext,
  proposals: ActionProposal[],
  mintLink: () => string,
  narration: { onActivity?: ActivityEmitter; iteration: number },
): Promise<LlmContentBlock> {
  const tool = registry.get(request.name);
  const { onActivity, iteration } = narration;
  const service = tool?.service ?? UNKNOWN_TOOL_SERVICE;
  const startedAt = Date.now();

  // Announced before anything runs, which is the whole liveness claim: the
  // visible seconds in a turn are the tool round trips, so the row has to be on
  // screen while the user is still waiting for it.
  onActivity?.({
    kind: 'tool_start',
    sessionId: ctx.sessionId,
    id: request.toolUseId,
    iteration,
    tool: request.name,
    service,
    inputSummary: summariseToolInput(request.input),
  });

  /** Close the row this call opened. Every exit below goes through it. */
  const finish = (ok: boolean, outcome: string) => {
    onActivity?.({
      kind: 'tool_end',
      sessionId: ctx.sessionId,
      id: request.toolUseId,
      iteration,
      tool: request.name,
      service,
      durationMs: Date.now() - startedAt,
      ok,
      outcome,
    });
  };

  if (!tool) {
    logger.warn('agent.unknown_tool', {
      sessionId: ctx.sessionId,
      requested: request.name,
    });
    // A tool name the model invented is a real, visible beat — it costs the user
    // a round trip, so it gets a row rather than an unexplained pause.
    finish(false, 'no such tool');
    return {
      toolResult: {
        toolUseId: request.toolUseId,
        content: [
          {
            text: `There is no tool called "${request.name}". Available tools: ${knownToolNames(registry)}. Answer the user directly instead of calling it again.`,
          },
        ],
        status: 'error',
      },
    };
  }

  // Substituted before the tool runs, so what the proposal card shows and what
  // `propose_email` later sends are the same real URL, and the model never held
  // a character of it. Deep, because the link belongs in a body or a description
  // rather than at a fixed key — see `sharing/link-placeholder.ts`.
  const input = expandConversationLinks(request.input, mintLink);

  const result = await runTool(tool, input, ctx);

  // Redacted, and from the prose the tool already wrote — see `activity-summary`.
  finish(result.ok, summariseToolOutcome(result.summary, result.ok));

  if (result.proposal) {
    proposals.push(result.proposal);
  }

  const summary = result.proposal
    ? `${result.summary}\n\nThis is a PROPOSAL and nothing has happened yet. The user has been shown a card and must accept it. Describe what you have lined up and ask them to confirm — do not say it is booked, sent or scheduled.`
    : result.summary;

  return {
    toolResult: {
      toolUseId: request.toolUseId,
      content: [{ text: summary }],
      status: result.ok ? 'success' : 'error',
    },
  };
}
