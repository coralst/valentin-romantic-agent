import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ChatMessage } from '../../shared/interfaces/message';
import type {
  Preference,
  PreferenceCategory,
  PreferenceHistoryEntry,
  PreferenceWithHistory,
} from '../../shared/interfaces/preference';
import { DEFAULT_GENERATION, isPersonGeneration } from '../../shared/interfaces/person';
import type { Person, PersonGeneration } from '../../shared/interfaces/person';
import type { SessionData } from '../../shared/interfaces/session';
import type { Task } from '../../shared/interfaces/task';
import { isOutingVerdict } from '../../shared/interfaces/outing';
import type { Outing } from '../../shared/interfaces/outing';
import { isReminderKind } from '../../shared/interfaces/reminder';
import type { Reminder } from '../../shared/interfaces/reminder';
import type {
  PreferenceInput,
  PreferenceRef,
  ReminderIndexReader,
  ScopedStorageFactory,
  ScopedStorageOptions,
  SessionMetaPatch,
  StorageInterface,
} from './storage-interface';
import {
  MANUAL_PREFIX,
  META_SK,
  MSG_PREFIX,
  PERSON_PREFIX,
  PREF_PREFIX,
  REMINDER_PREFIX,
  TASK_PREFIX,
  OUTING_PREFIX,
  dueGsi1pk,
  outingSk,
  manualSk,
  msgSk,
  personSk,
  prefSk,
  reminderGsi1sk,
  reminderSk,
  sessionGsi1sk,
  sessionPk,
  taskSk,
  userGsi1pk,
} from './keys';
import { config } from '../config';
import { logger } from '../logging';

/** A single-table primary key pair */
interface ItemKey {
  pk: string;
  sk: string;
}

/** Maximum number of write requests DynamoDB accepts in one BatchWriteItem call */
const BATCH_WRITE_LIMIT = 25;

/** Bound on retries of unprocessed batch keys, so a throttled table cannot loop forever */
const BATCH_MAX_ATTEMPTS = 5;

/** Split a list into fixed-size chunks */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Milliseconds in a day, for stepping back one due-index bucket */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How much of a failure message is worth keeping.
 *
 * A provider error can arrive with a stack trace and a full request dump
 * attached, and the row it lands on is read by a human answering "why did my
 * reminder not arrive?" — the first sentence answers that. Whatever is stored
 * here is a *message*: nothing on this path ever writes a token, an OAuth refresh
 * secret or an app password onto the row.
 */
const MAX_STORED_ERROR_CHARS = 500;

/**
 * The due-index day bucket an instant belongs to.
 *
 * Derived from the UTC instant, never from local calendar fields: a 09:00
 * Asia/Jerusalem reminder is 06:00 UTC, and a bucket built from the local date
 * would sit in a partition the sweep does not read.
 */
function utcDayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The `HH:mm:ss` an instant falls at, in UTC, for the same reason as `utcDayOf` */
function utcClockOf(at: Date): string {
  return at.toISOString().slice(11, 19);
}

/**
 * An id that sorts after every real one, for the upper bound of a bucket query.
 *
 * The bound has to *include* the reminders due in `at`'s own second, and
 * `T<HH:mm:ss>#` alone would exclude them all — every real key has an id after
 * the '#'. `dueBefore` re-filters on `dueAt` anyway, so erring inclusive here
 * costs one discarded row and erring exclusive loses a send.
 */
const ID_SORT_SENTINEL = '\uffff';

/**
 * Run a Query to exhaustion.
 *
 * DynamoDB caps a single Query response at 1 MB regardless of Limit, so a
 * one-shot Query silently truncates. The store this replaced did exactly that in
 * clearSession, which could therefore report success while leaving data behind
 * past the first page.
 *
 * A free function rather than a method because both the scoped store and the
 * unscoped index reader on the factory need it, and a second hand-rolled
 * pagination loop is a second chance to forget `LastEvaluatedKey`.
 */
async function queryAllPages(
  docClient: DynamoDBDocumentClient,
  input: ConstructorParameters<typeof QueryCommand>[0],
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({ ...input, ExclusiveStartKey: startKey }),
    );
    items.push(...((result.Items ?? []) as Record<string, unknown>[]));
    startKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);

  return items;
}

/**
 * Build the shared document client.
 *
 * One client per process, shared by every scoped store: it holds the HTTP
 * connection pool, and the stores are created per connection.
 */
function defaultDocClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: config.awsRegion }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
}

/**
 * DynamoDB-backed storage, scoped to one user.
 *
 * Obtain instances via {@link DynamoDBStoreFactory}, never with `new` from
 * application code — the constructor takes a user id precisely so that no
 * method needs one, and so that no caller can accidentally omit it.
 */
