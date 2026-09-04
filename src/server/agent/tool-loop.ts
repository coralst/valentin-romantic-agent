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
import { logger } from '../logging';

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

export interface ToolLoopOptions {
  client: BedrockClient;
  /** The transcript so far, user-first. Not mutated. */
  messages: LlmMessage[];
  systemPrompt: string;
  registry: ToolRegistry;
  sessionId: string;
  /** Passed straight through to every tool as `ToolContext.userId`. */
  userId: string;
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
}: ToolLoopOptions): Promise<ToolLoopResult> {
  const tools: ToolSchema[] = [...registry.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));

  const transcript = [...messages];
  const proposals: ActionProposal[] = [];
  let lastText = '';

  for (let iteration = 1; iteration <= MAX_TOOL_ITERATIONS; iteration += 1) {
    const turn = await client.converseWithTools(
      transcript,
      systemPrompt,
      tools,
      sessionId,
    );

    // Kept even when it is empty prose accompanying a tool call — it is often
    // the "Let me check whether Saturday works" the user should see if the
    // chain later falls apart.
    if (turn.text) lastText = turn.text;

    if (turn.toolUses.length === 0) {
      return { text: turn.text || lastText, proposals, iterations: iteration, truncated: false };
    }

    transcript.push(turn.message);
    transcript.push({
      role: 'user',
      content: await Promise.all(
        turn.toolUses.map((request) =>
          resolveToolUse(request, registry, { sessionId, userId }, proposals),
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
    text: lastText || NO_TEXT_FALLBACK,
    proposals,
    iterations: MAX_TOOL_ITERATIONS,
    truncated: true,
  };
}

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
): Promise<LlmContentBlock> {
  const tool = registry.get(request.name);

  if (!tool) {
    logger.warn('agent.unknown_tool', {
      sessionId: ctx.sessionId,
      requested: request.name,
    });
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

  const result = await runTool(tool, request.input, ctx);

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
