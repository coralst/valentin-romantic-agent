import type { PreferenceCategory } from '../../shared/interfaces/preference';

/**
 * Every DynamoDB key in the application, in one place.
 *
 * ## Why the user id is in the partition key
 *
 * A session's items live at `pk = USER#<sub>#SESSION#<sid>`. That makes
 * authorization structural rather than checked: asking for someone else's
 * session doesn't need an ownership test, it simply **misses**. `getSession`
 * builds the key from the *caller's* sub, no item matches, it returns null, and
 * the HTTP layer already maps null to 404.
 *
 * The alternative — `pk = SESSION#<sid>` plus an `ownerUserId` attribute
 * compared after the read — costs the same reads and turns cross-tenant access
 * into a one-missing-`if` bug at every call site. Here there is no `if` to
 * miss, because no code path can read a session without naming a user.
 *
 * ## Why per session, not per user
 *
 * `USER#<sub>#SESSION#<sid>` rather than `USER#<sub>` keeps the shared demo
 * account — which every audience member signs into at once — from becoming a
 * single hot partition.
 *
 * ## The schema
 *
 * | Entity  | pk                        | sk                    | gsi1pk      | gsi1sk                  |
 * |---------|---------------------------|-----------------------|-------------|-------------------------|
 * | Session | `USER#<sub>#SESSION#<sid>`| `META`                | `USER#<sub>`| `TS#<createdAt>#<sid>`  |
 * | Message | `USER#<sub>#SESSION#<sid>`| `MSG#<ts>#<msgId>`    | —           | —                       |
 * | Pref    | `USER#<sub>#SESSION#<sid>`| `PREF#<cat>#<key>`    | —           | —                       |
 * | Person  | `USER#<sub>#SESSION#<sid>`| `PERSON#<personId>`   | —           | —                       |
 * | Task    | `USER#<sub>#SESSION#<sid>`| `TASK#<taskId>`       | —           | —                       |
 * | Manual  | `USER#<sub>#SESSION#<sid>`| `MANUAL#<fieldId>`    | —           | —                       |
 * | Outing  | `USER#<sub>#SESSION#<sid>`| `OUTING#<outingId>`   | —           | —                       |
 * | Reminder| `USER#<sub>#SESSION#<sid>`| `REMINDER#<id>`       | `DUE#<date>`| `T<HH:mm:ss>#<id>`      |
 *
 * ## GSI1 carries two disjoint kinds of row, and that is deliberate
 *
 * It used to be true that only session-meta items carried `gsi1pk`. A pending
 * reminder carries one too — but in a **reserved partition space** that
 * `listSessions` can never see. That query is an *equality* match on
 * `gsi1pk = USER#<sub>`, so a row at `DUE#2026-10-04` is not merely filtered out
 * of it, it is not in the partition being read. This is textbook index
 * overloading, and it is what lets the dispatcher ask "what is due before now?"
 * across every user without a second GSI.
 *
 * Two rules keep the two kinds from ever meeting:
 *
 *  - **Nothing in the `USER#` partition space gets a `gsi1pk` except session
 *    meta.** Adding one to a person or a task row would put it in the sidebar.
 *    `listSessions` also filters on `entityType` as belt and braces, since the
 *    read capacity is already spent.
 *  - **A sent reminder drops out of the index.** The write that stamps `sentAt`
 *    also `REMOVE`s `gsi1pk` and `gsi1sk`, so the due-index stays sparse over
 *    *pending* reminders only and the poller never re-reads history.
 *
 * Day buckets rather than one constant `DUE` partition, because a single
 * partition holding every reminder in the system is the definition of a hot one,
 * and a poller sweeping a window only ever needs today's bucket and yesterday's.
 *
 * Every non-meta item shares its session's partition, so a reset is one query
 * plus a chunked BatchWrite, and `begins_with` is applied to the **sort** key —
 * which is legal. The store this replaced tried `begins_with(gsi1pk, …)` on a
 * *partition* key, which DynamoDB rejects outright.
 *
 * ## Why people, tasks and manual values are items and not attributes
 *
 * All three could have been JSON blobs on the session-meta item, which would
 * have been fewer lines. They are separate items because each is written
 * independently and concurrently: extraction can record a person while the user
 * ticks a task, and a read-modify-write of one shared blob loses one of those
 * two edits silently. One item per record means the two writes never touch.
 *
 * `MANUAL#<fieldId>` deliberately mirrors `PREF#` rather than reusing it. A
 * `PREF` row is what Valentin *inferred*; a `MANUAL` row is what the user
 * *corrected him about*, and the correction has to win. Storing them in the same
 * item would make the last writer win instead, so a re-extraction would quietly
 * overwrite the user's own answer.
 *
 * Never build a key inline. The previous store had four scattered
 * `'USER#anonymous'` literals, and that is exactly what inline keys produce.
 */

