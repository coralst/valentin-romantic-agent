import type { ChatMessage } from '../../shared/interfaces/message';
import type {
  Preference,
  PreferenceCategory,
  PreferenceHistoryEntry,
  PreferenceWithHistory,
} from '../../shared/interfaces/preference';
import type { SessionData } from '../../shared/interfaces/session';
import type { StorageInterface } from './storage-interface';

/** In-memory implementation of StorageInterface using Map collections */
export class InMemoryStore implements StorageInterface {
  private sessions = new Map<string, SessionData>();
  private messages = new Map<string, ChatMessage[]>();
  private preferences = new Map<string, PreferenceWithHistory>();

  // --- Preferences ---

  async savePreference(
    pref: Omit<Preference, 'id' | 'createdAt' | 'updatedAt'> & {
      sourceMessageId: string;
    },
  ): Promise<PreferenceWithHistory> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

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

    this.preferences.set(id, record);
    this.incrementSessionCount(pref.sessionId, 'preferenceCount');
    return record;
  }

  async updatePreference(
    id: string,
    update: Partial<Pick<Preference, 'value' | 'confidence' | 'sourceMessageId'>>,
  ): Promise<PreferenceWithHistory> {
    const existing = this.preferences.get(id);
    if (!existing) {
      throw new Error(`Preference not found: ${id}`);
    }

    const historyEntry: PreferenceHistoryEntry = {
      previousValue: existing.value,
      changedAt: new Date().toISOString(),
      sourceMessageId: update.sourceMessageId ?? existing.sourceMessageId,
    };

    const updated: PreferenceWithHistory = {
      ...existing,
      ...update,
      updatedAt: new Date().toISOString(),
      history: [...existing.history, historyEntry],
    };

    this.preferences.set(id, updated);
    return updated;
  }

  async getPreferencesBySession(
    sessionId: string,
  ): Promise<PreferenceWithHistory[]> {
    return [...this.preferences.values()].filter(
      (p) => p.sessionId === sessionId,
    );
  }

  async findPreference(
    sessionId: string,
    category: PreferenceCategory,
    key: string,
  ): Promise<PreferenceWithHistory | null> {
    for (const pref of this.preferences.values()) {
      if (
        pref.sessionId === sessionId &&
        pref.category === category &&
        pref.key === key
      ) {
        return pref;
      }
    }
    return null;
  }

  // --- Conversation Memory ---

  async saveMessage(msg: ChatMessage): Promise<void> {
    const list = this.messages.get(msg.sessionId) ?? [];
    list.push(msg);
    this.messages.set(msg.sessionId, list);
    this.incrementSessionCount(msg.sessionId, 'messageCount');
  }

  async getMessagesBySession(sessionId: string): Promise<ChatMessage[]> {
    return this.messages.get(sessionId) ?? [];
  }

  // --- Session ---

  async createSession(): Promise<string> {
    const id = crypto.randomUUID();
    const session: SessionData = {
      id,
      createdAt: new Date().toISOString(),
      endedAt: null,
      messageCount: 0,
      preferenceCount: 0,
    };
    this.sessions.set(id, session);
    return id;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async endSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.endedAt = new Date().toISOString();
    }
  }

  // --- Internal helpers ---

  private incrementSessionCount(
    sessionId: string,
    field: 'messageCount' | 'preferenceCount',
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session[field] += 1;
    }
  }
}
