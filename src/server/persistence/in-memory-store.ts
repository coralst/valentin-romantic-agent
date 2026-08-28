import type { ChatMessage } from '../../shared/interfaces/message';
import type {
  Preference,
  PreferenceCategory,
  PreferenceHistoryEntry,
  PreferenceWithHistory,
} from '../../shared/interfaces/preference';
import { DEFAULT_GENERATION, isPersonGeneration } from '../../shared/interfaces/person';
import type { Person } from '../../shared/interfaces/person';
import type { SessionData } from '../../shared/interfaces/session';
import type { Task } from '../../shared/interfaces/task';
import type {
  PreferenceInput,
  PreferenceRef,
  ScopedStorageFactory,
  ScopedStorageOptions,
  SessionMetaPatch,
  StorageInterface,
} from './storage-interface';
import { manualSk, personSk, prefSk, sessionPk, taskSk } from './keys';

/**
 * In-memory storage for tests and local development.
 *
 * Keyed with the *same* functions as the DynamoDB store, so the two share the
 * partitioning behaviour that isolation depends on rather than merely
 * resembling each other. In particular, a test asserting that user A cannot
 * read user B's session exercises the real key derivation here.
 */
export class InMemoryStore implements StorageInterface {
  constructor(
    private readonly userId: string,
    private readonly shared: InMemoryData,
  ) {}

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
    const now = new Date().toISOString();
    const records: PreferenceWithHistory[] = [];

    for (const pref of prefs) {
      const record: PreferenceWithHistory = {
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
      };

      // Keyed by natural identity, not by a fresh uuid.
      //
      // The previous version stored preferences under `crypto.randomUUID()`,
      // which meant saving the same (session, category, key) twice created two
      // rows and `findPreference` linear-scanned and returned whichever was
      // oldest. Revisions then piled up behind a stale row that never changed.
      this.shared.preferences.set(this.prefKey(sessionId, pref.category, pref.key), record);
      records.push(record);
    }

