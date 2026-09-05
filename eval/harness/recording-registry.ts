/**
 * The observability seam for the live layer.
 *
 * WHY NOT THE EXISTING CHANNELS
 *
 * The single most valuable thing to assert about a live turn is which absolute
 * date the model resolved "next Friday" to. Neither existing channel can tell us:
 *
 * - The websocket `agent_activity` frame redacts arguments by allowlist
 *   (`agent/activity-summary.ts`), and `date` is not on it. The trail literally
 *   renders `date: <text>`.
 * - The `integration.<service>` log line deliberately logs no input at all, and
 *   its docblock explains why — that line reaches CloudWatch and a proposed
 *   message carries prose about someone's partner. Weakening it to run tests
 *   would be a bad trade.
 *
 * So the harness wraps the registry in-process instead. Nothing in production
 * changes, no privacy contract moves, and the test sees the real arguments.
 *
 * Every call still goes through {@link runTool}, so the never-throws guarantee and
 * the telemetry line stay in the path being tested rather than being bypassed by
 * the thing testing them.
 */
import {
  type ActionProposal,
  type AgentTool,
  type ToolContext,
  type ToolRegistry,
  type ToolResult,
  runTool,
  runToolConfirm,
} from '../../src/server/integrations/tool-registry';

/** One tool call as it actually happened, arguments included. */
export interface RecordedCall {
  /**
   * Which user turn this call belongs to, zero-based.
   *
   * Needed because several cases are about what happens *after* something the user
   * said — "I don't want a reminder" — and without a boundary a call from turn one
   * would fail an assertion about turn three.
   */
  readonly turn: number;
  readonly name: string;
  readonly service: string;
  readonly args: Record<string, unknown>;
  readonly ok: boolean;
  readonly summary: string;
  readonly data?: unknown;
  readonly proposal?: ActionProposal;
  readonly ms: number;
  /** True when the harness stubbed this instead of letting it reach the world. */
  readonly stubbed?: boolean;
}

/**
 * How far a run may go with tools that write, spend or send.
 *
 * `proposal` is the default and the only mode used unattended: a `propose_*`
 * tool's `execute` runs for real (it only ever builds a card), and `confirm` is
 * replaced by a recorded stub. Nothing is booked, ordered, emailed or messaged.
 */
export type WriteMode = 'none' | 'proposal' | 'confirm';

/**
 * Tools that stay stubbed even at `--allow-writes=confirm`.
 *
 * Confirming any of these contacts a third party who did not agree to be part of
 * a test run: a restaurant holding a table, a person receiving mail, a phone
 * receiving a WhatsApp message. A playlist and a calendar entry are the author's
 * own junk to delete, which is a different kind of thing.
 */
const NEVER_CONFIRM = new Set(['propose_reservation', 'propose_email', 'propose_whatsapp_nudge']);

export interface Recording {
  readonly registry: ToolRegistry;
  readonly calls: RecordedCall[];
  /** Names whose confirm the harness refused to let through. */
  readonly stubbedConfirms: string[];
  /** Called by the driver between user turns, so each call knows its turn. */
  beginTurn(index: number): void;
}

/**
 * Wrap a registry so every call is recorded and every write is fenced.
 *
 * The returned registry has the same tool names and schemas, so the model is
 * shown exactly what production shows it — a harness that hid a tool would be
 * testing a different agent.
 */
export function recordingRegistry(base: ToolRegistry, mode: WriteMode = 'proposal'): Recording {
  const calls: RecordedCall[] = [];
  const stubbedConfirms: string[] = [];
  const wrapped = new Map<string, AgentTool>();
  let turn = 0;

  for (const [name, tool] of base) {
    const record = (
      args: Record<string, unknown>,
      result: ToolResult,
      ms: number,
      stubbed?: boolean,
    ): ToolResult => {
      calls.push({
        turn,
        name: tool.name,
        service: tool.service,
        args,
        ok: result.ok,
        summary: result.summary,
        data: (result as { data?: unknown }).data,
        proposal: (result as { proposal?: ActionProposal }).proposal,
        ms,
        stubbed,
      });
      return result;
    };

    wrapped.set(name, {
      ...tool,
      async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        // `mode: 'none'` blocks even the proposal, for a run that must make no
        // provider request at all.
        if (mode === 'none' && tool.requiresConfirmation) {
          const blocked: ToolResult = {
            ok: false,
            summary: `[harness] ${tool.name} was not run: writes are disabled for this run.`,
          };
          return record(input, blocked, 0, true);
        }

        const startedAt = Date.now();
        const result = await runTool(tool, input, ctx);
        return record(input, result, Date.now() - startedAt, false);
      },
      confirm: tool.confirm
        ? async (proposal: ActionProposal, ctx: ToolContext): Promise<ToolResult> => {
            const allowed = mode === 'confirm' && !NEVER_CONFIRM.has(tool.name);
            if (!allowed) {
              stubbedConfirms.push(tool.name);
              // Deliberately `ok: true`: the point is to exercise what the agent
              // *says* after a successful confirm, which is where "never claim it
              // is saved before it is" gets broken. The prose is marked so no
              // report can mistake it for a real one.
              const stub: ToolResult = {
                ok: true,
                summary: `[harness] ${tool.name} confirm was stubbed; nothing left this process.`,
              };
              return record({ proposalId: proposal.id }, stub, 0, true);
            }

            const startedAt = Date.now();
            const result = await runToolConfirm(tool, proposal, ctx);
            return record({ proposalId: proposal.id }, result, Date.now() - startedAt, false);
          }
        : undefined,
    });
  }

  return {
    registry: wrapped,
    calls,
    stubbedConfirms,
    beginTurn(index: number): void {
      turn = index;
    },
  };
}
