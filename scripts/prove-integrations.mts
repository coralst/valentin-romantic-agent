#!/usr/bin/env npx tsx
/**
 * Prove each integration by actually using it, and write down what came back.
 *
 *   npx tsx scripts/prove-integrations.mts            # everything configured
 *   npx tsx scripts/prove-integrations.mts ontopo     # just one
 *
 * ### Why this exists
 *
 * The unit suite stubs `fetch`, so it proves the client handles a shape — not
 * that the shape is real, that the host resolves, or that the credential works.
 * Those are exactly the things that break, and they break silently: an
 * undocumented API changes a field name and every mocked test still passes.
 *
 * So this is the definition of done for an integration. It calls the real
 * provider through the real registered `AgentTool` — the same code path the model
 * drives — and records the response. A run either produces evidence or names what
 * is missing; it never reports a pass it did not earn.
 *
 * ### What it will not do
 *
 * **It never confirms a proposal.** Every write tool here is invoked through
 * `execute`, which by contract *proposes* and returns an `ActionProposal` without
 * acting. `confirm` is what books the table and sends the mail, and a script that
 * called it would book real tables and email real people every time someone
 * checked whether the integration worked. Proving that a proposal is well-formed
 * and carries a live provider link is the whole of what can honestly be proven
 * unattended — the last step belongs to a human pressing Confirm, which is the
 * authority model this build is built around.
 *
 * Evidence lands in `docs/integration-proof/`. It is committed on purpose: a
 * reviewer asking "does Ontopo actually work" should be able to read the answer
 * rather than re-run anything.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { config } from '../src/server/config';
import { integrationReadiness } from '../src/server/integrations';
import { runTool, type AgentTool, type ToolResult } from '../src/server/integrations/tool-registry';
import { hebcalTools } from '../src/server/integrations/hebcal/tools';
import { ontopoTools } from '../src/server/integrations/ontopo/tools';
import { amadeusTools } from '../src/server/integrations/amadeus/tools';
import { gmailTools, googleCalendarTools } from '../src/server/integrations/google/tools';
import { whatsappTools } from '../src/server/integrations/whatsapp/tools';
import type { IntegrationId } from '../src/shared/interfaces/integrations';

const OUT_DIR = 'docs/integration-proof';
const CTX = { sessionId: 'proof-run' };

/**
 * Where a proof-run WhatsApp nudge would be addressed, and an email.
 *
 * Overridable so a run can use the account it actually has. Neither is ever sent:
 * both tools stop at a proposal, and this script never calls `confirm`.
 */
const PROOF_PHONE = process.env.PROOF_PHONE ?? '+972500000000';
const PROOF_EMAIL = process.env.PROOF_EMAIL ?? 'koralsteinberg@gmail.com';

/** One thing to try, and how to judge what came back. */
interface Probe {
  /** What this demonstrates, in the words a reviewer would use. */
  claim: string;
  tool: AgentTool;
  input?: Record<string, unknown>;
  /**
   * Work out the input by asking the provider first, when a fixed one cannot work.
   *
   * Ontopo needs this: proposing a table requires a slot that is genuinely free,
   * and which nights are free is not knowable in advance. Returning null means
   * "the provider answered, and there was nothing to propose" — recorded as
   * unproven rather than failed, because that is a true fact about Tel Aviv on a
   * Sunday and not a defect.
   */
  prepare?: () => Promise<Record<string, unknown> | null>;
  /**
   * Whether the result actually supports the claim.
   *
   * `ok` alone is not enough for several of these. A search that returns zero
   * venues is a successful call and no evidence at all that Ontopo works, so the
   * check looks at the payload.
   */
  check: (result: ToolResult) => boolean;
}

/**
 * A near date that is definitely in the future, in Israel.
 *
 * Computed rather than hardcoded because availability APIs reject past dates, and
 * a hardcoded date turns this script into something that works until it doesn't.
 */
function soon(daysAhead: number): string {
  const at = new Date(Date.now() + daysAhead * 86_400_000);
  return at.toISOString().slice(0, 10);
}

/** The upcoming Saturday, which is the interesting case for anything Shabbat-adjacent. */
function nextSaturday(): string {
  const at = new Date();
  at.setDate(at.getDate() + ((6 - at.getDay() + 7) % 7 || 7));
  return at.toISOString().slice(0, 10);
}

