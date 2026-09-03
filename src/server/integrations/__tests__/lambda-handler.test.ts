import { describe, it, expect, beforeEach, vi } from 'vitest';
import { logger } from '../../logging';
import type { ActionProposal, AgentTool, ToolResult } from '../tool-registry';

/**
 * The Gateway tool host, with the registry and the secret read stubbed.
 *
 * What is actually under test is the *envelope*: where the tool name comes from,
 * what is stripped before a tool sees its input, and what is allowed out. The
 * tools themselves have their own tests, and `runTool` is deliberately left real
 * — its never-throws guarantee is half of what this handler promises, so mocking
 * it would test the mock.
 *
 * Two of these assertions exist because of a specific way this could go wrong in
 * production rather than in review: a proposal's `payload` leaving the process
 * (it carries an Ontopo area id and the prose of an unsent email), and the
 * handler throwing instead of returning, which reaches the agent as a Gateway 500
 * it can only retry.
 */

const buildToolRegistry = vi.fn();
const loadRemoteCredentials = vi.fn(() => Promise.resolve());

vi.mock('../index', () => ({
  buildToolRegistry: () => buildToolRegistry(),
}));

vi.mock('../credential-store', () => ({
  loadRemoteCredentials: () => loadRemoteCredentials(),
}));

const { handler, resetHandlerCacheForTests } = await import('../lambda-handler');

/** Gateway hands the tool name in the client context, prefixed by its target. */
function ctx(toolName: string) {
  return { clientContext: { custom: { bedrockAgentCoreToolName: toolName } } };
}

interface FakeToolOptions {
  readonly result?: ToolResult;
  readonly throws?: Error;
}

/** A tool that records what it was called with. */
function fakeTool(name: string, options: FakeToolOptions = {}) {
  const calls: { input: Record<string, unknown>; sessionId: string }[] = [];
  const tool: AgentTool = {
    name,
    description: `fake ${name}`,
    input_schema: { type: 'object', properties: {} },
    service: 'ontopo',
    requiresConfirmation: false,
    execute: async (input, toolCtx) => {
      calls.push({ input, sessionId: toolCtx.sessionId });
      if (options.throws) throw options.throws;
      return options.result ?? { ok: true, summary: 'done' };
    },
  };
  return { tool, calls };
}

/** Install a registry for this invocation and forget the container cache. */
function registryOf(...tools: AgentTool[]) {
  const map = new Map(tools.map((t) => [t.name, t]));
  buildToolRegistry.mockReturnValue(map);
  resetHandlerCacheForTests();
  return map;
}

function captureLogs() {
  const records: { event: string; data?: Record<string, unknown> }[] = [];
  const push = (event: string, data?: Record<string, unknown>) => {
    records.push({ event, data });
  };
  vi.spyOn(logger, 'info').mockImplementation(push);
  vi.spyOn(logger, 'warn').mockImplementation(push);
  vi.spyOn(logger, 'error').mockImplementation(push);
  return records;
}

const IDS = { user_id: 'sub-123#visitor-9', session_id: 'sess-1' };

