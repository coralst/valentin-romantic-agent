import type {
  ExtractedPreference,
  StorageInterface,
} from '../persistence/storage-interface';
import { DEMO_SEED_SOURCE_MESSAGE_ID } from '../fixtures/demo-profile';
import { resolvePersona } from '../fixtures/demo-personas';
import type { DemoConversation } from '../fixtures/demo-personas';
import { isPartnerNamePreference } from '../extraction/partner-name';
import { buildToolRegistry, integrationReadiness } from '../integrations';
import type { IntegrationStatusResponse } from '../../shared/interfaces/integrations';
import {
  INTEGRATION_IDS,
  INTEGRATION_LABELS,
} from '../../shared/interfaces/integrations';
import {
  applyIntegrationCredentials,
  clearIntegrationCredentials,
  isConnectable,
} from '../integrations/credentials';
import { buildAuthUrl } from '../integrations/google/oauth';

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
 * Persist a persona's preferences into a session.
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
  preferences: readonly ExtractedPreference[],
): Promise<number> {
  // The "start fresh" persona has nothing to write, and an empty batch is a
  // round trip some storage backends reject outright.
  if (preferences.length === 0) return 0;

  const written = await storage.savePreferencesBatch(
    sessionId,
    preferences.map((pref) => ({
      ...pref,
      // Seeded rows have no originating conversation turn — see the fixture.
      sourceMessageId: DEMO_SEED_SOURCE_MESSAGE_ID,
    })),
  );

  // Label the conversation in the sidebar. The extractor does this as a real
  // conversation reveals the name; a seeded profile knows it up front.
  const name = preferences.find((pref) =>
    isPartnerNamePreference(pref.category, pref.key),
  );
  if (name) {
    await storage.updateSessionMeta(sessionId, { partnerName: name.value });
  }

  return written.length;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far apart two consecutive turns of a seeded transcript are placed */
const TURN_SPACING_MS = 4 * 60 * 1000;

/**
 * Fill an already-created session with one backdated conversation.
 *
 * `createSession` always stamps `createdAt` to now and there is no way through
 * the storage contract to move it — it is baked into the GSI's sort key. What
 * *can* be backdated is `lastActivity`, because `saveMessage` sets it from the
 * message's own timestamp, and `lastActivity` is what the sidebar renders
 * ("4 months ago · 9 messages"). So the age of a seeded conversation lives
 * entirely in its messages.
 *
 * Timestamps run from `daysAgo` backwards by one spacing per remaining turn, so
 * the last turn lands just under `daysAgo` and every turn — including today's
 * conversation — is strictly in the past and strictly after the one before it.
 */
async function fillConversation(
  storage: StorageInterface,
  sessionId: string,
  conversation: DemoConversation,
  now: number,
): Promise<void> {
  const end = now - conversation.daysAgo * DAY_MS;
  const turnCount = conversation.turns.length;

  // Sequential, not batched: each `saveMessage` moves `lastActivity` forward, so
  // running them concurrently would leave the session showing whichever write
  // happened to land last. A handful of fixtures is worth the round trips.
  for (const [index, turn] of conversation.turns.entries()) {
    await storage.saveMessage({
      id: `${DEMO_SEED_SOURCE_MESSAGE_ID}-${sessionId}-${index}`,
      sessionId,
      sender: turn.sender,
      content: turn.content,
      timestamp: new Date(end - (turnCount - index) * TURN_SPACING_MS).toISOString(),
    });
  }

  // Without a title every row in the sidebar reads "Samantha", since the
  // denormalised partner name is the fallback label.
  await storage.updateSessionMeta(sessionId, { title: conversation.title });
}

/** Creates HTTP route handlers bound to the given storage */
export function createHttpRoutes(storage: StorageInterface) {
  return {
    /** GET /health — health check */
    async health(): Promise<HttpResponse> {
      return { status: 200, body: { status: 'ok' } };
    },

    /**
     * GET /integrations — which outside services this deployment can reach.
     *
     * Booleans and nothing else. There is no credential in this response, not
     * even a masked or truncated one: the client needs to know whether Gmail
     * works, and a prefix of a refresh token would answer that question while
     * also putting part of a secret into a public-facing payload and into every
     * browser devtools log that captures it.
     *
     * Needs no session and no storage — readiness is a property of the process.
     *
     * Ordered by `INTEGRATION_IDS` rather than by whatever order the readiness
     * object happens to enumerate in, so the panel's rows do not reshuffle if
     * someone reorders that function.
     */
    async listIntegrations(): Promise<HttpResponse> {
      return { status: 200, body: this.readinessBody() };
    },

    /**
     * POST /integrations/:id/connect — hand this deployment a credential.
     *
     * The response is the same readiness list `listIntegrations` returns, plus a
     * sentence to show. That shape is deliberate: the caller needs to re-render
     * from the truth rather than assume its own request succeeded, and returning
     * readiness here saves a follow-up GET that could race the rebuild.
     *
     * Nothing in the response echoes what was sent. A route that confirmed a
     * credential by quoting it back would put a secret in the browser's network
     * log for no gain — the visitor typed it, they do not need it read aloud.
     */
    async connectIntegration(id: string, body: unknown): Promise<HttpResponse> {
      if (!isConnectable(id)) {
        return { status: 404, body: { error: 'No such connectable integration' } };
      }
      const fields = (body ?? {}) as Record<string, unknown>;
      const result = await applyIntegrationCredentials(id, fields);
      if (!result.ok) {
        return { status: result.status, body: { error: result.message } };
      }

      // Pick up tools for whatever just became configured. Without this the
      // panel would say "live" while the model still had no tool to call.
      buildToolRegistry();
      return {
        status: 200,
        body: { message: result.message, ...(this.readinessBody() as object) },
      };
    },

    /**
     * POST /integrations/:id/disconnect — take a credential away again.
     *
     * Rebuilds the registry too, so the tools actually disappear. A model still
     * holding a tool for a disconnected service would call it and fail, which
     * reads to the user as a broken integration rather than an absent one.
     */
    async disconnectIntegration(id: string): Promise<HttpResponse> {
      if (!isConnectable(id)) {
        return { status: 404, body: { error: 'No such connectable integration' } };
      }
      clearIntegrationCredentials(id);
      buildToolRegistry();
      return {
        status: 200,
        body: { message: 'Disconnected.', ...(this.readinessBody() as object) },
      };
    },

    /**
     * GET /integrations/google/auth-url — where to send the visitor to consent.
     *
     * Returns the URL rather than a redirect because the panel opens it in a
     * popup: a 302 from `fetch` would be followed by the fetch itself and the
     * consent screen would never be seen by anyone.
     */
    async googleAuthUrl(): Promise<HttpResponse> {
      const result = buildAuthUrl();
      return result.ok
        ? { status: 200, body: { url: result.url } }
        : { status: result.status, body: { error: result.message } };
    },

    /** The readiness payload, shared by the list and both connect routes. */
    readinessBody(): IntegrationStatusResponse {
      const ready = integrationReadiness();
      return {
        integrations: INTEGRATION_IDS.map((id) => ({
          id,
          label: INTEGRATION_LABELS[id],
          configured: ready[id],
        })),
      };
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
     * POST /session/seed — create a session pre-populated with a demo persona.
     *
     * Used to open a presentation on a fully populated partner profile rather
     * than an empty panel. An unknown or absent persona resolves to the default
     * one, so this can never fail on what the caller asked for.
     *
     * A persona may also carry backdated conversations, which become extra rows
     * in the sidebar — a profile with every field filled and a single
     * one-minute-old conversation behind it reads as a fixture, not as a
     * relationship anyone has been tracking. The returned `sessionId` is always
     * the newest conversation and always the one holding the preferences.
     */
    async seedSession(persona?: unknown): Promise<HttpResponse> {
      const { id, preferences, history } = resolvePersona(persona);
      const now = Date.now();
      const conversations = history ?? [];

      // Created one at a time, oldest conversation first.
      //
      // Not cosmetic ordering: the DynamoDB store lists sessions by descending
      // `createdAt` (that is the GSI's sort key) while the in-memory one sorts on
      // `lastActivity`. Creating them in fixture order is what makes those two
      // agree — the newest conversation is created last, so it is first in both,
      // and the history below it reads oldest-last either way. Created
      // concurrently, the backdated rows would come out of the real store in
      // whatever order the writes landed.
      const sessionIds: string[] = [];
      for (const _conversation of conversations) {
        sessionIds.push(await storage.createSession());
      }

      // The fixture's last conversation is the live one and the one that carries
      // the preferences. A persona with no history at all (the "start fresh"
      // one) gets a plain empty session, exactly as before.
      const sessionId =
        sessionIds[sessionIds.length - 1] ?? (await storage.createSession());

      // Messages, on the other hand, can go up concurrently: they are in
      // separate sessions, and the turns *within* one still go in order.
      await Promise.all(
        conversations.map((conversation, index) =>
          fillConversation(storage, sessionIds[index], conversation, now),
        ),
      );

      const preferenceCount = await seedDemoProfile(
        storage,
        sessionId,
        preferences,
      );

      return {
        status: 201,
        body: {
          sessionId,
          preferenceCount,
          persona: id,
          historyCount: Math.max(sessionIds.length - 1, 0),
        },
      };
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

      // GET /integrations
      if (req.method === 'GET' && req.url === '/integrations') {
        return this.listIntegrations();
      }

      // GET /sessions
      if (req.method === 'GET' && req.url === '/sessions') {
        return this.listSessions();
      }

      // POST /session/seed — must precede any /session/:id pattern so the
      // literal "seed" segment is never captured as a session id.
      if (req.method === 'POST' && req.url === '/session/seed') {
        return this.seedSession((req.body as { persona?: unknown })?.persona);
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