export class DynamoDBStore implements StorageInterface {
  constructor(
    private readonly userId: string,
    private readonly docClient: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly ttlSeconds?: number,
  ) {}

  // --- Session ---

  async createSession(): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: this.withTtl({
          pk: sessionPk(this.userId, id),
          sk: META_SK,
          // Only meta items carry gsi1*, which is what makes GSI1 sparse: one
          // row per session, so listSessions needs no filter.
          gsi1pk: userGsi1pk(this.userId),
          gsi1sk: sessionGsi1sk(now, id),
          id,
          createdAt: now,
          lastActivity: now,
          endedAt: null,
          messageCount: 0,
          preferenceCount: 0,
          title: null,
          partnerName: null,
          entityType: 'Session',
        }),
      }),
    );

    logger.info('session.created', { sessionId: id });
    return id;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    // A plain GetItem, because the user id is part of the partition key. Another
    // user's session id produces a key that simply does not exist, so isolation
    // needs no ownership check here or at any caller.
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: sessionPk(this.userId, sessionId), sk: META_SK },
      }),
    );

    return result.Item ? toSessionData(result.Item) : null;
  }

  async listSessions(): Promise<SessionData[]> {
    const items = await this.queryAll({
      TableName: this.tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      // Belt and braces only: reminders live in the disjoint `DUE#` partition
      // space, so an equality match on `USER#<sub>` cannot reach them in the first
      // place. That, not this filter, is the guarantee — but the read capacity is
      // already spent, so anything that ever gained a stray gsi1pk in the user
      // partition surfaces as a bug here rather than as a ghost in the sidebar.
      FilterExpression: 'entityType = :entityType',
      ExpressionAttributeValues: {
        ':pk': userGsi1pk(this.userId),
        ':entityType': 'Session',
      },
      // Newest first: gsi1sk is TS#<createdAt>#<id>, so descending is reverse
      // chronological with no client-side sort.
      ScanIndexForward: false,
    });

    return items.map(toSessionData);
  }

  async updateSessionMeta(sessionId: string, patch: SessionMetaPatch): Promise<void> {
    const sets: string[] = [];
    const values: Record<string, unknown> = {};

    if (patch.title !== undefined) {
      sets.push('title = :title');
      values[':title'] = patch.title;
    }
    if (patch.partnerName !== undefined) {
      sets.push('partnerName = :partnerName');
      values[':partnerName'] = patch.partnerName;
    }
    if (sets.length === 0) return;

    await this.updateSessionIfExists(sessionId, `SET ${sets.join(', ')}`, values);
  }

  async endSession(sessionId: string): Promise<void> {
    await this.updateSessionIfExists(sessionId, 'SET endedAt = :endedAt', {
      ':endedAt': new Date().toISOString(),
    });
    logger.info('session.ended', { sessionId });
  }

  async clearSession(sessionId: string): Promise<void> {
    const prefKeys = await this.collectItemKeys(sessionId, PREF_PREFIX);
    const msgKeys = await this.collectItemKeys(sessionId, MSG_PREFIX);
    // People, tasks and manual values are as much "what Valentin knows" as the
    // preferences are. A reset that left her family standing would look to the
    // user like the reset had failed.
    const otherKeys = await this.collectOwnedItemKeys(sessionId);

    await this.batchDeleteAll([...prefKeys, ...msgKeys, ...otherKeys]);

    // Zero the counters rather than decrementing, and tolerate a missing session
    // so the documented "no-op for unknown session ids" actually holds.
    await this.updateSessionIfExists(
      sessionId,
      'SET messageCount = :zero, preferenceCount = :zero, partnerName = :null',
      { ':zero': 0, ':null': null },
    );

    logger.info('session.cleared', {
      sessionId,
      preferencesDeleted: prefKeys.length,
      messagesDeleted: msgKeys.length,
      recordsDeleted: otherKeys.length,
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    // Everything for a session shares one partition, so one query per prefix
    // plus the meta row covers it.
    const keys = [
      ...(await this.collectItemKeys(sessionId, PREF_PREFIX)),
      ...(await this.collectItemKeys(sessionId, MSG_PREFIX)),
      ...(await this.collectOwnedItemKeys(sessionId)),
      { pk: sessionPk(this.userId, sessionId), sk: META_SK },
    ];

    await this.batchDeleteAll(keys);
    logger.info('session.deleted', { sessionId, itemsDeleted: keys.length });
  }

  // --- Messages ---

  async saveMessage(msg: ChatMessage): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: this.withTtl({
          pk: sessionPk(this.userId, msg.sessionId),
          sk: msgSk(msg.timestamp, msg.id),
          id: msg.id,
          sessionId: msg.sessionId,
          sender: msg.sender,
          content: msg.content,
          timestamp: msg.timestamp,
          entityType: 'Message',
        }),
      }),
    );

    // ADD, not `SET messageCount = messageCount + :inc`. The latter throws
    // ValidationException whenever the attribute is absent, which is every
    // session the previous store created — it wrote counters at creation but
    // then also upserted meta rows that had none.
    await this.updateSessionIfExists(
      msg.sessionId,
      'SET lastActivity = :now ADD messageCount :inc',
      { ':inc': 1, ':now': msg.timestamp },
    );
  }

  async getMessagesBySession(sessionId: string): Promise<ChatMessage[]> {
    const items = await this.queryAll({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': sessionPk(this.userId, sessionId),
        ':prefix': MSG_PREFIX,
      },
    });

    return items.map((item) => ({
      id: item.id as string,
      sessionId: item.sessionId as string,
      sender: item.sender as ChatMessage['sender'],
      content: item.content as string,
      timestamp: item.timestamp as string,
    }));
  }

  // --- Preferences ---

  async savePreference(
    pref: Omit<Preference, 'id' | 'createdAt' | 'updatedAt'> & {
      sourceMessageId: string;
    },
  ): Promise<PreferenceWithHistory> {
    const [record] = await this.savePreferencesBatch(pref.sessionId, [
      {
        category: pref.category,
        key: pref.key,
        // Was dropped on the floor here, so every live-extracted row in DynamoDB
        // persisted `fieldId: null` and the client fell back to fuzzy category+key
        // resolution to work out which profile field it belonged to. The batch below
        // has always read it; only this single-row path forgot to pass it on.
        // `InMemoryStore.savePreference` does pass it, which is exactly why no unit
        // test caught the divergence.
        fieldId: pref.fieldId ?? null,
        value: pref.value,
        confidence: pref.confidence,
        sourceMessageId: pref.sourceMessageId,
      },
    ]);
    return record;
  }

  async savePreferencesBatch(
    sessionId: string,
    prefs: readonly PreferenceInput[],
  ): Promise<PreferenceWithHistory[]> {
    if (prefs.length === 0) return [];

    const now = new Date().toISOString();
    const pk = sessionPk(this.userId, sessionId);

    const records = prefs.map<PreferenceWithHistory>((pref) => ({
      id: crypto.randomUUID(),
      sessionId,
      category: pref.category,
      key: pref.key,
      fieldId: pref.fieldId ?? null,
      value: pref.value,
      confidence: pref.confidence,
      sourceMessageId: pref.sourceMessageId,
      createdAt: now,
      updatedAt: now,
      history: [],
    }));

    // Timed across the writes and the counter update, because both are what a
    // save actually costs. `span-bridge.ts` reads this duration for the DynamoDB
    // node in the architecture drawer; the store itself knows nothing about that.
    const startedAt = Date.now();

    for (const batch of chunk(records, BATCH_WRITE_LIMIT)) {
      await this.batchWrite(
        batch.map((record) => ({
          PutRequest: {
            Item: this.withTtl({
              pk,
              sk: prefSk(record.category, record.key),
              ...record,
              entityType: 'Preference',
            }),
          },
        })),
      );
    }

    // One counter update for the whole batch rather than one per preference.
    await this.updateSessionIfExists(
      sessionId,
      'SET lastActivity = :now ADD preferenceCount :inc',
      { ':inc': records.length, ':now': now },
    );

    // `category` and `durationMs` are read by `span-bridge.ts`, and `userId` is
    // what lets a single process-wide bridge route the span to the right socket
    // without becoming a cross-tenant leak. A batch spans one session, so the
    // first record's category is representative enough for a `PREF#…` label —
    // and only the category is ever logged, never a value.
    logger.info('preference.saved', {
      sessionId,
      userId: this.userId,
      count: records.length,
      category: records[0]?.category,
      durationMs: Date.now() - startedAt,
    });
    return records;
  }

  async updatePreference(
    ref: PreferenceRef,
    update: Partial<Pick<Preference, 'value' | 'confidence' | 'sourceMessageId'>>,
  ): Promise<PreferenceWithHistory> {
    const existing = await this.findPreference(ref.sessionId, ref.category, ref.key);
    if (!existing) {
      throw new Error(
        `Preference not found: ${ref.sessionId}/${ref.category}/${ref.key}`,
      );
    }

    const now = new Date().toISOString();
    const historyEntry: PreferenceHistoryEntry = {
      previousValue: existing.value,
      changedAt: now,
      sourceMessageId: update.sourceMessageId ?? existing.sourceMessageId,
    };

    const next: PreferenceWithHistory = {
      ...existing,
      value: update.value ?? existing.value,
      confidence: update.confidence ?? existing.confidence,
      sourceMessageId: update.sourceMessageId ?? existing.sourceMessageId,
      updatedAt: now,
      history: [...existing.history, historyEntry],
    };

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: sessionPk(this.userId, ref.sessionId), sk: prefSk(ref.category, ref.key) },
        UpdateExpression:
          'SET #val = :val, confidence = :conf, sourceMessageId = :src, updatedAt = :now, history = :hist',
        // A revision must not resurrect a preference that was deleted between
        // the read above and this write.
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeNames: { '#val': 'value' },
        ExpressionAttributeValues: {
          ':val': next.value,
          ':conf': next.confidence,
          ':src': next.sourceMessageId,
          ':now': now,
          ':hist': next.history,
        },
      }),
    );

    // Deliberately no counter change: revising a preference does not add one.
    // The store this replaced used a plain Put here, which wiped `history` while
    // still incrementing preferenceCount on every revision.
    return next;
  }

  async getPreferencesBySession(sessionId: string): Promise<PreferenceWithHistory[]> {
    const items = await this.queryAll({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': sessionPk(this.userId, sessionId),
        ':prefix': PREF_PREFIX,
      },
    });

    return items.map(toPreferenceWithHistory);
  }

  async findPreference(
    sessionId: string,
    category: PreferenceCategory,
    key: string,
  ): Promise<PreferenceWithHistory | null> {
    // A GetItem, because the natural key *is* the primary key. This is the query
    // the old schema could not express, which is why it reached for an illegal
    // begins_with on a GSI partition key.
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: sessionPk(this.userId, sessionId),
          sk: prefSk(category, key),
        },
      }),
    );

    return result.Item ? toPreferenceWithHistory(result.Item) : null;
  }

  // --- Her people ---

  async savePerson(sessionId: string, person: Person): Promise<Person> {
    const [saved] = await this.savePeopleBatch(sessionId, [person]);
    return saved;
  }

  async savePeopleBatch(sessionId: string, people: readonly Person[]): Promise<Person[]> {
    if (people.length === 0) return [];

    const pk = sessionPk(this.userId, sessionId);
    const now = new Date().toISOString();
    const records = people.map<Person>((person) => ({ ...person, updatedAt: now }));

    for (const batch of chunk(records, BATCH_WRITE_LIMIT)) {
      await this.batchWrite(
        batch.map((record) => ({
          PutRequest: {
            Item: this.withTtl({
              pk,
              sk: personSk(record.id),
              sessionId,
              ...record,
              entityType: 'Person',
            }),
          },
        })),
      );
    }

    // Touched, but not counted: `preferenceCount` drives "21 of 21" and a family
    // is not a profile field. Incrementing it would inflate a number the board
    // reads as field coverage.
    await this.updateSessionIfExists(sessionId, 'SET lastActivity = :now', { ':now': now });

    logger.info('people.saved', { sessionId, userId: this.userId, count: records.length });
    return records;
  }

  async getPeopleBySession(sessionId: string): Promise<Person[]> {
    const items = await this.queryAll({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': sessionPk(this.userId, sessionId),
        ':prefix': PERSON_PREFIX,
      },
    });

    return items.map(toPerson);
  }

  async deletePerson(sessionId: string, personId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: sessionPk(this.userId, sessionId), sk: personSk(personId) },
      }),
    );
  }

  // --- What to do next ---

  async saveTask(sessionId: string, task: Task): Promise<Task> {
    const [saved] = await this.saveTasksBatch(sessionId, [task]);
    return saved;
  }

  async saveTasksBatch(sessionId: string, tasks: readonly Task[]): Promise<Task[]> {
    if (tasks.length === 0) return [];

    const pk = sessionPk(this.userId, sessionId);
    const now = new Date().toISOString();
    const records = tasks.map<Task>((task) => ({ ...task, updatedAt: now }));

    for (const batch of chunk(records, BATCH_WRITE_LIMIT)) {
      await this.batchWrite(
        batch.map((record) => ({
          PutRequest: {
            Item: this.withTtl({
              pk,
              sk: taskSk(record.id),
              sessionId,
              ...record,
              entityType: 'Task',
            }),
          },
        })),
      );
    }

    await this.updateSessionIfExists(sessionId, 'SET lastActivity = :now', { ':now': now });
    return records;
  }

  async getTasksBySession(sessionId: string): Promise<Task[]> {
    const items = await this.queryAll({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': sessionPk(this.userId, sessionId),
        ':prefix': TASK_PREFIX,
      },
    });

    return items.map(toTask);
  }

  async deleteTask(sessionId: string, taskId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: sessionPk(this.userId, sessionId), sk: taskSk(taskId) },
      }),
    );
  }

  // --- Where he has taken her ---

  async saveOuting(sessionId: string, outing: Outing): Promise<Outing> {
    const [saved] = await this.saveOutingsBatch(sessionId, [outing]);
    return saved;
  }

  async saveOutingsBatch(sessionId: string, outings: readonly Outing[]): Promise<Outing[]> {
    if (outings.length === 0) return [];

    const pk = sessionPk(this.userId, sessionId);
    const now = new Date().toISOString();

    for (const batch of chunk(outings, BATCH_WRITE_LIMIT)) {
      await this.batchWrite(
        batch.map((record) => ({
          PutRequest: {
            Item: this.withTtl({
              pk,
              sk: outingSk(record.id),
              sessionId,
              ...record,
              entityType: 'Outing',
            }),
          },
        })),
      );
    }

    await this.updateSessionIfExists(sessionId, 'SET lastActivity = :now', { ':now': now });
    // The rows as given, not as re-stamped: unlike a task, neither timestamp on an
    // outing is "when we last touched it".
    return [...outings];
  }

  async getOutingsBySession(sessionId: string): Promise<Outing[]> {
    const items = await this.queryAll({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': sessionPk(this.userId, sessionId),
        ':prefix': OUTING_PREFIX,
      },
    });

    return items.map(toOuting);
  }

  async deleteOuting(sessionId: string, outingId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: sessionPk(this.userId, sessionId), sk: outingSk(outingId) },
      }),
    );
  }

  // --- What he is going to be reminded about ---

  async saveReminder(sessionId: string, reminder: Reminder): Promise<Reminder> {
    // The owner and the conversation come from the store's own scope rather than
    // from the record. Both are on the row for the dispatcher's benefit, and a row
    // in this partition claiming a different owner is a row `markSent` would look
    // for in a partition that has no such item.
    const record: Reminder = { ...reminder, sessionId, userId: this.userId };
    const dueAt = new Date(record.dueAt);

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: this.withTtl({
          pk: sessionPk(this.userId, sessionId),
          sk: reminderSk(record.id),
          ...record,
          entityType: 'Reminder',
          // Pending means the attribute is *absent*, not present and NULL.
          // `markSent` and `recordFailure` both guard on
          // `attribute_not_exists(sentAt)`, and DynamoDB counts a stored NULL as
          // existing — so a row spelling out `sentAt: null` could never be claimed
          // and every reminder would sit in the index for ever, unsendable.
          // `toReminder` reads the absence back as null, so the interface is
          // unchanged either way. (`removeUndefinedValues` is what drops it.)
          sentAt: record.sentAt ?? undefined,
          // Only a *pending* reminder belongs in the due-index. Re-putting a sent
          // row with these attributes would put it back in front of the poller and
          // mail the same birthday again.
          //
          // Both halves come from the UTC instant, never from the local calendar
          // fields the reminder was planned in: 09:00 Asia/Jerusalem is 06:00 UTC,
          // and a bucket named after the local date would land in a partition the
          // sweep never reads.
          ...(record.sentAt
            ? {}
            : {
                gsi1pk: dueGsi1pk(utcDayOf(dueAt)),
                gsi1sk: reminderGsi1sk(utcClockOf(dueAt), record.id),
              }),
        }),
      }),
    );

    await this.updateSessionIfExists(sessionId, 'SET lastActivity = :now', {
      ':now': new Date().toISOString(),
    });

    return record;
  }

  async getRemindersBySession(sessionId: string): Promise<Reminder[]> {
    const items = await this.queryAll({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': sessionPk(this.userId, sessionId),
        ':prefix': REMINDER_PREFIX,
      },
    });

    return items.map(toReminder);
  }

  async deleteReminder(sessionId: string, reminderId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: sessionPk(this.userId, sessionId), sk: reminderSk(reminderId) },
      }),
    );
  }

  // --- Corrections the user made by hand ---

  async setManualValue(sessionId: string, fieldId: string, value: string): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: this.withTtl({
          pk: sessionPk(this.userId, sessionId),
          sk: manualSk(fieldId),
          sessionId,
          fieldId,
          value,
          updatedAt: new Date().toISOString(),
          entityType: 'ManualValue',
        }),
      }),
    );
  }

  async getManualValues(sessionId: string): Promise<Record<string, string>> {
    const items = await this.queryAll({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': sessionPk(this.userId, sessionId),
        ':prefix': MANUAL_PREFIX,
      },
    });

    const values: Record<string, string> = {};
    for (const item of items) {
      const fieldId = item.fieldId as string | undefined;
      const value = item.value as string | undefined;
      if (fieldId && typeof value === 'string') values[fieldId] = value;
    }
    return values;
  }

  async clearManualValue(sessionId: string, fieldId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: sessionPk(this.userId, sessionId), sk: manualSk(fieldId) },
      }),
    );
  }

  // --- Helpers ---

  /** Attach the table's `ttl` attribute when this store was given a lifetime */
  private withTtl<T extends Record<string, unknown>>(item: T): T {
    if (this.ttlSeconds === undefined) return item;
    return {
      ...item,
      // Epoch *seconds*, which is what DynamoDB's TTL reads. Milliseconds here
      // would put every expiry ~50,000 years out and quietly disable the whole
      // feature.
      ttl: Math.floor(Date.now() / 1000) + this.ttlSeconds,
    };
  }

  /** Run a Query to exhaustion — see {@link queryAllPages} */
  private async queryAll(
    input: ConstructorParameters<typeof QueryCommand>[0],
  ): Promise<Record<string, unknown>[]> {
    return queryAllPages(this.docClient, input);
  }

  /** Query every key under a session partition matching an sk prefix */
  private async collectItemKeys(
    sessionId: string,
    skPrefix: string,
  ): Promise<ItemKey[]> {
    const items = await this.queryAll({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ProjectionExpression: 'pk, sk',
      ExpressionAttributeValues: {
        ':pk': sessionPk(this.userId, sessionId),
        ':prefix': skPrefix,
      },
    });

    return items.map((item) => ({ pk: item.pk as string, sk: item.sk as string }));
  }

  /**
   * Keys of every person, task, outing, reminder and manual value in a session.
   *
   * Kept as one helper rather than five call-site queries so that adding another
   * item type later cannot leave one of the two session sweeps behind — an item
   * missed by `deleteSession` outlives the session that owned it and is then
   * unreachable, since nothing will ever query that partition again.
   *
   * A missed *reminder* is worse than unreachable. Its index row stays in the
   * `DUE#` partition, so the dispatcher keeps finding it and keeps mailing someone
   * about a conversation that no longer exists.
   */
  private async collectOwnedItemKeys(sessionId: string): Promise<ItemKey[]> {
    const keys: ItemKey[] = [];
    for (const prefix of [
      PERSON_PREFIX,
      TASK_PREFIX,
      OUTING_PREFIX,
      REMINDER_PREFIX,
      MANUAL_PREFIX,
    ]) {
      keys.push(...(await this.collectItemKeys(sessionId, prefix)));
    }
    return keys;
  }

  /** Delete an unbounded set of keys, chunked to the BatchWriteItem limit */
  private async batchDeleteAll(keys: readonly ItemKey[]): Promise<void> {
    for (const batch of chunk(keys, BATCH_WRITE_LIMIT)) {
      await this.batchWrite(batch.map((Key) => ({ DeleteRequest: { Key } })));
    }
  }

  /** Send one batch, retrying whatever DynamoDB declines to process */
  private async batchWrite(
    requests: readonly Record<string, unknown>[],
    attemptsLeft = BATCH_MAX_ATTEMPTS,
  ): Promise<void> {
    if (requests.length === 0) return;
    if (attemptsLeft <= 0) {
      throw new Error(
        `Failed to write ${requests.length} item(s) after ${BATCH_MAX_ATTEMPTS} attempts`,
      );
    }

    const result = await this.docClient.send(
      new BatchWriteCommand({
        RequestItems: { [this.tableName]: requests as never },
      }),
    );

    const unprocessed = result.UnprocessedItems?.[this.tableName] ?? [];
    if (unprocessed.length === 0) return;

    await this.batchWrite(
      unprocessed as unknown as Record<string, unknown>[],
      attemptsLeft - 1,
    );
  }

  /**
   * Update a session's meta item, treating "no such session" as a no-op.
   *
   * Without the condition, UpdateItem would *create* a stub session item for an
   * unknown id — an upsert nobody asked for, which is how a reset of a
   * non-existent session used to leave a half-formed row behind.
   */
  private async updateSessionIfExists(
    sessionId: string,
    updateExpression: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: sessionPk(this.userId, sessionId), sk: META_SK },
          UpdateExpression: updateExpression,
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeValues: values,
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        return;
      }
      throw err;
    }
  }
}

