import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { sessionPk, proposalSk } from '../persistence/keys';
import type { ActionProposal } from './tool-registry';
import { logger } from '../logging';

/**
 * Where a proposal waits between being offered and being confirmed, on engine B.
 *
 * ## Why engine B needs a table and engine A does not
 *
 * Engine A raises a proposal and confirms it in the same process, so a `Map`
 * outlives the wait. The Gateway tool Lambda is stateless: `propose_reservation`
 * and `confirm_reservation` are two separate invocations, quite possibly of two
 * separate containers, and `ActionProposal.payload` — the Ontopo area id, the
 * prose of a proposed email — must survive between them without ever passing
 * through the model or the browser. So the payload stays here and only the safe
 * view goes back.
 *
 * ## Ownership is the key, not a check
 *
 * The row lives at `pk = USER#<sub>#SESSION#<sid>`, exactly where the rest of
 * that conversation lives. Confirming someone else's proposal is therefore not a
 * check that could be forgotten — it is a GetItem that **misses**, because the
 * caller cannot name a partition without naming the user and session. This is the
 * same reasoning as `persistence/keys.ts`, applied to a second writer.
 *
 * ## Expiry has two enforcers, on purpose
 *
 * `ttl` lets DynamoDB collect abandoned proposals with nobody sweeping — but
 * DynamoDB deletes on its own schedule, up to 48 hours late, so it is a cleaner
 * and not a gate. The gate is the explicit `expiresAt` comparison in
 * {@link takeProposal}: an Ontopo checkout link is good for about fifteen
 * minutes, and confirming a dead one must fail loudly rather than post a link
 * that goes nowhere.
 */

/** What is written down, beyond the proposal itself. */
interface ProposalRow {
  pk: string;
  sk: string;
  entityType: 'proposal';
  /** The tool that raised it, so the confirm knows whose `confirm()` to call. */
  tool: string;
  service: string;
  proposal: ActionProposal;
  expiresAt: string;
  /** Unix seconds. DynamoDB's own attribute — see the note above. */
  ttl: number;
}

/**
 * How long a row outlives the proposal's own expiry, in seconds.
 *
 * A short grace period rather than zero so the *explicit* expiry check is what a
 * late confirm hits — producing "that hold has expired", which a user can act on
 * — rather than a missing row, which is indistinguishable from someone else's
 * proposal and so answers with the vaguer "I've lost track of that one".
 */
const TTL_GRACE_SECONDS = 3600;

let cachedDoc: DynamoDBDocumentClient | null = null;

function doc(): DynamoDBDocumentClient {
  cachedDoc ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    // `removeUndefinedValues` because `ActionProposal.url` is optional and
    // DynamoDB rejects an explicit `undefined` outright — the proposal object is
    // stored whole, so whatever a tool omitted arrives here omitted.
    marshallOptions: { removeUndefinedValues: true },
  });
  return cachedDoc;
}

/** Drop the cached client. Tests only. */
export function resetProposalStoreForTests(client?: DynamoDBDocumentClient): void {
  cachedDoc = client ?? null;
}

function tableName(): string {
  // `VALENTIN_TABLE_NAME`, the same variable `infra/lambda/profile-tools` reads
  // and the same one the stack sets on this function — not a second spelling.
  const name = process.env.VALENTIN_TABLE_NAME;
  if (!name) {
    throw new Error(
      'VALENTIN_TABLE_NAME is unset — the Gateway tool Lambda cannot hold a proposal',
    );
  }
  return name;
}

/** Why a proposal could not be taken. Mirrors the proxy's own refusal reasons. */
export type ProposalRefusal = 'unknown' | 'expired';

export class ProposalUnavailable extends Error {
  constructor(readonly reason: ProposalRefusal, message: string) {
    super(message);
    this.name = 'ProposalUnavailable';
  }
}

/** Remember a proposal so a later invocation can carry it out. */
export async function putProposal(
  userId: string,
  proposal: ActionProposal,
  toolName: string,
): Promise<void> {
  const row: ProposalRow = {
    pk: sessionPk(userId, proposal.sessionId),
    sk: proposalSk(proposal.id),
    entityType: 'proposal',
    tool: toolName,
    service: proposal.service,
    proposal,
    expiresAt: proposal.expiresAt,
    ttl:
      Math.floor(Date.parse(proposal.expiresAt) / 1000) + TTL_GRACE_SECONDS,
  };

  await doc().send(new PutCommand({ TableName: tableName(), Item: row }));
}

/**
 * Claim a proposal for execution, or explain why it cannot be.
 *
 * Deletes before returning, so a double confirm cannot book two tables — the
 * same one-shot rule as the proxy's in-memory store, enforced here too because
 * this is the side that actually spends the money. A `ConditionExpression` on the
 * delete rather than a get-then-delete: two concurrent confirms otherwise both
 * read the row and both act.
 */
export async function takeProposal(
  userId: string,
  sessionId: string,
  proposalId: string,
): Promise<{ proposal: ActionProposal; tool: string }> {
  let deleted;
  try {
    deleted = await doc().send(
      new DeleteCommand({
        TableName: tableName(),
        Key: { pk: sessionPk(userId, sessionId), sk: proposalSk(proposalId) },
        ConditionExpression: 'attribute_exists(pk)',
        ReturnValues: 'ALL_OLD',
      }),
    );
  } catch (err) {
    const name = err instanceof Error ? err.name : String(err);
    if (name !== 'ConditionalCheckFailedException') throw err;
    throw new ProposalUnavailable(
      'unknown',
      'That proposal is no longer waiting — it may already have been dealt with.',
    );
  }

  const row = deleted.Attributes as ProposalRow | undefined;
  if (!row?.proposal) {
    // Belt and braces: a table that answered without `ALL_OLD` would otherwise
    // look like a successful confirm of nothing.
    throw new ProposalUnavailable('unknown', 'That proposal is no longer waiting.');
  }

  if (Date.parse(row.expiresAt) <= Date.now()) {
    logger.warn('gateway.proposal-expired', {
      sessionId,
      integration: row.service,
    });
    throw new ProposalUnavailable(
      'expired',
      `That ${row.service} hold has expired — they only keep them for a few minutes.`,
    );
  }

  return { proposal: row.proposal, tool: row.tool };
}
