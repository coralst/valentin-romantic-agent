import { describe, it, expect, vi } from 'vitest';
import { createServer, resolveBroadcastSessionId } from '../index';
import { AgentOrchestrator } from '../agent/agent-orchestrator';
import { AgentCoreOrchestrator } from '../agent/agentcore-orchestrator';
import type { AgentCoreRuntime } from '../agent/agentcore-adapter';

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

/**
 * The one branch where the two engines diverge, at `forUser`.
 *
 * Untested until now, and the file it lives in is where every later change to
 * engine B's wiring lands — so a mistake there would show up as engine B quietly
 * behaving like engine A, which reads as an AgentCore result rather than as a
 * bug. Asserted through the `engine` / `agentCoreRuntime` seams rather than
 * `AGENT_ENGINE`, because vitest shares a process per pool worker and a
 * process-wide variable set here would leak into the next file.
 */
describe('createServer engine selection', () => {
  /** Enough of the data plane to be constructed; no test here takes a turn. */
  function stubRuntime(): AgentCoreRuntime {
    return {
      invoke: vi.fn().mockResolvedValue({ content: 'ok', toolsUsed: [] }),
      recordTurn: vi.fn().mockResolvedValue(undefined),
      recallPreferences: vi.fn().mockResolvedValue([]),
    };
  }

  it('serves engine A by default, with the integration registry attached', () => {
    const services = createServer().forUser('user-a');

    expect(services.engine).toBe('valentin');
    expect(services.orchestrator).toBeInstanceOf(AgentOrchestrator);
  });

  it('serves engine B when both the engine and its runtime are given', () => {
    const services = createServer({
      engine: 'agentcore',
      agentCoreRuntime: stubRuntime(),
    }).forUser('user-b');

    expect(services.engine).toBe('agentcore');
    expect(services.orchestrator).toBeInstanceOf(AgentCoreOrchestrator);
  });

  it('downgrades to engine A when the AgentCore wiring is missing', () => {
    // The failure this guards is a proxy task missing `AGENTCORE_RUNTIME_ARN` or
    // `AGENTCORE_MEMORY_ID`. `resolveEngine` only checks the first, so before
    // this the second took the whole task down at boot — a misconfiguration
    // turned into an outage, which is exactly what its doc comment promises not
    // to do. Answering on engine A and saying so in `engine` is the contract.
    const server = createServer({ engine: 'agentcore' });

    expect(server.forUser('user-c').engine).toBe('valentin');
    expect(server.forUser('user-c').orchestrator).toBeInstanceOf(AgentOrchestrator);
  });

  it('builds an extractor on both engines, so forUser has one shape', () => {
    // Engine B gets extraction from AgentCore Memory and never invokes this, but
    // returning a different shape per engine would push the branch into every
    // caller. See the note on `UserServices.extractor`.
    const engineA = createServer().forUser('user-d');
    const engineB = createServer({
      engine: 'agentcore',
      agentCoreRuntime: stubRuntime(),
    }).forUser('user-e');

    expect(engineA.extractor).toBeDefined();
    expect(engineB.extractor).toBeDefined();
  });

  it('gives every user their own orchestrator, on either engine', () => {
    // Engine B's orchestrator holds the storage id it was scoped to, so a shared
    // instance would write one user's preferences under another's partition.
    const server = createServer({
      engine: 'agentcore',
      agentCoreRuntime: stubRuntime(),
    });

    expect(server.forUser('user-f').orchestrator).not.toBe(
      server.forUser('user-g').orchestrator,
    );
  });
});