function toSessionData(item: Record<string, unknown>): SessionData {
  return {
    id: item.id as string,
    createdAt: item.createdAt as string,
    endedAt: (item.endedAt as string) ?? null,
    messageCount: (item.messageCount as number) ?? 0,
    preferenceCount: (item.preferenceCount as number) ?? 0,
    lastActivity: (item.lastActivity as string) ?? (item.createdAt as string),
    partnerName: (item.partnerName as string | null) ?? null,
    title: (item.title as string | null) ?? null,
  };
}

function toPreferenceWithHistory(item: Record<string, unknown>): PreferenceWithHistory {
  return {
    id: item.id as string,
    sessionId: item.sessionId as string,
    category: item.category as PreferenceCategory,
    key: item.key as string,
    // Absent on rows written before the field id existed — null, not undefined,
    // so the client's fallback path is taken deliberately rather than by accident.
    fieldId: (item.fieldId as string | null | undefined) ?? null,
    value: item.value as string,
    confidence: item.confidence as number,
    sourceMessageId: item.sourceMessageId as string,
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
    history: (item.history as PreferenceHistoryEntry[]) ?? [],
  };
}

function toPerson(item: Record<string, unknown>): Person {
  const generation = item.generation;
  return {
    id: item.id as string,
    // Empty string is not coerced to null here: `isGap` already treats a blank
    // name as a gap, so both spellings render the same dashed node, and folding
    // them would lose what was actually written.
    name: (item.name as string | null | undefined) ?? null,
    relationship: item.relationship as string,
    // A row written by an older build can carry a generation this one does not
    // know. Drawing her a rung off is a smaller loss than dropping her.
    generation: isPersonGeneration(generation)
      ? (generation as PersonGeneration)
      : DEFAULT_GENERATION,
    birthday: (item.birthday as string | null | undefined) ?? null,
    note: (item.note as string | null | undefined) ?? null,
    source: item.source === 'discovered' ? 'discovered' : 'manual',
    updatedAt: item.updatedAt as string,
  };
}

