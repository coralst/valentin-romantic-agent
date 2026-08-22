import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBStore } from '../dynamodb-store';
import type { StorageInterface } from '../storage-interface';
import { META_SK, prefSk, sessionPk } from '../keys';

/**
 * Contract tests for the DynamoDB store, run against **DynamoDB Local**.
 *
 * The suite this replaces was 445 lines of `vi.fn()` asserting which commands
 * the store *built*. That is precisely why every one of these defects was green:
 *
 *   - `begins_with(gsi1pk, …)` — illegal, since `begins_with` cannot apply to a
 *     partition key. A mock happily records the call.
 *   - `SET messageCount = messageCount + :inc` against an item with no such
 *     attribute — a ValidationException in reality, an assertion that passes
 *     against a mock.
 *   - a plain `PutCommand` to revise a preference, silently erasing `history`
 *     while still incrementing the counter.
 *   - a single-page Query in `clearSession`, reporting success while leaving
 *     everything past the 1 MB page behind.
 *
 * None of those is visible by inspecting a command object. Catching them needs
 * an engine that can *refuse*.
 *
 * DynamoDB Local runs in Docker and so is not always present. The suite skips
 * with a loud warning rather than failing when the endpoint is unreachable:
 *
 *   docker run -d --rm -p 8000:8000 --name valentin-ddb-local \
 *     amazon/dynamodb-local -jar DynamoDBLocal.jar -inMemory -sharedDb
 */

const ENDPOINT = process.env.DYNAMODB_LOCAL_ENDPOINT ?? 'http://localhost:8000';
const TABLE_NAME = 'ValentinTable-contract-test';

async function isReachable(): Promise<boolean> {
  try {
    // DynamoDB Local answers a bare GET with 400. Any HTTP reply at all proves
    // it is listening, which is the only question here.
    await fetch(ENDPOINT, { method: 'GET' });
    return true;
  } catch {
    return false;
  }
}

const available = await isReachable();

if (!available) {
  console.warn(
    `[dynamodb-store.test] SKIPPED — no DynamoDB Local at ${ENDPOINT}. Start it with: ` +
      'docker run -d --rm -p 8000:8000 amazon/dynamodb-local ' +
      '-jar DynamoDBLocal.jar -inMemory -sharedDb',
  );
}

