import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ChatMessage } from '../../shared/interfaces/message';
import type {
  Preference,
  PreferenceCategory,
  PreferenceHistoryEntry,
  PreferenceWithHistory,
} from '../../shared/interfaces/preference';
import type { SessionData } from '../../shared/interfaces/session';
import type { StorageInterface } from './storage-interface';
import { config } from '../config';
import { logger } from '../logging';

/** DynamoDB single-table implementation of StorageInterface */
export class DynamoDBStore implements StorageInterface {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(docClient?: DynamoDBDocumentClient, tableName?: string) {
    if (docClient) {
      this.docClient = docClient;
    } else {
      const ddbClient = new DynamoDBClient({ region: config.awsRegion });
      this.docClient = DynamoDBDocumentClient.from(ddbClient, {
        marshallOptions: { removeUndefinedValues: true },
      });
    }
    this.tableName = tableName ?? config.dynamoTableName;
  }

  // --- Session ---

  async createSession(): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const item = {
      pk: 'USER#anonymous',
      sk: `SESSION#${id}`,
      gsi1pk: `SESSION#${id}`,
      gsi1sk: 'META',
      id,
      createdAt: now,
      endedAt: null,
      messageCount: 0,
      preferenceCount: 0,
      entityType: 'Session',
    };

    await this.docClient.send(
      new PutCommand({ TableName: this.tableName, Item: item }),
    );

