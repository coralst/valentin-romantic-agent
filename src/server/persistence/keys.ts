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
 *
 * Only session-meta items carry `gsi1pk`, so GSI1 is **sparse**: listing a
 * user's sessions is one query returning one row per session, with no filter.
 *
 * Messages and preferences share their session's partition, so a reset is one
 * query plus a chunked BatchWrite, and `begins_with` is applied to the **sort**
 * key — which is legal. The store this replaced tried `begins_with(gsi1pk, …)`
 * on a *partition* key, which DynamoDB rejects outright.
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
  const sk = `${PREF_PREFIX}${category}#${key}`;
  if (Buffer.byteLength(sk, 'utf8') > MAX_SORT_KEY_BYTES) {
    throw new Error(
      `Preference key too long: "${category}#${key}" exceeds DynamoDB's ${MAX_SORT_KEY_BYTES}-byte sort key limit`,
    );
  }
  return sk;
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
