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

    // 16, not the 14 an earlier plan said: Spotify's two arrived after it was
    // written. An exact count so adding an integration is a deliberate change to
    // engine B's surface rather than something that happens quietly.
    expect(fresh).toHaveLength(16);
    expect(committed).toHaveLength(16);
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