    logger.info('session.created', { sessionId: id });
    return id;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `SESSION#${sessionId}`, sk: 'META' },
      }),
    );

    // Try GSI1 lookup pattern: gsi1pk=SESSION#<id>, gsi1sk=META
    // Since we stored with pk=USER#anonymous, sk=SESSION#<id>,
    // and gsi1pk=SESSION#<id>, gsi1sk=META — query the GSI
    if (!result.Item) {
      const queryResult = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk = :sk',
          ExpressionAttributeValues: {
            ':pk': `SESSION#${sessionId}`,
            ':sk': 'META',
          },
        }),
      );
      const item = queryResult.Items?.[0];
      if (!item) return null;
      return this.toSessionData(item);
    }

    return this.toSessionData(result.Item);
  }

  async endSession(sessionId: string): Promise<void> {
    const now = new Date().toISOString();

    // We need to update the item using its primary key pattern
    // The session is stored with pk=USER#anonymous, sk=SESSION#<id>
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: 'USER#anonymous', sk: `SESSION#${sessionId}` },
        UpdateExpression: 'SET endedAt = :endedAt',
        ExpressionAttributeValues: { ':endedAt': now },
      }),
    );

    logger.info('session.ended', { sessionId });
  }

  // --- Messages ---

  async saveMessage(msg: ChatMessage): Promise<void> {
    const item = {
      pk: `SESSION#${msg.sessionId}`,
      sk: `MSG#${msg.timestamp}#${msg.id}`,
      id: msg.id,
      sessionId: msg.sessionId,
      sender: msg.sender,
      content: msg.content,
      timestamp: msg.timestamp,
      entityType: 'Message',
    };

    await this.docClient.send(
      new PutCommand({ TableName: this.tableName, Item: item }),
    );

    // Increment session message count
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: 'USER#anonymous', sk: `SESSION#${msg.sessionId}` },
        UpdateExpression: 'SET messageCount = messageCount + :inc',
        ExpressionAttributeValues: { ':inc': 1 },
      }),
    );
  }

  async getMessagesBySession(sessionId: string): Promise<ChatMessage[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `SESSION#${sessionId}`,
          ':prefix': 'MSG#',
        },
      }),
    );

    return (result.Items ?? []).map((item) => ({
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
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const record: PreferenceWithHistory = {
      id,
      sessionId: pref.sessionId,
      category: pref.category,
      key: pref.key,
      value: pref.value,
      confidence: pref.confidence,
      sourceMessageId: pref.sourceMessageId,
      createdAt: now,
      updatedAt: now,
      history: [],
    };

    const item = {
      pk: `SESSION#${pref.sessionId}`,
      sk: `PREF#${pref.category}#${pref.key}`,
      gsi1pk: `SESSION#${pref.sessionId}`,
      gsi1sk: `PREF#${pref.category}#${pref.key}`,
      ...record,
      entityType: 'Preference',
    };

    await this.docClient.send(
      new PutCommand({ TableName: this.tableName, Item: item }),
    );

    // Increment session preference count
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: 'USER#anonymous', sk: `SESSION#${pref.sessionId}` },
        UpdateExpression: 'SET preferenceCount = preferenceCount + :inc',
        ExpressionAttributeValues: { ':inc': 1 },
      }),
    );

    logger.info('preference.saved', { sessionId: pref.sessionId, category: pref.category, key: pref.key });
    return record;
  }

  async updatePreference(
    id: string,
    update: Partial<Pick<Preference, 'value' | 'confidence' | 'sourceMessageId'>>,
  ): Promise<PreferenceWithHistory> {
    // First, find the existing preference by querying for it
    // We need to look it up — since the PK/SK don't include the ID, we must
    // find which item has this ID. In production, you'd maintain an ID-to-key index.
    // For now, scan preferences with the GSI
    // This is acceptable since preferences per session are bounded.
    const scanResult = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'begins_with(gsi1pk, :prefix)',
        FilterExpression: 'id = :id',
        ExpressionAttributeValues: {
          ':prefix': 'SESSION#',
          ':id': id,
        },
      }),
    );

    // Fallback: broader search if the above yields nothing (GSI requires exact key)
    // We'll use a different approach: maintain the previous item in the update call
    // Actually, the proper approach for DynamoDB is that callers know the session context.
    // For the interface contract, we locate via attributes.
    const item = scanResult.Items?.[0];
    if (!item) {
      throw new Error(`Preference not found: ${id}`);
    }

    const existing = this.toPreferenceWithHistory(item);
    const now = new Date().toISOString();

    const historyEntry: PreferenceHistoryEntry = {
      previousValue: existing.value,
      changedAt: now,
      sourceMessageId: update.sourceMessageId ?? existing.sourceMessageId,
    };

    const newHistory = [...existing.history, historyEntry];
    const newValue = update.value ?? existing.value;
    const newConfidence = update.confidence ?? existing.confidence;
    const newSourceMessageId = update.sourceMessageId ?? existing.sourceMessageId;

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: item.pk as string, sk: item.sk as string },
        UpdateExpression:
          'SET #val = :val, confidence = :conf, sourceMessageId = :src, updatedAt = :now, history = :hist',
        ExpressionAttributeNames: { '#val': 'value' },
        ExpressionAttributeValues: {
          ':val': newValue,
          ':conf': newConfidence,
          ':src': newSourceMessageId,
          ':now': now,
          ':hist': newHistory,
        },
      }),
    );

    return {
      ...existing,
      value: newValue,
      confidence: newConfidence,
      sourceMessageId: newSourceMessageId,
      updatedAt: now,
      history: newHistory,
    };
  }

  async getPreferencesBySession(sessionId: string): Promise<PreferenceWithHistory[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `SESSION#${sessionId}`,
          ':prefix': 'PREF#',
        },
      }),
    );

    return (result.Items ?? []).map((item) => this.toPreferenceWithHistory(item));
  }

  async findPreference(
    sessionId: string,
    category: PreferenceCategory,
    key: string,
  ): Promise<PreferenceWithHistory | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `SESSION#${sessionId}`,
          sk: `PREF#${category}#${key}`,
        },
      }),
    );

    if (!result.Item) return null;
    return this.toPreferenceWithHistory(result.Item);
  }

  // --- Helpers ---

  private toSessionData(item: Record<string, unknown>): SessionData {
    return {
      id: item.id as string,
      createdAt: item.createdAt as string,
      endedAt: (item.endedAt as string) ?? null,
      messageCount: (item.messageCount as number) ?? 0,
      preferenceCount: (item.preferenceCount as number) ?? 0,
    };
  }

  private toPreferenceWithHistory(item: Record<string, unknown>): PreferenceWithHistory {
    return {
      id: item.id as string,
      sessionId: item.sessionId as string,
      category: item.category as PreferenceCategory,
      key: item.key as string,
      value: item.value as string,
      confidence: item.confidence as number,
      sourceMessageId: item.sourceMessageId as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
      history: (item.history as PreferenceHistoryEntry[]) ?? [],
    };
  }
}
