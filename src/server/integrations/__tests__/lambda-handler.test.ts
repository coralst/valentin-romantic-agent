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

/*
 * The proposal store is mocked, unlike `runTool`.
 *
 * It is the one collaborator that is pure I/O — a DynamoDB round trip against a
 * table this test has no reason to stand up — and what matters here is *that* a
 * proposal is written before the card goes back and *what* is written, both of
 * which a spy shows better than a table would. `proposal-store.test.ts` covers
 * the conditional delete itself.
 */
const putProposal = vi.fn(() => Promise.resolve());
const takeProposal = vi.fn();

vi.mock('../proposal-store', async () => {
  // The error class is real: `confirmProposal` does not catch it, so the handler's
  // outer catch is what turns it into `{ok:false}` — and that only happens for a
  // genuine Error.
  const actual = await import('../proposal-store');
  return {
    ProposalUnavailable: actual.ProposalUnavailable,
    putProposal: (...args: unknown[]) => putProposal(...(args as [])),
    takeProposal: (...args: unknown[]) => takeProposal(...(args as [])),
  };
});

const { handler, resetHandlerCacheForTests } = await import('../lambda-handler');
const { ProposalUnavailable } = await import('../proposal-store');

/** Gateway hands the tool name in the client context, prefixed by its target. */
function ctx(toolName: string) {
  return { clientContext: { custom: { bedrockAgentCoreToolName: toolName } } };
}

interface FakeToolOptions {
  readonly result?: ToolResult;
  readonly throws?: Error;
  /** Give the tool a `confirm`; omit it to model a tool that cannot be confirmed. */
  readonly confirmResult?: ToolResult;
  readonly confirmThrows?: Error;
}