function toTask(item: Record<string, unknown>): Task {
  return {
    id: item.id as string,
    title: item.title as string,
    due: (item.due as string | null | undefined) ?? null,
    note: (item.note as string | null | undefined) ?? null,
    // Anything other than a stored `true` reads as open. A row missing the
    // attribute must not present as done, or the list silently forgets work.
    done: item.done === true,
    source: item.source === 'discovered' ? 'discovered' : 'manual',
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
  };
}

function toOuting(item: Record<string, unknown>): Outing {
  const rating = item.rating;
  return {
    id: item.id as string,
    venueSlug: (item.venueSlug as string | null | undefined) ?? null,
    venueName: item.venueName as string,
    city: (item.city as string | null | undefined) ?? null,
    occursOn: (item.occursOn as string | null | undefined) ?? null,
    confirmedAt: item.confirmedAt as string,
    // Only a real number survives. A stored string or a zero would both read as
    // "rated" downstream and suppress the survey for a row nobody has answered.
    rating: typeof rating === 'number' && rating >= 1 && rating <= 5 ? rating : null,
    verdict: isOutingVerdict(item.verdict) ? item.verdict : null,
    note: (item.note as string | null | undefined) ?? null,
    ratedAt: (item.ratedAt as string | null | undefined) ?? null,
  };
}