describe.runIf(available)('DynamoDBStore (contract, DynamoDB Local)', () => {
  let client: DynamoDBClient;
  let docClient: DynamoDBDocumentClient;
  let alice: StorageInterface;
  let bob: StorageInterface;

  beforeAll(() => {
    client = new DynamoDBClient({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    });
    docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  });

  afterAll(() => {
    docClient?.destroy();
  });

  beforeEach(async () => {
    // A fresh table per test, so no case can depend on another's leftovers.
    await docClient
      .send(new DeleteTableCommand({ TableName: TABLE_NAME }))
      .catch(() => {});

    await docClient.send(
      new CreateTableCommand({
        TableName: TABLE_NAME,
        // Mirrors infra/lib/data-stack.ts. Divergence here would make the suite
        // prove something about a table that does not exist.
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
          { AttributeName: 'gsi1pk', AttributeType: 'S' },
          { AttributeName: 'gsi1sk', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'gsi1pk', KeyType: 'HASH' },
              { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      }),
    );

    alice = new DynamoDBStore('alice', docClient, TABLE_NAME);
    bob = new DynamoDBStore('bob', docClient, TABLE_NAME);
  });

  // --- Sessions ---

  describe('sessions', () => {
    it('reads back a session it just created', async () => {
      const sessionId = await alice.createSession();
      const session = await alice.getSession(sessionId);

      expect(session).not.toBeNull();
      expect(session!.id).toBe(sessionId);
      expect(session!.endedAt).toBeNull();
      expect(session!.messageCount).toBe(0);
      expect(session!.preferenceCount).toBe(0);
    });

    it('returns null for a session that does not exist', async () => {
      expect(await alice.getSession('no-such-session')).toBeNull();
    });

    it("lists only this user's sessions", async () => {
      const first = await alice.createSession();
      const second = await alice.createSession();
      await bob.createSession();

      const ids = (await alice.listSessions()).map((s) => s.id);

      expect(ids).toHaveLength(2);
      expect(new Set(ids)).toEqual(new Set([first, second]));
    });

    it('patches title and partnerName independently', async () => {
      const sessionId = await alice.createSession();

      await alice.updateSessionMeta(sessionId, { partnerName: 'Maya' });
      await alice.updateSessionMeta(sessionId, { title: 'Anniversary plans' });

      const session = await alice.getSession(sessionId);
      expect(session!.partnerName).toBe('Maya');
      expect(session!.title).toBe('Anniversary plans');
    });

    it('endSession stamps endedAt', async () => {
      const sessionId = await alice.createSession();
      await alice.endSession(sessionId);

      expect((await alice.getSession(sessionId))!.endedAt).toBeTruthy();
    });

    it('is a no-op — not an upsert — for an unknown session id', async () => {
      // Without ConditionExpression: attribute_exists(pk), UpdateItem *creates*
      // the item, leaving a half-formed session that listSessions would return.
      await alice.endSession('no-such-session');
      await alice.updateSessionMeta('no-such-session', { title: 'ghost' });
      await alice.clearSession('no-such-session');

      expect(await alice.getSession('no-such-session')).toBeNull();
      expect(await alice.listSessions()).toEqual([]);
    });

    it('deleteSession removes the meta row along with its contents', async () => {
      const sessionId = await alice.createSession();
      await alice.saveMessage({
        id: 'm1',
        sessionId,
        sender: 'user',
        content: 'hello',
        timestamp: '2026-01-01T00:00:00.000Z',
      });
      await alice.savePreference({
        sessionId,
        category: 'food',
        key: 'cuisine',
        value: 'Italian',
        confidence: 0.9,
        sourceMessageId: 'm1',
      });

      await alice.deleteSession(sessionId);

      expect(await alice.getSession(sessionId)).toBeNull();
      expect(await alice.getMessagesBySession(sessionId)).toEqual([]);
      expect(await alice.getPreferencesBySession(sessionId)).toEqual([]);
    });
  });

  // --- Messages ---

  describe('messages', () => {
    it('returns messages in chronological order regardless of write order', async () => {
      const sessionId = await alice.createSession();

      // Written newest-first deliberately: ordering must come from the sort key,
      // not from insertion order.
      for (const [id, timestamp] of [
        ['m3', '2026-01-03T00:00:00.000Z'],
        ['m1', '2026-01-01T00:00:00.000Z'],
        ['m2', '2026-01-02T00:00:00.000Z'],
      ]) {
        await alice.saveMessage({
          id,
          sessionId,
          sender: 'user',
          content: id,
          timestamp,
        });
      }

      const ids = (await alice.getMessagesBySession(sessionId)).map((m) => m.id);
      expect(ids).toEqual(['m1', 'm2', 'm3']);
    });

    it('increments messageCount and advances lastActivity', async () => {
      const sessionId = await alice.createSession();

      await alice.saveMessage({
        id: 'm1',
        sessionId,
        sender: 'user',
        content: 'hello',
        timestamp: '2026-06-01T00:00:00.000Z',
      });
      await alice.saveMessage({
        id: 'm2',
        sessionId,
        sender: 'agent',
        content: 'hi',
        timestamp: '2026-06-02T00:00:00.000Z',
      });

      const session = await alice.getSession(sessionId);
      expect(session!.messageCount).toBe(2);
      expect(session!.lastActivity).toBe('2026-06-02T00:00:00.000Z');
    });
  });

  // --- Preferences ---

  describe('preferences', () => {
    it('reads back a saved preference by natural key', async () => {
      const sessionId = await alice.createSession();
      await alice.savePreference({
        sessionId,
        category: 'food',
        key: 'cuisine',
        value: 'Italian',
        confidence: 0.9,
        sourceMessageId: 'm1',
      });

      const found = await alice.findPreference(sessionId, 'food', 'cuisine');
      expect(found).not.toBeNull();
      expect(found!.value).toBe('Italian');
      expect(found!.history).toEqual([]);
    });

    it('saving the same natural key twice keeps one row', async () => {
      const sessionId = await alice.createSession();
      const write = () =>
        alice.savePreference({
          sessionId,
          category: 'food',
          key: 'cuisine',
          value: 'Italian',
          confidence: 0.9,
          sourceMessageId: 'm1',
        });

      await write();
      await write();

      expect(await alice.getPreferencesBySession(sessionId)).toHaveLength(1);
    });

    it('revising a preference appends history and persists it', async () => {
      const sessionId = await alice.createSession();
      await alice.savePreference({
        sessionId,
        category: 'food',
        key: 'cuisine',
        value: 'French',
        confidence: 0.7,
        sourceMessageId: 'm0',
      });

      const first = await alice.updatePreference(
        { sessionId, category: 'food', key: 'cuisine' },
        { value: 'Italian', confidence: 0.95, sourceMessageId: 'm1' },
      );
      const second = await alice.updatePreference(
        { sessionId, category: 'food', key: 'cuisine' },
        { value: 'Thai', confidence: 0.9, sourceMessageId: 'm2' },
      );

      expect(first.history).toHaveLength(1);
      expect(second.history).toHaveLength(2);

      // The returned object is easy to get right by accident; what matters is
      // what actually landed on the item.
      const persisted = await alice.findPreference(sessionId, 'food', 'cuisine');
      expect(persisted!.value).toBe('Thai');
      expect(persisted!.history.map((h) => h.previousValue)).toEqual([
        'French',
        'Italian',
      ]);
    });

    it('a revision does not inflate preferenceCount', async () => {
      const sessionId = await alice.createSession();
      await alice.savePreference({
        sessionId,
        category: 'food',
        key: 'cuisine',
        value: 'French',
        confidence: 0.7,
        sourceMessageId: 'm0',
      });
      await alice.updatePreference(
        { sessionId, category: 'food', key: 'cuisine' },
        { value: 'Italian', confidence: 0.95, sourceMessageId: 'm1' },
      );

      expect((await alice.getSession(sessionId))!.preferenceCount).toBe(1);
    });

    it('revising a preference that does not exist throws rather than creating one', async () => {
      const sessionId = await alice.createSession();

      await expect(
        alice.updatePreference(
          { sessionId, category: 'food', key: 'cuisine' },
          { value: 'Italian' },
        ),
      ).rejects.toThrow(/not found/i);

      expect(await alice.getPreferencesBySession(sessionId)).toEqual([]);
    });

    it('writes a batch larger than the 25-item BatchWriteItem limit', async () => {
      const sessionId = await alice.createSession();
      const prefs = Array.from({ length: 30 }, (_, i) => ({
        category: 'food' as const,
        key: `dish-${i}`,
        value: `value-${i}`,
        confidence: 0.8,
        sourceMessageId: 'seed',
      }));

      const written = await alice.savePreferencesBatch(sessionId, prefs);

      expect(written).toHaveLength(30);
      expect(await alice.getPreferencesBySession(sessionId)).toHaveLength(30);
      // One counter update for the whole batch, not one per item.
      expect((await alice.getSession(sessionId))!.preferenceCount).toBe(30);
    });

    it('an empty batch touches nothing', async () => {
      const sessionId = await alice.createSession();
      expect(await alice.savePreferencesBatch(sessionId, [])).toEqual([]);
      expect((await alice.getSession(sessionId))!.preferenceCount).toBe(0);
    });

    it('tolerates delimiters inside a preference key', async () => {
      const sessionId = await alice.createSession();
      await alice.savePreference({
        sessionId,
        category: 'food',
        key: 'PREF#weird#key',
        value: 'still works',
        confidence: 0.5,
        sourceMessageId: 'm1',
      });

      const found = await alice.findPreference(sessionId, 'food', 'PREF#weird#key');
      expect(found!.value).toBe('still works');
    });
  });

  // --- Reset ---

  describe('clearSession', () => {
    it('drops messages and preferences, keeps the session, zeroes the counters', async () => {
      const sessionId = await alice.createSession();
      await alice.saveMessage({
        id: 'm1',
        sessionId,
        sender: 'user',
        content: 'hello',
        timestamp: '2026-01-01T00:00:00.000Z',
      });
      await alice.savePreferencesBatch(sessionId, [
        {
          category: 'food',
          key: 'cuisine',
          value: 'Italian',
          confidence: 0.9,
          sourceMessageId: 'm1',
        },
      ]);
      await alice.updateSessionMeta(sessionId, { partnerName: 'Maya' });

      await alice.clearSession(sessionId);

      expect(await alice.getMessagesBySession(sessionId)).toEqual([]);
      expect(await alice.getPreferencesBySession(sessionId)).toEqual([]);

      const session = await alice.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session!.messageCount).toBe(0);
      expect(session!.preferenceCount).toBe(0);
      expect(session!.partnerName).toBeNull();
    });

    it('leaves the same user\'s other sessions untouched', async () => {
      const kept = await alice.createSession();
      const cleared = await alice.createSession();
      for (const sessionId of [kept, cleared]) {
        await alice.savePreference({
          sessionId,
          category: 'food',
          key: 'cuisine',
          value: 'Italian',
          confidence: 0.9,
          sourceMessageId: 'm1',
        });
      }

      await alice.clearSession(cleared);

      expect(await alice.getPreferencesBySession(kept)).toHaveLength(1);
    });
  });

  // --- Cross-tenant isolation ---

  describe('cross-tenant isolation', () => {
    let aliceSession: string;

    beforeEach(async () => {
      aliceSession = await alice.createSession();
      await alice.saveMessage({
        id: 'm1',
        sessionId: aliceSession,
        sender: 'user',
        content: 'private',
        timestamp: '2026-01-01T00:00:00.000Z',
      });
      await alice.savePreference({
        sessionId: aliceSession,
        category: 'food',
        key: 'cuisine',
        value: 'Italian',
        confidence: 0.9,
        sourceMessageId: 'm1',
      });
    });

    it('hides the session, its messages and its preferences from another user', async () => {
      // Bob holds a *valid* session id. Isolation must not rest on him not
      // knowing it.
      expect(await bob.getSession(aliceSession)).toBeNull();
      expect(await bob.getMessagesBySession(aliceSession)).toEqual([]);
      expect(await bob.getPreferencesBySession(aliceSession)).toEqual([]);
      expect(await bob.findPreference(aliceSession, 'food', 'cuisine')).toBeNull();
      expect(await bob.listSessions()).toEqual([]);
    });

    it("refuses another user's writes to that session", async () => {
      await bob.endSession(aliceSession);
      await bob.updateSessionMeta(aliceSession, { title: 'hijacked' });
      await bob.clearSession(aliceSession);
      await bob.deleteSession(aliceSession);

      const session = await alice.getSession(aliceSession);
      expect(session).not.toBeNull();
      expect(session!.endedAt).toBeNull();
      expect(session!.title).toBeNull();
      expect(await alice.getMessagesBySession(aliceSession)).toHaveLength(1);
      expect(await alice.getPreferencesBySession(aliceSession)).toHaveLength(1);
    });
  });

  // --- TTL ---

  describe('ttl', () => {
    it('stamps an epoch-second expiry when the store was given a lifetime', async () => {
      const ephemeral = new DynamoDBStore('demo', docClient, TABLE_NAME, 3600);
      const sessionId = await ephemeral.createSession();

      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { pk: sessionPk('demo', sessionId), sk: META_SK },
        }),
      );

      const ttl = result.Item!.ttl as number;
      const nowSeconds = Math.floor(Date.now() / 1000);

      // Seconds, not milliseconds. A millisecond value would sit roughly 50,000
      // years in the future and silently disable expiry altogether.
      expect(ttl).toBeGreaterThan(nowSeconds);
      expect(ttl).toBeLessThanOrEqual(nowSeconds + 3601);
    });

    it('omits ttl entirely for a store with no lifetime', async () => {
      const sessionId = await alice.createSession();

      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { pk: sessionPk('alice', sessionId), sk: META_SK },
        }),
      );

      expect(result.Item).not.toHaveProperty('ttl');
    });
  });

  // --- Key layout ---

  describe('item layout', () => {
    it('places a preference at the key the schema documents', async () => {
      const sessionId = await alice.createSession();
      await alice.savePreference({
        sessionId,
        category: 'food',
        key: 'cuisine',
        value: 'Italian',
        confidence: 0.9,
        sourceMessageId: 'm1',
      });

      // Asserted directly, because the key layout is a storage contract: a
      // change here is a migration, not a refactor.
      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: sessionPk('alice', sessionId),
            sk: prefSk('food', 'cuisine'),
          },
        }),
      );

      expect(result.Item).toBeDefined();
      expect(result.Item!.entityType).toBe('Preference');
    });

    it('carries GSI keys on the session meta row only', async () => {
      const sessionId = await alice.createSession();
      await alice.saveMessage({
        id: 'm1',
        sessionId,
        sender: 'user',
        content: 'hello',
        timestamp: '2026-01-01T00:00:00.000Z',
      });

      const meta = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { pk: sessionPk('alice', sessionId), sk: META_SK },
        }),
      );
      const message = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: sessionPk('alice', sessionId),
            sk: 'MSG#2026-01-01T00:00:00.000Z#m1',
          },
        }),
      );

      // A sparse index: one GSI row per session, so listSessions needs no filter.
      expect(meta.Item!.gsi1pk).toBe('USER#alice');
      expect(message.Item).toBeDefined();
      expect(message.Item).not.toHaveProperty('gsi1pk');
    });
  });
});
