import type { StorageInterface } from '../persistence/storage-interface';
import {
  DEMO_PROFILE_PREFERENCES,
  DEMO_SEED_SOURCE_MESSAGE_ID,
} from '../fixtures/demo-profile';
import { isPartnerNamePreference } from '../extraction/partner-name';

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
 * One batch, not a loop. Written one at a time each fixture is a put *plus* a
 * counter update — 36 sequential round trips, one to two seconds on the single
 * most visible click in the product.
 *
 * Returns the number of preferences written.
 */
async function seedDemoProfile(
  storage: StorageInterface,
  sessionId: string,
): Promise<number> {
  const written = await storage.savePreferencesBatch(
    sessionId,
    DEMO_PROFILE_PREFERENCES.map((pref) => ({
      ...pref,
      // Seeded rows have no originating conversation turn — see the fixture.
      sourceMessageId: DEMO_SEED_SOURCE_MESSAGE_ID,
    })),
  );

  // Label the conversation in the sidebar. The extractor does this as a real
  // conversation reveals the name; a seeded profile knows it up front.
  const name = DEMO_PROFILE_PREFERENCES.find((pref) =>
    isPartnerNamePreference(pref.category, pref.key),
  );
  if (name) {
    await storage.updateSessionMeta(sessionId, { partnerName: name.value });
  }

  return written.length;
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

    /**
     * GET /sessions — every session belonging to the caller, newest first.
     *
     * One GSI query. Only session metadata rows carry the index keys, so this
     * reads one item per session rather than filtering a partition scan.
     */
    async listSessions(): Promise<HttpResponse> {
      const sessions = await storage.listSessions();
      return { status: 200, body: { sessions } };
    },

    /**
     * GET /session/:id — one session with its full contents.
     *
     * This is the route that makes the sidebar real. Until now the client kept
     * sessions in localStorage and never stored a single message in them, so
     * switching conversations always landed on an empty transcript.
     *
     * Messages and preferences come back together because they share the
     * session's partition — fetching them separately would cost a second round
     * trip for no benefit on the one interaction that must feel instant.
     */
    async getSessionDetail(sessionId: string): Promise<HttpResponse> {
      const session = await storage.getSession(sessionId);
      if (!session) {
        // Covers "no such session" and "belongs to someone else" alike: the key
        // includes the caller, so it simply misses either way.
        return { status: 404, body: { error: 'Session not found' } };
      }

      const [messages, preferences] = await Promise.all([
        storage.getMessagesBySession(sessionId),
        storage.getPreferencesBySession(sessionId),
      ]);

      return { status: 200, body: { session, messages, preferences } };
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

    /**
     * PATCH /session/:id — rename a conversation.
     *
     * The sidebar has offered rename since before there was a server, backed by
     * localStorage. Now that the list is server-owned, a rename with nowhere to
     * go would silently revert on the next reload — worse than not offering it.
     */
    async renameSession(
      sessionId: string,
      title: unknown,
    ): Promise<HttpResponse> {
      if (typeof title !== 'string') {
        return { status: 400, body: { error: 'A title is required' } };
      }

      const session = await storage.getSession(sessionId);
      if (!session) {
        return { status: 404, body: { error: 'Session not found' } };
      }

      // An empty title clears the custom name and falls back to the partner's,
      // which is what the inline editor sends when the field is emptied.
      const trimmed = title.trim();
      await storage.updateSessionMeta(sessionId, {
        title: trimmed.length > 0 ? trimmed.slice(0, 120) : null,
      });

      return { status: 200, body: { sessionId, title: trimmed || null } };
    },

    /** DELETE /session/:id — remove a conversation and everything in it */
    async deleteSession(sessionId: string): Promise<HttpResponse> {
      const session = await storage.getSession(sessionId);
      if (!session) {
        // The key names the caller, so this is also the cross-tenant answer.
        return { status: 404, body: { error: 'Session not found' } };
      }

      await storage.deleteSession(sessionId);
      return { status: 200, body: { sessionId, deleted: true } };
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

      // GET /sessions
      if (req.method === 'GET' && req.url === '/sessions') {
        return this.listSessions();
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

      // /session/:id — last, so the more specific patterns above win
      const detailMatch = req.url.match(/^\/session\/([^/]+)$/);
      if (detailMatch) {
        if (req.method === 'GET') return this.getSessionDetail(detailMatch[1]);
        if (req.method === 'PATCH') {
          const patch = (req.body ?? {}) as { title?: unknown };
          return this.renameSession(detailMatch[1], patch.title);
        }
        if (req.method === 'DELETE') return this.deleteSession(detailMatch[1]);
      }

      return { status: 404, body: { error: 'Not found' } };
    },
  };
}
