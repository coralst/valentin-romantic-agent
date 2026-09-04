import type { IntegrationId } from '../../shared/interfaces/integrations';
import type { StorageInterface } from '../persistence/storage-interface';
import { logger } from '../logging';

/**
 * A thing Valentin proposes to do in the outside world, awaiting a human yes.
 *
 * Every write — a reservation, an email, a calendar entry, a WhatsApp nudge —
 * arrives as one of these rather than happening. The agent's own word is not
 * sufficient authority to spend someone's money or send mail from their
 * account, and a demo in which it were would be a demo of something nobody
 * should ship.
 *
 * `expiresAt` is not decoration. An Ontopo checkout link is valid for roughly
 * fifteen minutes; a confirmation arriving after that must fail loudly rather
 * than post a dead link to the user as though it had worked.
 */
export interface ActionProposal {
  id: string;
  /**
   * The conversation this belongs to.
   *
   * Carried on the proposal rather than looked up later because the WebSocket
   * broadcast path resolves its target from a top-level `sessionId` and silently
   * drops any event without one — see `resolveBroadcastSessionId`. A proposal
   * that could not be routed would render as a reply promising a card the user
   * never sees.
   */
  sessionId: string;
  /** Which integration would carry this out — `ontopo`, `gmail`, … */
  service: IntegrationId;
  /** Short label for the card's heading, e.g. "Dinner at Ouzeria, Sat 21:00" */
  title: string;
  /** One or two sentences the user reads before deciding */
  summary: string;
  /** Where confirming sends them, when the provider owns the last step */
  url?: string;
  /** ISO timestamp after which confirming must fail */
  expiresAt: string;
  /**
   * Whatever the owning tool needs to actually carry this out later.
   *
   * Opaque to everything except the tool that set it. A reservation needs the
   * venue slug, the date, the party size and Ontopo's area identifier at
   * *confirm* time, and none of those belong in a card the user reads — so they
   * ride here rather than in a second map keyed by proposal id, which would be a
   * lifetime to manage and a way for the two halves to disagree.
   *
   * This never reaches the client. `onProposal` in `index.ts` maps the fields it
   * sends one at a time rather than spreading the object, precisely so a
   * server-side addition here cannot leak onto the wire. Keep that mapping
   * explicit if you touch it.
   */
  payload?: Record<string, unknown>;
}

/**
 * The services this build can actually reach.
 *
 * Re-exported from `shared` rather than declared here: the browser needs the same
 * union to read `GET /api/integrations`, and two copies is how one of them ends up
 * a spelling behind. A typo should be a compile error, not a silently dark row.
 */
export type { IntegrationId };

/** What a tool hands back to the loop. */
export interface ToolResult {
  ok: boolean;
  /**
   * What the model is told happened, in prose.
   *
   * This is the only channel back into the conversation, so it carries the
   * failure text too: "Ontopo returned nothing for Saturday" lets Valentin
   * offer Sunday, where a thrown exception would just cost the user their turn.
   */
  summary: string;
  /** Structured detail for the model to quote from. Kept small — it is tokens. */
  data?: unknown;
  /** Set when the tool wants a human yes before anything happens. */
  proposal?: ActionProposal;
  /**
   * Facts about a place he has now actually been committed to.
   *
   * Set by a `confirm` that ended with a real venue and date — whether the
   * provider completed the last step or handed the reader a live checkout link —
   * and read only by `recordOuting`, which turns it into a row on her file. A
   * failed confirm and every non-booking tool leave it undefined.
   *
   * It is here rather than read out of `payload` because `payload` is documented
   * opaque to everything but the owning tool — a reader that reached into it
   * would be coupled to Ontopo's field names, and `ActionProposal` carries no
   * `tool` or `args` to dispatch on. This is the one narrow, named channel by
   * which the loop learns *where* it just sent him.
   */
  booking?: BookingRecord;
}

/** What a confirmed booking tells us about the place. */
export interface BookingRecord {
  /** The provider's own identifier, when there is one to match against later. */
  venueSlug?: string | null;
  venueName: string;
  city?: string | null;
  /** ISO date the outing happens on, `YYYY-MM-DD`. */
  occursOn?: string | null;
}

