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
import type { Outing } from '../../shared/interfaces/outing';
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
  manualSk,
  outingSk,
  personSk,
  prefSk,
  reminderSk,
  sessionPk,
  taskSk,
} from './keys';

/**
 * How much of a failure message is worth keeping.
 *
 * Mirrors the DynamoDB store's own limit so a test written against this store
 * cannot accept a `lastError` production would truncate. What is stored is a
 * message, never a credential.
 */
const MAX_STORED_ERROR_CHARS = 500;

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

  // --- Where he has taken her ---

  async saveOuting(sessionId: string, outing: Outing): Promise<Outing> {
    const [saved] = await this.saveOutingsBatch(sessionId, [outing]);
    return saved;
  }

  async saveOutingsBatch(sessionId: string, outings: readonly Outing[]): Promise<Outing[]> {
    const now = new Date().toISOString();
    const records: Outing[] = [];

    for (const outing of outings) {
      // No `updatedAt` to stamp, unlike a task: an outing's two timestamps are
      // both facts about events — when it was booked, when it was rated — and
      // overwriting either from the clock would falsify them.
      const record: Outing = { ...outing };
      this.shared.outings.set(this.itemKey(sessionId, outingSk(record.id)), record);
      records.push(record);
    }

    this.touchSession(sessionId, now);
    return records;
  }

  async getOutingsBySession(sessionId: string): Promise<Outing[]> {
    return this.itemsUnder(this.shared.outings, sessionId);
  }

  async deleteOuting(sessionId: string, outingId: string): Promise<void> {
    this.shared.outings.delete(this.itemKey(sessionId, outingSk(outingId)));
  }

  // --- What he is going to be reminded about ---

  async saveReminder(sessionId: string, reminder: Reminder): Promise<Reminder> {
    // Owner and conversation come from the store's scope, exactly as the DynamoDB
    // store stamps them: a row whose `userId` disagreed with its partition is one
    // `markSent` would look for in the wrong place.
    const record: Reminder = { ...reminder, sessionId, userId: this.userId };
    this.shared.reminders.set(this.itemKey(sessionId, reminderSk(record.id)), record);
    this.touchSession(sessionId, new Date().toISOString());
    return record;
  }

  async getRemindersBySession(sessionId: string): Promise<Reminder[]> {
    return this.itemsUnder(this.shared.reminders, sessionId);
  }

  async deleteReminder(sessionId: string, reminderId: string): Promise<void> {
    this.shared.reminders.delete(this.itemKey(sessionId, reminderSk(reminderId)));
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
    //
    // A reminder left standing would be worse than stale data: the index reader
    // would keep finding it and keep mailing about a conversation that was reset.
    for (const map of [
      this.shared.people,
      this.shared.tasks,
      this.shared.outings,
      this.shared.reminders,
      this.shared.manualValues,
    ]) {
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
  outings: Map<string, Outing>;
  reminders: Map<string, Reminder>;
  manualValues: Map<string, { fieldId: string; value: string }>;
}

/**
 * Hands out user-scoped in-memory stores backed by one shared data set.
 *
 * Carries {@link ReminderIndexReader} for the same reason the DynamoDB factory
 * does — the dispatcher's sweep spans users, so it belongs on the unscoped side —
 * and it has to be more than a stub: the dispatcher's own tests run against this
 * store, so if `markSent` here were merely optimistic, the double-dispatch test
 * would pass while production was the only place the condition was real.
 */
export class InMemoryStoreFactory implements ScopedStorageFactory, ReminderIndexReader {
  private readonly data: InMemoryData = {
    sessions: new Map(),
    messages: new Map(),
    preferences: new Map(),
    people: new Map(),
    tasks: new Map(),
    outings: new Map(),
    reminders: new Map(),
    manualValues: new Map(),
  };

  // ttlSeconds is accepted and ignored: nothing in a process that ends survives
  // long enough for an expiry to matter.
  forUser(userId: string, _opts?: ScopedStorageOptions): StorageInterface {
    return new InMemoryStore(userId, this.data);
  }

  // --- The due-index, across every user ---

  async dueBefore(at: Date, limit: number): Promise<Reminder[]> {
    // No day buckets to merge: the whole map is one partition here. The behaviour
    // that has to match DynamoDB is *which rows come back* — pending only, due at
    // or before `at`, soonest first, no more than `limit` of them.
    return [...this.data.reminders.values()]
      .filter(
        (reminder) =>
          !reminder.sentAt && new Date(reminder.dueAt).getTime() <= at.getTime(),
      )
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
      .slice(0, limit);
  }

  async markSent(reminder: Reminder, sentAt: Date): Promise<boolean> {
    const mapKey = this.reminderMapKey(reminder);
    const stored = this.data.reminders.get(mapKey);
    // The whole point of the return value: the second caller is told it lost
    // rather than sending a duplicate. False for an already-sent row and false for
    // one that has since been deleted, matching the conditional write's two ways
    // of failing.
    if (!stored || stored.sentAt) return false;

    this.data.reminders.set(mapKey, { ...stored, sentAt: sentAt.toISOString() });
    return true;
  }

  async recordFailure(reminder: Reminder, error: string): Promise<void> {
    const mapKey = this.reminderMapKey(reminder);
    const stored = this.data.reminders.get(mapKey);
    if (!stored) return;

    /*
     * `sentAt` is deliberately not guarded on, and that is the difference between
     * this and `markSent`. The dispatcher *claims a row before it sends* — so by the
     * time a send throws, `sentAt` is already stamped, and a guard here would make
     * the failure path a silent no-op: the row would look delivered, `attempts`
     * would stay 0 and the reason would live only in the logs. Nothing below writes
     * `sentAt`, so recording a failure cannot overwrite the record of a send; it
     * only annotates it.
     */
    this.data.reminders.set(mapKey, {
      ...stored,
      attempts: stored.attempts + 1,
      lastError: error.slice(0, MAX_STORED_ERROR_CHARS),
      // Deliberately leaves the index membership alone: a row that was never claimed
      // stays pending for the next sweep, and a claimed one stays out of the index.
    });
  }

  /**
   * The row's own key, built from the reminder's stated owner.
   *
   * Mirrors the DynamoDB reader going back into `sessionPk(reminder.userId, …)`,
   * which is why the owner is an attribute on the row and not only a key component.
   */
  private reminderMapKey(reminder: Reminder): string {
    return `${sessionPk(reminder.userId, reminder.sessionId)}|${reminderSk(reminder.id)}`;
  }
}