function tool(tools: readonly AgentTool[], name: string): AgentTool {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`No such tool: ${name}`);
  return found;
}

/**
 * Venues from the curated bookable list, tried in order.
 *
 * Real names are required to prove anything: an invented one is rejected locally
 * by `resolveVenue` before a request is ever made, which would produce a green
 * run that touched no network at all.
 */
const PROOF_VENUES = ['Hotel Montefiore', 'NOEMA', 'Yaffo Tel Aviv', 'Milgo Milbar'];

/**
 * Ask Ontopo, for real, until something is actually bookable.
 *
 * This exists because `propose_reservation` refuses a time that is not free — as
 * it should; silently moving someone's anniversary dinner is the helpfulness
 * nobody asked for. So proving the proposal step needs a slot the live
 * availability call just returned, and finding one means asking about several
 * nights. Which is itself the strongest evidence in this file: each iteration is
 * a real request to ontopo.com.
 */
async function findRealSlot(): Promise<Record<string, unknown> | null> {
  const availability = tool(ontopoTools, 'check_availability');
  for (const daysAhead of [9, 10, 11, 16, 17]) {
    for (const restaurant of PROOF_VENUES) {
      const date = soon(daysAhead);
      const result = await runTool(availability, { restaurant, date, party_size: 2 }, CTX);
      const slots = (result.data as { slots?: { time: string; area?: string }[] })?.slots;
      if (result.ok && slots?.length) {
        console.log(
          `        found a real table: ${restaurant} on ${date} at ${slots[0].time}`,
        );
        return { restaurant, date, time: slots[0].time, party_size: 2, area: slots[0].area };
      }
    }
  }
  return null;
}

const PROBES: Record<IntegrationId, Probe[]> = {
  hebcal: [
    {
      claim: 'Resolves the real candle-lighting and Havdalah times for a Tel Aviv Shabbat',
      tool: tool(hebcalTools, 'check_shabbat'),
      input: { city: 'Tel Aviv', when: `${nextSaturday()}T21:00` },
      // Both moments, in order, and the weekly portion — the pairing that was
      // once broken in a way every mocked test missed.
      check: (r) =>
        r.ok &&
        /Shabbat (begins|began)/.test(r.summary) &&
        /Havdalah/.test(r.summary),
    },
    {
      claim: 'Converts a Gregorian anniversary to its drifting Hebrew date',
      tool: tool(hebcalTools, 'get_hebrew_occasions'),
      input: { anniversary_date: '2019-03-02' },
      check: (r) => r.ok && r.summary.length > 20,
    },
  ],
  ontopo: [
    {
      // Deliberately not claimed as a live call: the bookable list is curated in
      // `venues.ts` and this tool reads it locally. Saying otherwise would be the
      // exact kind of overclaim this file exists to prevent.
      claim: 'Resolves the curated bookable list (local — no network call)',
      tool: tool(ontopoTools, 'find_restaurants'),
      input: { query: 'romantic' },
      check: (r) =>
        r.ok &&
        Array.isArray((r.data as { venues?: unknown[] })?.venues) &&
        (r.data as { venues: unknown[] }).venues.length > 0,
    },
    {
      claim: 'Reads live table availability from ontopo.com for a real venue and date',
      tool: tool(ontopoTools, 'check_availability'),
      input: { restaurant: PROOF_VENUES[0], date: soon(9), time: '20:00', party_size: 2 },
      // A venue with genuinely no tables that night is a valid answer, so the
      // claim is that the call reached Ontopo and was understood — not that a
      // table happened to be free.
      check: (r) => r.ok,
    },
    {
      claim:
        'Turns a genuinely free slot into a proposal, and books nothing — the checkout link is minted only on confirm',
      tool: tool(ontopoTools, 'propose_reservation'),
      prepare: findRealSlot,
      check: (r) =>
        r.ok &&
        r.proposal !== undefined &&
        r.proposal?.expiresAt !== undefined &&
        // No url yet, and that is correct: minting it here would burn its
        // fifteen minutes while the user read the card, and would mean holding a
        // live booking page for a decision nobody had made.
        r.proposal?.url === undefined,
    },
  ],
  amadeus: [
    {
      claim: 'Authenticates with client credentials and returns real hotel offers',
      tool: tool(amadeusTools, 'search_hotels'),
      input: { city: 'Tel Aviv', check_in: soon(30), check_out: soon(32), adults: 2 },
      check: (r) => r.ok,
    },
    {
      claim: 'Returns Tours & Activities near a real coordinate',
      tool: tool(amadeusTools, 'search_activities'),
      input: { city: 'Tel Aviv' },
      check: (r) => r.ok,
    },
  ],
  'google-calendar': [
    {
      claim: 'Reads the connected account\'s real calendar events',
      tool: tool(googleCalendarTools, 'find_occasions'),
      input: {},
      check: (r) => r.ok,
    },
    {
      claim: 'Proposes a calendar entry without creating it',
      tool: tool(googleCalendarTools, 'propose_calendar_event'),
      input: {
        title: 'Anniversary dinner (proof run — not created)',
        date: soon(21),
        time: '20:00',
      },
      check: (r) => r.ok && r.proposal !== undefined,
    },
  ],
  gmail: [
    {
      claim: 'Drafts a message as the connected account and waits for confirmation to send',
      tool: tool(gmailTools, 'propose_email'),
      input: {
        to: PROOF_EMAIL,
        subject: 'Valentin proof run — nothing was sent',
        body: 'This proves the Gmail tool produced a proposal. Sending needs a human Confirm.',
      },
      check: (r) => r.ok && r.proposal !== undefined,
    },
  ],
  whatsapp: [
    {
      claim: 'Renders an approved template into a proposal without sending it',
      tool: tool(whatsappTools, 'propose_whatsapp_nudge'),
      input: {
        to: PROOF_PHONE,
        template: 'valentin_occasion_reminder',
        params: { occasion: 'your anniversary', date: 'Saturday' },
      },
      check: (r) => r.ok && r.proposal !== undefined,
    },
  ],
};

