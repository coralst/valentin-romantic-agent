import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  putProposal,
  takeProposal,
  ProposalUnavailable,
  resetProposalStoreForTests,
} from '../proposal-store';
import type { ActionProposal } from '../tool-registry';

/**
 * The row that lets a stateless Lambda hold a proposal between two invocations.
 *
 * What is worth testing here is not DynamoDB — it is the three decisions layered
 * on top of it: that the key encodes the owner so a cross-user confirm is a miss
 * rather than a forgotten check, that expiry is enforced explicitly instead of
 * trusting TTL, and that a claimed row is gone before anything is spent.
 */

const TABLE = 'ValentinTable-test';

function proposal(over: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: 'prop-1',
    sessionId: 'sess-1',
    service: 'ontopo',
    title: 'A table at Port Said',
    summary: 'Saturday, 21:00, two people',
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    payload: { areaId: 'secret-area-id' },
    ...over,
  };
}

/** A doc client that records what it was asked to do and answers as told. */
function fakeDoc(reply: unknown = {}) {
  const sent: Record<string, unknown>[] = [];
  const send = vi.fn(async (command: { input: Record<string, unknown> }) => {
    sent.push(command.input);
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { client: { send } as unknown as DynamoDBDocumentClient, sent, send };
}

/** The name DynamoDB's conditional failure arrives under. */
function conditionalCheckFailed(): Error {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
}

beforeEach(() => {
  process.env.VALENTIN_TABLE_NAME = TABLE;
});

afterEach(() => {
  resetProposalStoreForTests();
  delete process.env.VALENTIN_TABLE_NAME;
});

describe('putProposal', () => {
  it('keys the row by user and session, so ownership is the key and not a check', () => {
    const doc = fakeDoc();
    resetProposalStoreForTests(doc.client);

    return putProposal('google_1234', proposal(), 'propose_reservation').then(() => {
      const item = doc.sent[0].Item as Record<string, unknown>;
      expect(doc.sent[0].TableName).toBe(TABLE);
      expect(item.pk).toBe('USER#google_1234#SESSION#sess-1');
      expect(item.sk).toBe('PROPOSAL#prop-1');
    });
  });

  it('records the tool that raised it, so the confirm knows whose confirm() to run', async () => {
    const doc = fakeDoc();
    resetProposalStoreForTests(doc.client);

    await putProposal('u', proposal(), 'propose_reservation');

    const item = doc.sent[0].Item as Record<string, unknown>;
    expect(item.tool).toBe('propose_reservation');
    expect(item.entityType).toBe('proposal');
  });

  it('stores the payload here, which is the whole reason the row exists', async () => {
    // The payload must survive between two Lambda invocations without passing
    // through the model or the browser. If it stopped being written the confirm
    // would silently lose the Ontopo area id.
    const doc = fakeDoc();
    resetProposalStoreForTests(doc.client);

    await putProposal('u', proposal(), 'propose_reservation');

    const item = doc.sent[0].Item as { proposal: ActionProposal };
    expect(item.proposal.payload).toEqual({ areaId: 'secret-area-id' });
  });

  it('sets a ttl an hour past the proposal’s own expiry, not at it', async () => {
    // The grace period is what makes a late confirm hit the explicit "expired"
    // message rather than a missing row, which reads as someone else's proposal.
    const doc = fakeDoc();
    resetProposalStoreForTests(doc.client);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    await putProposal('u', proposal({ expiresAt }), 'propose_reservation');

    const item = doc.sent[0].Item as { ttl: number };
    expect(item.ttl).toBe(Math.floor(Date.parse(expiresAt) / 1000) + 3600);
  });

  it('refuses to run without a table name rather than writing nowhere', async () => {
    delete process.env.VALENTIN_TABLE_NAME;
    resetProposalStoreForTests(fakeDoc().client);

    await expect(putProposal('u', proposal(), 'propose_reservation')).rejects.toThrow(
      /VALENTIN_TABLE_NAME is unset/,
    );
  });
});

describe('takeProposal', () => {
  it('returns the proposal and its tool, and deletes the row in the same call', async () => {
    const stored = proposal();
    const doc = fakeDoc({
      Attributes: { proposal: stored, tool: 'propose_reservation', expiresAt: stored.expiresAt },
    });
    resetProposalStoreForTests(doc.client);

    const taken = await takeProposal('u', 'sess-1', 'prop-1');

    expect(taken.tool).toBe('propose_reservation');
    expect(taken.proposal.payload).toEqual({ areaId: 'secret-area-id' });
    // A delete with ALL_OLD, not a get-then-delete: two concurrent confirms would
    // otherwise both read the row and both spend money.
    expect(doc.sent[0].ReturnValues).toBe('ALL_OLD');
    expect(doc.sent[0].ConditionExpression).toBe('attribute_exists(pk)');
    expect(doc.send).toHaveBeenCalledTimes(1);
  });

  it('looks only in the caller’s own partition', async () => {
    const stored = proposal();
    const doc = fakeDoc({
      Attributes: { proposal: stored, tool: 'propose_reservation', expiresAt: stored.expiresAt },
    });
    resetProposalStoreForTests(doc.client);

    await takeProposal('her-sub', 'sess-9', 'prop-1');

    expect(doc.sent[0].Key).toEqual({
      pk: 'USER#her-sub#SESSION#sess-9',
      sk: 'PROPOSAL#prop-1',
    });
  });

  it('turns a lost race into "no longer waiting" rather than an unhandled failure', async () => {
    // Both a second Confirm press and another user's id arrive here as the same
    // conditional failure, and both deserve the same sentence.
    resetProposalStoreForTests(fakeDoc(conditionalCheckFailed()).client);

    await expect(takeProposal('u', 'sess-1', 'prop-1')).rejects.toBeInstanceOf(ProposalUnavailable);
    await expect(takeProposal('u', 'sess-1', 'prop-1')).rejects.toMatchObject({
      reason: 'unknown',
    });
  });

  it('lets a real DynamoDB failure through, so an outage is not read as a stale proposal', async () => {
    const throttled = new Error('Rate exceeded');
    throttled.name = 'ProvisionedThroughputExceededException';
    resetProposalStoreForTests(fakeDoc(throttled).client);

    await expect(takeProposal('u', 'sess-1', 'prop-1')).rejects.toThrow(/Rate exceeded/);
  });

  it('refuses an expired hold even though the row was still there', async () => {
    // TTL deletes up to 48 hours late, so the row outliving the hold is the normal
    // case and this comparison — not DynamoDB — is the gate.
    const stored = proposal({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    resetProposalStoreForTests(
      fakeDoc({
        Attributes: { proposal: stored, tool: 'propose_reservation', expiresAt: stored.expiresAt, service: 'ontopo' },
      }).client,
    );

    await expect(takeProposal('u', 'sess-1', 'prop-1')).rejects.toMatchObject({
      reason: 'expired',
    });
    await expect(takeProposal('u', 'sess-1', 'prop-1')).rejects.toThrow(/ontopo hold has expired/);
  });

  it('treats a delete that returned no attributes as nothing to confirm', async () => {
    // Belt and braces: a table answering without ALL_OLD would otherwise look like
    // a successful confirm of an undefined proposal.
    resetProposalStoreForTests(fakeDoc({}).client);

    await expect(takeProposal('u', 'sess-1', 'prop-1')).rejects.toMatchObject({
      reason: 'unknown',
    });
  });
});
