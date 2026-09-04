import type { ActionProposal, AgentTool } from '../integrations/tool-registry';

/**
 * A proposal awaiting a human yes, with whatever would carry it out.
 *
 * Exactly one of the two is set, and which one says which engine raised it.
 * Engine A holds the `AgentTool` itself — the proposal was raised in this process
 * and will be confirmed in it. Engine B has no tool object to hold: its proposal
 * was raised inside a Lambda behind the Gateway, so what it holds instead is the
 * *name* of the `confirm_*` tool to call over MCP.
 */
export interface PendingProposal {
  proposal: ActionProposal;
  /** Engine A: the tool whose `confirm()` runs. */
  tool?: AgentTool;
  /**
   * Engine B: the unprefixed Gateway tool name to call, e.g.
   * `confirm_reservation`.
   *
   * Carried rather than derived from `proposal.service`, because a service→action
   * table here would be a second copy of a pairing the tool registry already
   * knows — and a wrong entry in it would confirm the wrong action. The Lambda
   * that raised the proposal names it, and checks the name again on the way back
   * against the row it stored.
   */
  confirmTool?: string;
}

/** What will carry a proposal out. See {@link PendingProposal}. */
export interface ProposalExecutor {
  tool?: AgentTool;
  confirmTool?: string;
}

/** Why a proposal could not be taken. */
export type ProposalRefusal = 'unknown' | 'expired';

/**
 * A proposal that cannot be carried out, carrying the sentence to say about it.
 *
 * The message lives on the error rather than at each call site so both engines
 * refuse in the same words. A user switching engines mid-demo who sees two
 * different apologies for the same expired hold reads it as one engine being
 * broken.
 */
export class ProposalUnavailableError extends Error {
  constructor(
    readonly reason: ProposalRefusal,
    message: string,
    /** The integration the proposal belonged to; absent when the id is unknown. */
    readonly service?: string,
  ) {
    super(message);
    this.name = 'ProposalUnavailableError';
  }
}

/**
 * Proposals a conversation has raised and nobody has answered yet.
 *
 * Held in memory rather than persisted, deliberately. The longest-lived thing
 * here is an Ontopo checkout link, valid for about fifteen minutes, so
 * durability across a restart buys nothing a user would notice — and it would
 * cost an addition to `StorageInterface`, both implementations and their tests.
 *
 * Keyed by proposal id alone, not by session, because the id is a uuid and a
 * store is already per-user — one is built per connection. {@link take} still
 * checks the session matches, so a stray id from another of this user's
 * conversations cannot fire here.
 *
 * Shared by both engines so ownership and expiry are enforced once. Engine B's
 * authoritative copy of the *payload* lives in DynamoDB keyed by user and
 * session; this store is the proxy's own record that the user was offered the
 * card, and it is what stops a confirm for someone else's proposal ever reaching
 * the Gateway.
 */
export class PendingProposalStore {
  private readonly pending = new Map<string, PendingProposal>();

  /** Number of proposals still awaiting an answer. Tests and logging only. */
  get size(): number {
    return this.pending.size;
  }

  remember(proposal: ActionProposal, by: ProposalExecutor = {}): void {
    this.pending.set(proposal.id, { proposal, ...by });
  }

  /**
   * Claim a proposal for execution, or explain why it cannot be.
   *
   * One-shot: a claimed proposal is out of the store before the caller attempts
   * anything, so a double click cannot book two tables. A failed attempt
   * therefore has to be re-proposed rather than retried, which is the safer of
   * the two wrong answers.
   */
  take(sessionId: string, proposalId: string): PendingProposal {
    const entry = this.pending.get(proposalId);

    // The session check is not paranoia about a hostile client so much as about
    // a confused one: proposal ids are process-global, so a stale tab holding a
    // card from another conversation could otherwise spend the wrong person's
    // evening. It deliberately gives the same answer as an unknown id, so a
    // guessed id cannot be distinguished from a wrong one.
    if (!entry || entry.proposal.sessionId !== sessionId) {
      throw new ProposalUnavailableError(
        'unknown',
        "I've lost track of that one, I'm afraid — it may have already been dealt with. Shall I look again?",
      );
    }

    this.pending.delete(proposalId);

    if (Date.parse(entry.proposal.expiresAt) <= Date.now()) {
      throw new ProposalUnavailableError(
        'expired',
        `That ${entry.proposal.service} hold has expired — they only keep them for a few minutes. Say the word and I'll find it again.`,
        entry.proposal.service,
      );
    }

    return entry;
  }
}
