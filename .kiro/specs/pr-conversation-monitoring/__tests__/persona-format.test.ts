/**
 * Persona Format Tests — the one matcher, and the four drift eras.
 *
 * This repo's persona header format drifted through four eras, and three call
 * sites parsed it independently with three different degrees of leniency. The
 * result: 19 of 93 PR comments unattributable, and — worse — four PRs (63-66)
 * that merged on a bare `APPROVED-BY-MASTER-AGENT` with no persona header at
 * all, which `isMasterApprovalComment()` should have rejected.
 *
 * These tests pin the policy so it cannot silently regress:
 *   - the canonical form parses and yields the right agent;
 *   - a bare approval token with no persona header FAILS;
 *   - each historical drift era is handled the documented way.
 *
 * The fixture file (.kiro/skills/shared/persona-fixtures.json) is shared with
 * the Python mirror (scripts/persona_format.py). Both implementations replay it
 * via --selfcheck; this suite additionally asserts the fixture itself still
 * covers every era, so nobody can "fix" a drift test by deleting its case.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
// @ts-expect-error - JS skill module without type declarations
import persona from '../../../skills/shared/persona-format.js';
// @ts-expect-error - JS skill module without type declarations
import gate from '../../../skills/pr-monitoring/approval-gate-skill.js';
// @ts-expect-error - JS skill module without type declarations
import router from '../../../skills/pr-monitoring/turn-router-skill.js';

const { identifyPersona, formatHeader, selfCheck, CANONICAL_FORM, FIXTURE_PATH } = persona;

type Case = {
  name: string;
  era: string;
  header: string;
  strict: string | null;
  lenient: string | null;
};

const fixtures: { canonicalForm: string; agents: Record<string, { name: string; emoji: string }>; cases: Case[] } =
  JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

const REPO_ROOT = resolve(__dirname, '../../../..');

describe('canonical persona header', () => {
  it('documents the canonical form as **<emoji> <Persona>** — <subject>', () => {
    expect(CANONICAL_FORM).toBe('**<emoji> <Persona>** — <subject>');
  });

  it('parses the canonical form and yields the right agent, for every agent', () => {
    for (const key of Object.keys(fixtures.agents)) {
      const body = `${formatHeader(key, 'Code Review')}\n\nSome review prose.`;
      expect(identifyPersona(body, { mode: 'strict' }), key).toBe(key);
    }
  });

  it('round-trips: what formatHeader writes, identifyPersona reads', () => {
    for (const key of Object.keys(fixtures.agents)) {
      expect(identifyPersona(formatHeader(key), { mode: 'strict' })).toBe(key);
      expect(identifyPersona(formatHeader(key, 'subject'), { mode: 'strict' })).toBe(key);
    }
  });

  it('is not fooled by a persona merely MENTIONED in prose', () => {
    // The old body-wide regex matched this. Attribution requires a header.
    const body = 'I think 👔 Master Agent should take a look at this one.';
    expect(identifyPersona(body, { mode: 'strict' })).toBeNull();
    expect(identifyPersona(body, { mode: 'lenient' })).toBeNull();
  });

  it('is not fooled by a canonical header quoted inside a code fence', () => {
    const body = ['Use this format:', '', '```', '**👔 Master Agent** — Review Complete', '```'].join('\n');
    expect(identifyPersona(body, { mode: 'strict' })).toBeNull();
  });
});

describe('the four historical drift eras', () => {
  /**
   * Policy, and why. `strict` is the live workflow (merge gate, turn routing);
   * `lenient` is BACKFILL ONLY (the contribution graph reading comments that
   * already exist and can never be rewritten).
   */

  it('ERA 1 — PRs 57-58, emoji dropped: recognize-for-backfill, reject-going-forward', () => {
    const body = '**Master Agent** --- Code Review\n\nReviewing the diff.';
    // Rejected going forward: a bold-name-only header is indistinguishable from
    // ordinary prose emphasis, e.g. "**Frontend Dev** should look at this".
    expect(identifyPersona(body, { mode: 'strict' })).toBeNull();
    // Recognized for backfill: the persona name is unambiguous.
    expect(identifyPersona(body, { mode: 'lenient' })).toBe('master-agent');
  });

  it('ERA 2 — PRs 61-62, "## Review: <Role>" + aliases: recognize-for-backfill, reject-going-forward', () => {
    const cases: Array<[string, string]> = [
      ['## Review: Architecture Lead', 'system-architect'],
      ['## Review: Backend Developer', 'backend-dev'],
      ['## Review: Master Approval', 'master-agent'],
      ['## Review: Master (Initial Review)', 'master-agent'],
      ['## Review: Architect', 'system-architect'],
    ];
    for (const [header, expected] of cases) {
      const body = `${header}\n\nReviewing infrastructure.`;
      expect(identifyPersona(body, { mode: 'strict' }), header).toBeNull();
      expect(identifyPersona(body, { mode: 'lenient' }), header).toBe(expected);
    }
  });

  it('ERA 2 — aliases resolve from an explicit table, not fuzzy matching', () => {
    // An unlisted role must NOT be guessed into a lane. Fuzzy matching is how
    // the drift became invisible in the first place.
    expect(identifyPersona('## Review: Release Manager', { mode: 'lenient' })).toBeNull();
    expect(identifyPersona('## Review: Staff Engineer', { mode: 'lenient' })).toBeNull();
  });

  it('ERA 3 — PRs 63-66, bare approval token with no persona header: REJECTED IN BOTH MODES', () => {
    const body = 'APPROVED-BY-MASTER-AGENT\n\nReviewed and independently verified.';
    // Not rehabilitated even for backfill: these four merged through a gate that
    // should have stopped them. Backfilling them would launder a real gate
    // bypass into a clean-looking graph.
    expect(identifyPersona(body, { mode: 'strict' })).toBeNull();
    expect(identifyPersona(body, { mode: 'lenient' })).toBeNull();
  });

  it('ERA 4 — PRs 49-50, no header of any kind: REJECTED IN BOTH MODES', () => {
    const body = 'Workflow verification successful — all phases confirmed operational.';
    expect(identifyPersona(body, { mode: 'strict' })).toBeNull();
    expect(identifyPersona(body, { mode: 'lenient' })).toBeNull();
  });

  it('the fixture still covers all four eras (nobody deleted a drift case)', () => {
    const eras = new Set(fixtures.cases.map((c) => c.era));
    for (const era of ['canonical', 'no-emoji', 'review-heading', 'bare-token', 'headerless', 'adversarial']) {
      expect(eras, `fixture lost coverage for era: ${era}`).toContain(era);
    }
  });
});

