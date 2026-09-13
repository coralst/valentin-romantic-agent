import { describe, it, expect, vi, afterEach } from 'vitest';
import { GATEWAY_TOOL_SERVICES, logRecordToSpan, startSpanBridge } from '../span-bridge';
import integrationToolSchemas from '../../../../infra/lib/generated/integration-tool-schemas.json';
import { logger, resetServerLogSubscribers, withUserScope } from '../../logging';
import { resolveBroadcastSessionId } from '../../index';
import type { AwsSpan, ServerEvent } from '../../../shared/interfaces/ws-events';
import type { ServerLogRecord } from '../../logging';
import {
  INTEGRATION_IDS,
  INTEGRATION_LABELS,
} from '../../../shared/interfaces/integrations';

function record(
  event: string,
  data?: Record<string, unknown>,
  level: ServerLogRecord['level'] = 'info',
): ServerLogRecord {
  return { level, event, data };
}

describe('logRecordToSpan', () => {
  /**
   * The transcript write, which used to be invisible.
   *
   * Two of these happen per turn — the user's message and the reply — before any
   * preference is extracted, and neither reached the drawer, so every `PutItem` in
   * the feed looked like a preference. That is what made a caption on the DynamoDB
   * row unfalsifiable, and it is why this span exists.
   */
  describe('message.saved → DynamoDB', () => {
    const saved = record('message.saved', {
      sessionId: 's-1',
      userId: 'u-1',
      sender: 'user',
      durationMs: 7,
    });

    it('maps to the dynamodb node with the real table name', () => {
      expect(logRecordToSpan(saved)).toMatchObject({
        sessionId: 's-1',
        resourceId: 'dynamodb',
        service: 'Amazon DynamoDB',
        resourceName: 'ValentinTable-dev',
        operation: 'PutItem',
        durationMs: 7,
        ok: true,
      });
    });

    /** The prefix is what the drawer reads to tell this from a `PREF#` write. */
    it('carries the sort-key prefix and the sender, and nothing else', () => {
      expect(logRecordToSpan(saved)?.detail).toBe('MSG#user');
      expect(
        logRecordToSpan(record('message.saved', { sessionId: 's-1', sender: 'agent', durationMs: 9 }))
          ?.detail,
      ).toBe('MSG#agent');
    });

    /**
     * The same rule as `preference.saved`, and here the stakes are higher: the store
     * has the message text in hand at the call site, so this is the one span where a
     * careless field would project the conversation itself.
     */
    it('never carries the message content', () => {
      const span = logRecordToSpan(
        record('message.saved', {
          sessionId: 's-1',
          sender: 'user',
          durationMs: 7,
          content: 'She loves late-night jazz',
        }),
      );
      expect(JSON.stringify(span)).not.toContain('jazz');
    });

    it('keeps the prefix when the sender was not logged', () => {
      const span = logRecordToSpan(record('message.saved', { sessionId: 's-1', durationMs: 7 }));
      expect(span?.detail).toBe('MSG#message');
    });

    /**
     * Dropped rather than reported as `0`. An unmeasured write and a free one are
     * different claims — the rule `AwsSpan.durationMs` sets — and unlike
     * `preference.saved`, which predates that rule and defaults to `0`, there is no
     * path that logs this line without a duration.
     */
    it('is dropped when no duration was logged', () => {
      expect(logRecordToSpan(record('message.saved', { sessionId: 's-1' }))).toBeUndefined();
    });

    it('is dropped without a session, which is the only thing that can route it', () => {
      expect(logRecordToSpan(record('message.saved', { durationMs: 7 }))).toBeUndefined();
    });

    it('reports not-ok when the write was logged as an error', () => {
      const span = logRecordToSpan(
        record('message.saved', { sessionId: 's-1', durationMs: 7 }, 'error'),
      );
      expect(span?.ok).toBe(false);
    });
  });

  describe('preference.saved → DynamoDB', () => {
    const saved = record('preference.saved', {
      sessionId: 's-1',
      category: 'music',
      key: 'genre',
      durationMs: 18,
    });

    it('maps to the dynamodb node with the real table name', () => {
      const span = logRecordToSpan(saved);
      expect(span).toMatchObject({
        sessionId: 's-1',
        resourceId: 'dynamodb',
        service: 'Amazon DynamoDB',
        resourceName: 'ValentinTable-dev',
        operation: 'PutItem',
        durationMs: 18,
        ok: true,
      });
    });

    /**
     * The whole privacy contract in one assertion. The store logs `key` and
     * `category` but never the value, and the bridge must not widen that — this
     * ends up on a projector, and the values are a real person's.
     */
    it('carries the sort key, never a value', () => {
      const span = logRecordToSpan(
        record('preference.saved', {
          sessionId: 's-1',
          category: 'music',
          key: 'genre',
          value: 'Late-night jazz',
          durationMs: 18,
        }),
      );

      expect(span?.detail).toBe('PREF#music');
      expect(JSON.stringify(span)).not.toContain('Late-night jazz');
    });

    it('survives a save logged without a duration', () => {
      const span = logRecordToSpan(
        record('preference.saved', { sessionId: 's-1', category: 'music' }),
      );
      expect(span?.durationMs).toBe(0);
    });

    /**
     * Keeps the bare prefix when no category was logged — it used to drop the detail
     * entirely.
     *
     * The prefix stopped being decoration when the drawer started reading it: it is
     * what distinguishes this `PutItem` from the transcript write on the same table
     * with the same duration, so an empty detail would caption a preference write as
     * an unplaceable one. The prefix alone is still true; the category is what is
     * missing, and it is what is left out.
     */
    it('keeps the sort-key prefix when no category was logged', () => {
      const span = logRecordToSpan(record('preference.saved', { sessionId: 's-1' }));
      expect(span?.detail).toBe('PREF#');
    });

    it('reports not-ok when the save was logged as an error', () => {
      const span = logRecordToSpan(
        record('preference.saved', { sessionId: 's-1', category: 'music' }, 'error'),
      );
      expect(span?.ok).toBe(false);
    });
  });

  describe('bedrock.converse → Bedrock', () => {
    it('maps to the bedrock node, counting as a model call', () => {
      const span = logRecordToSpan(
        record('bedrock.converse', {
          sessionId: 's-2',
          operation: 'chat-reply',
          modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
          durationMs: 412,
          ok: true,
        }),
      );

      expect(span).toMatchObject({
        sessionId: 's-2',
        resourceId: 'bedrock',
        service: 'Amazon Bedrock',
        resourceName: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        // The client counts model calls by `operation === 'Converse'`; which of
        // the two Converse calls it was belongs in `detail`.
        operation: 'Converse',
        durationMs: 412,
        ok: true,
        detail: 'chat-reply',
      });
    });

    it('distinguishes the preference-extraction call in its detail', () => {
      const span = logRecordToSpan(
        record('bedrock.converse', {
          sessionId: 's-2',
          operation: 'extract-preferences',
          durationMs: 380,
          ok: true,
        }),
      );
      expect(span?.detail).toBe('extract-preferences');
      expect(span?.operation).toBe('Converse');
    });

    /**
     * The outcome, appended only when the model asked for a tool.
     *
     * Needed because tools are on for nearly every turn, so the call that writes the
     * answer is a `chat-tools` call — the same operation, with the same duration, as
     * one that stops to call Ontopo. Without the stop reason the drawer captioned
     * every reply "picks a tool".
     */
    it('marks a call that stopped to ask for a tool', () => {
      const toolTurn = logRecordToSpan(
        record('bedrock.converse', {
          sessionId: 's-2',
          operation: 'chat-tools',
          durationMs: 486,
          stopReason: 'tool_use',
        }),
      );
      expect(toolTurn?.detail).toBe('chat-tools · tool_use');
    });

    /**
     * The extraction call is never marked, however it stopped.
     *
     * It is handed one tool and required to use it, so it reports `tool_use` on every
     * successful call — a real log line from a real turn reads
     * `operation: extract-preferences, stopReason: tool_use`. Marking that would
     * caption the extraction pass "picks a tool", which is the same defect on the
     * other call.
     */
    it('never marks the forced-tool extraction call, whose stop reason says nothing', () => {
      const span = logRecordToSpan(
        record('bedrock.converse', {
          sessionId: 's-2',
          operation: 'extract-preferences',
          durationMs: 3868,
          stopReason: 'tool_use',
        }),
      );
      expect(span?.detail).toBe('extract-preferences');
    });

    /** Every other stop reason means the same thing here: no tool was asked for. */
    it('leaves the detail alone for a call that finished the turn', () => {
      for (const stopReason of ['end_turn', 'max_tokens', 'stop_sequence', undefined]) {
        const span = logRecordToSpan(
          record('bedrock.converse', {
            sessionId: 's-2',
            operation: 'chat-tools',
            durationMs: 412,
            stopReason,
          }),
        );
        expect(span?.detail, String(stopReason)).toBe('chat-tools');
      }
    });

    /**
     * A Converse call that took four seconds and *then* threw is the most
     * useful thing to see on stage, and exactly what a success-only wrapper
     * hides.
     */
    it('keeps a failed call, with its duration and ok:false', () => {
      const span = logRecordToSpan(
        record('bedrock.converse', {
          sessionId: 's-2',
          operation: 'chat-reply',
          durationMs: 4001,
          ok: false,
        }),
      );
      expect(span).toMatchObject({ ok: false, durationMs: 4001 });
    });
  });

  describe('integration.* → External APIs', () => {
    it('maps every service onto the one grouped node', () => {
      /*
       * One node, not six. Six cards do not read on a projector, so `resourceId`
       * is the node and the service goes in `resourceName` — which is what makes
       * a single node able to say "Ontopo, 412ms" out loud.
       */
      for (const id of INTEGRATION_IDS) {
        const span = logRecordToSpan(
          record(`integration.${id}`, {
            sessionId: 's-9',
            integration: id,
            operation: 'check_availability',
            durationMs: 412,
            ok: true,
          }),
        );
        expect(span).toMatchObject({
          sessionId: 's-9',
          resourceId: 'integrations',
          service: 'External APIs',
          resourceName: INTEGRATION_LABELS[id],
          operation: 'check_availability',
          durationMs: 412,
          ok: true,
        });
      }
    });

    it('carries the tool name and nothing about what was asked', () => {
      const span = logRecordToSpan(
        record('integration.gmail', {
          sessionId: 's-9',
          operation: 'propose_email',
          durationMs: 88,
        }),
      );

      /*
       * The load-bearing assertion of this whole file. A proposed email carries
       * prose about someone's partner, and the drawer is on a projector. The tool
       * name is the whole of what is safe, so there is no `detail` at all.
       */
      expect(span?.detail).toBeUndefined();
      expect(JSON.stringify(span)).not.toMatch(/@|body|recipient|message/i);
    });

    it('reports a failed call as not ok, keeping its duration', () => {
      // A visible red segment with a real number on it is the point: "Ontopo took
      // 3 seconds and failed" is the sentence the drawer exists to show.
      expect(
        logRecordToSpan(
          record('integration.ontopo', {
            sessionId: 's-9',
            operation: 'search_restaurants',
            durationMs: 3010,
            ok: false,
          }),
        ),
      ).toMatchObject({ ok: false, durationMs: 3010 });

      expect(
        logRecordToSpan(
          record('integration.ontopo', { sessionId: 's-9', durationMs: 5 }, 'error'),
        ),
      ).toMatchObject({ ok: false });
    });

    it('survives a log with no operation or duration', () => {
      // Degrades to a labelled zero-length segment rather than vanishing: a call
      // that happened and was not timed is still a call worth drawing.
      expect(
        logRecordToSpan(record('integration.hebcal', { sessionId: 's-9' })),
      ).toMatchObject({ operation: 'call', durationMs: 0 });
    });

    it('ignores an integration event for a service that is not in the union', () => {
      /*
       * The prefix match is still a closed set. A stray `integration.opentable`
       * log — a rename half-applied, say — must be dropped rather than drawn as a
       * node with an empty label.
       */
      expect(
        logRecordToSpan(record('integration.opentable', { sessionId: 's-9' })),
      ).toBeUndefined();
      expect(logRecordToSpan(record('integration.', { sessionId: 's-9' }))).toBeUndefined();
    });

    it('ignores an integration event with no session to route it to', () => {
      expect(logRecordToSpan(record('integration.ontopo', { durationMs: 5 }))).toBeUndefined();
      // `integration.failed` is a warning for CloudWatch, not a span — and it is
      // logged *alongside* the real one, so mapping it would double every failure.
      expect(
        logRecordToSpan(record('integration.failed', { sessionId: 's-9', cause: 'boom' })),
      ).toBeUndefined();
    });
  });

  describe('agentcore.invoke → AgentCore Runtime', () => {
    const invoked = record('agentcore.invoke', {
      sessionId: 's-3',
      durationMs: 486,
      runtimeSessionId: 'rt-s-3',
      toolsUsed: 2,
      ok: true,
    });

    it('maps to the Runtime, counting as engine B’s model call', () => {
      expect(logRecordToSpan(invoked)).toMatchObject({
        sessionId: 's-3',
        // Not `ac-runtime`: the wire carries the service's own id and the client
        // maps it, so renaming a diagram node cannot silently drop a span.
        resourceId: 'agentcore-runtime',
        service: 'AgentCore Runtime',
        operation: 'InvokeAgentRuntime',
        durationMs: 486,
        ok: true,
      });
    });

    it('reports how many tools were called, never their arguments', () => {
      // Tool arguments carry partner data and this is projected in front of a room.
      expect(logRecordToSpan(invoked)?.detail).toBe('2 tool calls');
      expect(
        logRecordToSpan(
          record('agentcore.invoke', { sessionId: 's-3', durationMs: 9, toolsUsed: 1 }),
        )?.detail,
      ).toBe('1 tool call');
    });

    it('says nothing about tools on a turn that used none', () => {
      expect(
        logRecordToSpan(
          record('agentcore.invoke', { sessionId: 's-3', durationMs: 9, toolsUsed: 0 }),
        )?.detail,
      ).toBeUndefined();
    });

    it('keeps a failed invoke, with its duration', () => {
      const span = logRecordToSpan(
        record('agentcore.invoke', { sessionId: 's-3', durationMs: 3002, ok: false }, 'error'),
      );
      expect(span).toMatchObject({ ok: false, durationMs: 3002 });
    });

    it('carries the X-Ray trace id through, since it is the only thread across the hops', () => {
      // With the Gateway in engine B's real path the Runtime and the tool Lambda are
      // two processes the proxy cannot see inside; this id is what stitches the three
      // log groups together.
      expect(
        logRecordToSpan(
          record('agentcore.invoke', {
            sessionId: 's-3',
            durationMs: 9,
            traceId: 'Root=1-6612ab00-1f2e3d4c5b6a7980',
          }),
        )?.traceId,
      ).toBe('Root=1-6612ab00-1f2e3d4c5b6a7980');
    });

    it('leaves the trace id off when the service returned none', () => {
      expect(logRecordToSpan(invoked)?.traceId).toBeUndefined();
    });
  });

  describe('agentcore.memory → AgentCore Memory', () => {
    it('keeps the two Memory calls distinct, since they are different beats', () => {
      const write = logRecordToSpan(
        record('agentcore.memory', { sessionId: 's-4', operation: 'CreateEvent', durationMs: 37 }),
      );
      const read = logRecordToSpan(
        record('agentcore.memory', {
          sessionId: 's-4',
          operation: 'ListMemoryRecords',
          durationMs: 61,
          recordCount: 5,
        }),
      );

      expect(write).toMatchObject({ resourceId: 'agentcore-memory', operation: 'CreateEvent' });
      expect(write?.detail).toBeUndefined();
      expect(read).toMatchObject({ operation: 'ListMemoryRecords', durationMs: 61 });
      // The count of what has been learned, never any of it.
      expect(read?.detail).toBe('5 records');
    });

    it('reports zero records as zero rather than as nothing at all', () => {
      // "Recalled nothing" is a fact worth seeing — it is what a cold session
      // looks like, and an absent detail would read as an unmeasured call.
      const span = logRecordToSpan(
        record('agentcore.memory', {
          sessionId: 's-4',
          operation: 'ListMemoryRecords',
          durationMs: 12,
          recordCount: 0,
        }),
      );
      expect(span?.detail).toBe('0 records');
    });

    it('ignores a Memory record that never says which call it was', () => {
      expect(
        logRecordToSpan(record('agentcore.memory', { sessionId: 's-4', durationMs: 37 })),
      ).toBeUndefined();
    });
  });

  describe('agentcore.gateway → AgentCore Gateway', () => {
    it('names the tool as the operation', () => {
      expect(
        logRecordToSpan(
          record('agentcore.gateway', { sessionId: 's-5', tool: 'get_partner_profile' }),
        ),
      ).toMatchObject({
        sessionId: 's-5',
        resourceId: 'agentcore-gateway',
        service: 'AgentCore Gateway',
        operation: 'get_partner_profile',
        ok: true,
      });
    });

    /**
     * The one span that carries no timing, and deliberately: the tool call runs
     * inside the Runtime and reaches the proxy only as a name in the reply. A `0`
     * would read as a free call and the turn's own duration would credit the
     * whole model call to a tool lookup.
     */
    it('reports no duration, because the proxy never timed this call', () => {
      const span = logRecordToSpan(
        record('agentcore.gateway', { sessionId: 's-5', tool: 'save_preference' }),
      );
      expect(span?.durationMs).toBeUndefined();
    });

    it('ignores a Gateway record with no tool name', () => {
      expect(logRecordToSpan(record('agentcore.gateway', { sessionId: 's-5' }))).toBeUndefined();
    });

    /*
     * Gateway tool names arrive `<target>___<tool>` — that is what
     * `agent.py`'s `_tools_used()` reports, and the prefix is the target's name, so
     * it changes when a target is renamed. Splitting rather than matching whole
     * names is what keeps a rename from silently dropping every span.
     */
    it('splits the target off the tool name', () => {
      expect(
        logRecordToSpan(
          record('agentcore.gateway', {
            sessionId: 's-5',
            tool: 'valentin-profile___get_partner_profile',
          }),
        ),
      ).toMatchObject({
        resourceId: 'agentcore-gateway',
        operation: 'get_partner_profile',
        detail: 'via valentin-profile-tools',
      });
    });

    it('sends an integration tool to engine B’s External APIs card, named for the partner', () => {
      // The point of the whole branch: the room sees "Ontopo" on engine B exactly
      // as it does on engine A, reached the other way.
      expect(
        logRecordToSpan(
          record('agentcore.gateway', {
            sessionId: 's-5',
            tool: 'valentin-integrations___find_restaurants',
          }),
        ),
      ).toMatchObject({
        resourceId: 'agentcore-integrations',
        service: 'External APIs',
        resourceName: 'Ontopo',
        operation: 'find_restaurants',
        detail: 'via valentin-integration-tools',
      });
    });

    it('still has no duration for an integration tool, for the same reason', () => {
      const span = logRecordToSpan(
        record('agentcore.gateway', {
          sessionId: 's-5',
          tool: 'valentin-integrations___search_hotels',
        }),
      );
      expect(span?.durationMs).toBeUndefined();
    });

    it('falls back to the Gateway card for a tool it does not recognise', () => {
      // A tool shipped in the Lambda ahead of this table. Better a Gateway span
      // with the right name than no beat at all.
      expect(
        logRecordToSpan(
          record('agentcore.gateway', {
            sessionId: 's-5',
            tool: 'valentin-integrations___book_a_hot_air_balloon',
          }),
        ),
      ).toMatchObject({
        resourceId: 'agentcore-gateway',
        operation: 'book_a_hot_air_balloon',
      });
    });

    it('names a partner for every tool the stack declares', () => {
      /*
       * The drift guard. `GATEWAY_TOOL_SERVICES` is hand-written — the proxy cannot
       * ask the registry, because a credential missing on *this* container would
       * drop a tool that ran perfectly well in the Lambda — so the coupling is
       * enforced here instead: add a tool to the registry and this fails.
       */
      const missing = integrationToolSchemas
        .map((tool) => tool.name)
        .filter((name) => !(name in GATEWAY_TOOL_SERVICES));
      expect(missing).toEqual([]);
    });
  });

  describe('agentcore.gateway.confirm → the proxy’s own Gateway call', () => {
    const confirm = {
      sessionId: 's-6',
      tool: 'valentin-integrations___confirm_reservation',
      durationMs: 812,
      ok: true,
    };

    it('carries a real duration, unlike the read path', () => {
      /*
       * The asymmetry is the truthful part: this call was made by the proxy, so it
       * has a measured number, while a tool the agent called inside the Runtime does
       * not. Asserted rather than commented, so nobody "fixes" one to match the other.
       */
      expect(logRecordToSpan(record('agentcore.gateway.confirm', confirm))).toMatchObject({
        sessionId: 's-6',
        resourceId: 'agentcore-gateway',
        service: 'AgentCore Gateway',
        operation: 'confirm_reservation',
        durationMs: 812,
        ok: true,
      });
    });

    it('stays on the Gateway card even though the tool is an integration one', () => {
      // Deliberate: the story here is the endpoint, not the partner — the same MCP
      // route the agent uses, called by the application, with the booking authority
      // kept out of the model's hands.
      const span = logRecordToSpan(record('agentcore.gateway.confirm', confirm));
      expect(span?.resourceId).not.toBe('agentcore-integrations');
    });

    it('reports a refused booking as a failed span', () => {
      const span = logRecordToSpan(
        record('agentcore.gateway.confirm', { ...confirm, ok: false }),
      );
      expect(span?.ok).toBe(false);
    });

    it('drops a confirm record with no duration rather than inventing one', () => {
      expect(
        logRecordToSpan(record('agentcore.gateway.confirm', { sessionId: 's-6', tool: 'x' })),
      ).toBeUndefined();
    });
  });

  describe('what it refuses to map', () => {
    /**
     * The bridge must never need to know every call site to stay correct.
     * Unrecognised events are ignored, so adding a log line elsewhere cannot
     * produce a garbage span.
     */
    it('ignores unrecognised events', () => {
      expect(logRecordToSpan(record('session.created', { sessionId: 's-1' }))).toBeUndefined();
      expect(logRecordToSpan(record('storage.initialized', { backend: 'memory' }))).toBeUndefined();
    });

    it('ignores a record with no data at all', () => {
      expect(logRecordToSpan(record('preference.saved'))).toBeUndefined();
      expect(logRecordToSpan(record('bedrock.converse'))).toBeUndefined();
    });

    /**
     * A span with no session cannot be routed to any client — the broadcast
     * path drops it. Better to not manufacture one than to emit into the void.
     */
    it('ignores a record whose sessionId is missing or the wrong type', () => {
      expect(logRecordToSpan(record('preference.saved', { category: 'music' }))).toBeUndefined();
      expect(
        logRecordToSpan(record('bedrock.converse', { sessionId: 42, durationMs: 1 })),
      ).toBeUndefined();
    });

    it('ignores a converse record with no measured duration', () => {
      expect(
        logRecordToSpan(record('bedrock.converse', { sessionId: 's-2', ok: true })),
      ).toBeUndefined();
    });
  });
});