function toReminder(item: Record<string, unknown>): Reminder {
  const attempts = item.attempts;
  return {
    id: item.id as string,
    sessionId: item.sessionId as string,
    userId: item.userId as string,
    // A row written by an older build can name a kind this one has dropped.
    // Wording it as a generic occasion beats not mailing at all.
    kind: isReminderKind(item.kind) ? item.kind : 'occasion',
    occursOn: item.occursOn as string,
    dueAt: item.dueAt as string,
    leadDays: item.leadDays as number,
    occasion: item.occasion as string,
    // An unknown channel must not be honoured: `log` is a real channel that always
    // works, so an unrecognised value degrades to a delivered-and-visible reminder
    // rather than a silent one.
    channel: item.channel === 'gmail' ? 'gmail' : 'log',
    target: (item.target as string | null | undefined) ?? null,
    // `sentAt` decides whether the poller may still claim this row, so an absent
    // attribute must read as pending rather than as a falsy "sent".
    sentAt: (item.sentAt as string | null | undefined) ?? null,
    // A stored string would make `attempts + 1` a type error at the next failure.
    attempts: typeof attempts === 'number' ? attempts : 0,
    lastError: (item.lastError as string | null | undefined) ?? null,
    createdAt: item.createdAt as string,
  };
}

/**
 * Hands out user-scoped DynamoDB stores over one shared connection pool.
 *
 * This is what production injects into createServer. There is no unscoped store
 * variant, by design.
 *
 * It also carries {@link ReminderIndexReader}. That is not a hole in the scoping
 * argument, it is the point of it: the three methods below are *deliberately* the
 * unscoped side, and they are reachable only by something that was handed the
 * factory rather than a store. See the interface's own doc comment for why the
 * dispatcher's cross-user read must not sit on `StorageInterface` next to
 * `getSession` looking equally safe to call.
 */
