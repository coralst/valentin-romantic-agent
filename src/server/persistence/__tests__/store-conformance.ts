import { beforeEach, describe, expect, it } from 'vitest';
import type { Person } from '../../../shared/interfaces/person';
import type { Task } from '../../../shared/interfaces/task';
import type { Outing } from '../../../shared/interfaces/outing';
import type { StorageInterface } from '../storage-interface';

/**
 * The behaviour both `StorageInterface` implementations owe their callers.
 *
 * ## Why this file exists
 *
 * `dynamodb-store.test.ts` needs DynamoDB Local on :8000 and `describe.runIf`s
 * itself away when it is missing — which, in CI and on most laptops, is always.
 * So the store that actually serves production had effectively zero coverage,
 * while `in-memory-store.test.ts` — the store nothing depends on at runtime —
 * ran on every push. Every divergence between them was therefore invisible by
 * construction, and each one was found in the deployed app rather than in a test:
 * `savePreference` dropping `fieldId` on the DynamoDB side only, and
 * `collectOwnedItemKeys` forgetting a sort-key prefix so a reset left rows
 * standing in a partition the UI still reads.
 *
 * Writing the same assertion twice by hand is what let those diverge. The two
 * suites had grown different fixtures, different names and different coverage,
 * so "do they agree?" was a question no test asked. Here the assertion exists
 * once and is *called* twice, so a store that behaves differently cannot be
 * green — and when DynamoDB Local is absent, the skip is a visible hole in a
 * shared spec rather than a suite quietly proving nothing.
 *
 * ## What belongs here and what does not
 *
 * Only claims that hold for both engines. Anything about how a store keeps its
 * promise — TTL attributes, `(pk, sk)` layout, GSI1 sparseness, tolerating rows
 * an older build wrote, the reachability guard itself — stays in that store's own
 * file. Two rules follow from that, and both have already bitten:
 *
 * - **Never assert on ordering** that only one store guarantees. `listSessions`
 *   is newest-first by `createdAt` on DynamoDB (that is the GSI1 sort key) and by
 *   `lastActivity` in memory; `getOutingsBySession` is sort-key order there and
 *   insertion order here. Compare sets, or sort in the test.
 * - **Read every nullable field through `?? null`.** `toOuting` normalises a
 *   missing attribute to `null` on the way out of DynamoDB; the in-memory store
 *   hands back the object it was given, `undefined` and all. Both satisfy the
 *   interface, so the spec must not pick a side.
 */