/** A tool that records what it was called with. */
function fakeTool(name: string, options: FakeToolOptions = {}) {
  const calls: { input: Record<string, unknown>; sessionId: string }[] = [];
  const confirmCalls: { proposal: ActionProposal; sessionId: string }[] = [];
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
    ...(options.confirmResult || options.confirmThrows
      ? {
          confirm: async (proposal: ActionProposal, toolCtx: { sessionId: string }) => {
            confirmCalls.push({ proposal, sessionId: toolCtx.sessionId });
            if (options.confirmThrows) throw options.confirmThrows;
            return options.confirmResult as ToolResult;
          },
        }
      : {}),
  };
  return { tool, calls, confirmCalls };
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
    putProposal.mockReset();
    putProposal.mockImplementation(() => Promise.resolve());
    takeProposal.mockReset();
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
        confirm: 'confirm_reservation',
      });
      // The whole response, not just the proposal — a payload field surfacing
      // anywhere in the envelope is the failure being guarded against.
      expect(JSON.stringify(response)).not.toContain('AREA-7');
      expect(JSON.stringify(response)).not.toContain('window table');
    });

    it('writes the payload down before handing back the card', async () => {
      /*
       * Order matters and is the reason this is awaited in the handler: the proxy
       * may call `confirm_*` the instant the user clicks, and a row still being
       * written would read as a proposal nobody remembers. The *whole* proposal
       * goes to the store, payload included — that is the point of the store.
       */
      const { tool } = fakeTool('propose_reservation', {
        result: { ok: true, summary: 'Shall I book it?', proposal },
      });
      registryOf(tool);

      await handler({ ...IDS }, ctx('t___propose_reservation'));

      expect(putProposal).toHaveBeenCalledWith(
        IDS.user_id,
        proposal,
        'propose_reservation',
      );
    });

    it('returns no card when the payload could not be stored', async () => {
      // A card whose Confirm button cannot work is worse than no card: the user
      // agrees to something and nothing happens. `putProposal` is inside the
      // handler's try, so a failed write becomes an honest `{ok:false}`.
      putProposal.mockImplementation(() => Promise.reject(new Error('table gone')));
      const { tool } = fakeTool('propose_reservation', {
        result: { ok: true, summary: 'Shall I book it?', proposal },
      });
      registryOf(tool);

      const response = await handler({ ...IDS }, ctx('t___propose_reservation'));

      expect(response.ok).toBe(false);
      expect(response.proposal).toBeUndefined();
    });

    it('names the confirm tool the proxy should call', async () => {
      // Carried rather than derived on the far side: a `service → action` table in
      // the proxy would be a second copy of a pairing this file already has, and
      // its wrong entry would confirm the wrong action.
      const { tool } = fakeTool('propose_email', {
        result: { ok: true, summary: 'Send it?', proposal },
      });
      registryOf(tool);

      const response = await handler({ ...IDS }, ctx('t___propose_email'));

      expect(response.proposal?.confirm).toBe('confirm_email');
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

  /*
   * The confirm half.
   *
   * These are the invocations that spend money, and the only ones the model is not
   * allowed to make — `agent.py` filters `confirm_*` out of the list it shows
   * Bedrock and the proxy calls them directly. So what is asserted here is mostly
   * about refusing: a proposal that is gone, a name that disagrees with the stored
   * row, a tool whose credential has since been disconnected.
   */
  describe('confirming', () => {
    const stored: ActionProposal = {
      id: 'prop-1',
      sessionId: 'sess-1',
      service: 'ontopo',
      title: 'Dinner at Ouzeria, Sat 21:00',
      summary: 'Table for two, 21:00',
      expiresAt: '2026-09-05T18:00:00.000Z',
      payload: { areaId: 'AREA-7' },
    };
    const CONFIRM = { ...IDS, proposal_id: 'prop-1' };

    it('runs the tool the stored row names, not the one the caller implies', async () => {
      const { tool, confirmCalls } = fakeTool('propose_reservation', {
        confirmResult: { ok: true, summary: 'Booked for 21:00' },
      });
      registryOf(tool);
      takeProposal.mockResolvedValue({ proposal: stored, tool: 'propose_reservation' });

      const response = await handler(CONFIRM, ctx('t___confirm_reservation'));

      expect(response.ok).toBe(true);
      expect(response.summary).toBe('Booked for 21:00');
      // The payload the model never saw is what reaches `confirm`.
      expect(confirmCalls[0]?.proposal.payload).toEqual({ areaId: 'AREA-7' });
      expect(confirmCalls[0]?.sessionId).toBe('sess-1');
    });

    it('reads the row under the caller-supplied user, so ownership is the key', async () => {
      // Not a check that could be forgotten: `takeProposal` builds
      // `USER#<user>#SESSION#<session>`, so another user's proposal simply misses.
      registryOf(fakeTool('propose_reservation', { confirmResult: { ok: true, summary: 'Booked' } }).tool);
      takeProposal.mockResolvedValue({ proposal: stored, tool: 'propose_reservation' });

      await handler(CONFIRM, ctx('t___confirm_reservation'));

      expect(takeProposal).toHaveBeenCalledWith(IDS.user_id, IDS.session_id, 'prop-1');
    });

    it('passes the booking back so the proxy can record the outing', async () => {
      const booking = { venueName: 'Ouzeria', city: 'Tel Aviv', occursOn: '2026-09-05' };
      registryOf(
        fakeTool('propose_reservation', {
          confirmResult: { ok: true, summary: 'Booked', booking },
        }).tool,
      );
      takeProposal.mockResolvedValue({ proposal: stored, tool: 'propose_reservation' });

      const response = await handler(CONFIRM, ctx('t___confirm_reservation'));

      expect(response.booking).toEqual(booking);
    });

    it('carries nothing out when the name disagrees with the stored row', async () => {
      /*
       * The row is authoritative about which tool runs, and this is the case where
       * two proposals have been confused. Doing nothing loses a proposal; guessing
       * books the wrong thing.
       */
      const records = captureLogs();
      const { tool, confirmCalls } = fakeTool('propose_reservation', {
        confirmResult: { ok: true, summary: 'Booked' },
      });
      registryOf(tool);
      takeProposal.mockResolvedValue({ proposal: stored, tool: 'propose_reservation' });

      const response = await handler(CONFIRM, ctx('t___confirm_email'));

      expect(response.ok).toBe(false);
      expect(confirmCalls).toHaveLength(0);
      expect(records.some((r) => r.event === 'gateway.confirm-mismatch')).toBe(true);
    });

    it('says so plainly when the integration was disconnected in between', async () => {
      // `buildToolRegistry` gates on credentials, so a rotation or a disconnect
      // between the propose and the confirm leaves the row with no tool to run.
      captureLogs();
      registryOf(fakeTool('find_restaurants').tool);
      takeProposal.mockResolvedValue({ proposal: stored, tool: 'propose_reservation' });

      const response = await handler(CONFIRM, ctx('t___confirm_reservation'));

      expect(response.ok).toBe(false);
      expect(response.error).toContain('propose_reservation');
    });

    it('turns an unavailable proposal into ok:false rather than a Gateway 500', async () => {
      captureLogs();
      registryOf(fakeTool('propose_reservation', { confirmResult: { ok: true, summary: 'Booked' } }).tool);
      takeProposal.mockRejectedValue(
        new ProposalUnavailable('expired', 'That offer has expired.'),
      );

      const response = await handler(CONFIRM, ctx('t___confirm_reservation'));

      expect(response.ok).toBe(false);
      expect(response.error).toContain('expired');
    });

    it('rejects a confirm with no proposal_id before reading anything', async () => {
      registryOf(fakeTool('propose_reservation', { confirmResult: { ok: true, summary: 'Booked' } }).tool);

      const response = await handler({ ...IDS }, ctx('t___confirm_reservation'));

      expect(response.ok).toBe(false);
      expect(response.error).toContain('proposal_id');
      expect(takeProposal).not.toHaveBeenCalled();
    });

    it('reports a refused booking as ok:false with its prose', async () => {
      registryOf(
        fakeTool('propose_reservation', {
          confirmResult: { ok: false, summary: 'That table went while you decided' },
        }).tool,
      );
      takeProposal.mockResolvedValue({ proposal: stored, tool: 'propose_reservation' });

      const response = await handler(CONFIRM, ctx('t___confirm_reservation'));

      expect(response.ok).toBe(false);
      expect(response.summary).toBe('That table went while you decided');
    });

    it('never returns the payload it just confirmed with', async () => {
      registryOf(
        fakeTool('propose_reservation', {
          confirmResult: { ok: true, summary: 'Booked', data: { ref: 'OK-1' } },
        }).tool,
      );
      takeProposal.mockResolvedValue({ proposal: stored, tool: 'propose_reservation' });

      const response = await handler(CONFIRM, ctx('t___confirm_reservation'));

      expect(JSON.stringify(response)).not.toContain('AREA-7');
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