describe('the Gateway tool host', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    buildToolRegistry.mockReset();
    loadRemoteCredentials.mockClear();
    loadRemoteCredentials.mockImplementation(() => Promise.resolve());
    resetHandlerCacheForTests();
  });

  describe('finding the tool', () => {
    it('reads the name from the client context, not the event body', async () => {
      const { tool, calls } = fakeTool('check_availability');
      registryOf(tool);

      // A `tool` key in the body must not be able to redirect the call — the
      // event is the model's input and the model does not choose the target.
      const response = await handler(
        { ...IDS, tool: 'propose_email' },
        ctx('valentin-integrations___check_availability'),
      );

      expect(response.ok).toBe(true);
      expect(calls).toHaveLength(1);
    });

    it('takes the last segment, so renaming the target cannot break it', async () => {
      const { tool, calls } = fakeTool('check_shabbat');
      registryOf(tool);

      const response = await handler({ ...IDS }, ctx('some-other-target___check_shabbat'));

      expect(response.ok).toBe(true);
      expect(calls).toHaveLength(1);
    });

    it('refuses an invocation with no client context', async () => {
      registryOf(fakeTool('check_shabbat').tool);

      const response = await handler({ ...IDS }, undefined);

      expect(response.ok).toBe(false);
      expect(response.error).toMatch(/bedrockAgentCoreToolName/);
    });

    it('names what is available when the tool is not registered', async () => {
      // The likely cause is not a hallucinated name but an integration with no
      // credential in this Lambda, since `buildToolRegistry` gates on readiness.
      registryOf(fakeTool('check_shabbat').tool, fakeTool('find_restaurants').tool);

      const response = await handler({ ...IDS }, ctx('valentin-integrations___propose_gift'));

      expect(response.ok).toBe(false);
      expect(response.error).toContain('propose_gift');
      expect(response.error).toContain('check_shabbat, find_restaurants');
    });

    it('says "none" rather than nothing when the registry is empty', async () => {
      registryOf();

      const response = await handler({ ...IDS }, ctx('t___check_shabbat'));

      expect(response.error).toContain('none');
    });
  });

  describe('identity', () => {
    it('strips the identity args before the tool sees its input', async () => {
      const { tool, calls } = fakeTool('find_restaurants');
      registryOf(tool);

      await handler(
        { ...IDS, city: 'Tel Aviv', partySize: 2 },
        ctx('valentin-integrations___find_restaurants'),
      );

      expect(calls[0]?.input).toEqual({ city: 'Tel Aviv', partySize: 2 });
    });

    it('passes session_id through as the tool context', async () => {
      const { tool, calls } = fakeTool('find_restaurants');
      registryOf(tool);

      await handler({ ...IDS }, ctx('t___find_restaurants'));

      expect(calls[0]?.sessionId).toBe('sess-1');
    });

    it('does not mutate the caller-supplied event', async () => {
      registryOf(fakeTool('find_restaurants').tool);
      const event = { ...IDS, city: 'Jaffa' };

      await handler(event, ctx('t___find_restaurants'));

      expect(event.user_id).toBe(IDS.user_id);
    });

    it.each(['user_id', 'session_id'])('rejects a missing %s before running anything', async (
      field,
    ) => {
      const { tool, calls } = fakeTool('find_restaurants');
      registryOf(tool);
      const event: Record<string, unknown> = { ...IDS };
      delete event[field];

      const response = await handler(event, ctx('t___find_restaurants'));

      expect(response.ok).toBe(false);
      expect(response.error).toContain(field);
      expect(calls).toHaveLength(0);
    });

    it('rejects an over-long id rather than logging it', async () => {
      registryOf(fakeTool('find_restaurants').tool);

      const response = await handler(
        { ...IDS, session_id: 's'.repeat(129) },
        ctx('t___find_restaurants'),
      );

      expect(response.ok).toBe(false);
    });

    it('accepts the demo visitor id, which carries a "#"', async () => {
      // `scopeToVisitor` builds `<sub>#<visitorId>`; a stricter rule here would
      // make every demo visitor's tool call fail.
      const { tool, calls } = fakeTool('find_restaurants');
      registryOf(tool);

      const response = await handler(
        { user_id: 'abc-def#visitor-42', session_id: 'sess-2' },
        ctx('t___find_restaurants'),
      );

      expect(response.ok).toBe(true);
      expect(calls).toHaveLength(1);
    });
  });

  describe('what comes back', () => {
    it('returns the summary and data a tool produced', async () => {
      const { tool } = fakeTool('check_shabbat', {
        result: { ok: true, summary: 'Candle lighting 18:42', data: { candles: '18:42' } },
      });
      registryOf(tool);

      const response = await handler({ ...IDS }, ctx('t___check_shabbat'));

      expect(response).toEqual({
        ok: true,
        summary: 'Candle lighting 18:42',
        data: { candles: '18:42' },
      });
    });

    it('reports a failed tool as ok:false with its prose, not as an error', async () => {
      // `runTool` returns this shape; the distinction matters because a tool that
      // found nothing is something Valentin can talk about.
      const { tool } = fakeTool('find_restaurants', {
        result: { ok: false, summary: 'Nothing free on Saturday' },
      });
      registryOf(tool);

      const response = await handler({ ...IDS }, ctx('t___find_restaurants'));

      expect(response.ok).toBe(false);
      expect(response.summary).toBe('Nothing free on Saturday');
      expect(response.error).toBeUndefined();
    });

    it('turns a thrown tool into a returned failure, never a Gateway 500', async () => {
      const { tool } = fakeTool('search_hotels', { throws: new Error('Amadeus 401') });
      registryOf(tool);

      const response = await handler({ ...IDS }, ctx('t___search_hotels'));

      expect(response.ok).toBe(false);
      expect(JSON.stringify(response)).toContain('Amadeus 401');
    });
  });

  describe('proposals', () => {
    const proposal: ActionProposal = {
      id: 'prop-1',
      sessionId: 'sess-1',
      service: 'ontopo',
      title: 'Dinner at Ouzeria, Sat 21:00',
      summary: 'Table for two, 21:00',
      url: 'https://ontopo.example/checkout/abc',
      expiresAt: '2026-09-05T18:00:00.000Z',
      payload: { areaId: 'AREA-7', slug: 'ouzeria', note: 'window table' },
    };

    it('never returns the payload', async () => {
      const { tool } = fakeTool('propose_reservation', {
        result: { ok: true, summary: 'Shall I book it?', proposal },
      });
      registryOf(tool);

      const response = await handler({ ...IDS }, ctx('t___propose_reservation'));

      expect(response.proposal).toEqual({
        id: 'prop-1',
        service: 'ontopo',
        title: 'Dinner at Ouzeria, Sat 21:00',
        summary: 'Table for two, 21:00',
        url: 'https://ontopo.example/checkout/abc',
        expiresAt: '2026-09-05T18:00:00.000Z',
      });
      // The whole response, not just the proposal — a payload field surfacing
      // anywhere in the envelope is the failure being guarded against.
      expect(JSON.stringify(response)).not.toContain('AREA-7');
      expect(JSON.stringify(response)).not.toContain('window table');
    });

    it('omits url when the proposal has none', async () => {
      const { url: _url, ...withoutUrl } = proposal;
      const { tool } = fakeTool('propose_email', {
        result: { ok: true, summary: 'Send it?', proposal: withoutUrl },
      });
      registryOf(tool);

      const response = await handler({ ...IDS }, ctx('t___propose_email'));

      expect(response.proposal).not.toHaveProperty('url');
    });

    it('records that a proposal was raised without logging its id', async () => {
      const records = captureLogs();
      const { tool } = fakeTool('propose_reservation', {
        result: { ok: true, summary: 'Shall I book it?', proposal },
      });
      registryOf(tool);

      await handler({ ...IDS }, ctx('t___propose_reservation'));

      const invoked = records.find((r) => r.event === 'gateway.tool-invoked');
      expect(invoked?.data?.proposed).toBe(true);
      expect(JSON.stringify(records)).not.toContain('prop-1');
    });
  });

  describe('logging', () => {
    it('never writes the user id, only its length', async () => {
      const records = captureLogs();
      registryOf(fakeTool('find_restaurants').tool);

      await handler({ ...IDS }, ctx('t___find_restaurants'));

      expect(JSON.stringify(records)).not.toContain(IDS.user_id);
      const invoked = records.find((r) => r.event === 'gateway.tool-invoked');
      expect(invoked?.data?.userIdLength).toBe(IDS.user_id.length);
      expect(invoked?.data?.sessionId).toBe('sess-1');
    });
  });

  describe('container reuse', () => {
    it('reads the credentials once and reuses the registry', async () => {
      registryOf(fakeTool('find_restaurants').tool);

      await handler({ ...IDS }, ctx('t___find_restaurants'));
      await handler({ ...IDS }, ctx('t___find_restaurants'));

      expect(loadRemoteCredentials).toHaveBeenCalledTimes(1);
      expect(buildToolRegistry).toHaveBeenCalledTimes(1);
    });

    it('does not build the registry twice under concurrent invocations', async () => {
      // `buildToolRegistry` refills the live map in place, so a second build
      // racing the first would clear the map the first call is about to read.
      registryOf(fakeTool('find_restaurants').tool);

      await Promise.all([
        handler({ ...IDS }, ctx('t___find_restaurants')),
        handler({ ...IDS }, ctx('t___find_restaurants')),
      ]);

      expect(buildToolRegistry).toHaveBeenCalledTimes(1);
    });

    it('answers rather than crashing when the credential read fails', async () => {
      // Same contract as the server: absent rather than broken. A Secrets Manager
      // blip must not make every tool call a Gateway error.
      captureLogs();
      registryOf(fakeTool('find_restaurants').tool);
      loadRemoteCredentials.mockImplementation(() => Promise.reject(new Error('AccessDenied')));
      resetHandlerCacheForTests();

      const response = await handler({ ...IDS }, ctx('t___find_restaurants'));

      expect(response.ok).toBe(false);
      expect(response.error).toContain('AccessDenied');
    });

    it('retries on the next invocation instead of staying broken for hours', async () => {
      captureLogs();
      registryOf(fakeTool('find_restaurants').tool);
      loadRemoteCredentials.mockImplementationOnce(() =>
        Promise.reject(new Error('Throttled')),
      );
      resetHandlerCacheForTests();

      const first = await handler({ ...IDS }, ctx('t___find_restaurants'));
      const second = await handler({ ...IDS }, ctx('t___find_restaurants'));

      expect(first.ok).toBe(false);
      expect(second.ok).toBe(true);
    });
  });
});
