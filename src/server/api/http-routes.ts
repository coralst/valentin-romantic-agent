import type { StorageInterface } from '../persistence/storage-interface';
import {
  DEMO_PROFILE_PREFERENCES,
  DEMO_SEED_SOURCE_MESSAGE_ID,
} from '../fixtures/demo-profile';

/** Simple framework-agnostic request representation */
export interface HttpRequest {
  method: string;
  url: string;
  params: Record<string, string>;
  body: unknown;
}

/** Simple framework-agnostic response representation */
export interface HttpResponse {
  status: number;
  body: unknown;
}

/**
 * Persist every demo fixture preference into a session.
 *
 * Returns the number of preferences written.
 */
async function seedDemoProfile(
  storage: StorageInterface,
  sessionId: string,
): Promise<number> {
  for (const pref of DEMO_PROFILE_PREFERENCES) {
    await storage.savePreference({
      sessionId,
      category: pref.category,
      key: pref.key,
      value: pref.value,
      confidence: pref.confidence,
      // Seeded rows have no originating conversation turn — see the fixture.
      sourceMessageId: DEMO_SEED_SOURCE_MESSAGE_ID,
    });
  }

  return DEMO_PROFILE_PREFERENCES.length;
}

/** Creates HTTP route handlers bound to the given storage */
export function createHttpRoutes(storage: StorageInterface) {
  return {
    /** GET /health — health check */
    async health(): Promise<HttpResponse> {
      return { status: 200, body: { status: 'ok' } };
    },

    /** POST /session — create a new session */
    async createSession(): Promise<HttpResponse> {
      const sessionId = await storage.createSession();
      return { status: 201, body: { sessionId } };
    },

    /** GET /session/:id/preferences — get preferences for a session */
    async getSessionPreferences(
      sessionId: string,
    ): Promise<HttpResponse> {
      const session = await storage.getSession(sessionId);
      if (!session) {
        return {
          status: 404,
          body: { error: 'Session not found' },
        };
      }

      const preferences =
        await storage.getPreferencesBySession(sessionId);
      return { status: 200, body: { preferences } };
    },

    /**
     * POST /session/seed — create a session pre-populated with the demo profile.
     *
     * Used to open a presentation on a fully populated partner profile rather
     * than an empty panel.
     */
    async seedSession(): Promise<HttpResponse> {
      const sessionId = await storage.createSession();
      const preferenceCount = await seedDemoProfile(storage, sessionId);

      return { status: 201, body: { sessionId, preferenceCount } };
    },

    /** POST /session/:id/reset — drop a session's preferences and messages */
    async resetSession(sessionId: string): Promise<HttpResponse> {
      const session = await storage.getSession(sessionId);
      if (!session) {
        return {
          status: 404,
          body: { error: 'Session not found' },
        };
      }

      await storage.clearSession(sessionId);
      return { status: 200, body: { sessionId, cleared: true } };
    },

    /** Route an incoming request to the appropriate handler */
    async handleRequest(req: HttpRequest): Promise<HttpResponse> {
      // GET /health
      if (req.method === 'GET' && req.url === '/health') {
        return this.health();
      }

      // POST /session/seed — must precede any /session/:id pattern so the
      // literal "seed" segment is never captured as a session id.
      if (req.method === 'POST' && req.url === '/session/seed') {
        return this.seedSession();
      }

      // POST /session
      if (req.method === 'POST' && req.url === '/session') {
        return this.createSession();
      }

      // POST /session/:id/reset
      const resetMatch = req.url.match(/^\/session\/([^/]+)\/reset$/);
      if (req.method === 'POST' && resetMatch) {
        return this.resetSession(resetMatch[1]);
      }

      // GET /session/:id/preferences
      const prefMatch = req.url.match(
        /^\/session\/([^/]+)\/preferences$/,
      );
      if (req.method === 'GET' && prefMatch) {
        return this.getSessionPreferences(prefMatch[1]);
      }

      return { status: 404, body: { error: 'Not found' } };
    },
  };
}