export class DynamoDBStoreFactory implements ScopedStorageFactory, ReminderIndexReader {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(docClient?: DynamoDBDocumentClient, tableName?: string) {
    this.docClient = docClient ?? defaultDocClient();
    this.tableName = tableName ?? config.dynamoTableName;
  }

  forUser(userId: string, opts?: ScopedStorageOptions): StorageInterface {
    return new DynamoDBStore(userId, this.docClient, this.tableName, opts?.ttlSeconds);
  }

  // --- The due-index, across every user ---

  async dueBefore(at: Date, limit: number): Promise<Reminder[]> {
    /*
     * Two buckets, today's and yesterday's — and exactly two.
     *
     * A sweep running at 00:03 UTC must still find the reminder that came due at
     * 23:58, and a poller that only ever read `DUE#<today>` would skip the last
     * minutes of every single day: nothing would ever revisit them, because the
     * next sweep's "today" has moved on. Yesterday's bucket closes that seam.
     *
     * Reading further back deliberately is not done. Anything older than yesterday
     * means the dispatcher was down for a day or more, and that is a backlog — a
     * decision about what is still worth mailing, taken with a human in the loop.
     * A bounded sweep that quietly widened its window would instead discover a
     * month of missed anniversaries and send all of them at once.
     */
    const previous = new Date(at.getTime() - ONE_DAY_MS);

    const untilNow = await queryAllPages(this.docClient, {
      TableName: this.tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk <= :sk',
      ExpressionAttributeValues: {
        ':pk': dueGsi1pk(utcDayOf(at)),
        ':sk': reminderGsi1sk(utcClockOf(at), ID_SORT_SENTINEL),
      },
    });

    // The whole of the previous bucket: every row in it is due before every row in
    // today's, so there is nothing to bound it by.
    const yesterday = await queryAllPages(this.docClient, {
      TableName: this.tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': dueGsi1pk(utcDayOf(previous)) },
    });

    return (
      [...yesterday, ...untilNow]
        .map(toReminder)
        // The sort key is a clock time, so it bounds the bucket but does not prove
        // the instant: this compares the fact the dispatcher orders on.
        .filter((reminder) => new Date(reminder.dueAt).getTime() <= at.getTime())
        .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
        .slice(0, limit)
    );
  }

