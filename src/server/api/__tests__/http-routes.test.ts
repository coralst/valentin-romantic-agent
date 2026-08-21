import { describe, it, expect, beforeEach } from 'vitest';
import { createHttpRoutes } from '../http-routes';
import { InMemoryStore } from '../../persistence/in-memory-store';
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
  let store: InMemoryStore;
  let routes: ReturnType<typeof createHttpRoutes>;

  beforeEach(() => {
    store = new InMemoryStore();
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

  describe('handleRequest routing', () => {
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
