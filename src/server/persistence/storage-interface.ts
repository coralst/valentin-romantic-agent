import type { ChatMessage } from '../../shared/interfaces/message';
import type {
  Preference,
  PreferenceCategory,
  PreferenceWithHistory,
} from '../../shared/interfaces/preference';
import type { Person } from '../../shared/interfaces/person';
import type { SessionData } from '../../shared/interfaces/session';
import type { Task } from '../../shared/interfaces/task';

/** Structured preference data extracted from conversation, before persistence */
export interface ExtractedPreference {
  category: PreferenceCategory;
  key: string;
  /** Canonical profile field id, or null for an off-registry fact. */
  fieldId?: string | null;
  value: string;
  confidence: number;
}

/** A preference ready to persist — an extracted one plus its originating turn */
export type PreferenceInput = ExtractedPreference & { sourceMessageId: string };

/**
 * Identifies a preference by its natural key.
 *
 * `updatePreference` used to take an opaque `id`, which is unimplementable on a
 * key-value store: an id alone yields no key. The store this replaced tried to
 * recover the key with `begins_with(gsi1pk, 'SESSION#')` — illegal, because
 * `begins_with` cannot be applied to a partition key — and its own comment
 * conceded "in production, you'd maintain an ID-to-key index."
 *
 * There is no need for one. (sessionId, category, key) *is* the identity, and
 * every caller already holds all three: preference-extractor.ts asks
 * `findPreference(sessionId, category, key)` immediately beforehand.
 */
export interface PreferenceRef {
  sessionId: string;
  category: PreferenceCategory;
  key: string;
}

/** Fields of a session's metadata a caller may change after creation */
export interface SessionMetaPatch {
  /** User-given conversation name */
  title?: string | null;
  /** Denormalised from the partner_name preference, for the sidebar */
  partnerName?: string | null;
}

/**
 * Abstract storage contract — implementations can be in-memory, database, etc.
 *
 * **Every method is implicitly scoped to one user.** There is no `userId`
 * parameter anywhere; an instance is obtained from
 * {@link ScopedStorageFactory.forUser} and carries its user internally. See that
 * interface for why.
 */
export interface StorageInterface {
  // --- Preferences ---
  savePreference(
    pref: Omit<Preference, 'id' | 'createdAt' | 'updatedAt'> & {
      sourceMessageId: string;
    },
  ): Promise<PreferenceWithHistory>;

  /**
   * Persist many preferences for one session at once.
   *
   * Exists for the demo seed, which writes 18 fixtures. Done one at a time that
   * is 18 puts plus 18 counter updates — 36 sequential round trips, 1-2 seconds
   * on the single most visible click in the product.
   */
  savePreferencesBatch(
    sessionId: string,
    prefs: readonly PreferenceInput[],
  ): Promise<PreferenceWithHistory[]>;

  /** Revise a preference in place, appending the old value to its history */
  updatePreference(
    ref: PreferenceRef,
    update: Partial<Pick<Preference, 'value' | 'confidence' | 'sourceMessageId'>>,
  ): Promise<PreferenceWithHistory>;

  getPreferencesBySession(sessionId: string): Promise<PreferenceWithHistory[]>;

  findPreference(
    sessionId: string,
    category: PreferenceCategory,
    key: string,
  ): Promise<PreferenceWithHistory | null>;

  // --- Her people ---
  /**
   * Write one person, keyed by their own id, so this is idempotent and a rename
   * is an overwrite rather than a delete plus an insert.
   */
  savePerson(sessionId: string, person: Person): Promise<Person>;

  /** Write many at once — the demo seed lands thirteen of them in one click. */
  savePeopleBatch(sessionId: string, people: readonly Person[]): Promise<Person[]>;

  getPeopleBySession(sessionId: string): Promise<Person[]>;

  /** Remove one person. A no-op for an id this session does not have. */
  deletePerson(sessionId: string, personId: string): Promise<void>;

  // --- What to do next ---
  saveTask(sessionId: string, task: Task): Promise<Task>;
  saveTasksBatch(sessionId: string, tasks: readonly Task[]): Promise<Task[]>;
  getTasksBySession(sessionId: string): Promise<Task[]>;
  deleteTask(sessionId: string, taskId: string): Promise<void>;

  // --- Corrections the user made by hand ---
  /**
   * Record what the user says a field's value is, overriding what Valentin
   * inferred.
   *
   * Separate from `savePreference` because the two must not race: a manual value
   * has to survive a later extraction of the same field, and writing both into
   * one row would make whichever landed second the winner.
   */
  setManualValue(sessionId: string, fieldId: string, value: string): Promise<void>;

  /** Every hand-entered value for a session, keyed by field id. */
  getManualValues(sessionId: string): Promise<Record<string, string>>;

  /** Drop one hand-entered value, letting Valentin's own guess show again. */
  clearManualValue(sessionId: string, fieldId: string): Promise<void>;

  // --- Conversation Memory ---
  saveMessage(msg: ChatMessage): Promise<void>;
  getMessagesBySession(sessionId: string): Promise<ChatMessage[]>;

  // --- Session ---
  createSession(): Promise<string>;

  /**
   * Read one session's metadata, or null if this user has no such session.
   *
   * Null covers both "no such session" and "belongs to someone else" — and
   * deliberately does not distinguish them, since the key simply misses either
   * way. Callers map null to 404.
   */
  getSession(sessionId: string): Promise<SessionData | null>;

  /** Every session belonging to this user, newest first */
  listSessions(): Promise<SessionData[]>;

  /** Amend a session's title or denormalised partner name. No-op if unknown. */
  updateSessionMeta(sessionId: string, patch: SessionMetaPatch): Promise<void>;

  endSession(sessionId: string): Promise<void>;

  /**
   * Remove everything belonging to a session — preferences, messages, people,
   * tasks and manual values — resetting its counters. The session itself stays
   * alive and usable: this is a reset, not a delete. A no-op for unknown ids.
   */
  clearSession(sessionId: string): Promise<void>;

  /** Remove a session outright, along with every item in its partition */
  deleteSession(sessionId: string): Promise<void>;
}

/** Options narrowing the behaviour of one scoped store instance */
export interface ScopedStorageOptions {
  /**
   * Expire this user's items after N seconds via the table's `ttl` attribute.
   *
   * Set for the shared demo account so abandoned demo conversations disappear
   * on their own; left unset for real users, whose history must not evaporate.
   * DynamoDB's TTL is best-effort (typically within 48 hours), so it is a
   * backstop for the explicit reap, not a replacement for it.
   */
  ttlSeconds?: number;
}

/**
 * The only way to obtain a store.
 *
 * The alternative was adding a `userId` parameter to all of the methods above.
 * That is mechanical, but it creates roughly fifteen call sites where passing
 * the *wrong* user id type-checks perfectly and silently writes into someone
 * else's partition. Here you cannot get a store without naming a user, and once
 * you have one every key it builds is already scoped.
 *
 * The cost is that the store stops being a process singleton. Bedrock client,
 * agent runtime and WsGateway stay singletons; the store, ConversationMemory,
 * PreferenceExtractor, AgentOrchestrator and EventRouter are built per
 * connection. All are constructor-only objects, so that allocation is free, and
 * no consumer's signature changes.
 */
export interface ScopedStorageFactory {
  forUser(userId: string, opts?: ScopedStorageOptions): StorageInterface;
}
