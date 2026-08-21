import { describe, it, expect, beforeEach } from 'vitest';
import { createHttpRoutes } from '../http-routes';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { StorageInterface } from '../../persistence/storage-interface';
import {
  DEMO_PROFILE_PREFERENCES,
  DEMO_SEED_SOURCE_MESSAGE_ID,
} from '../../fixtures/demo-profile';
import { PROFILE_FIELD_REGISTRY } from '../../../client/utils/profile-field-registry';
import { resolveField } from '../../../client/utils/preference-field-mapper';

interface SeedBody {
  sessionId: string;
  preferenceCount: number;
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
  });

  // The contract test: the fixture is only useful if every key it writes still
  // resolves to a registry field, and every registry field gets a value.
  describe('seeded session covers the profile field registry', () => {
    it('resolves a value for all 18 registry fields', async () => {
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

    it("returns the caller's own sessions", async () => {
      const { body } = await routes.seedSession();
      const { sessionId } = body as SeedBody;

      const result = await routes.listSessions();

      const { sessions } = result.body as { sessions: { id: string }[] };
      expect(sessions.map((s) => s.id)).toEqual([sessionId]);
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
      expect(sessions[0].partnerName).toBe('Mirabel');
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
      expect(detail.messages.map((m) => m.content)).toEqual(['she loves peonies']);
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
      expect(JSON.stringify(result.body)).not.toContain('Mirabel');
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
      expect(session?.partnerName).toBe('Mirabel');
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

      const result = await bob.renameSession(sessionId, 'Bob was here');

      expect(result.status).toBe(404);
      expect((await aliceStore.getSession(sessionId))?.title).toBeFalsy();
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

  describe('handleRequest routing', () => {
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
      await routes.seedSession();

      const result = await routes.handleRequest({
        method: 'GET',
        url: '/sessions',
        params: {},
        body: null,
      });

      expect(result.status).toBe(200);
      expect((result.body as { sessions: unknown[] }).sessions).toHaveLength(1);
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
});
