import { describe, it, expect } from 'vitest';
import committed from '../../../../infra/lib/generated/integration-tool-schemas.json';
import { generateToolSchemas } from '../../../../scripts/generate-tool-schemas.mjs';

/**
 * The committed Gateway schemas must match the tools that actually run.
 *
 * `infra/tsconfig.json` cannot import from `src/`, so the integration target's
 * tool schemas are generated into a committed JSON file. That file is the
 * agent's entire instruction set on engine B: each `description` is what the
 * model reads to decide whether to call a tool, and each `inputSchema` is the
 * contract it fills in.
 *
 * A stale copy does not fail loudly. It makes the model call the right tool with
 * arguments the tool no longer accepts, or stop calling a tool whose description
 * no longer describes what it does — which surfaces as "AgentCore's tool use is
 * worse than the hand-written loop", the one false conclusion this whole
 * comparison exists to avoid. So editing an `input_schema` without regenerating
 * is a red unit test here rather than a silently wrong Gateway.
 *
 * If this fails, run:
 *
 *   npm run generate:tool-schemas
 */
describe('the generated Gateway tool schemas', () => {
  it('match what the registry produces right now', async () => {
    // Regenerated in-process rather than by spawning `tsx`: faster, and a
    // subprocess would read the same stale file it is meant to be checking.
    const fresh = await generateToolSchemas();

    expect(fresh).toEqual(committed);
  });

  it('declares every tool the registry holds when fully credentialled', async () => {
    const fresh = await generateToolSchemas();

    // 23, having been 14 when the plan was written, then 16, 18 and 20 as Spotify's
    // two arrived, then `find_places_nearby` and `create_conversation_link`, then
    // `search_web` and `read_webpage` — and now the three reminders tools, which were
    // withheld until the tools Lambda was given a store. An exact count so adding an
    // integration is a deliberate change to engine B's surface rather than something
    // that happens quietly — this number moving is the signal to look at what a merge
    // just exposed to the model.
    expect(fresh).toHaveLength(23);
    expect(committed).toHaveLength(23);
  });

  /*
   * The exclusion that came back out, and why it must not silently return.
   *
   * All three reminders tools write our own DynamoDB table, and for a long time
   * `lambda-handler.ts` built its `ToolContext` with no store — so `set_reminder`
   * registered on engine B and refused every call with "Reminders are not available on
   * this deployment". The generator therefore filtered the whole `reminders` service
   * out, and a live turn on `?engine=agentcore` answered "I don't have a set_reminder
   * tool in my toolkit", truthfully.
   *
   * The Lambda now builds a real store from `VALENTIN_TABLE_NAME`, so they are hosted.
   * Asserted by name rather than left to the count above, which cannot tell "declared"
   * from "declared something else": both leave 23.
   */
  it('hosts the reminders tools on engine B, now the Lambda has a store', async () => {
    const fresh = await generateToolSchemas();

    for (const name of ['set_reminder', 'list_reminders', 'cancel_reminder']) {
      expect(fresh.map((t) => t.name)).toContain(name);
      expect(committed.map((t) => t.name)).toContain(name);
    }
  });

  /*
   * None of them is gated, and that is structural rather than a preference.
   *
   * `toolFor` in `agent-orchestrator.ts` resolves a `confirm_*` call by scanning for
   * the first tool with the matching `service` *and* `requiresConfirmation` — by
   * service, not by name. A gated reminders tool would therefore be reachable by
   * another reminders tool's confirmation, and the stack would derive a `confirm_*`
   * entry for it that nothing routes correctly.
   */
  it('leaves every reminders tool ungated, so confirm resolution stays unambiguous', () => {
    const reminders = committed.filter((t) => t.name.includes('reminder'));

    expect(reminders).toHaveLength(3);
    expect(reminders.every((t) => !t.requiresConfirmation)).toBe(true);
  });

  it('gates exactly the seven tools that spend money or send messages', () => {
    const gated = committed.filter((t) => t.requiresConfirmation).map((t) => t.name);

    expect(gated).toEqual([
      'propose_calendar_event',
      'propose_email',
      'propose_gift',
      'propose_hotel_booking',
      'propose_playlist',
      'propose_reservation',
      'propose_whatsapp_nudge',
    ]);
  });

  it('names every gated tool propose_*, and nothing else', () => {
    // The convention is asserted rather than relied upon. Step 6 pairs each gated
    // tool with a `confirm_*`, and a tool that quietly acted without a
    // `propose_`-shaped name would get no pair and no confirmation gate.
    for (const tool of committed) {
      expect(tool.name.startsWith('propose_')).toBe(tool.requiresConfirmation);
    }
  });

  it('requires the identity args on every tool', () => {
    // A tool missing these is one the proxy cannot attribute to a user. It would
    // still run — which is the problem.
    for (const tool of committed) {
      expect(tool.inputSchema.required).toContain('user_id');
      expect(tool.inputSchema.required).toContain('session_id');
      expect(tool.inputSchema.properties).toHaveProperty('user_id');
      expect(tool.inputSchema.properties).toHaveProperty('session_id');
    }
  });

  it('gives the model a description to decide on', () => {
    // An empty description is a tool the model will not call, which reads as the
    // integration being broken.
    for (const tool of committed) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('is sorted by name, so a diff shows a real change', () => {
    const names = committed.map((t) => t.name);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('carries no credential from the generator placeholders', () => {
    // The generator stubs every credential env var so all tools register. Those
    // placeholders must not end up in a committed file, and the day someone
    // generates with a real `.env` loaded, nothing of theirs should either.
    expect(JSON.stringify(committed)).not.toContain('schema-generation-only');
  });
});
