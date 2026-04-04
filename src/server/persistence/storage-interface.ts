import type { ChatMessage } from '../../shared/interfaces/message';
import type {
  Preference,
  PreferenceCategory,
  PreferenceWithHistory,
} from '../../shared/interfaces/preference';
import type { SessionData } from '../../shared/interfaces/session';

/** Structured preference data extracted from conversation, before persistence */
export interface ExtractedPreference {
  category: PreferenceCategory;
  key: string;
  value: string;
  confidence: number;
}

/** Abstract storage contract — implementations can be in-memory, database, etc. */
export interface StorageInterface {
  // Preferences
  savePreference(
    pref: Omit<Preference, 'id' | 'createdAt' | 'updatedAt'> & {
      sourceMessageId: string;
    },
  ): Promise<PreferenceWithHistory>;

  updatePreference(
    id: string,
    update: Partial<Pick<Preference, 'value' | 'confidence' | 'sourceMessageId'>>,
  ): Promise<PreferenceWithHistory>;

  getPreferencesBySession(sessionId: string): Promise<PreferenceWithHistory[]>;

  findPreference(
    sessionId: string,
    category: PreferenceCategory,
    key: string,
  ): Promise<PreferenceWithHistory | null>;

  // Conversation Memory
  saveMessage(msg: ChatMessage): Promise<void>;
  getMessagesBySession(sessionId: string): Promise<ChatMessage[]>;

  // Session
  createSession(): Promise<string>;
  getSession(sessionId: string): Promise<SessionData | null>;
  endSession(sessionId: string): Promise<void>;
}