/** DynamoDB's hard limit on a sort key, in bytes */
const MAX_SORT_KEY_BYTES = 1024;

/** Guard against a key component that is empty or carries a stray delimiter */
function assertComponent(name: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Key component "${name}" must be a non-empty string`);
  }
}

/**
 * Reject a sort key DynamoDB would reject, naming the component at fault.
 *
 * The limit is on the whole key, but the useful error names the part the caller
 * can do something about — a model-derived preference key or a person id — not
 * the assembled string with a prefix they never wrote.
 */
function withinLimit(sk: string, name: string, value: string): string {
  if (Buffer.byteLength(sk, 'utf8') > MAX_SORT_KEY_BYTES) {
    throw new Error(
      `Key component "${name}" too long: "${value}" exceeds DynamoDB's ${MAX_SORT_KEY_BYTES}-byte sort key limit`,
    );
  }
  return sk;
}

/** Partition key for everything belonging to one session of one user */
export function sessionPk(userId: string, sessionId: string): string {
  assertComponent('userId', userId);
  assertComponent('sessionId', sessionId);
  return `USER#${userId}#SESSION#${sessionId}`;
}

/** Sort key of a session's metadata item */
export const META_SK = 'META';

/** Sort-key prefix shared by every message in a session */
export const MSG_PREFIX = 'MSG#';

/** Sort-key prefix shared by every preference in a session */
export const PREF_PREFIX = 'PREF#';

/**
 * Sort key of a message.
 *
 * Timestamp first so a plain Query returns messages in chronological order with
 * no sort step; the id breaks ties between messages written in the same
 * millisecond, which is common when a turn stores the user message and the
 * agent reply back to back.
 */
export function msgSk(timestamp: string, messageId: string): string {
  assertComponent('timestamp', timestamp);
  assertComponent('messageId', messageId);
  return `${MSG_PREFIX}${timestamp}#${messageId}`;
}

/**
 * Sort key of a preference.
 *
 * The natural key *is* the identity: one row per (category, key) per session.
 * That makes `findPreference` a GetItem instead of a scan, and makes
 * `savePreference` idempotent.
 *
 * `key` is model-derived text, so it may contain '#'. That cannot cause a
 * collision — `category` comes first and is drawn from a closed union with no
 * '#' in any member, so the boundary is never ambiguous.
 */
export function prefSk(category: PreferenceCategory, key: string): string {
  assertComponent('category', category);
  assertComponent('key', key);
  return withinLimit(`${PREF_PREFIX}${category}#${key}`, 'key', `${category}#${key}`);
}

/** Sort-key prefix shared by every person in a session */
export const PERSON_PREFIX = 'PERSON#';

/** Sort-key prefix shared by every task in a session */
export const TASK_PREFIX = 'TASK#';

/** Sort-key prefix shared by every manually-entered field value in a session */
export const MANUAL_PREFIX = 'MANUAL#';

/** Sort-key prefix shared by every recorded outing in a session */
export const OUTING_PREFIX = 'OUTING#';

/** Sort-key prefix shared by every reminder in a session */
export const REMINDER_PREFIX = 'REMINDER#';

/**
 * Sort key of a person.
 *
 * Keyed by the record's own id rather than by name, because a rename is the most
 * likely edit a family record ever gets and a name-keyed row would turn each one
 * into a delete plus an insert. Nothing needs these in a particular order — the
 * tree groups them by generation on the client — so the id alone is enough.
 */