    this.bumpSession(sessionId, 'preferenceCount', records.length, now);
    return records;
  }

  async updatePreference(
    ref: PreferenceRef,
    update: Partial<Pick<Preference, 'value' | 'confidence' | 'sourceMessageId'>>,
  ): Promise<PreferenceWithHistory> {
    const mapKey = this.prefKey(ref.sessionId, ref.category, ref.key);
    const existing = this.shared.preferences.get(mapKey);
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

    const updated: PreferenceWithHistory = {
      ...existing,
      ...update,
      updatedAt: now,
      history: [...existing.history, historyEntry],
    };

    this.shared.preferences.set(mapKey, updated);
    return updated;
  }

  async getPreferencesBySession(sessionId: string): Promise<PreferenceWithHistory[]> {
    const prefix = `${sessionPk(this.userId, sessionId)}|`;
    return [...this.shared.preferences.entries()]
      .filter(([mapKey]) => mapKey.startsWith(prefix))
      .map(([, pref]) => pref);
  }

  async findPreference(
    sessionId: string,
    category: PreferenceCategory,
    key: string,
  ): Promise<PreferenceWithHistory | null> {
    return this.shared.preferences.get(this.prefKey(sessionId, category, key)) ?? null;
  }

  // --- Her people ---

  async savePerson(sessionId: string, person: Person): Promise<Person> {
    const [saved] = await this.savePeopleBatch(sessionId, [person]);
    return saved;
  }

  async savePeopleBatch(sessionId: string, people: readonly Person[]): Promise<Person[]> {
    const now = new Date().toISOString();
    const records: Person[] = [];

    for (const person of people) {
      // Normalised on the way in, exactly as the DynamoDB store's `toPerson`
      // normalises on the way out. Otherwise a test using this store would
      // accept a generation production would silently reassign.
      const record: Person = {
        ...person,
        generation: isPersonGeneration(person.generation)
          ? person.generation
          : DEFAULT_GENERATION,
        updatedAt: now,
      };
      this.shared.people.set(this.itemKey(sessionId, personSk(record.id)), record);
      records.push(record);
    }

    this.touchSession(sessionId, now);
    return records;
  }

  async getPeopleBySession(sessionId: string): Promise<Person[]> {
    return this.itemsUnder(this.shared.people, sessionId);
  }

  async deletePerson(sessionId: string, personId: string): Promise<void> {
    this.shared.people.delete(this.itemKey(sessionId, personSk(personId)));
  }

  // --- What to do next ---

  async saveTask(sessionId: string, task: Task): Promise<Task> {
    const [saved] = await this.saveTasksBatch(sessionId, [task]);
    return saved;
  }

  async saveTasksBatch(sessionId: string, tasks: readonly Task[]): Promise<Task[]> {
    const now = new Date().toISOString();
    const records: Task[] = [];

    for (const task of tasks) {
      const record: Task = { ...task, updatedAt: now };
      this.shared.tasks.set(this.itemKey(sessionId, taskSk(record.id)), record);
      records.push(record);
    }

    this.touchSession(sessionId, now);
    return records;
  }

  async getTasksBySession(sessionId: string): Promise<Task[]> {
    return this.itemsUnder(this.shared.tasks, sessionId);
  }

  async deleteTask(sessionId: string, taskId: string): Promise<void> {
    this.shared.tasks.delete(this.itemKey(sessionId, taskSk(taskId)));
  }

  // --- Corrections the user made by hand ---

  async setManualValue(sessionId: string, fieldId: string, value: string): Promise<void> {
    this.shared.manualValues.set(this.itemKey(sessionId, manualSk(fieldId)), {
      fieldId,
      value,
    });
  }

  async getManualValues(sessionId: string): Promise<Record<string, string>> {
    const values: Record<string, string> = {};
    for (const entry of this.itemsUnder(this.shared.manualValues, sessionId)) {
      values[entry.fieldId] = entry.value;
    }
    return values;
  }

  async clearManualValue(sessionId: string, fieldId: string): Promise<void> {
    this.shared.manualValues.delete(this.itemKey(sessionId, manualSk(fieldId)));
  }

  // --- Conversation Memory ---

  async saveMessage(msg: ChatMessage): Promise<void> {
    const partition = sessionPk(this.userId, msg.sessionId);
    const list = this.shared.messages.get(partition) ?? [];
    list.push(msg);
    this.shared.messages.set(partition, list);
    this.bumpSession(msg.sessionId, 'messageCount', 1, msg.timestamp);
  }

  async getMessagesBySession(sessionId: string): Promise<ChatMessage[]> {
    return this.shared.messages.get(sessionPk(this.userId, sessionId)) ?? [];
  }

  // --- Session ---

  async createSession(): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.shared.sessions.set(sessionPk(this.userId, id), {
      id,
      createdAt: now,
      lastActivity: now,
      endedAt: null,
      messageCount: 0,
      preferenceCount: 0,
      title: null,
      partnerName: null,
    });
    return id;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    return this.shared.sessions.get(sessionPk(this.userId, sessionId)) ?? null;
  }

  async listSessions(): Promise<SessionData[]> {
    const prefix = `USER#${this.userId}#SESSION#`;
    return [...this.shared.sessions.entries()]
      .filter(([partition]) => partition.startsWith(prefix))
      .map(([, session]) => session)
      .sort(
        (a, b) =>
          new Date(b.lastActivity ?? b.createdAt).getTime() -
          new Date(a.lastActivity ?? a.createdAt).getTime(),
      );
  }

  async updateSessionMeta(sessionId: string, patch: SessionMetaPatch): Promise<void> {
    const session = this.shared.sessions.get(sessionPk(this.userId, sessionId));
    if (!session) return;
    if (patch.title !== undefined) session.title = patch.title;
    if (patch.partnerName !== undefined) session.partnerName = patch.partnerName;
  }

  async endSession(sessionId: string): Promise<void> {
    const session = this.shared.sessions.get(sessionPk(this.userId, sessionId));
    if (session) {
      session.endedAt = new Date().toISOString();
    }
  }

  async clearSession(sessionId: string): Promise<void> {
    const partition = sessionPk(this.userId, sessionId);
    const prefix = `${partition}|`;

    for (const mapKey of [...this.shared.preferences.keys()]) {
      if (mapKey.startsWith(prefix)) {
        this.shared.preferences.delete(mapKey);
      }
    }
    this.shared.messages.delete(partition);

    // Her family, his to-do list and his corrections are as much "what Valentin
    // knows" as the preferences are — a reset that left them standing would look
    // to the user like it had failed.
    for (const map of [this.shared.people, this.shared.tasks, this.shared.manualValues]) {
      for (const mapKey of [...map.keys()]) {
        if (mapKey.startsWith(prefix)) map.delete(mapKey);
      }
    }

    const session = this.shared.sessions.get(partition);
    if (session) {
      session.messageCount = 0;
      session.preferenceCount = 0;
      session.partnerName = null;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.clearSession(sessionId);
    this.shared.sessions.delete(sessionPk(this.userId, sessionId));
  }

  // --- Internal helpers ---

  /** Map key mirroring the DynamoDB (pk, sk) pair for a preference */
  private prefKey(sessionId: string, category: PreferenceCategory, key: string): string {
    return `${sessionPk(this.userId, sessionId)}|${prefSk(category, key)}`;
  }

  /** Map key mirroring the DynamoDB (pk, sk) pair for any session-owned item */
  private itemKey(sessionId: string, sk: string): string {
    return `${sessionPk(this.userId, sessionId)}|${sk}`;
  }

  /** Every value in one of the shared maps belonging to one session */
  private itemsUnder<T>(map: Map<string, T>, sessionId: string): T[] {
    const prefix = `${this.itemKey(sessionId, '')}`;
    return [...map.entries()]
      .filter(([mapKey]) => mapKey.startsWith(prefix))
      .map(([, value]) => value);
  }

  /**
   * Touch lastActivity without moving a counter.
   *
   * People and tasks deliberately do not bump `preferenceCount`: that number
   * drives the board's field-coverage reading, and a family is not a field.
   */
  private touchSession(sessionId: string, at: string): void {
    const session = this.shared.sessions.get(sessionPk(this.userId, sessionId));
    if (!session) return;
    session.lastActivity = at;
  }

  /**
   * Increment a counter and touch lastActivity.
   *
   * A no-op for an unknown session, matching the DynamoDB store's
   * `attribute_exists` guard rather than upserting a stub.
   */
  private bumpSession(
    sessionId: string,
    field: 'messageCount' | 'preferenceCount',
    by: number,
    at: string,
  ): void {
    const session = this.shared.sessions.get(sessionPk(this.userId, sessionId));
    if (!session) return;
    session[field] += by;
    session.lastActivity = at;
  }
}

/**
 * The maps every scoped in-memory store shares.
 *
 * Held by the factory rather than by each store, so two stores from the same
 * factory see one another's writes — which is what makes a cross-tenant
 * isolation test meaningful. If each store had private maps, isolation would
 * pass trivially and prove nothing.
 */
export interface InMemoryData {
  sessions: Map<string, SessionData>;
  messages: Map<string, ChatMessage[]>;
  preferences: Map<string, PreferenceWithHistory>;
  people: Map<string, Person>;
  tasks: Map<string, Task>;
  manualValues: Map<string, { fieldId: string; value: string }>;
}

/** Hands out user-scoped in-memory stores backed by one shared data set */
export class InMemoryStoreFactory implements ScopedStorageFactory {
  private readonly data: InMemoryData = {
    sessions: new Map(),
    messages: new Map(),
    preferences: new Map(),
    people: new Map(),
    tasks: new Map(),
    manualValues: new Map(),
  };

  // ttlSeconds is accepted and ignored: nothing in a process that ends survives
  // long enough for an expiry to matter.
  forUser(userId: string, _opts?: ScopedStorageOptions): StorageInterface {
    return new InMemoryStore(userId, this.data);
  }
}
