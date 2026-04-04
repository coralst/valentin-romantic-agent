import { describe, it, expect } from 'vitest';
import { createServer } from '../index';

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
