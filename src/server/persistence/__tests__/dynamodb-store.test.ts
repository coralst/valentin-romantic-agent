import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynamoDBStore } from '../dynamodb-store';
import type { ChatMessage } from '../../../shared/interfaces/message';
import type { PreferenceCategory } from '../../../shared/interfaces/preference';

// Mock the DynamoDBDocumentClient
const mockSend = vi.fn();
const mockDocClient = { send: mockSend } as unknown as import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient;

describe('DynamoDBStore', () => {
  let store: DynamoDBStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new DynamoDBStore(mockDocClient, 'TestTable');
  });

  describe('createSession', () => {
    it('should create a session and return an id', async () => {
      mockSend.mockResolvedValueOnce({});

      const id = await store.createSession();

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.input.TableName).toBe('TestTable');
      expect(putCall.input.Item.pk).toBe('USER#anonymous');
      expect(putCall.input.Item.sk).toBe(`SESSION#${id}`);
      expect(putCall.input.Item.gsi1pk).toBe(`SESSION#${id}`);
      expect(putCall.input.Item.gsi1sk).toBe('META');
      expect(putCall.input.Item.entityType).toBe('Session');
    });
  });

  describe('getSession', () => {
    it('should return session data when found via GSI', async () => {
      const sessionId = 'test-session-123';
      const mockItem = {
        id: sessionId,
        createdAt: '2026-01-01T00:00:00.000Z',
        endedAt: null,
        messageCount: 5,
        preferenceCount: 3,
      };

      // First GetCommand returns nothing (direct lookup)
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // Then QueryCommand on GSI returns the item
      mockSend.mockResolvedValueOnce({ Items: [mockItem] });

      const result = await store.getSession(sessionId);

      expect(result).toEqual({
        id: sessionId,
        createdAt: '2026-01-01T00:00:00.000Z',
        endedAt: null,
        messageCount: 5,
        preferenceCount: 3,
      });
    });

    it('should return null when session not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await store.getSession('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('endSession', () => {
    it('should update the session with an endedAt timestamp', async () => {
      mockSend.mockResolvedValueOnce({});

      await store.endSession('session-abc');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const updateCall = mockSend.mock.calls[0][0];
      expect(updateCall.input.TableName).toBe('TestTable');
      expect(updateCall.input.Key).toEqual({
        pk: 'USER#anonymous',
        sk: 'SESSION#session-abc',
      });
      expect(updateCall.input.UpdateExpression).toBe('SET endedAt = :endedAt');
      expect(updateCall.input.ExpressionAttributeValues[':endedAt']).toBeDefined();
    });
  });

  describe('saveMessage', () => {
    it('should save a message with correct PK/SK pattern', async () => {
      mockSend.mockResolvedValue({});

      const msg: ChatMessage = {
        id: 'msg-1',
        sessionId: 'session-1',
        sender: 'user',
        content: 'Hello',
        timestamp: '2026-01-01T12:00:00.000Z',
      };

      await store.saveMessage(msg);

      // Two calls: PutCommand + UpdateCommand for count
      expect(mockSend).toHaveBeenCalledTimes(2);

      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.input.Item.pk).toBe('SESSION#session-1');
      expect(putCall.input.Item.sk).toBe('MSG#2026-01-01T12:00:00.000Z#msg-1');
      expect(putCall.input.Item.entityType).toBe('Message');
      expect(putCall.input.Item.sender).toBe('user');
      expect(putCall.input.Item.content).toBe('Hello');
    });
  });

  describe('getMessagesBySession', () => {
    it('should query messages with begins_with prefix', async () => {
      const mockItems = [
        { id: 'msg-1', sessionId: 's1', sender: 'user', content: 'Hi', timestamp: '2026-01-01T12:00:00.000Z' },
        { id: 'msg-2', sessionId: 's1', sender: 'agent', content: 'Hello!', timestamp: '2026-01-01T12:00:01.000Z' },
      ];
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const messages = await store.getMessagesBySession('s1');

      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe('msg-1');
      expect(messages[1].sender).toBe('agent');

      const queryCall = mockSend.mock.calls[0][0];
      expect(queryCall.input.KeyConditionExpression).toBe(
        'pk = :pk AND begins_with(sk, :prefix)',
      );
      expect(queryCall.input.ExpressionAttributeValues[':pk']).toBe('SESSION#s1');
      expect(queryCall.input.ExpressionAttributeValues[':prefix']).toBe('MSG#');
    });

    it('should return empty array when no messages found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const messages = await store.getMessagesBySession('empty-session');

      expect(messages).toEqual([]);
    });
  });

  describe('savePreference', () => {
    it('should save a preference with correct PK/SK pattern', async () => {
      mockSend.mockResolvedValue({});

      const result = await store.savePreference({
        sessionId: 's1',
        category: 'food' as PreferenceCategory,
        key: 'favorite_cuisine',
        value: 'Italian',
        confidence: 0.9,
        sourceMessageId: 'msg-1',
      });

      expect(result.id).toBeDefined();
      expect(result.category).toBe('food');
      expect(result.key).toBe('favorite_cuisine');
      expect(result.value).toBe('Italian');
      expect(result.confidence).toBe(0.9);
      expect(result.history).toEqual([]);

      // Two calls: PutCommand + UpdateCommand for count
      expect(mockSend).toHaveBeenCalledTimes(2);

      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.input.Item.pk).toBe('SESSION#s1');
      expect(putCall.input.Item.sk).toBe('PREF#food#favorite_cuisine');
      expect(putCall.input.Item.entityType).toBe('Preference');
    });
  });

  describe('updatePreference', () => {
    it('should update preference and append to history', async () => {
      const existingItem = {
        pk: 'SESSION#s1',
        sk: 'PREF#food#favorite_cuisine',
        id: 'pref-1',
        sessionId: 's1',
        category: 'food',
        key: 'favorite_cuisine',
        value: 'Italian',
        confidence: 0.9,
        sourceMessageId: 'msg-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        history: [],
      };

      // Query to find the preference by id
      mockSend.mockResolvedValueOnce({ Items: [existingItem] });
      // UpdateCommand
      mockSend.mockResolvedValueOnce({});

      const result = await store.updatePreference('pref-1', {
        value: 'Japanese',
        confidence: 0.95,
      });

      expect(result.value).toBe('Japanese');
      expect(result.confidence).toBe(0.95);
      expect(result.history).toHaveLength(1);
      expect(result.history[0].previousValue).toBe('Italian');
    });

    it('should throw when preference not found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await expect(store.updatePreference('nonexistent', { value: 'x' }))
        .rejects.toThrow('Preference not found: nonexistent');
    });
  });

  describe('getPreferencesBySession', () => {
    it('should query preferences with PREF# prefix', async () => {
      const mockItems = [
        {
          id: 'p1', sessionId: 's1', category: 'food', key: 'cuisine',
          value: 'Italian', confidence: 0.9, sourceMessageId: 'msg-1',
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
          history: [],
        },
        {
          id: 'p2', sessionId: 's1', category: 'music', key: 'genre',
          value: 'Jazz', confidence: 0.8, sourceMessageId: 'msg-2',
          createdAt: '2026-01-01T00:00:01.000Z', updatedAt: '2026-01-01T00:00:01.000Z',
          history: [],
        },
      ];
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const prefs = await store.getPreferencesBySession('s1');

      expect(prefs).toHaveLength(2);
      expect(prefs[0].category).toBe('food');
      expect(prefs[1].category).toBe('music');

      const queryCall = mockSend.mock.calls[0][0];
      expect(queryCall.input.ExpressionAttributeValues[':pk']).toBe('SESSION#s1');
      expect(queryCall.input.ExpressionAttributeValues[':prefix']).toBe('PREF#');
    });
  });

  describe('findPreference', () => {
    it('should get preference by composite key lookup', async () => {
      const mockItem = {
        id: 'p1', sessionId: 's1', category: 'food', key: 'cuisine',
        value: 'Italian', confidence: 0.9, sourceMessageId: 'msg-1',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        history: [],
      };
      mockSend.mockResolvedValueOnce({ Item: mockItem });

      const result = await store.findPreference('s1', 'food', 'cuisine');

      expect(result).not.toBeNull();
      expect(result!.value).toBe('Italian');

      const getCall = mockSend.mock.calls[0][0];
      expect(getCall.input.Key).toEqual({
        pk: 'SESSION#s1',
        sk: 'PREF#food#cuisine',
      });
    });

    it('should return null when preference not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await store.findPreference('s1', 'music', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('clearSession', () => {
    /** Build N projected PREF#/MSG# key items for a session partition */
    function keyItems(sessionId: string, prefix: string, count: number) {
      return Array.from({ length: count }, (_, i) => ({
        pk: `SESSION#${sessionId}`,
        sk: `${prefix}${i}`,
      }));
    }

    it('batch-deletes every PREF# and MSG# item for the session', async () => {
      mockSend.mockResolvedValueOnce({ Items: keyItems('s1', 'PREF#food#', 2) });
      mockSend.mockResolvedValueOnce({ Items: keyItems('s1', 'MSG#t#', 1) });
      mockSend.mockResolvedValueOnce({}); // BatchWrite
      mockSend.mockResolvedValueOnce({}); // counter reset

      await store.clearSession('s1');

      const batchCall = mockSend.mock.calls[2][0];
      const requests = batchCall.input.RequestItems.TestTable;
      expect(requests).toHaveLength(3);
      expect(requests[0].DeleteRequest.Key).toEqual({
        pk: 'SESSION#s1',
        sk: 'PREF#food#0',
      });
      expect(requests[2].DeleteRequest.Key).toEqual({
        pk: 'SESSION#s1',
        sk: 'MSG#t#0',
      });
    });

    it('queries the session partition with PREF# and MSG# sk prefixes', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({});

      await store.clearSession('s1');

      const prefQuery = mockSend.mock.calls[0][0];
      const msgQuery = mockSend.mock.calls[1][0];
      expect(prefQuery.input.ExpressionAttributeValues[':pk']).toBe('SESSION#s1');
      expect(prefQuery.input.ExpressionAttributeValues[':prefix']).toBe('PREF#');
      expect(msgQuery.input.ExpressionAttributeValues[':prefix']).toBe('MSG#');
    });

    it('resets the session counters to zero', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({});

      await store.clearSession('s1');

      const updateCall = mockSend.mock.calls[2][0];
      expect(updateCall.input.Key).toEqual({
        pk: 'USER#anonymous',
        sk: 'SESSION#s1',
      });
      expect(updateCall.input.UpdateExpression).toContain('messageCount = :zero');
      expect(updateCall.input.UpdateExpression).toContain('preferenceCount = :zero');
      expect(updateCall.input.ExpressionAttributeValues[':zero']).toBe(0);
    });

    it('skips the batch write when the session has no items', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({});

      await store.clearSession('s1');

      // 2 queries + 1 counter reset, no BatchWrite
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('chunks deletes into batches of 25', async () => {
      mockSend.mockResolvedValueOnce({ Items: keyItems('s1', 'PREF#food#', 30) });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({}); // first BatchWrite
      mockSend.mockResolvedValueOnce({}); // second BatchWrite
      mockSend.mockResolvedValueOnce({}); // counter reset

      await store.clearSession('s1');

      expect(
        mockSend.mock.calls[2][0].input.RequestItems.TestTable,
      ).toHaveLength(25);
      expect(
        mockSend.mock.calls[3][0].input.RequestItems.TestTable,
      ).toHaveLength(5);
    });

    it('retries keys DynamoDB reports as unprocessed', async () => {
      const unprocessedKey = { pk: 'SESSION#s1', sk: 'PREF#food#1' };
      mockSend.mockResolvedValueOnce({ Items: keyItems('s1', 'PREF#food#', 2) });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({
        UnprocessedItems: {
          TestTable: [{ DeleteRequest: { Key: unprocessedKey } }],
        },
      });
      mockSend.mockResolvedValueOnce({}); // retry succeeds
      mockSend.mockResolvedValueOnce({}); // counter reset

      await store.clearSession('s1');

      const retryCall = mockSend.mock.calls[3][0];
      const retryRequests = retryCall.input.RequestItems.TestTable;
      expect(retryRequests).toHaveLength(1);
      expect(retryRequests[0].DeleteRequest.Key).toEqual(unprocessedKey);
    });

    it('throws when unprocessed keys persist past the retry limit', async () => {
      mockSend.mockResolvedValueOnce({ Items: keyItems('s1', 'PREF#food#', 1) });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValue({
        UnprocessedItems: {
          TestTable: [
            { DeleteRequest: { Key: { pk: 'SESSION#s1', sk: 'PREF#food#0' } } },
          ],
        },
      });

      await expect(store.clearSession('s1')).rejects.toThrow(/after 5 attempts/);
    });
  });

  describe('key generation patterns', () => {
    it('generates correct session PK/SK', async () => {
      mockSend.mockResolvedValue({});
      const id = await store.createSession();
      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.input.Item.pk).toMatch(/^USER#anonymous$/);
      expect(putCall.input.Item.sk).toMatch(/^SESSION#[0-9a-f-]+$/);
      expect(putCall.input.Item.gsi1pk).toBe(`SESSION#${id}`);
    });

    it('generates correct message SK with timestamp ordering', async () => {
      mockSend.mockResolvedValue({});
      const msg: ChatMessage = {
        id: 'abc-123',
        sessionId: 'sess-1',
        sender: 'user',
        content: 'test',
        timestamp: '2026-06-15T10:30:00.000Z',
      };
      await store.saveMessage(msg);
      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.input.Item.sk).toBe('MSG#2026-06-15T10:30:00.000Z#abc-123');
    });

    it('generates correct preference composite SK', async () => {
      mockSend.mockResolvedValue({});
      await store.savePreference({
        sessionId: 'sess-1',
        category: 'love_language',
        key: 'primary',
        value: 'quality_time',
        confidence: 0.85,
        sourceMessageId: 'msg-5',
      });
      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.input.Item.sk).toBe('PREF#love_language#primary');
    });
  });
});