/** Everything a tool may need about the turn it is running inside. */
export interface ToolContext {
  sessionId: string;
  /**
   * Who is talking. Needed by `create_conversation_link`, because a share token
   * names both the conversation and its owner — a token carrying only a session
   * id would be honoured for whoever presented it.
   *
   * Not an authorisation input: the storage handed to the orchestrator is
   * already scoped to this user, so a tool cannot reach another user's rows by
   * lying about it. It is here so a tool can *name* the owner, not so it can
   * choose one.
   */
  userId: string;

  /**
   * This user's store, for tools that write to Valentin's own tables.
   *
   * Optional, and absent for every third-party integration: those are stateless
   * modules over an HTTP client, and handing them a store would invite a tool to
   * persist a side effect the orchestrator knows nothing about. `set_reminder` is
   * the first tool whose whole job is a row in our table, which is why this exists.
   *
   * Already scoped to the caller — `forUser(userId)` — so a tool cannot reach
   * another user's rows, and both stores overwrite `sessionId`/`userId` on write
   * from their own scope regardless of what a caller passes.
   *
   * A tool that needs it must check for it and fail with a summary rather than
   * throwing: it is legitimately absent in the confirm path of older callers and in
   * tests that exercise a tool in isolation.
   */
  storage?: StorageInterface;
}

/**
 * One capability the model may invoke.
 *
 * Deliberately shaped like Bedrock's `toolSpec` (`name`, `description`,
 * `input_schema`) so registering an integration is a registry entry and never an
 * edit to the loop. `input_schema` keeps the snake_case spelling the existing
 * {@link EXTRACT_PREFERENCES_TOOL} uses, so both tool paths look the same.
 */
export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Which integration this belongs to. Drives telemetry and the sidebar. */
  service: IntegrationId;
  /**
   * True for anything that writes, spends or sends.
   *
   * A tool that sets this must return a `proposal` and must not perform the
   * action; {@link AgentTool.confirm} is what performs it, later, once a human
   * has said yes.
   */
  requiresConfirmation: boolean;
  execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult>;
  /**
   * Carry out a proposal the user accepted.
   *
   * Only meaningful when `requiresConfirmation` is true. Read-only tools leave
   * it undefined.
   */
  confirm?(proposal: ActionProposal, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * The tools available this process, by name.
 *
 * A map rather than an array because the loop's hot path is "the model asked for
 * `check_availability` — is that real?", and a name the model invented must
 * resolve to nothing rather than to the wrong tool.
 */
export type ToolRegistry = ReadonlyMap<string, AgentTool>;

/**
 * Run a tool, and make sure the loop survives whatever it does.
 *
 * Two guarantees, both load-bearing:
 *
 * 1. **It never throws.** A failing integration must degrade the reply, not end
 *    it. Ontopo is an undocumented API that can change shape without notice, and
 *    the correct outcome of that is Valentin saying he could not check
 *    availability — not an apology bubble in place of the whole answer.
 * 2. **It logs exactly once, with a duration.** `span-bridge.ts` turns
 *    `integration.<service>` into a span for the Inspector, so the integration
 *    code itself needs no telemetry at all. The duration is measured around the
 *    call because it is the number nobody can estimate and the one the drawer
 *    shows on stage.
 *
 * `operation` is the tool name and `integration` the service; neither is user
 * data. Nothing from `input` is logged, deliberately — a restaurant search
 * carries a date and a party size, but a proposed message carries prose about
 * someone's partner, and this log line ends up in CloudWatch.
 *
 * The field is `integration` rather than the more natural `service` because
 * `formatLog` already writes `service: 'valentin-backend'` into every record,
 * and a same-named key here silently overwrote it — every integration call
 * showed up in CloudWatch as though it came from a service called "hebcal".
 */
export async function runTool(
  tool: AgentTool,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const startedAt = Date.now();
  try {
    const result = await tool.execute(input, ctx);
    logger.info(`integration.${tool.service}`, {
      sessionId: ctx.sessionId,
      integration: tool.service,
      operation: tool.name,
      durationMs: Date.now() - startedAt,
      ok: result.ok,
    });
    return result;
  } catch (err) {
    logger.info(`integration.${tool.service}`, {
      sessionId: ctx.sessionId,
      integration: tool.service,
      operation: tool.name,
      durationMs: Date.now() - startedAt,
      ok: false,
    });
    logger.warn('integration.failed', {
      sessionId: ctx.sessionId,
      integration: tool.service,
      operation: tool.name,
      cause: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      summary: `${tool.name} could not be completed: ${
        err instanceof Error ? err.message : 'unknown error'
      }. Tell the user plainly and offer an alternative — do not pretend it worked.`,
    };
  }
}