describe('the merge gate rejects a bare APPROVED-BY-MASTER-AGENT', () => {
  // This is the specific regression: PRs 63-66 merged on exactly this body.
  const bareToken = {
    body: 'APPROVED-BY-MASTER-AGENT\n\nReviewed as the trunk-clearing prerequisite.',
    authorLogin: 'coralst',
  };

  it('isMasterApprovalComment FAILS on a bare token with no persona header', () => {
    expect(gate.hasApprovalToken(bareToken.body)).toBe(true); // token IS present
    expect(gate.isMasterApprovalComment(bareToken)).toBe(false); // but it is not enough
  });

  it('isMasterApprovalComment PASSES with the canonical header plus the token', () => {
    const body = gate.buildApprovalComment({ ciGreen: true, blockingResolved: true, qaSignedOff: true });
    expect(gate.isMasterApprovalComment({ body, authorLogin: 'coralst' })).toBe(true);
  });

  it('the comment this skill EMITS satisfies the header this skill READS', () => {
    const body = gate.buildApprovalComment({ ciGreen: true });
    expect(gate.hasMasterPersonaHeader(body)).toBe(true);
    expect(identifyPersona(body, { mode: 'strict' })).toBe('master-agent');
  });

  it('a sub-agent cannot open the gate by quoting the token', () => {
    const body = `${formatHeader('backend-dev', 'done')}\n\nI think this is APPROVED-BY-MASTER-AGENT now.`;
    expect(gate.isMasterApprovalComment({ body, authorLogin: 'coralst' })).toBe(false);
  });

  it('the whole merge gate refuses a bare-token approval', () => {
    const decision = gate.evaluateMergeGate({
      ciStatus: 'success',
      prOpen: true,
      blockingIssues: 0,
      isUserFacing: false,
      comments: [bareToken],
    });
    expect(decision.mergeable).toBe(false);
    expect(decision.reasons.join(' ')).toContain('APPROVED-BY-MASTER-AGENT');
  });
});

describe('the turn router uses the same matcher', () => {
  it('AGENTS covers exactly the shared agent table', () => {
    expect(Object.keys(router.AGENTS).sort()).toEqual(Object.keys(fixtures.agents).sort());
  });

  it('identifyAuthorPersona is strict — a drift-era header has no author', () => {
    expect(router.identifyAuthorPersona('**Master Agent** --- Code Review')).toBeNull();
    expect(router.identifyAuthorPersona('## Review: Architecture Lead')).toBeNull();
    expect(router.identifyAuthorPersona(formatHeader('master-agent', 'Review'))).toBe('master-agent');
  });

  it('parseTurn reports a missing canonical header as a protocol problem', () => {
    const parsed = router.parseTurn({ body: 'APPROVED-BY-MASTER-AGENT', authorLogin: 'coralst' });
    expect(parsed.author).toBeNull();
    expect(parsed.terminal).toBe(false);
    expect(parsed.valid).toBe(false);
    expect(parsed.problems.join(' ')).toContain(CANONICAL_FORM);
  });
});

describe('the JS and Python matchers cannot drift apart', () => {
  it('the JS self-check replays every fixture case in both modes', () => {
    const { passed, failures } = selfCheck();
    expect(failures).toEqual([]);
    // Two modes per case: proves the whole fixture actually ran.
    expect(passed).toBe(fixtures.cases.length * 2);
  });

  it('the Python mirror agrees with the JS matcher on the same fixture', () => {
    // The two languages cannot share code, so they share the fixture. If this
    // fails, scripts/persona_format.py and persona-format.js have diverged.
    const out = execFileSync('python3', ['scripts/persona_format.py', '--selfcheck'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(out).toContain('selfcheck OK');
    expect(out).toContain(`${fixtures.cases.length * 2} assertions`);
  });

  it('each implementation points at the other, so the mirror is discoverable', () => {
    const js = readFileSync(resolve(REPO_ROOT, '.kiro/skills/shared/persona-format.js'), 'utf8');
    const py = readFileSync(resolve(REPO_ROOT, 'scripts/persona_format.py'), 'utf8');
    expect(js).toContain('scripts/persona_format.py');
    expect(py).toContain('.kiro/skills/shared/persona-format.js');
    // …and both name the fixture they share.
    expect(js).toContain('persona-fixtures.json');
    expect(py).toContain('persona-fixtures.json');
  });
});