export function describeStoreConformance(
  name: string,
  makeStore: () => Promise<StorageInterface> | StorageInterface,
): void {
  describe(`StorageInterface conformance (${name})`, () => {
    let store: StorageInterface;

    beforeEach(async () => {
      store = await makeStore();
    });

    // --- Fixtures ---
    //
    // Shared rather than per-describe so that "the same row, written to either
    // store" is literally the same object graph in both suites.

    function person(overrides: Partial<Person> = {}): Person {
      return {
        id: 'p1',
        name: 'Leah',
        relationship: 'Older sister',
        generation: 'peer',
        birthday: null,
        note: null,
        source: 'manual',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }

    function task(overrides: Partial<Task> = {}): Task {
      return {
        id: 't1',
        title: 'Book somewhere for the anniversary',
        due: '2026-09-11',
        note: null,
        done: false,
        source: 'discovered',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }

    /**
     * An unrated outing — a booking that has happened and not yet been asked
     * about. Nulls are spelled out rather than omitted because `rating: null` is
     * the state the survey looks for, so a fixture that merely left it off would
     * be testing the store's defaults instead of the row the app writes.
     */
    function outing(overrides: Partial<Outing> = {}): Outing {
      return {
        id: 'o1',
        venueSlug: 'claro',
        venueName: 'Claro',
        city: 'Tel Aviv',
        occursOn: '2026-08-14',
        confirmedAt: '2026-08-01T09:00:00.000Z',
        rating: null,
        verdict: null,
        note: null,
        ratedAt: null,
        ...overrides,
      };
    }

    // --- Sessions ---

    describe('sessions', () => {
      it('reads back a session it just created', async () => {
        const sessionId = await store.createSession();

        const session = await store.getSession(sessionId);
        expect(session).not.toBeNull();
        expect(session!.id).toBe(sessionId);
        expect(session!.endedAt).toBeNull();
        expect(session!.messageCount).toBe(0);
        expect(session!.preferenceCount).toBe(0);
      });

      it('returns null for a session id it never issued', async () => {
        expect(await store.getSession('no-such-session')).toBeNull();
      });

      it('lists every session it created', async () => {
        // A set, not an array: the two stores order this differently and both
        // orderings satisfy the interface.
        const first = await store.createSession();
        const second = await store.createSession();

        const ids = (await store.listSessions()).map((s) => s.id);
        expect(new Set(ids)).toEqual(new Set([first, second]));
      });

      it('patches title and partnerName independently', async () => {
        const sessionId = await store.createSession();

        await store.updateSessionMeta(sessionId, { partnerName: 'Maya' });
        await store.updateSessionMeta(sessionId, { title: 'Anniversary plans' });

        const session = await store.getSession(sessionId);
        expect(session!.partnerName).toBe('Maya');
        // A patch touches only the fields it names.
        expect(session!.title).toBe('Anniversary plans');
      });

      it('endSession stamps endedAt', async () => {
        const sessionId = await store.createSession();

        await store.endSession(sessionId);

        expect((await store.getSession(sessionId))!.endedAt).toBeTruthy();
      });

      it('treats a write to an unknown session as a no-op, not an upsert', async () => {
        // The failure this guards against is a half-formed session appearing in
        // the sidebar because a conditionless update created the item it meant
        // to amend.
        await store.endSession('no-such-session');
        await store.updateSessionMeta('no-such-session', { title: 'ghost' });
        await store.clearSession('no-such-session');

        expect(await store.getSession('no-such-session')).toBeNull();
        expect(await store.listSessions()).toEqual([]);
      });

      it('deleteSession removes the session and its contents', async () => {
        const sessionId = await store.createSession();
        await store.saveMessage({
          id: 'm1',
          sessionId,
          sender: 'user',
          content: 'hello',
          timestamp: '2026-01-01T00:00:00.000Z',
        });
        await store.savePreference({
          sessionId,
          category: 'food',
          key: 'cuisine',
          value: 'Italian',
          confidence: 0.9,
          sourceMessageId: 'm1',
        });

        await store.deleteSession(sessionId);

        expect(await store.getSession(sessionId)).toBeNull();
        expect(await store.getMessagesBySession(sessionId)).toEqual([]);
        expect(await store.getPreferencesBySession(sessionId)).toEqual([]);
      });
    });

    // --- Messages ---

    describe('messages', () => {
      it('round trips a message', async () => {
        const sessionId = await store.createSession();

        await store.saveMessage({
          id: 'm1',
          sessionId,
          sender: 'user',
          content: 'She loves Italian food',
          timestamp: '2026-01-01T00:00:00.000Z',
        });

        const messages = await store.getMessagesBySession(sessionId);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
          id: 'm1',
          sender: 'user',
          content: 'She loves Italian food',
          timestamp: '2026-01-01T00:00:00.000Z',
        });
      });

      it('counts messages on the session', async () => {
        const sessionId = await store.createSession();

        await store.saveMessage({
          id: 'm1',
          sessionId,
          sender: 'user',
          content: 'hello',
          timestamp: '2026-06-01T00:00:00.000Z',
        });
        await store.saveMessage({
          id: 'm2',
          sessionId,
          sender: 'agent',
          content: 'hi',
          timestamp: '2026-06-02T00:00:00.000Z',
        });

        const session = await store.getSession(sessionId);
        expect(session!.messageCount).toBe(2);
        expect(session!.lastActivity).toBe('2026-06-02T00:00:00.000Z');
      });
    });

    // --- Preferences ---

    describe('preferences', () => {
      it('finds a saved preference by its natural key', async () => {
        const sessionId = await store.createSession();
        await store.savePreference({
          sessionId,
          category: 'food',
          key: 'cuisine',
          value: 'Italian',
          confidence: 0.9,
          sourceMessageId: 'm1',
        });

        const found = await store.findPreference(sessionId, 'food', 'cuisine');
        expect(found).not.toBeNull();
        expect(found!.value).toBe('Italian');
        expect(found!.history).toEqual([]);
      });

      it('returns null for a preference nobody saved', async () => {
        const sessionId = await store.createSession();

        expect(await store.findPreference(sessionId, 'food', 'cuisine')).toBeNull();
      });

      it('carries fieldId through the single-row save path', async () => {
        // The divergence that made this whole file worth writing: the DynamoDB
        // store built its batch row without `fieldId`, so every live-extracted
        // preference in the deployment persisted null and the client fell back to
        // fuzzy category+key matching. The in-memory store passed.
        const sessionId = await store.createSession();
        await store.savePreference({
          sessionId,
          category: 'personality_traits',
          key: 'partner_name',
          fieldId: 'partner_name',
          value: 'Maya',
          confidence: 1,
          sourceMessageId: 'm1',
        });

        const found = await store.findPreference(
          sessionId,
          'personality_traits',
          'partner_name',
        );
        expect(found?.fieldId).toBe('partner_name');
      });

      it('stores no field id rather than a stray undefined when none resolved', async () => {
        const sessionId = await store.createSession();
        await store.savePreference({
          sessionId,
          category: 'food',
          key: 'cuisine',
          value: 'Thai',
          confidence: 0.9,
          sourceMessageId: 'm1',
        });

        const found = await store.findPreference(sessionId, 'food', 'cuisine');
        expect(found?.fieldId ?? null).toBeNull();
      });

      it('saving the same natural key twice keeps one row', async () => {
        // (session, category, key) *is* the identity. Keyed by a fresh uuid
        // instead, a second extraction of the same fact produces a second row and
        // reads return whichever happens to come first.
        const sessionId = await store.createSession();
        const write = (value: string) =>
          store.savePreference({
            sessionId,
            category: 'food',
            key: 'cuisine',
            value,
            confidence: 0.9,
            sourceMessageId: 'm1',
          });

        await write('Italian');
        await write('Thai');

        const all = await store.getPreferencesBySession(sessionId);
        expect(all).toHaveLength(1);
        expect(all[0].value).toBe('Thai');
      });

      it('appends the old value to history on every revision', async () => {
        const sessionId = await store.createSession();
        await store.savePreference({
          sessionId,
          category: 'food',
          key: 'cuisine',
          value: 'French',
          confidence: 0.7,
          sourceMessageId: 'm0',
        });

        const first = await store.updatePreference(
          { sessionId, category: 'food', key: 'cuisine' },
          { value: 'Italian', confidence: 0.95, sourceMessageId: 'm1' },
        );
        const second = await store.updatePreference(
          { sessionId, category: 'food', key: 'cuisine' },
          { value: 'Thai', confidence: 0.9, sourceMessageId: 'm2' },
        );

        expect(first.history).toHaveLength(1);
        expect(second.history).toHaveLength(2);

        // The returned object is easy to get right by accident; what matters is
        // what a later read sees.
        const persisted = await store.findPreference(sessionId, 'food', 'cuisine');
        expect(persisted!.value).toBe('Thai');
        expect(persisted!.history.map((h) => h.previousValue)).toEqual([
          'French',
          'Italian',
        ]);
      });

      it('does not count a revision as a new preference', async () => {
        const sessionId = await store.createSession();
        await store.savePreference({
          sessionId,
          category: 'food',
          key: 'cuisine',
          value: 'French',
          confidence: 0.7,
          sourceMessageId: 'm0',
        });
        await store.updatePreference(
          { sessionId, category: 'food', key: 'cuisine' },
          { value: 'Italian' },
        );

        expect((await store.getSession(sessionId))!.preferenceCount).toBe(1);
      });

      it('refuses to revise a preference that does not exist', async () => {
        const sessionId = await store.createSession();

        await expect(
          store.updatePreference(
            { sessionId, category: 'food', key: 'cuisine' },
            { value: 'Italian' },
          ),
        ).rejects.toThrow(/not found/i);

        expect(await store.getPreferencesBySession(sessionId)).toEqual([]);
      });

      it('writes a batch with one counter bump', async () => {
        const sessionId = await store.createSession();

        const written = await store.savePreferencesBatch(sessionId, [
          { category: 'food', key: 'cuisine', value: 'Italian', confidence: 0.9, sourceMessageId: 'm1' },
          { category: 'music', key: 'genre', value: 'Indie', confidence: 0.8, sourceMessageId: 'm1' },
        ]);

        expect(written).toHaveLength(2);
        expect(await store.getPreferencesBySession(sessionId)).toHaveLength(2);
        expect((await store.getSession(sessionId))!.preferenceCount).toBe(2);
      });

      it('an empty batch touches nothing', async () => {
        const sessionId = await store.createSession();

        expect(await store.savePreferencesBatch(sessionId, [])).toEqual([]);
        expect((await store.getSession(sessionId))!.preferenceCount).toBe(0);
      });

      it('reads only the named session’s preferences', async () => {
        const mine = await store.createSession();
        const other = await store.createSession();
        await store.savePreference({
          sessionId: other,
          category: 'music',
          key: 'genre',
          value: 'Indie folk',
          confidence: 0.8,
          sourceMessageId: 'm1',
        });

        expect(await store.getPreferencesBySession(mine)).toEqual([]);
        expect(await store.getPreferencesBySession(other)).toHaveLength(1);
      });
    });

    // --- Her people ---

    describe('people', () => {
      it('round trips a person', async () => {
        const sessionId = await store.createSession();

        await store.savePerson(
          sessionId,
          person({ birthday: '1988-09-09', note: 'Lives in Haifa' }),
        );

        const [read] = await store.getPeopleBySession(sessionId);
        expect(read).toMatchObject({
          id: 'p1',
          name: 'Leah',
          relationship: 'Older sister',
          generation: 'peer',
          birthday: '1988-09-09',
          note: 'Lives in Haifa',
        });
      });

      it('keeps a null name, which is how a gap is recorded', async () => {
        // A vanished null is a dashed "ask her" node the tree never draws.
        const sessionId = await store.createSession();

        await store.savePerson(sessionId, person({ name: null, relationship: 'Uncle' }));

        expect((await store.getPeopleBySession(sessionId))[0].name).toBeNull();
      });

      it('falls back rather than keeping a generation the tree cannot draw', async () => {
        const sessionId = await store.createSession();

        await store.savePerson(sessionId, person({ generation: 'ancestor' as never }));

        expect((await store.getPeopleBySession(sessionId))[0].generation).toBe('elder');
      });

      it('treats a second write of one id as a rename, not a second person', async () => {
        const sessionId = await store.createSession();

        await store.savePerson(sessionId, person({ name: null }));
        await store.savePerson(sessionId, person({ name: 'Nadia' }));

        const people = await store.getPeopleBySession(sessionId);
        expect(people).toHaveLength(1);
        expect(people[0].name).toBe('Nadia');
      });

      it('does not count a family as profile fields', async () => {
        // preferenceCount drives the board's coverage reading, which the user
        // reads as "how much Valentin knows about her".
        const sessionId = await store.createSession();

        await store.savePeopleBatch(sessionId, [person(), person({ id: 'p2', name: 'Noa' })]);

        expect((await store.getSession(sessionId))!.preferenceCount).toBe(0);
      });

      it('deletes one person and leaves the rest', async () => {
        const sessionId = await store.createSession();
        await store.savePeopleBatch(sessionId, [person(), person({ id: 'p2', name: 'Noa' })]);

        await store.deletePerson(sessionId, 'p1');

        expect((await store.getPeopleBySession(sessionId)).map((p) => p.id)).toEqual(['p2']);
      });

      it('ignores a delete for an id the session does not have', async () => {
        const sessionId = await store.createSession();
        await store.savePerson(sessionId, person());

        await store.deletePerson(sessionId, 'nobody');

        expect(await store.getPeopleBySession(sessionId)).toHaveLength(1);
      });
    });

    // --- What to do next ---

    describe('tasks', () => {
      it('remembers a tick across a read', async () => {
        // The whole reason tasks are stored rather than derived: a derived list
        // re-offers finished work the next morning.
        const sessionId = await store.createSession();
        await store.saveTask(sessionId, task());

        await store.saveTask(sessionId, task({ done: true }));

        const tasks = await store.getTasksBySession(sessionId);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].done).toBe(true);
      });

      it('reads only the named session’s tasks', async () => {
        const mine = await store.createSession();
        const other = await store.createSession();
        await store.saveTask(other, task());

        expect(await store.getTasksBySession(mine)).toEqual([]);
        expect(await store.getTasksBySession(other)).toHaveLength(1);
      });

      it('deletes one task and leaves the rest', async () => {
        const sessionId = await store.createSession();
        await store.saveTasksBatch(sessionId, [
          task(),
          task({ id: 't2', title: 'Draft the card' }),
        ]);

        await store.deleteTask(sessionId, 't2');

        expect((await store.getTasksBySession(sessionId)).map((t) => t.id)).toEqual(['t1']);
      });
    });

    // --- Where he has taken her ---

    describe('outings', () => {
      it('round trips an unrated outing with its null rating intact', async () => {
        // `rating: null` is what the survey queries for. A store that coerced it
        // to 0, or dropped the field so it read as "rated", would empty the survey
        // silently.
        const sessionId = await store.createSession();

        await store.saveOuting(sessionId, outing());

        const [read] = await store.getOutingsBySession(sessionId);
        expect(read).toMatchObject({
          id: 'o1',
          venueName: 'Claro',
          city: 'Tel Aviv',
          occursOn: '2026-08-14',
          confirmedAt: '2026-08-01T09:00:00.000Z',
        });
        expect(read.rating ?? null).toBeNull();
        expect(read.verdict ?? null).toBeNull();
        expect(read.ratedAt ?? null).toBeNull();
      });

      it('rating an outing revises the row rather than adding a second one', async () => {
        // Rating is a whole-row idempotent put of the same id, days after the
        // booking. Keyed by anything else — a venue slug, a fresh uuid — the
        // history shows the same evening twice, once unrated.
        const sessionId = await store.createSession();
        await store.saveOuting(sessionId, outing());

        await store.saveOuting(
          sessionId,
          outing({
            rating: 5,
            verdict: 'again',
            note: 'ask for the corner table',
            ratedAt: '2026-08-15T20:00:00.000Z',
          }),
        );

        const outings = await store.getOutingsBySession(sessionId);
        expect(outings).toHaveLength(1);
        expect(outings[0].rating).toBe(5);
        expect(outings[0].verdict).toBe('again');
        expect(outings[0].note).toBe('ask for the corner table');
        expect(outings[0].ratedAt).toBe('2026-08-15T20:00:00.000Z');
      });

      it('writes a batch and reads every row back', async () => {
        const sessionId = await store.createSession();

        const written = await store.saveOutingsBatch(sessionId, [
          outing(),
          outing({ id: 'o2', venueSlug: 'haachim', venueName: "Ha'achim", rating: 2 }),
        ]);

        expect(written).toHaveLength(2);
        const ids = (await store.getOutingsBySession(sessionId)).map((o) => o.id);
        expect(new Set(ids)).toEqual(new Set(['o1', 'o2']));
      });

      it('an empty batch touches nothing', async () => {
        const sessionId = await store.createSession();

        expect(await store.saveOutingsBatch(sessionId, [])).toEqual([]);
        expect(await store.getOutingsBySession(sessionId)).toEqual([]);
      });

      it('reads only the named session’s outings', async () => {
        // Two sessions of the same user, both with an outing keyed `o1`: the
        // partition has to keep them apart, not a field compared after the read.
        const first = await store.createSession();
        const second = await store.createSession();
        await store.saveOuting(first, outing({ venueName: 'Claro' }));
        await store.saveOuting(second, outing({ venueName: 'Port Said' }));

        const firstOutings = await store.getOutingsBySession(first);
        const secondOutings = await store.getOutingsBySession(second);
        expect(firstOutings.map((o) => o.venueName)).toEqual(['Claro']);
        expect(secondOutings.map((o) => o.venueName)).toEqual(['Port Said']);
      });

      it('deletes one outing and leaves the rest', async () => {
        const sessionId = await store.createSession();
        await store.saveOutingsBatch(sessionId, [
          outing(),
          outing({ id: 'o2', venueName: "Ha'achim" }),
        ]);

        await store.deleteOuting(sessionId, 'o2');

        expect((await store.getOutingsBySession(sessionId)).map((o) => o.id)).toEqual(['o1']);
      });

      it('ignores a delete for an id the session does not have', async () => {
        const sessionId = await store.createSession();
        await store.saveOuting(sessionId, outing());

        await store.deleteOuting(sessionId, 'never-booked');

        expect(await store.getOutingsBySession(sessionId)).toHaveLength(1);
      });

      it('does not count an outing as a profile field', async () => {
        const sessionId = await store.createSession();

        await store.saveOutingsBatch(sessionId, [outing(), outing({ id: 'o2' })]);

        expect((await store.getSession(sessionId))!.preferenceCount).toBe(0);
      });
    });

    // --- Corrections the user made by hand ---

    describe('manual corrections', () => {
      it('stores hand-entered values under their field ids', async () => {
        const sessionId = await store.createSession();

        await store.setManualValue(sessionId, 'bra_size', '34B');
        await store.setManualValue(sessionId, 'shoe_size', 'UK 6');

        expect(await store.getManualValues(sessionId)).toEqual({
          bra_size: '34B',
          shoe_size: 'UK 6',
        });
      });

      it('survives a later extraction of the same field', async () => {
        // The point of MANUAL# existing beside PREF#: one row would make the
        // later writer win, so a re-extraction would overwrite the user's answer.
        const sessionId = await store.createSession();
        await store.setManualValue(sessionId, 'bra_size', '34B');

        await store.savePreference({
          sessionId,
          category: 'gifts',
          fieldId: 'bra_size',
          key: 'bra size',
          value: '36C',
          confidence: 0.6,
          sourceMessageId: 'm1',
        });

        expect((await store.getManualValues(sessionId)).bra_size).toBe('34B');
      });

      it('clears one value without touching the others', async () => {
        const sessionId = await store.createSession();
        await store.setManualValue(sessionId, 'bra_size', '34B');
        await store.setManualValue(sessionId, 'shoe_size', 'UK 6');

        await store.clearManualValue(sessionId, 'bra_size');

        expect(await store.getManualValues(sessionId)).toEqual({ shoe_size: 'UK 6' });
      });
    });

    // --- Reset and delete ---

    describe('a reset sweeps every item type', () => {
      /** One session carrying one of everything a session can own. */
      async function seedEverything(): Promise<string> {
        const sessionId = await store.createSession();
        await store.saveMessage({
          id: 'm1',
          sessionId,
          sender: 'user',
          content: 'She loves Italian food',
          timestamp: '2026-01-01T00:00:00.000Z',
        });
        await store.savePreference({
          sessionId,
          category: 'food',
          key: 'cuisine',
          value: 'Italian',
          confidence: 0.9,
          sourceMessageId: 'm1',
        });
        await store.savePerson(sessionId, person());
        await store.saveTask(sessionId, task());
        await store.saveOuting(sessionId, outing());
        await store.setManualValue(sessionId, 'bra_size', '34B');
        await store.updateSessionMeta(sessionId, { partnerName: 'Maya' });
        return sessionId;
      }

      it('clearSession empties every collection but keeps the session', async () => {
        // Every item type in one assertion on purpose. A sweep that enumerates
        // prefixes forgets the prefix added last — which is exactly how outings
        // survived a reset while the panel above them went blank.
        const sessionId = await seedEverything();

        await store.clearSession(sessionId);

        expect(await store.getMessagesBySession(sessionId)).toEqual([]);
        expect(await store.getPreferencesBySession(sessionId)).toEqual([]);
        expect(await store.getPeopleBySession(sessionId)).toEqual([]);
        expect(await store.getTasksBySession(sessionId)).toEqual([]);
        expect(await store.getOutingsBySession(sessionId)).toEqual([]);
        expect(await store.getManualValues(sessionId)).toEqual({});

        const session = await store.getSession(sessionId);
        expect(session).not.toBeNull();
        expect(session!.endedAt).toBeNull();
        expect(session!.messageCount).toBe(0);
        expect(session!.preferenceCount).toBe(0);
        expect(session!.partnerName).toBeNull();
      });

      it('deleteSession leaves no outing behind', async () => {
        // An item outliving its session is unreachable forever: nothing queries
        // that partition again, so it is storage nobody can read or reclaim.
        const sessionId = await seedEverything();

        await store.deleteSession(sessionId);

        expect(await store.getSession(sessionId)).toBeNull();
        expect(await store.getOutingsBySession(sessionId)).toEqual([]);
        expect(await store.getPeopleBySession(sessionId)).toEqual([]);
        expect(await store.getTasksBySession(sessionId)).toEqual([]);
        expect(await store.getManualValues(sessionId)).toEqual({});
      });

      it('leaves the same user’s other sessions untouched', async () => {
        const cleared = await seedEverything();
        const kept = await seedEverything();

        await store.clearSession(cleared);

        expect(await store.getPreferencesBySession(kept)).toHaveLength(1);
        expect(await store.getOutingsBySession(kept)).toHaveLength(1);
        expect(await store.getPeopleBySession(kept)).toHaveLength(1);
      });
    });
  });
}
