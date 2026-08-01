import { describe, it, expect } from 'vitest';
import { createServer, resolveBroadcastSessionId } from '../index';

describe('resolveBroadcastSessionId', () => {
  it('reads a top-level sessionId (typing_start / typing_stop)', () => {
    expect(resolveBroadcastSessionId({ sessionId: 'session-1' })).toBe(
      'session-1',
    );
  });

  it('reads a sessionId nested in a message (agent_message)', () => {
    expect(
      resolveBroadcastSessionId({ message: { sessionId: 'session-2' } }),
    ).toBe('session-2');
  });

  it('reads a sessionId nested in a preference (preference_update)', () => {
    expect(
      resolveBroadcastSessionId({
        preference: { sessionId: 'session-3' },
        isNew: true,
      }),
    ).toBe('session-3');
  });

  it('returns undefined when no sessionId is present anywhere', () => {
    expect(
      resolveBroadcastSessionId({ code: 'ERR', message: 'no session here' }),
    ).toBeUndefined();
  });

  it('prefers a top-level sessionId over nested ones', () => {
    expect(
      resolveBroadcastSessionId({
        sessionId: 'top',
        message: { sessionId: 'nested' },
      }),
    ).toBe('top');
  });
});

describe('createServer', () => {
  it('initializes without errors', () => {
    const server = createServer();

    expect(server).toBeDefined();
    expect(server.gateway).toBeDefined();
    expect(server.httpRoutes).toBeDefined();
    expect(server.orchestrator).toBeDefined();
    expect(server.store).toBeDefined();
  });

  it('health endpoint returns 200 with ok status', async () => {
    const server = createServer();
    const response = await server.httpRoutes.health();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('session creation returns sessionId', async () => {
    const server = createServer();
    const response = await server.httpRoutes.createSession();

    expect(response.status).toBe(201);
    expect(
      (response.body as { sessionId: string }).sessionId,
    ).toBeTruthy();
  });

  it('preferences endpoint returns 404 for unknown session', async () => {
    const server = createServer();
    const response = await server.httpRoutes.getSessionPreferences(
      'nonexistent-session',
    );

    expect(response.status).toBe(404);
  });

  it('preferences endpoint returns preferences for valid session', async () => {
    const server = createServer();

    // Create a session first
    const sessionResponse = await server.httpRoutes.createSession();
    const sessionId = (sessionResponse.body as { sessionId: string }).sessionId;

    const response = await server.httpRoutes.getSessionPreferences(sessionId);

    expect(response.status).toBe(200);
    expect(
      (response.body as { preferences: unknown[] }).preferences,
    ).toEqual([]);
  });

  it('request router handles GET /health', async () => {
    const server = createServer();
    const response = await server.httpRoutes.handleRequest({
      method: 'GET',
      url: '/health',
      params: {},
      body: null,
    });

    expect(response.status).toBe(200);
  });

  it('request router returns 404 for unknown routes', async () => {
    const server = createServer();
    const response = await server.httpRoutes.handleRequest({
      method: 'GET',
      url: '/unknown',
      params: {},
      body: null,
    });

    expect(response.status).toBe(404);
  });

  it('gateway starts with zero connections', () => {
    const server = createServer();
    expect(server.gateway.connectionCount).toBe(0);
  });
});
