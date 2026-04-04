import type { StorageInterface } from '../persistence/storage-interface';

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

    /** Route an incoming request to the appropriate handler */
    async handleRequest(req: HttpRequest): Promise<HttpResponse> {
      // GET /health
      if (req.method === 'GET' && req.url === '/health') {
        return this.health();
      }

      // POST /session
      if (req.method === 'POST' && req.url === '/session') {
        return this.createSession();
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
