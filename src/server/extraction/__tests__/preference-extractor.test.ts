import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreferenceExtractor } from '../preference-extractor';
import { mapCategory } from '../category-mapper';
import type { BedrockClient } from '../../agent/bedrock-client';
import type { StorageInterface } from '../../persistence/storage-interface';
import type { ChatMessage } from '../../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

function createMockBedrock(): BedrockClient {
  return {
    generateResponse: vi.fn(),
    extractWithTool: vi.fn().mockResolvedValue({
      toolName: 'extract_preferences',
      input: { preferences: [] },
    }),
  };
}

function createMockStorage(): StorageInterface {
  return {
    createSession: vi.fn(),
    getSession: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    updateSessionMeta: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn(),
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
    saveMessage: vi.fn(),
    getMessagesBySession: vi.fn(),
    savePreference: vi.fn().mockImplementation(async (pref) => ({
      id: 'pref-new',
      ...pref,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    })),
    savePreferencesBatch: vi.fn().mockResolvedValue([]),
    updatePreference: vi.fn().mockImplementation(async (ref, update) => ({
      id: 'pref-existing',
      sessionId: ref.sessionId,
      category: ref.category,
      key: ref.key,
      value: update.value ?? 'old',
      confidence: update.confidence ?? 0.8,
      sourceMessageId: update.sourceMessageId ?? 'msg-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{ previousValue: 'old-value', changedAt: new Date().toISOString(), sourceMessageId: 'msg-0' }],
    })),
    getPreferencesBySession: vi.fn().mockResolvedValue([]),
    findPreference: vi.fn().mockResolvedValue(null),
    // Echoing the record back rather than returning undefined: the extractor
    // forwards what the store returns to the client, so a stub that swallowed it
    // would let a broken forward pass.
    savePerson: vi.fn().mockImplementation(async (_sessionId, person) => person),
    savePeopleBatch: vi.fn().mockResolvedValue([]),
    getPeopleBySession: vi.fn().mockResolvedValue([]),
    deletePerson: vi.fn().mockResolvedValue(undefined),
    saveTask: vi.fn().mockImplementation(async (_sessionId, task) => task),
    saveTasksBatch: vi.fn().mockResolvedValue([]),
    getTasksBySession: vi.fn().mockResolvedValue([]),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    setManualValue: vi.fn().mockResolvedValue(undefined),
    getManualValues: vi.fn().mockResolvedValue({}),
    clearManualValue: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 'sess-1',
    sender: 'user',
    content: 'She loves Italian food',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('PreferenceExtractor', () => {
  let bedrock: BedrockClient;
  let storage: StorageInterface;
  let onUpdate: ReturnType<typeof vi.fn>;
  let onPerson: ReturnType<typeof vi.fn>;
  let onTask: ReturnType<typeof vi.fn>;
  let extractor: PreferenceExtractor;

  beforeEach(() => {
    bedrock = createMockBedrock();
    storage = createMockStorage();
    onUpdate = vi.fn();
    onPerson = vi.fn();
    onTask = vi.fn();
    extractor = new PreferenceExtractor(bedrock, storage, {
      onPreference: onUpdate,
      onPerson,
      onTask,
    });
  });

  it('extracts preferences from mocked Bedrock response', async () => {
    vi.mocked(bedrock.extractWithTool).mockResolvedValue({
      toolName: 'extract_preferences',
      input: {
        preferences: [
          { category: 'food', key: 'favorite_cuisine', value: 'Italian', confidence: 0.9 },
        ],
      },
    });

    await extractor.extract(makeMessage(), []);

    expect(storage.savePreference).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'food',
        key: 'favorite_cuisine',
        value: 'Italian',
        confidence: 0.9,
      }),
    );
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pref-new' }),
      true,
    );
  });

  it('updates existing preference when duplicate found', async () => {
    const existing: PreferenceWithHistory = {
      id: 'pref-existing',
      sessionId: 'sess-1',
      category: 'food',
      key: 'favorite_cuisine',
      value: 'French',
      confidence: 0.8,
      sourceMessageId: 'msg-0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    };
    vi.mocked(storage.findPreference).mockResolvedValue(existing);

    vi.mocked(bedrock.extractWithTool).mockResolvedValue({
      toolName: 'extract_preferences',
      input: {
        preferences: [
          { category: 'food', key: 'favorite_cuisine', value: 'Italian', confidence: 0.95 },
        ],
      },
    });

    await extractor.extract(makeMessage(), []);

    // Addressed by natural key, not by an opaque id: an id alone yields no
    // DynamoDB key, which is what made the old signature unimplementable.
    expect(storage.updatePreference).toHaveBeenCalledWith(
      { sessionId: 'sess-1', category: 'food', key: 'favorite_cuisine' },
      {
        value: 'Italian',
        confidence: 0.95,
        sourceMessageId: 'msg-1',
      },
    );
    expect(onUpdate).toHaveBeenCalledWith(expect.anything(), false);
  });

  it('denormalises the partner name onto the session', async () => {
    vi.mocked(bedrock.extractWithTool).mockResolvedValue({
      toolName: 'extract_preferences',
      input: {
        preferences: [
          { category: 'personality_traits', key: 'Name', value: 'Maya', confidence: 0.9 },
        ],
      },
    });

    await extractor.extract(makeMessage(), []);

    // Key casing varies with whatever the model emits, so the match normalises.
    expect(storage.updateSessionMeta).toHaveBeenCalledWith('sess-1', {
      partnerName: 'Maya',
    });
  });

  it('leaves session meta alone for preferences that are not the name', async () => {
    vi.mocked(bedrock.extractWithTool).mockResolvedValue({
      toolName: 'extract_preferences',
      input: {
        preferences: [
          { category: 'food', key: 'favorite_cuisine', value: 'Italian', confidence: 0.9 },
        ],
      },
    });

    await extractor.extract(makeMessage(), []);

    expect(storage.updateSessionMeta).not.toHaveBeenCalled();
  });

  it('logs error and returns empty on Bedrock failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(bedrock.extractWithTool).mockRejectedValue(new Error('Bedrock down'));

    // Should not throw
    await extractor.extract(makeMessage(), []);

    expect(consoleSpy).toHaveBeenCalled();
    expect(storage.savePreference).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('skips preferences with empty key or value', async () => {
    vi.mocked(bedrock.extractWithTool).mockResolvedValue({
      toolName: 'extract_preferences',
      input: {
        preferences: [
          { category: 'food', key: '', value: 'Italian', confidence: 0.9 },
          { category: 'food', key: 'cuisine', value: '', confidence: 0.9 },
        ],
      },
    });

    await extractor.extract(makeMessage(), []);

    expect(storage.savePreference).not.toHaveBeenCalled();
  });

  it('clamps confidence to [0, 1] range', async () => {
    vi.mocked(bedrock.extractWithTool).mockResolvedValue({
      toolName: 'extract_preferences',
      input: {
        preferences: [
          { category: 'food', key: 'spice_level', value: 'high', confidence: 1.5 },
        ],
      },
    });

    await extractor.extract(makeMessage(), []);

    expect(storage.savePreference).toHaveBeenCalledWith(
      expect.objectContaining({ confidence: 1 }),
    );
  });
});

describe('categoryMapper', () => {
  it('maps valid categories directly', () => {
    expect(mapCategory('food')).toBe('food');
    expect(mapCategory('hobbies')).toBe('hobbies');
    expect(mapCategory('love_language')).toBe('love_language');
  });

  it('maps known aliases', () => {
    expect(mapCategory('cuisine')).toBe('food');
    expect(mapCategory('hobby')).toBe('hobbies');
    expect(mapCategory('birthday')).toBe('important_dates');
    expect(mapCategory('personality')).toBe('personality_traits');
  });

  it('returns null for unknown categories', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapCategory('unknown_thing')).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('handles case-insensitive input', () => {
    expect(mapCategory('FOOD')).toBe('food');
    expect(mapCategory('Music')).toBe('music');
  });
});
