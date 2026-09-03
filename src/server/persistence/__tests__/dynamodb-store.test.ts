import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBStore, DynamoDBStoreFactory } from '../dynamodb-store';
import type { Person } from '../../../shared/interfaces/person';
import type { StorageInterface } from '../storage-interface';
import type { Reminder } from '../../../shared/interfaces/reminder';
import type { Task } from '../../../shared/interfaces/task';
import {
  META_SK,
  dueGsi1pk,
  manualSk,
  personSk,
  prefSk,
  reminderGsi1sk,
  reminderSk,
  sessionPk,
  taskSk,
} from '../keys';
import { describeStoreConformance } from './store-conformance';

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

  /*
   * The shared spec, run against the real engine.
   *
   * Nested inside this describe so the table teardown/create above still runs
   * before each of its cases, and so it disappears with the rest of the file when
   * DynamoDB Local is not listening. Everything below is what is true of *this*
   * store in particular: TTL attributes, (pk, sk) layout, GSI1 sparseness, rows an
   * older build wrote, and behaviour that needs two users at once.
   */
  describeStoreConformance(
    'DynamoDBStore',
    () => new DynamoDBStore('alice', docClient, TABLE_NAME),
    // The index reader lives on the factory, deliberately — see
    // `ReminderIndexReader`. Two factory instances over one docClient are
    // interchangeable here because all of the state is in the table.
    {
      makeReader: () => new DynamoDBStoreFactory(docClient, TABLE_NAME),
      userId: 'alice',
    },
  );

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

    /*
     * The single-row path used to build its batch entry without `fieldId`, so every
     * live-extracted preference in the real deployment persisted `fieldId: null` and
     * the client fell back to fuzzy category+key resolution. `InMemoryStore` passed
     * it, which is exactly why the unit suite never noticed — hence the same
     * assertion in both stores' suites.
     */
    it('carries fieldId through the single-row save path', async () => {
      const sessionId = await alice.createSession();
      await alice.savePreference({
        sessionId,
        category: 'personality_traits',
        key: 'partner_name',
        fieldId: 'partner_name',
        value: 'Maya',
        confidence: 1,
        sourceMessageId: 'm1',
      });

      const found = await alice.findPreference(sessionId, 'personality_traits', 'partner_name');
      expect(found?.fieldId).toBe('partner_name');
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

  // --- The one-page dossier's item types ---

  describe('people, tasks and manual values', () => {
    function person(overrides: Partial<Person> = {}): Person {
      return {
        id: 'p1',
        name: 'Leah',
        relationship: 'Older sister',
        generation: 'peer',
        birthday: null,
        note: null,
        source: 'manual',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }

    function task(overrides: Partial<Task> = {}): Task {
      return {
        id: 't1',
        title: 'Book somewhere for the anniversary',
        due: '2026-09-11',
        note: null,
        done: false,
        source: 'discovered',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }

    it('round trips a person through the real engine', async () => {
      const sessionId = await alice.createSession();

      await alice.savePerson(sessionId, person({ birthday: '1988-09-09', note: 'Lives in Haifa' }));

      const [read] = await alice.getPeopleBySession(sessionId);
      expect(read).toMatchObject({
        id: 'p1',
        name: 'Leah',
        relationship: 'Older sister',
        generation: 'peer',
        birthday: '1988-09-09',
        note: 'Lives in Haifa',
      });
    });

    it('keeps a null name, which is how a gap is recorded', async () => {
      // DocumentClient is configured with removeUndefinedValues, so this asserts
      // that a *null* really survives the trip rather than vanishing like an
      // undefined would. A vanished gap is a dashed node the tree never draws.
      const sessionId = await alice.createSession();

      await alice.savePerson(sessionId, person({ name: null, relationship: 'Uncle' }));

      expect((await alice.getPeopleBySession(sessionId))[0].name).toBeNull();
    });

    it('writes a batch of people larger than the 25-item BatchWriteItem limit', async () => {
      const sessionId = await alice.createSession();
      const many = Array.from({ length: 30 }, (_, i) =>
        person({ id: `p${i}`, name: `Person ${i}` }),
      );

      await alice.savePeopleBatch(sessionId, many);

      expect(await alice.getPeopleBySession(sessionId)).toHaveLength(30);
    });

    it('does not inflate preferenceCount with a family', async () => {
      const sessionId = await alice.createSession();

      await alice.savePeopleBatch(sessionId, [person(), person({ id: 'p2', name: 'Noa' })]);

      expect((await alice.getSession(sessionId))!.preferenceCount).toBe(0);
    });

    it('a second write of a person id is a rename, not a duplicate', async () => {
      const sessionId = await alice.createSession();

      await alice.savePerson(sessionId, person({ name: null }));
      await alice.savePerson(sessionId, person({ name: 'Nadia' }));

      const people = await alice.getPeopleBySession(sessionId);
      expect(people).toHaveLength(1);
      expect(people[0].name).toBe('Nadia');
    });

    it('reads back a generation an older build never wrote', async () => {
      // Stored rows predate `grandparent`. Anything unrecognised lands on `elder`
      // rather than being dropped — a rung off beats a missing relative.
      const sessionId = await alice.createSession();
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            pk: sessionPk('alice', sessionId),
            sk: personSk('legacy'),
            id: 'legacy',
            name: 'Ruth',
            relationship: 'Mother',
            generation: 'ancestor',
            updatedAt: '2026-01-01T00:00:00.000Z',
            entityType: 'Person',
          },
        }),
      );

      expect((await alice.getPeopleBySession(sessionId))[0].generation).toBe('elder');
    });

    it('remembers a ticked task', async () => {
      const sessionId = await alice.createSession();
      await alice.saveTask(sessionId, task());

      await alice.saveTask(sessionId, task({ done: true }));

      const tasks = await alice.getTasksBySession(sessionId);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].done).toBe(true);
    });

    it('reads a task row with no `done` attribute as open', async () => {
      // Not merely defensive: a row missing the attribute must not present as
      // done, or the list silently forgets work he has not finished.
      const sessionId = await alice.createSession();
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            pk: sessionPk('alice', sessionId),
            sk: taskSk('legacy'),
            id: 'legacy',
            title: 'Draft the card',
            source: 'manual',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            entityType: 'Task',
          },
        }),
      );

      expect((await alice.getTasksBySession(sessionId))[0].done).toBe(false);
    });

    it('deletes one task and leaves the rest', async () => {
      const sessionId = await alice.createSession();
      await alice.saveTasksBatch(sessionId, [task(), task({ id: 't2', title: 'Draft the card' })]);

      await alice.deleteTask(sessionId, 't2');

      expect((await alice.getTasksBySession(sessionId)).map((t) => t.id)).toEqual(['t1']);
    });

    it('keeps a manual correction and the preference it overrides in separate rows', async () => {
      // The point of MANUAL# existing at all. One row would make the later writer
      // win, so a re-extraction would quietly overwrite the user's own answer.
      const sessionId = await alice.createSession();
      await alice.setManualValue(sessionId, 'bra_size', '34B');
      await alice.savePreference({
        sessionId,
        category: 'gifts',
        fieldId: 'bra_size',
        key: 'bra size',
        value: '36C',
        confidence: 0.6,
        sourceMessageId: 'm1',
      });

      expect((await alice.getManualValues(sessionId)).bra_size).toBe('34B');
      expect((await alice.getPreferencesBySession(sessionId))[0].value).toBe('36C');
    });

    it('clears one manual value without touching the others', async () => {
      const sessionId = await alice.createSession();
      await alice.setManualValue(sessionId, 'bra_size', '34B');
      await alice.setManualValue(sessionId, 'shoe_size', 'UK 6');

      await alice.clearManualValue(sessionId, 'bra_size');

      expect(await alice.getManualValues(sessionId)).toEqual({ shoe_size: 'UK 6' });
    });

    it('clearSession sweeps all three, keeping the session alive', async () => {
      const sessionId = await alice.createSession();
      await alice.savePerson(sessionId, person());
      await alice.saveTask(sessionId, task());
      await alice.setManualValue(sessionId, 'bra_size', '34B');

      await alice.clearSession(sessionId);

      expect(await alice.getPeopleBySession(sessionId)).toEqual([]);
      expect(await alice.getTasksBySession(sessionId)).toEqual([]);
      expect(await alice.getManualValues(sessionId)).toEqual({});
      expect(await alice.getSession(sessionId)).not.toBeNull();
    });

    it('deleteSession leaves no person row behind', async () => {
      // An item outliving its session is unreachable forever after: nothing will
      // query that partition again, so it is storage nobody can see or bill for.
      const sessionId = await alice.createSession();
      await alice.savePerson(sessionId, person());

      await alice.deleteSession(sessionId);

      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { pk: sessionPk('alice', sessionId), sk: personSk('p1') },
        }),
      );
      expect(result.Item).toBeUndefined();
    });

    it('hides people, tasks and corrections from another user', async () => {
      const sessionId = await alice.createSession();
      await alice.savePerson(sessionId, person());
      await alice.saveTask(sessionId, task());
      await alice.setManualValue(sessionId, 'bra_size', '34B');

      expect(await bob.getPeopleBySession(sessionId)).toEqual([]);
      expect(await bob.getTasksBySession(sessionId)).toEqual([]);
      expect(await bob.getManualValues(sessionId)).toEqual({});
    });

    it('places each at the key the schema documents', async () => {
      const sessionId = await alice.createSession();
      await alice.savePerson(sessionId, person());
      await alice.saveTask(sessionId, task());
      await alice.setManualValue(sessionId, 'bra_size', '34B');

      for (const [sk, entityType] of [
        [personSk('p1'), 'Person'],
        [taskSk('t1'), 'Task'],
        [manualSk('bra_size'), 'ManualValue'],
      ] as const) {
        const result = await docClient.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: { pk: sessionPk('alice', sessionId), sk },
          }),
        );
        expect(result.Item, sk).toBeDefined();
        expect(result.Item!.entityType).toBe(entityType);
        // Sparse GSI: only the meta row lists a session.
        expect(result.Item).not.toHaveProperty('gsi1pk');
      }
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

  // --- The due-index, as rows in the table ---
  //
  // GSI1 carries two disjoint kinds of row (see `keys.ts`). The conformance suite
  // proves the *behaviour*; these prove the layout that behaviour rests on, which
  // is a storage contract: a change here is a migration.

  describe('the due-index layout', () => {
    function reminder(sessionId: string, overrides: Partial<Reminder> = {}): Reminder {
      return {
        id: 'birthday-2026-10-04',
        sessionId,
        userId: 'alice',
        kind: 'birthday',
        occursOn: '2026-10-04',
        // 09:00 Asia/Jerusalem on 2026-09-27, which is 06:00 UTC the same day.
        dueAt: '2026-09-27T06:00:00.000Z',
        leadDays: 7,
        occasion: 'her birthday',
        channel: 'log',
        target: null,
        sentAt: null,
        attempts: 0,
        lastError: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
      };
    }

    async function readRow(sessionId: string): Promise<Record<string, unknown>> {
      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: sessionPk('alice', sessionId),
            sk: reminderSk('birthday-2026-10-04'),
          },
        }),
      );
      expect(result.Item).toBeDefined();
      return result.Item as Record<string, unknown>;
    }

    it('indexes a pending reminder by the UTC day and time of its dueAt', async () => {
      const sessionId = await alice.createSession();

      await alice.saveReminder(sessionId, reminder(sessionId));

      const item = await readRow(sessionId);
      expect(item.entityType).toBe('Reminder');
      // Not `DUE#2026-09-27` because the local date happens to agree — because the
      // *instant* does. A key built from local calendar fields would name the wrong
      // bucket for the three hours Israel is ahead of UTC.
      expect(item.gsi1pk).toBe(dueGsi1pk('2026-09-27'));
      expect(item.gsi1sk).toBe(reminderGsi1sk('06:00:00', 'birthday-2026-10-04'));
    });

    it('keeps a sent reminder out of the index on a plain re-put', async () => {
      // Not only on the markSent path: re-planning writes the whole row, and a Put
      // that restored gsi1* would hand an already-sent birthday back to the poller.
      const sessionId = await alice.createSession();

      await alice.saveReminder(
        sessionId,
        reminder(sessionId, { sentAt: '2026-09-27T06:00:01.000Z' }),
      );

      const item = await readRow(sessionId);
      expect(item).not.toHaveProperty('gsi1pk');
      expect(item).not.toHaveProperty('gsi1sk');
    });

    it('never shows a reminder in the sidebar', async () => {
      // The invariant behind index overloading: `listSessions` matches
      // `gsi1pk = USER#alice` exactly, so a `DUE#…` row is not in the partition it
      // reads — and the entityType filter says so a second time.
      const sessionId = await alice.createSession();
      await alice.saveReminder(sessionId, reminder(sessionId));

      const sessions = await alice.listSessions();
      expect(sessions.map((s) => s.id)).toEqual([sessionId]);
    });

    it('reads a row an older build wrote with no attempts attribute', async () => {
      // `attempts + 1` on a string or a missing attribute is the next failure
      // turning into a ValidationException instead of a retry.
      const sessionId = await alice.createSession();
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            pk: sessionPk('alice', sessionId),
            sk: reminderSk('birthday-2026-10-04'),
            id: 'birthday-2026-10-04',
            sessionId,
            userId: 'alice',
            kind: 'nameday',
            occursOn: '2026-10-04',
            dueAt: '2026-09-27T06:00:00.000Z',
            leadDays: 7,
            occasion: 'her birthday',
            createdAt: '2026-09-01T00:00:00.000Z',
            entityType: 'Reminder',
          },
        }),
      );

      const [read] = await alice.getRemindersBySession(sessionId);
      expect(read.attempts).toBe(0);
      // An unrecognised kind is worded as a generic occasion rather than dropped,
      // and an unrecognised channel degrades to the one that always works.
      expect(read.kind).toBe('occasion');
      expect(read.channel).toBe('log');
      expect(read.sentAt).toBeNull();
    });

    it("hides a reminder from another user's scoped read", async () => {
      const sessionId = await alice.createSession();
      await alice.saveReminder(sessionId, reminder(sessionId));

      expect(await bob.getRemindersBySession(sessionId)).toEqual([]);
    });
  });
});
