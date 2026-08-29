import { describe, it, expect, beforeEach } from 'vitest';
import { createHttpRoutes } from '../http-routes';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { StorageInterface } from '../../persistence/storage-interface';
import {
  DEMO_PROFILE_PREFERENCES,
  DEMO_SEED_SOURCE_MESSAGE_ID,
} from '../../fixtures/demo-profile';
import { resolvePersona } from '../../fixtures/demo-personas';
import { DEMO_PEOPLE } from '../../fixtures/demo-people';
import { DEMO_TASKS } from '../../fixtures/demo-tasks';
import { isGap } from '../../../shared/interfaces/person';
import type { IntegrationStatusResponse } from '../../../shared/interfaces/integrations';
import { INTEGRATION_IDS } from '../../../shared/interfaces/integrations';
import { PROFILE_FIELD_REGISTRY } from '../../../client/utils/profile-field-registry';
import { resolveField } from '../../../client/utils/preference-field-mapper';

interface SeedBody {
  sessionId: string;
  preferenceCount: number;
  peopleCount: number;
  taskCount: number;
  historyCount: number;
}

describe('createHttpRoutes', () => {
  let store: StorageInterface;
  let routes: ReturnType<typeof createHttpRoutes>;

  beforeEach(() => {
    store = new InMemoryStoreFactory().forUser('user-under-test');
    routes = createHttpRoutes(store);
  });

  describe('seedSession', () => {
    it('responds 201 with a usable session id', async () => {
      const result = await routes.seedSession();

      expect(result.status).toBe(201);
      const body = result.body as SeedBody;
      expect(typeof body.sessionId).toBe('string');
      expect(await store.getSession(body.sessionId)).not.toBeNull();
    });

    it('reports the number of seeded preferences', async () => {
      const result = await routes.seedSession();

      const body = result.body as SeedBody;
      expect(body.preferenceCount).toBe(DEMO_PROFILE_PREFERENCES.length);
    });

    it('persists every fixture preference to the new session', async () => {
      const { body } = await routes.seedSession();

      const stored = await store.getPreferencesBySession(
        (body as SeedBody).sessionId,
      );
      expect(stored).toHaveLength(DEMO_PROFILE_PREFERENCES.length);
    });

    it('labels seeded preferences with the synthetic source message id', async () => {
      const { body } = await routes.seedSession();

      const stored = await store.getPreferencesBySession(
        (body as SeedBody).sessionId,
      );
      for (const pref of stored) {
        expect(pref.sourceMessageId).toBe(DEMO_SEED_SOURCE_MESSAGE_ID);
      }
    });

    it('returns a session whose preferences are readable via getSessionPreferences', async () => {
      const { body } = await routes.seedSession();

      const read = await routes.getSessionPreferences(
        (body as SeedBody).sessionId,
      );
      expect(read.status).toBe(200);
    });

    it('creates an independent session on each call', async () => {
      const first = (await routes.seedSession()).body as SeedBody;
      const second = (await routes.seedSession()).body as SeedBody;

      expect(first.sessionId).not.toBe(second.sessionId);
    });

    it('seeds the whole fixture for the samantha persona', async () => {
      const { body } = await routes.seedSession('samantha');

      const stored = await store.getPreferencesBySession(
        (body as SeedBody).sessionId,
      );
      expect(stored).toHaveLength(DEMO_PROFILE_PREFERENCES.length);
      expect((body as SeedBody).preferenceCount).toBe(
        DEMO_PROFILE_PREFERENCES.length,
      );
    });

    it('seeds a usable but empty session for the fresh persona', async () => {
      const { status, body } = await routes.seedSession('fresh');

      // Still a real session — the conversation has to start somewhere, it just
      // starts with nothing known about the partner.
      expect(status).toBe(201);
      const { sessionId, preferenceCount } = body as SeedBody;
      expect(await store.getSession(sessionId)).not.toBeNull();
      expect(preferenceCount).toBe(0);
      expect(await store.getPreferencesBySession(sessionId)).toHaveLength(0);
    });

    it('leaves the fresh session unlabelled, since no partner is named yet', async () => {
      const { sessionId } = (await routes.seedSession('fresh'))
        .body as SeedBody;

      const session = await store.getSession(sessionId);
      expect(session?.partnerName ?? null).toBeNull();
    });

    it('falls back to the default persona on an id it does not know', async () => {
      // The id reaches here from an unauthenticated body, so a stranger's typo
      // must not be an error.
      const { body } = await routes.seedSession('not-a-persona');

      expect((body as SeedBody).preferenceCount).toBe(
        DEMO_PROFILE_PREFERENCES.length,
      );
    });

    it('seeds one session per past conversation, plus the live one', async () => {
      const samantha = resolvePersona('samantha');

      const { body } = await routes.seedSession('samantha');

      const { historyCount } = body as SeedBody;
      expect(historyCount).toBe((samantha.history?.length ?? 0) - 1);
      expect(await store.listSessions()).toHaveLength(historyCount + 1);
    });

    it('returns the newest session, and puts the preferences in it', async () => {
      const { sessionId } = (await routes.seedSession('samantha'))
        .body as SeedBody;

      // listSessions is newest-first, so this is the row the sidebar selects.
      const [newest] = await store.listSessions();
      expect(newest.id).toBe(sessionId);
      expect(await store.getPreferencesBySession(sessionId)).toHaveLength(
        DEMO_PROFILE_PREFERENCES.length,
      );
    });

    it('gives every seeded conversation a transcript and a sidebar title', async () => {
      await routes.seedSession('samantha');

      const sessions = await store.listSessions();
      for (const session of sessions) {
        expect(session.title).toBeTruthy();
        const messages = await store.getMessagesBySession(session.id);
        expect(messages.length).toBeGreaterThan(0);
        expect(session.messageCount).toBe(messages.length);
      }
    });

    it('backdates every transcript into the past, strictly in order', async () => {
      const before = Date.now();

      await routes.seedSession('samantha');

      for (const session of await store.listSessions()) {
        const stamps = (await store.getMessagesBySession(session.id)).map((m) =>
          new Date(m.timestamp).getTime(),
        );

        // Not NaN: a malformed ISO string would otherwise pass every comparison
        // below silently.
        for (const stamp of stamps) {
          expect(Number.isFinite(stamp)).toBe(true);
          expect(stamp).toBeLessThan(before);
        }
        for (let i = 1; i < stamps.length; i += 1) {
          expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
        }
      }
    });

    it('spreads the history over months, oldest conversation last in the list', async () => {
      await routes.seedSession('samantha');

      const sessions = await store.listSessions();
      const ages = sessions.map(
        (s) => Date.now() - new Date(s.lastActivity ?? s.createdAt).getTime(),
      );

      // Newest first, strictly — this is the order the sidebar renders.
      for (let i = 1; i < ages.length; i += 1) {
        expect(ages[i]).toBeGreaterThan(ages[i - 1]);
      }
      // And the oldest is genuinely months back, not minutes.
      expect(ages[ages.length - 1]).toBeGreaterThan(90 * 24 * 60 * 60 * 1000);
    });

    it('creates the sessions in the same order it backdates them', async () => {
      // Load-bearing for the real store, which cannot be checked here: the
      // DynamoDB store lists by descending `createdAt` (the GSI's sort key)
      // while this one sorts on `lastActivity`. The two agree only if the newest
      // conversation is also the last one created, so that is what is pinned.
      await routes.seedSession('samantha');

      const byRecency = await store.listSessions();
      const created = byRecency.map((s) => new Date(s.createdAt).getTime());

      for (let i = 1; i < created.length; i += 1) {
        expect(created[i]).toBeLessThanOrEqual(created[i - 1]);
      }
    });

    it('seeds no history at all for the fresh persona', async () => {
      const { body } = await routes.seedSession('fresh');
      const { sessionId, preferenceCount, historyCount } = body as SeedBody;

      expect(historyCount).toBe(0);
      expect(preferenceCount).toBe(0);
      const sessions = await store.listSessions();
      expect(sessions.map((s) => s.id)).toEqual([sessionId]);
      expect(await store.getMessagesBySession(sessionId)).toEqual([]);
      expect(sessions[0].title ?? null).toBeNull();
      expect(sessions[0].messageCount).toBe(0);
      expect(sessions[0].preferenceCount).toBe(0);
    });

    it('seeds her whole family into the same session', async () => {
      const { sessionId, peopleCount } = (await routes.seedSession('samantha'))
        .body as SeedBody;

      const stored = await store.getPeopleBySession(sessionId);
      expect(stored).toHaveLength(DEMO_PEOPLE.length);
      expect(peopleCount).toBe(DEMO_PEOPLE.length);
    });

    it('fills all four generation rungs, because the tree draws four', async () => {
      // A seed that filled three would leave the tree looking broken rather than
      // empty — the band with nobody in it still draws its label and its rung.
      const { sessionId } = (await routes.seedSession('samantha'))
        .body as SeedBody;

      const generations = new Set(
        (await store.getPeopleBySession(sessionId)).map((p) => p.generation),
      );
      expect([...generations].sort()).toEqual([
        'elder',
        'grandparent',
        'peer',
        'younger',
      ]);
    });

    it('keeps the two people whose names nobody has said', async () => {
      const { sessionId } = (await routes.seedSession('samantha'))
        .body as SeedBody;

      const gaps = (await store.getPeopleBySession(sessionId)).filter(isGap);
      expect(gaps).toHaveLength(2);
      // And they are still *someone* — a gap that lost its relationship would be
      // an empty card instead of a question worth asking.
      for (const gap of gaps) {
        expect(gap.relationship.length).toBeGreaterThan(0);
      }
    });

    it('re-seeding the same session overwrites her family rather than doubling it', async () => {
      // Ids are fixed in the fixture for exactly this. A presenter clicking the
      // demo button twice must not end up with two Ruths.
      const { sessionId } = (await routes.seedSession('samantha'))
        .body as SeedBody;
      const persona = resolvePersona('samantha');
      const stamp = new Date().toISOString();
      await store.savePeopleBatch(
        sessionId,
        (persona.people ?? []).map((person) => ({ ...person, updatedAt: stamp })),
      );

      expect(await store.getPeopleBySession(sessionId)).toHaveLength(
        DEMO_PEOPLE.length,
      );
    });

    it("seeds his to-do list, two of them already ticked", async () => {
      const { sessionId, taskCount } = (await routes.seedSession('samantha'))
        .body as SeedBody;

      const stored = await store.getTasksBySession(sessionId);
      expect(stored).toHaveLength(DEMO_TASKS.length);
      expect(taskCount).toBe(DEMO_TASKS.length);
      // The ticked pair is the whole reason tasks are stored and not derived.
      expect(stored.filter((task) => task.done)).toHaveLength(2);
    });

    it('resolves task dues against the seed moment, not a frozen date', async () => {
      const today = new Date().toISOString().slice(0, 10);

      const { sessionId } = (await routes.seedSession('samantha'))
        .body as SeedBody;

      const stored = await store.getTasksBySession(sessionId);
      // One due today, one with no date at all, and both ticked ones behind us.
      expect(stored.some((task) => task.due === today)).toBe(true);
      expect(stored.some((task) => !task.due)).toBe(true);
      for (const done of stored.filter((task) => task.done)) {
        expect(done.due! < today).toBe(true);
      }
    });

    it('leaves the fresh persona with no family and nothing to do', async () => {
      const { sessionId, peopleCount, taskCount } = (
        await routes.seedSession('fresh')
      ).body as SeedBody;

      expect(peopleCount).toBe(0);
      expect(taskCount).toBe(0);
      expect(await store.getPeopleBySession(sessionId)).toEqual([]);
      expect(await store.getTasksBySession(sessionId)).toEqual([]);
    });

    it('routes the persona through POST /session/seed', async () => {
      const result = await routes.handleRequest({
        method: 'POST',
        url: '/session/seed',
        params: {},
        body: { persona: 'fresh' },
      });

      expect((result.body as SeedBody).preferenceCount).toBe(0);
    });
  });

  // The contract test: the fixture is only useful if every key it writes still
  // resolves to a registry field, and every registry field gets a value.
  describe('seeded session covers the profile field registry', () => {
    it('resolves a value for every registry field', async () => {
      const { body } = await routes.seedSession();
      const stored = await store.getPreferencesBySession(
        (body as SeedBody).sessionId,
      );

      const resolvedFieldIds = new Set(
        stored
          .map((pref) => resolveField(pref.category, pref.key))
          .filter((id): id is string => id !== null),
      );

      const missing = PROFILE_FIELD_REGISTRY.filter(
        (field) => !resolvedFieldIds.has(field.id),
      ).map((field) => field.id);

      expect(missing).toEqual([]);
      expect(resolvedFieldIds.size).toBe(PROFILE_FIELD_REGISTRY.length);
    });

    it('has no seeded preference that fails to resolve to a field', async () => {
      const { body } = await routes.seedSession();
      const stored = await store.getPreferencesBySession(
        (body as SeedBody).sessionId,
      );

      const unresolved = stored
        .filter((pref) => resolveField(pref.category, pref.key) === null)
        .map((pref) => `${pref.category}:${pref.key}`);

      expect(unresolved).toEqual([]);
    });

    it('uses a valid enumOptions value for every enum field', async () => {
      const { body } = await routes.seedSession();
      const stored = await store.getPreferencesBySession(
        (body as SeedBody).sessionId,
      );

      for (const pref of stored) {
        const fieldId = resolveField(pref.category, pref.key);
        const field = PROFILE_FIELD_REGISTRY.find((f) => f.id === fieldId);
        if (field?.valueType === 'enum') {
          expect(field.enumOptions).toContain(pref.value);
        }
      }
    });

    it('uses ISO YYYY-MM-DD for every date field', async () => {
      const { body } = await routes.seedSession();
      const stored = await store.getPreferencesBySession(
        (body as SeedBody).sessionId,
      );

      for (const pref of stored) {
        const fieldId = resolveField(pref.category, pref.key);
        const field = PROFILE_FIELD_REGISTRY.find((f) => f.id === fieldId);
        if (field?.valueType === 'date') {
          expect(pref.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    });

    it('keeps every confidence within the plausible 0-1 range', () => {
      for (const pref of DEMO_PROFILE_PREFERENCES) {
        expect(pref.confidence).toBeGreaterThan(0);
        expect(pref.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('resetSession', () => {
    it('empties a populated session', async () => {
      const { body } = await routes.seedSession();
      const { sessionId } = body as SeedBody;

      const result = await routes.resetSession(sessionId);

      expect(result.status).toBe(200);
      expect(await store.getPreferencesBySession(sessionId)).toEqual([]);
    });

    it('leaves the session itself usable', async () => {
      const { body } = await routes.seedSession();
      const { sessionId } = body as SeedBody;

      await routes.resetSession(sessionId);

      const read = await routes.getSessionPreferences(sessionId);
      expect(read.status).toBe(200);
      expect(read.body).toEqual({ preferences: [] });
    });

    it('responds 404 for an unknown session id', async () => {
      const result = await routes.resetSession('no-such-session');

      expect(result.status).toBe(404);
      expect(result.body).toEqual({ error: 'Session not found' });
    });
  });

  describe('listSessions', () => {
    it('reports an empty list before anything exists', async () => {
      const result = await routes.listSessions();

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ sessions: [] });
    });

    it("returns the caller's own sessions, the live one first", async () => {
      // The seed now creates the persona's backdated history alongside the live
      // conversation, so this is a list, not a single row — and the one the seed
      // handed back has to be at the top of it.
      const { body } = await routes.seedSession();
      const { sessionId, historyCount } = body as SeedBody;

      const result = await routes.listSessions();

      const { sessions } = result.body as { sessions: { id: string }[] };
      expect(sessions).toHaveLength(historyCount + 1);
      expect(sessions[0].id).toBe(sessionId);
    });

    it("does not leak another user's sessions", async () => {
      // Both stores come from one factory, so they share the underlying data —
      // otherwise this would pass trivially and prove nothing.
      const factory = new InMemoryStoreFactory();
      const alice = createHttpRoutes(factory.forUser('alice'));
      const bob = createHttpRoutes(factory.forUser('bob'));
      await alice.seedSession();

      const result = await bob.listSessions();

      expect(result.body).toEqual({ sessions: [] });
    });

    it('carries the partner name, so the sidebar can label an entry', async () => {
      await routes.seedSession();

      const { sessions } = (await routes.listSessions()).body as {
        sessions: { partnerName: string | null }[];
      };
      expect(sessions[0].partnerName).toBe('Samantha');
    });
  });

  describe('getSessionDetail', () => {
    it('returns the session with its messages and preferences', async () => {
      const { body } = await routes.seedSession();
      const { sessionId } = body as SeedBody;
      await store.saveMessage({
        id: 'm1',
        sessionId,
        sender: 'user',
        content: 'she loves peonies',
        timestamp: new Date().toISOString(),
      });

      const result = await routes.getSessionDetail(sessionId);

      expect(result.status).toBe(200);
      const detail = result.body as {
        session: { id: string };
        messages: { content: string }[];
        preferences: unknown[];
      };
      expect(detail.session.id).toBe(sessionId);
      // The live session arrives with its own seeded transcript, so the message
      // written above is the newest one rather than the only one.
      const contents = detail.messages.map((m) => m.content);
      expect(contents.length).toBeGreaterThan(1);
      expect(contents[contents.length - 1]).toBe('she loves peonies');
      expect(detail.preferences).toHaveLength(DEMO_PROFILE_PREFERENCES.length);
    });

    it('responds 404 for an unknown session id', async () => {
      const result = await routes.getSessionDetail('no-such-session');

      expect(result.status).toBe(404);
      expect(result.body).toEqual({ error: 'Session not found' });
    });

    it('responds 404 for a session belonging to someone else', async () => {
      // The 404 is structural: the caller's user id is part of the storage key,
      // so the read misses rather than being rejected by a check.
      const factory = new InMemoryStoreFactory();
      const alice = createHttpRoutes(factory.forUser('alice'));
      const bob = createHttpRoutes(factory.forUser('bob'));
      const { sessionId } = (await alice.seedSession()).body as SeedBody;

      const result = await bob.getSessionDetail(sessionId);

      expect(result.status).toBe(404);
      expect(JSON.stringify(result.body)).not.toContain('Samantha');
    });
  });

  describe('renameSession', () => {
    it('gives the conversation the name the sidebar shows', async () => {
      const { sessionId } = (await routes.seedSession()).body as SeedBody;

      const result = await routes.renameSession(sessionId, '  Anniversary  ');

      expect(result.status).toBe(200);
      const session = await store.getSession(sessionId);
      expect(session?.title).toBe('Anniversary');
    });

    it('clears the title when renamed to blank, falling back to the partner', async () => {
      const { sessionId } = (await routes.seedSession()).body as SeedBody;
      await routes.renameSession(sessionId, 'Temporary');

      await routes.renameSession(sessionId, '   ');

      const session = await store.getSession(sessionId);
      expect(session?.title).toBeNull();
      expect(session?.partnerName).toBe('Samantha');
    });

    it('rejects a missing title rather than storing undefined', async () => {
      const { sessionId } = (await routes.seedSession()).body as SeedBody;

      const result = await routes.renameSession(sessionId, undefined);

      expect(result.status).toBe(400);
    });

    it("cannot rename someone else's conversation", async () => {
      const factory = new InMemoryStoreFactory();
      const aliceStore = factory.forUser('alice');
      const alice = createHttpRoutes(aliceStore);
      const bob = createHttpRoutes(factory.forUser('bob'));
      const { sessionId } = (await alice.seedSession()).body as SeedBody;
      // The seed titles the conversation, so "untouched" is "still what the seed
      // called it", not "still blank".
      const titleBefore = (await aliceStore.getSession(sessionId))?.title;

      const result = await bob.renameSession(sessionId, 'Bob was here');

      expect(result.status).toBe(404);
      expect((await aliceStore.getSession(sessionId))?.title).toBe(titleBefore);
    });
  });

  describe('deleteSession', () => {
    it('removes the conversation and its contents', async () => {
      const { sessionId } = (await routes.seedSession()).body as SeedBody;

      const result = await routes.deleteSession(sessionId);

      expect(result.status).toBe(200);
      expect(await store.getSession(sessionId)).toBeNull();
      expect(await store.getPreferencesBySession(sessionId)).toEqual([]);
    });

    it('responds 404 for an unknown session id', async () => {
      expect((await routes.deleteSession('no-such-session')).status).toBe(404);
    });

    it("cannot delete someone else's conversation", async () => {
      // The one that matters: a 404 here has to mean "untouched", not "gone".
      const factory = new InMemoryStoreFactory();
      const aliceStore = factory.forUser('alice');
      const alice = createHttpRoutes(aliceStore);
      const bob = createHttpRoutes(factory.forUser('bob'));
      const { sessionId } = (await alice.seedSession()).body as SeedBody;

      const result = await bob.deleteSession(sessionId);

      expect(result.status).toBe(404);
      expect(await aliceStore.getSession(sessionId)).not.toBeNull();
    });
  });

  describe('listIntegrations', () => {
    it('reports every integration, in the shared order', async () => {
      const result = await routes.listIntegrations();

      expect(result.status).toBe(200);
      const { integrations } = result.body as IntegrationStatusResponse;
      expect(integrations.map((entry) => entry.id)).toEqual([
        ...INTEGRATION_IDS,
      ]);
      // Hebcal is a local calculation and Ontopo's endpoints need no auth, so
      // these two are ready in any deployment — including a test run with an
      // entirely empty environment.
      expect(integrations.find((e) => e.id === 'hebcal')?.configured).toBe(true);
      expect(integrations.find((e) => e.id === 'ontopo')?.configured).toBe(true);
    });

    it('labels every integration for a human', async () => {
      const { integrations } = (await routes.listIntegrations())
        .body as IntegrationStatusResponse;

      // Without this the panel would render the raw id, and one of them is
      // `google-calendar`.
      for (const entry of integrations) {
        expect(entry.label.length).toBeGreaterThan(0);
        expect(entry.label).not.toBe(entry.id);
      }
    });

    it('carries nothing but ids, labels and booleans', async () => {
      const { integrations } = (await routes.listIntegrations())
        .body as IntegrationStatusResponse;

      /*
       * The point of the endpoint is that the UI can say "not configured"
       * without ever seeing a secret. A masked or truncated credential would
       * answer the same question while putting part of a real token into a
       * public payload, so the shape is asserted exactly rather than loosely.
       */
      for (const entry of integrations) {
        expect(Object.keys(entry).sort()).toEqual([
          'configured',
          'id',
          'label',
        ]);
        expect(typeof entry.configured).toBe('boolean');
      }
    });
  });

  describe('handleRequest routing', () => {
    it('routes GET /integrations to listIntegrations', async () => {
      const result = await routes.handleRequest({
        method: 'GET',
        url: '/integrations',
        params: {},
        body: null,
      });

      expect(result.status).toBe(200);
      expect(
        (result.body as IntegrationStatusResponse).integrations,
      ).toHaveLength(INTEGRATION_IDS.length);
    });

    it('routes PATCH /session/:id to renameSession', async () => {
      const { sessionId } = (await routes.seedSession()).body as SeedBody;

      const result = await routes.handleRequest({
        method: 'PATCH',
        url: `/session/${sessionId}`,
        params: {},
        body: { title: 'Renamed' },
      });

      expect(result.status).toBe(200);
      expect((await store.getSession(sessionId))?.title).toBe('Renamed');
    });

    it('routes DELETE /session/:id to deleteSession', async () => {
      const { sessionId } = (await routes.seedSession()).body as SeedBody;

      const result = await routes.handleRequest({
        method: 'DELETE',
        url: `/session/${sessionId}`,
        params: {},
        body: null,
      });

      expect(result.status).toBe(200);
      expect(await store.getSession(sessionId)).toBeNull();
    });

    it('routes GET /sessions to listSessions', async () => {
      const { historyCount } = (await routes.seedSession()).body as SeedBody;

      const result = await routes.handleRequest({
        method: 'GET',
        url: '/sessions',
        params: {},
        body: null,
      });

      expect(result.status).toBe(200);
      expect((result.body as { sessions: unknown[] }).sessions).toHaveLength(
        historyCount + 1,
      );
    });

    it('routes GET /session/:id to getSessionDetail', async () => {
      const { sessionId } = (await routes.seedSession()).body as SeedBody;

      const result = await routes.handleRequest({
        method: 'GET',
        url: `/session/${sessionId}`,
        params: {},
        body: null,
      });

      expect(result.status).toBe(200);
      expect((result.body as { session: { id: string } }).session.id).toBe(sessionId);
    });

    it('does not let GET /session/:id shadow the preferences route', async () => {
      const { sessionId } = (await routes.seedSession()).body as SeedBody;

      const result = await routes.handleRequest({
        method: 'GET',
        url: `/session/${sessionId}/preferences`,
        params: {},
        body: null,
      });

      expect(result.body).toHaveProperty('preferences');
      expect(result.body).not.toHaveProperty('session');
    });

    it('routes POST /session/seed to seedSession', async () => {
      const result = await routes.handleRequest({
        method: 'POST',
        url: '/session/seed',
        params: {},
        body: null,
      });

      expect(result.status).toBe(201);
      expect((result.body as SeedBody).preferenceCount).toBe(
        DEMO_PROFILE_PREFERENCES.length,
      );
    });

    it('does not treat "seed" as a session id', async () => {
      const result = await routes.handleRequest({
        method: 'POST',
        url: '/session/seed',
        params: {},
        body: null,
      });

      // A shadowed route would have produced a 404 'Session not found'.
      expect(result.status).not.toBe(404);
    });

    it('routes POST /session/:id/reset to resetSession', async () => {
      const seeded = await routes.handleRequest({
        method: 'POST',
        url: '/session/seed',
        params: {},
        body: null,
      });
      const { sessionId } = seeded.body as SeedBody;

      const result = await routes.handleRequest({
        method: 'POST',
        url: `/session/${sessionId}/reset`,
        params: {},
        body: null,
      });

      expect(result.status).toBe(200);
      expect(await store.getPreferencesBySession(sessionId)).toEqual([]);
    });

    it('routes a reset for an unknown session to a 404', async () => {
      const result = await routes.handleRequest({
        method: 'POST',
        url: '/session/bogus-id/reset',
        params: {},
        body: null,
      });

      expect(result.status).toBe(404);
    });

    it('still routes POST /session to createSession', async () => {
      const result = await routes.handleRequest({
        method: 'POST',
        url: '/session',
        params: {},
        body: null,
      });

      expect(result.status).toBe(201);
      expect(result.body).not.toHaveProperty('preferenceCount');
    });
  });
  // --- People, tasks and manual corrections ---

  describe('her people', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await store.createSession();
    });

    it('adds a person and reads them back', async () => {
      const result = await routes.savePerson(sessionId, {
        name: 'Leah',
        relationship: 'Older sister',
        generation: 'peer',
        birthday: '1988-09-09',
      });

      expect(result.status).toBe(200);
      const listed = await routes.getSessionPeople(sessionId);
      expect((listed.body as { people: unknown[] }).people).toHaveLength(1);
    });

    it('accepts a person with no name, because that is the gap the tree prompts about', async () => {
      const result = await routes.savePerson(sessionId, { relationship: 'Uncle' });

      expect(result.status).toBe(200);
      expect((result.body as { person: { name: string | null } }).person.name).toBeNull();
    });

    it('collapses a blank name to null rather than storing an empty string', async () => {
      // Two spellings of the same gap would leave `isGap` as the only thing
      // between a stray space and a person called "".
      const result = await routes.savePerson(sessionId, {
        name: '   ',
        relationship: 'Cousin',
      });

      expect((result.body as { person: { name: string | null } }).person.name).toBeNull();
    });

    it('rejects a person with no relationship', async () => {
      // The relationship is what labels the node; without one there is nothing to
      // draw, named or not.
      const result = await routes.savePerson(sessionId, { name: 'Leah' });

      expect(result.status).toBe(400);
    });

    it('drops an unparseable birthday instead of storing it', async () => {
      // The countdown parses these — a bad date renders as "NaN days" beside her
      // name, which is worse than no date.
      const result = await routes.savePerson(sessionId, {
        relationship: 'Mother',
        birthday: 'next spring',
      });

      expect((result.body as { person: { birthday: string | null } }).person.birthday).toBeNull();
    });

    it('falls back on a generation the tree cannot draw', async () => {
      const result = await routes.savePerson(sessionId, {
        relationship: 'Great-aunt',
        generation: 'ancestor',
      });

      expect((result.body as { person: { generation: string } }).person.generation).toBe('elder');
    });

    it('mints an id when the client does not supply one', async () => {
      const result = await routes.savePerson(sessionId, { relationship: 'Brother' });

      expect((result.body as { person: { id: string } }).person.id).toBeTruthy();
    });

    it('revises rather than duplicates when the id is resent', async () => {
      const first = await routes.savePerson(sessionId, { relationship: 'Sister' });
      const { id } = (first.body as { person: { id: string } }).person;

      await routes.savePerson(sessionId, { id, relationship: 'Sister', name: 'Nadia' });

      const listed = await routes.getSessionPeople(sessionId);
      const people = (listed.body as { people: { name: string | null }[] }).people;
      expect(people).toHaveLength(1);
      expect(people[0].name).toBe('Nadia');
    });

    it('deletes one person', async () => {
      const added = await routes.savePerson(sessionId, { relationship: 'Sister' });
      const { id } = (added.body as { person: { id: string } }).person;

      await routes.deletePerson(sessionId, id);

      expect((await routes.getSessionPeople(sessionId)).body).toEqual({ people: [] });
    });

    it('responds 404 for a session that is not the caller\'s', async () => {
      for (const call of [
        routes.getSessionPeople('nope'),
        routes.savePerson('nope', { relationship: 'Sister' }),
        routes.deletePerson('nope', 'p1'),
      ]) {
        expect((await call).status).toBe(404);
      }
    });
  });

  describe('his tasks', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await store.createSession();
    });

    it('adds a task and reads it back open', async () => {
      const result = await routes.saveTask(sessionId, {
        title: 'Book somewhere for the anniversary',
        due: '2026-09-11',
      });

      expect(result.status).toBe(200);
      expect((result.body as { task: { done: boolean } }).task.done).toBe(false);
    });

    it('rejects a task with no title', async () => {
      expect((await routes.saveTask(sessionId, { due: '2026-09-11' })).status).toBe(400);
    });

    it('keeps createdAt when the client resends a task to tick it', async () => {
      // Otherwise ticking a task would reset how long it had been outstanding,
      // which is the one thing the row's age is for.
      const added = await routes.saveTask(sessionId, { title: 'Draft the card' });
      const task = (added.body as { task: { id: string; createdAt: string } }).task;

      const ticked = await routes.saveTask(sessionId, { ...task, done: true });

      const body = (ticked.body as { task: { createdAt: string; done: boolean } }).task;
      expect(body.createdAt).toBe(task.createdAt);
      expect(body.done).toBe(true);
    });

    it('deletes one task', async () => {
      const added = await routes.saveTask(sessionId, { title: 'Draft the card' });
      const { id } = (added.body as { task: { id: string } }).task;

      await routes.deleteTask(sessionId, id);

      expect((await routes.getSessionTasks(sessionId)).body).toEqual({ tasks: [] });
    });
  });

  describe('manual corrections', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await store.createSession();
    });

    it('stores the user\'s own answer for a field', async () => {
      const result = await routes.setManualValue(sessionId, 'bra_size', { value: '34B' });

      expect(result.status).toBe(200);
      expect((await routes.getManualValues(sessionId)).body).toEqual({
        manualValues: { bra_size: '34B' },
      });
    });

    it('rejects a field id the registry does not have', async () => {
      // A row nothing reads back would let the correction appear to save and then
      // vanish on reload — the exact failure this route exists to fix.
      const result = await routes.setManualValue(sessionId, 'favourite_dinosaur', {
        value: 'Stegosaurus',
      });

      expect(result.status).toBe(400);
    });

    it('rejects a blank value, since clearing has its own verb', async () => {
      expect(
        (await routes.setManualValue(sessionId, 'bra_size', { value: '  ' })).status,
      ).toBe(400);
    });

    it('clears one value and leaves the others', async () => {
      await routes.setManualValue(sessionId, 'bra_size', { value: '34B' });
      await routes.setManualValue(sessionId, 'shoe_size', { value: 'UK 6' });

      await routes.clearManualValue(sessionId, 'bra_size');

      expect((await routes.getManualValues(sessionId)).body).toEqual({
        manualValues: { shoe_size: 'UK 6' },
      });
    });

    it('checks the field id before it checks the session, so a typo is a 400', async () => {
      // A 404 here would send the client looking for a missing session when the
      // real fault is the field name it sent.
      expect(
        (await routes.setManualValue('nope', 'favourite_dinosaur', { value: 'x' })).status,
      ).toBe(400);
    });
  });

  describe('dispatching the new routes', () => {
    it('routes each verb to its handler', async () => {
      const sessionId = await store.createSession();

      const added = await routes.handleRequest({
        method: 'POST',
        url: `/session/${sessionId}/people`,
        params: {},
        body: { name: 'Leah', relationship: 'Older sister' },
      });
      expect(added.status).toBe(200);
      const { id } = (added.body as { person: { id: string } }).person;

      const listed = await routes.handleRequest({
        method: 'GET',
        url: `/session/${sessionId}/people`,
        params: {},
        body: null,
      });
      expect((listed.body as { people: unknown[] }).people).toHaveLength(1);

      const removed = await routes.handleRequest({
        method: 'DELETE',
        url: `/session/${sessionId}/people/${id}`,
        params: {},
        body: null,
      });
      expect(removed.status).toBe(200);

      const corrected = await routes.handleRequest({
        method: 'PUT',
        url: `/session/${sessionId}/manual/bra_size`,
        params: {},
        body: { value: '34B' },
      });
      expect(corrected.status).toBe(200);

      const tasked = await routes.handleRequest({
        method: 'POST',
        url: `/session/${sessionId}/tasks`,
        params: {},
        body: { title: 'Draft the card' },
      });
      expect(tasked.status).toBe(200);
    });
  });
});