  async markSent(reminder: Reminder, sentAt: Date): Promise<boolean> {
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          // Back into the owner's partition, which is why `userId` is an attribute
          // on the row as well as a component of its key.
          Key: {
            pk: sessionPk(reminder.userId, reminder.sessionId),
            sk: reminderSk(reminder.id),
          },
          // The same write that stamps the send drops the row out of the due-index,
          // so a sent reminder becomes invisible to the poller instead of being
          // filtered out of every future sweep for ever.
          UpdateExpression: 'SET sentAt = :sentAt REMOVE gsi1pk, gsi1sk',
          // *This* is the idempotency guarantee, and it is why two containers can
          // sweep at once: both see the row, both attempt it, the condition admits
          // exactly one, and the loser is told so rather than erroring.
          ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(sentAt)',
          ExpressionAttributeValues: { ':sentAt': sentAt.toISOString() },
        }),
      );
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        // Already claimed, or already gone. Not an error: the send this caller was
        // about to make is precisely the one that must not happen twice.
        return false;
      }
      throw err;
    }
  }

  async recordFailure(reminder: Reminder, error: string): Promise<void> {
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: sessionPk(reminder.userId, reminder.sessionId),
            sk: reminderSk(reminder.id),
          },
          // No REMOVE of the index keys, and no write of them either: a row that was
          // never claimed stays visible to the next sweep, and a claimed one stays
          // out of the index.
          UpdateExpression:
            'SET attempts = if_not_exists(attempts, :zero) + :one, lastError = :error',
          /*
           * Deliberately *not* guarded on `sentAt`, which is the difference between
           * this and `markSent`. The dispatcher claims a row before it sends, so by
           * the time a send throws `sentAt` is already stamped — and an
           * `attribute_not_exists(sentAt)` guard here would make the entire failure
           * path a silent no-op: the row would look delivered, `attempts` would stay
           * 0 and the reason would live only in the logs. This expression writes
           * neither `sentAt` nor the index keys, so it cannot overwrite the record of
           * a send; it only annotates it.
           */
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeValues: {
            ':zero': 0,
            ':one': 1,
            ':error': error.slice(0, MAX_STORED_ERROR_CHARS),
          },
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        return;
      }
      throw err;
    }
  }
}