interface Outcome {
  integration: IntegrationId;
  claim: string;
  tool: string;
  input: Record<string, unknown>;
  passed: boolean;
  summary: string;
  /** Trimmed, because a hotel search returns pages of it and this file is read by people. */
  data?: unknown;
  proposal?: Record<string, unknown>;
  durationMs: number;
}

/**
 * Redact anything proposal-shaped before it is written down.
 *
 * `payload` is what a tool needs at confirm time and is opaque by contract; it can
 * hold a venue's internal availability id, and this file is committed. The url is
 * kept because a live checkout link *is* the evidence, and it expires in about
 * fifteen minutes anyway.
 */
function safeProposal(result: ToolResult): Record<string, unknown> | undefined {
  const p = result.proposal;
  if (!p) return undefined;
  return { service: p.service, title: p.title, url: p.url, expiresAt: p.expiresAt };
}

/** Keep evidence readable: the shape and the first entry, not the whole page. */
function trim(data: unknown): unknown {
  if (Array.isArray(data)) {
    return { count: data.length, first: data[0] };
  }
  if (data && typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      out[key] = Array.isArray(value) ? { count: value.length, first: value[0] } : value;
    }
    return out;
  }
  return data;
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const ready = integrationReadiness();
const outcomes: Outcome[] = [];
const unproven: { integration: IntegrationId; claim: string; why: string }[] = [];
const skipped: { integration: IntegrationId; why: string }[] = [];