export function personSk(personId: string): string {
  assertComponent('personId', personId);
  return withinLimit(`${PERSON_PREFIX}${personId}`, 'personId', personId);
}

/** Sort key of a task. Keyed by id for the same reason as a person. */
export function taskSk(taskId: string): string {
  assertComponent('taskId', taskId);
  return withinLimit(`${TASK_PREFIX}${taskId}`, 'taskId', taskId);
}

/**
 * Sort key of an outing. Keyed by id, like a task.
 *
 * Not keyed by venue slug, even though that would make "have we been here?" a
 * GetItem: going back to the same restaurant is the *point* of a place rated 5/5,
 * and a slug-keyed row would overwrite the first visit with the second and lose
 * the rating that earned the return.
 */
export function outingSk(outingId: string): string {
  assertComponent('outingId', outingId);
  return withinLimit(`${OUTING_PREFIX}${outingId}`, 'outingId', outingId);
}

/**
 * Sort key of a manually-entered field value.
 *
 * One row per field id, so a correction is an idempotent PutItem and clearing
 * one is a DeleteItem — no read-modify-write, and no way for two edits to
 * different fields to clobber each other.
 */
export function manualSk(fieldId: string): string {
  assertComponent('fieldId', fieldId);
  return withinLimit(`${MANUAL_PREFIX}${fieldId}`, 'fieldId', fieldId);
}

/**
 * Sort key of a reminder. Keyed by id, like a task.
 *
 * The id is itself derived from the occasion (`shared/interfaces/reminder.ts`), so
 * re-planning the same birthday overwrites one row rather than accumulating a
 * mailbox full of them.
 */
export function reminderSk(reminderId: string): string {
  assertComponent('reminderId', reminderId);
  return withinLimit(`${REMINDER_PREFIX}${reminderId}`, 'reminderId', reminderId);
}

/**
 * The reserved GSI1 partition prefix for the due-index.
 *
 * Exported so a test can assert no other entity ever writes a `gsi1pk` starting
 * with it, which is the invariant that keeps reminders out of the sidebar.
 */
export const DUE_PREFIX = 'DUE#';

/**
 * GSI1 partition key of a pending reminder — one bucket per calendar day.
 *
 * Takes the day as a string rather than a `Date` on purpose. The bucket a
 * reminder belongs in is a *UTC* day derived from its `dueAt`, and handing this a
 * `Date` would invite a caller to build the string from local calendar fields
 * instead, putting a 09:00-Israel reminder in yesterday's bucket for three hours
 * of every day and making the sweep miss it.
 */
export function dueGsi1pk(utcDay: string): string {
  assertComponent('utcDay', utcDay);
  return `${DUE_PREFIX}${utcDay}`;
}

/**
 * GSI1 sort key of a pending reminder, ordering one day's bucket by time.
 *
 * `T` before the clock time so the key can never begin with a digit that a future
 * prefix scheme might want, and the id last to break ties between two reminders
 * due in the same second — which happens routinely, since every reminder in a
 * bucket is pinned to the same local hour.
 */
export function reminderGsi1sk(utcTime: string, reminderId: string): string {
  assertComponent('utcTime', utcTime);
  assertComponent('reminderId', reminderId);
  return withinLimit(`T${utcTime}#${reminderId}`, 'reminderId', reminderId);
}

/** GSI1 partition key — the sparse index that lists one user's sessions */
export function userGsi1pk(userId: string): string {
  assertComponent('userId', userId);
  return `USER#${userId}`;
}

/**
 * GSI1 sort key, ordering a user's sessions.
 *
 * Uses the session's **immutable `createdAt`**, not its last activity. A mutable
 * sort key would rewrite this GSI row on every single message, purely to order a
 * sidebar that session-context.tsx already re-sorts client-side by
 * `lastActivity` anyway.
 */
export function sessionGsi1sk(createdAt: string, sessionId: string): string {
  assertComponent('createdAt', createdAt);
  assertComponent('sessionId', sessionId);
  return `TS#${createdAt}#${sessionId}`;
}
