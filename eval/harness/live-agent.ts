/**
 * Drive the real agent, at an instant of our choosing, and keep the receipts.
 *
 * Two drivers, because the two questions need different seams:
 *
 * - {@link driveLoopAt} calls `runToolLoop` with a prompt built at a chosen `now`.
 *   `buildSystemPrompt(facts, hasTools, visited, now)` takes an injectable clock;
 *   `AgentOrchestrator` does not thread one. Date cases need the clock, so they
 *   use this.
 * - {@link driveTurns} runs several turns against one transcript, for the cases
 *   about memory and consistency across a conversation.
 *
 * Both use the real `AwsBedrockClient` and the real registry. The only fiction is
 * the confirm stub in `recordingRegistry`, and it labels itself.
 */
import { AwsBedrockClient, type LlmMessage } from '../../src/server/agent/bedrock-client';
import { type KnownFact, buildSystemPrompt } from '../../src/server/agent/prompts';
import { runToolLoop } from '../../src/server/agent/tool-loop';
import { buildToolRegistry } from '../../src/server/integrations';
import type { ActionProposal } from '../../src/server/integrations/tool-registry';
import { InMemoryStoreFactory } from '../../src/server/persistence/in-memory-store';
import type { StorageInterface } from '../../src/server/persistence/storage-interface';
import { type RecordedCall, type WriteMode, recordingRegistry } from './recording-registry';

export interface TurnOutcome {
  /** The last turn's prose. */
  readonly reply: string;
  /** Every turn's prose, in order — consistency cases read across them. */
  readonly replies: readonly string[];
  readonly calls: RecordedCall[];
  readonly proposals: readonly ActionProposal[];
  readonly truncated: boolean;
  readonly iterations: number;
  readonly ms: number;
}

let sharedClient: AwsBedrockClient | null = null;

/** One Bedrock client for the whole run, so the token cache is not re-warmed per case. */
function client(): AwsBedrockClient {
  sharedClient ??= new AwsBedrockClient();
  return sharedClient;
}

/**
 * Storage is always in-memory.
 *
 * `set_reminder` is the one tool that writes without a confirmation gate, so a run
 * against the real store would leave rows in the dev DynamoDB table and arm real
 * mail. In-memory keeps the tool genuinely exercised and the side effect local.
 */
function storage(): StorageInterface {
  // A fresh factory per case, so nothing a case files can be read by the next one.
  return new InMemoryStoreFactory().forUser('eval-user');
}

export interface DriveOptions {
  /** What the agent already knows about her. */
  readonly facts?: readonly KnownFact[];
  /** The instant the prompt should claim it is. Defaults to real now. */
  readonly now?: Date;
  readonly writes?: WriteMode;
  readonly sessionId?: string;
}

/** One turn, at a chosen instant, with the arguments recorded. */
export async function driveLoopAt(text: string, options: DriveOptions = {}): Promise<TurnOutcome> {
  return driveTurns([text], options);
}

/** Several turns against one transcript, so later turns can see earlier ones. */
export async function driveTurns(
  texts: readonly string[],
  options: DriveOptions = {},
): Promise<TurnOutcome> {
  const { facts = [], now = new Date(), writes = 'proposal' } = options;
  const sessionId = options.sessionId ?? `eval-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const recording = recordingRegistry(buildToolRegistry(), writes);
  const store = storage();
  const systemPrompt = buildSystemPrompt(facts, recording.registry.size > 0, [], now);

  // Bedrock's own Message shape, which is what `runToolLoop` takes. Building it
  // directly rather than via `toLlmMessages` keeps the harness out of the
  // ChatMessage/id/timestamp business it has no use for.
  const transcript: LlmMessage[] = [];
  const replies: string[] = [];
  const proposals: ActionProposal[] = [];
  let truncated = false;
  let iterations = 0;
  const startedAt = Date.now();

  for (const [index, text] of texts.entries()) {
    recording.beginTurn(index);
    transcript.push({ role: 'user', content: [{ text }] });

    const result = await runToolLoop({
      client: client(),
      messages: transcript,
      systemPrompt,
      registry: recording.registry,
      sessionId,
      userId: 'eval-user',
      storage: store,
    });

    replies.push(result.text);
    proposals.push(...result.proposals);
    truncated = truncated || result.truncated;
    iterations += result.iterations;

    // `runToolLoop` does not mutate `messages`, so the assistant turn is appended
    // here. Only its prose carries forward: replaying the tool blocks would make
    // the model believe results it is about to be given again.
    transcript.push({ role: 'assistant', content: [{ text: result.text }] });
  }

  return {
    reply: replies[replies.length - 1] ?? '',
    replies,
    calls: recording.calls,
    proposals,
    truncated,
    iterations,
    ms: Date.now() - startedAt,
  };
}