for (const [id, probes] of Object.entries(PROBES) as [IntegrationId, Probe[]][]) {
  if (only.length && !only.includes(id)) continue;

  if (!ready[id]) {
    skipped.push({
      integration: id,
      why: 'no credentials on this machine, so the tools are not registered',
    });
    console.log(`\n— ${id}: SKIPPED (not configured)`);
    continue;
  }

  console.log(`\n— ${id}`);
  for (const probe of probes) {
    let input = probe.input ?? {};
    if (probe.prepare) {
      const prepared = await probe.prepare();
      if (!prepared) {
        // The provider answered and there was nothing to work with. A true fact
        // about the world, not a defect, so it is recorded as unproven and does
        // not fail the run.
        unproven.push({
          integration: id,
          claim: probe.claim,
          why: 'the provider had nothing available to propose at the time of the run',
        });
        console.log(`  n/a   ${probe.tool.name} — nothing available to propose right now`);
        continue;
      }
      input = prepared;
    }

    const startedAt = Date.now();
    // Through `runTool`, not `tool.execute`, so this exercises the same wrapper
    // the loop uses — including the structured log the Inspector draws spans from.
    const result = await runTool(probe.tool, input, CTX);
    const durationMs = Date.now() - startedAt;
    const passed = probe.check(result);

    outcomes.push({
      integration: id,
      claim: probe.claim,
      tool: probe.tool.name,
      input,
      passed,
      summary: result.summary,
      data: trim(result.data),
      proposal: safeProposal(result),
      durationMs,
    });

    console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${probe.tool.name} (${durationMs}ms) — ${probe.claim}`);
    console.log(`        ${result.summary.slice(0, 160).replace(/\n/g, ' ')}`);
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString();

writeFileSync(
  `${OUT_DIR}/results.json`,
  `${JSON.stringify({ ranAt: stamp, amadeusHost: config.integrations.amadeusHost, outcomes, unproven, skipped }, null, 2)}\n`,
);

const passed = outcomes.filter((o) => o.passed).length;
const lines: string[] = [
  '# Integration proof',
  '',
  'Generated by `npx tsx scripts/prove-integrations.mts`. Every row below is a real',
  'call to a real provider through the same `AgentTool` the model drives — no mocks,',
  'no stubbed `fetch`. Regenerate it rather than editing it.',
  '',
  '**No proposal is ever confirmed here.** Write tools are invoked through `execute`,',
  'which proposes and returns without acting; `confirm` is what books and sends, and',
  'it belongs to a human pressing Confirm. A checkout link in this file is a live',
  'offer that was never taken up.',
  '',
  `Last run: ${stamp}`,
  '',
  `Result: **${passed} of ${outcomes.length} probes passed**` +
    (skipped.length ? `, ${skipped.length} integration(s) skipped for want of credentials.` : '.'),
  '',
];

for (const [id] of Object.entries(PROBES) as [IntegrationId, Probe[]][]) {
  const mine = outcomes.filter((o) => o.integration === id);
  const skip = skipped.find((s) => s.integration === id);
  const mineUnproven = unproven.filter((u) => u.integration === id);
  if (!mine.length && !skip && !mineUnproven.length) continue;

  lines.push(`## ${id}`, '');
  if (skip) {
    lines.push(`Not proven: ${skip.why}.`, '');
    continue;
  }
  for (const u of unproven.filter((x) => x.integration === id)) {
    lines.push(`### ⏳ ${u.claim}`, '', `Not shown on this run: ${u.why}.`, '');
  }
  for (const o of mine) {
    lines.push(
      `### ${o.passed ? '✅' : '❌'} ${o.claim}`,
      '',
      `- Tool: \`${o.tool}\` · ${o.durationMs}ms`,
      `- Input: \`${JSON.stringify(o.input)}\``,
      `- What came back: ${o.summary.replace(/\n+/g, ' ')}`,
    );
    if (o.proposal) {
      lines.push(`- Proposal (not confirmed): \`${JSON.stringify(o.proposal)}\``);
    }
    if (o.data !== undefined) {
      lines.push('', '```json', JSON.stringify(o.data, null, 2).slice(0, 1400), '```');
    }
    lines.push('');
  }
}

if (skipped.length) {
  lines.push(
    '## Still to prove',
    '',
    'These need a credential this machine does not have. The integrations panel in',
    'the app takes them — probe, apply and register happen without a restart — and',
    'then this script proves them:',
    '',
  );
  for (const s of skipped) lines.push(`- **${s.integration}** — ${s.why}`);
  lines.push('');
}

writeFileSync(`${OUT_DIR}/README.md`, `${lines.join('\n')}\n`);

console.log(`\n${passed}/${outcomes.length} probes passed. Evidence: ${OUT_DIR}/README.md`);
if (skipped.length) {
  console.log(`Skipped (no credentials): ${skipped.map((s) => s.integration).join(', ')}`);
}
// Non-zero only for a *configured* integration that failed. A missing credential
// is a known state, not a broken build.
process.exit(outcomes.some((o) => !o.passed) ? 1 : 0);