describe('startSpanBridge', () => {
  afterEach(() => {
    resetServerLogSubscribers();
    vi.restoreAllMocks();
  });

  function bridge() {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const emitted: ServerEvent[] = [];
    const routedTo: string[] = [];
    const stop = startSpanBridge((userId, event) => {
      routedTo.push(userId);
      emitted.push(event);
    });
    return { emitted, routedTo, stop };
  }

  /**
   * Log the way production does — inside a user scope set once by `WsGateway`,
   * not stamped by hand at each call site. Going through the real seam is what
   * keeps these tests honest: if the scope stopped reaching log records, every
   * span would become unroutable in production, and this file would say so.
   */
  function logAs(userId: string, fn: () => void): void {
    withUserScope(userId, fn);
  }

  it('turns a real log call into an aws_span event', () => {
    const { emitted, stop } = bridge();

    logAs('u-1', () =>
      logger.info('preference.saved', {
        sessionId: 's-1',
        category: 'music',
        durationMs: 18,
      }),
    );

    stop();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('aws_span');
    expect((emitted[0].payload as AwsSpan).resourceId).toBe('dynamodb');
  });

  it('stamps a timestamp on the envelope', () => {
    const { emitted, stop } = bridge();
    logAs('u-1', () => logger.info('preference.saved', { sessionId: 's-1', category: 'music' }));
    stop();
    expect(Date.parse(emitted[0].timestamp)).not.toBeNaN();
  });

  /**
   * Routing needs the user as well as the session. Session ids live under a user
   * in storage, so two people can hold the same one — a session-only broadcast
   * would put one person's spans on another person's screen.
   */
  it('routes each span to the user whose work produced it', () => {
    const { routedTo, stop } = bridge();

    logAs('alice', () => logger.info('preference.saved', { sessionId: 's-1', category: 'music' }));
    logAs('bob', () =>
      logger.info('bedrock.converse', { sessionId: 's-1', operation: 'reply', durationMs: 3 }),
    );

    stop();
    expect(routedTo).toEqual(['alice', 'bob']);
  });

  /**
   * A userId stamped by the call site wins over the ambient scope. `DynamoDBStore`
   * knows its own user for certain — it is a constructor field — so it says so
   * explicitly rather than trusting whatever scope happens to be active.
   */
  it('prefers an explicitly logged userId over the ambient scope', () => {
    const { routedTo, stop } = bridge();

    logAs('scope-user', () =>
      logger.info('preference.saved', {
        sessionId: 's-1',
        category: 'music',
        userId: 'explicit-user',
      }),
    );

    stop();
    expect(routedTo).toEqual(['explicit-user']);
  });

  /**
   * The failure this guards is silence, not a crash: a span with no user cannot
   * be addressed to any connection, and inventing one would mean broadcasting a
   * measurement to whoever happened to be listening.
   */
  it('drops a span it cannot attribute to a user', () => {
    const { emitted, stop } = bridge();

    // No scope, no explicit userId — a boot-time or background log line.
    logger.info('preference.saved', { sessionId: 's-1', category: 'music' });

    stop();
    expect(emitted).toEqual([]);
  });

  /**
   * Guards the finding this design was shaped around: `resolveBroadcastSessionId`
   * reads only `payload.sessionId` and two nested spots. A span whose session
   * lived anywhere else would be dropped before reaching any client — silently,
   * with every other test still green.
   */
  it('emits spans the broadcast path can actually route', () => {
    const { emitted, stop } = bridge();

    logAs('u-1', () => {
      logger.info('preference.saved', { sessionId: 's-42', category: 'music' });
      logger.info('bedrock.converse', {
        sessionId: 's-42',
        operation: 'chat-reply',
        durationMs: 9,
      });
    });

    stop();
    expect(emitted).toHaveLength(2);
    for (const event of emitted) {
      expect(resolveBroadcastSessionId(event.payload as Record<string, unknown>)).toBe('s-42');
    }
  });

  it('emits nothing for logs that are not AWS calls', () => {
    const { emitted, stop } = bridge();

    logAs('u-1', () => {
      logger.info('session.created', { sessionId: 's-1' });
      logger.error('ws.parse_failed', { reason: 'bad json' });
    });

    stop();
    expect(emitted).toEqual([]);
  });

  it('stops emitting once unsubscribed', () => {
    const { emitted, stop } = bridge();

    stop();
    logger.info('preference.saved', { sessionId: 's-1', category: 'music' });

    expect(emitted).toEqual([]);
  });

  /**
   * The bridge is an observer. If the emitter throws — a closed socket, say —
   * the log call it was watching must still have succeeded, and the request
   * that logged must not fail because telemetry did.
   */
  it('cannot break the log call it observes', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    startSpanBridge(() => {
      throw new Error('socket closed');
    });

    // Inside a user scope, so the emitter is actually reached — an unattributable
    // span is dropped before it, which would make this pass for the wrong reason.
    expect(() =>
      withUserScope('u-1', () =>
        logger.info('preference.saved', { sessionId: 's-1', category: 'music' }),
      ),
    ).not.toThrow();

    resetServerLogSubscribers();
  });
});
