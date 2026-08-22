/**
 * Refactor Plan Tests — keep the committed PREDICTION well-formed and honest.
 *
 * docs/refactor-plan.json is a prediction of the UI rebuild, written before the
 * work, so the visualization can compare planned against actual. That only works
 * if the manifest is internally consistent (a dependency graph that references
 * real stages, symmetric parallelism, owner keys the ownership map recognizes)
 * and if it stays falsifiable — changes get an APPENDED dated revision rather
 * than a silent edit.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error - JS skill module without type declarations
import parser from '../../../skills/pr-monitoring/review-parser-skill.js';

const { knownOwners, attributeOwner } = parser;

const REPO_ROOT = resolve(__dirname, '../../../..');
const PLAN_PATH = resolve(REPO_ROOT, 'docs/refactor-plan.json');

type Stage = {
  id: string;
  title: string;
  owner: string[];
  kind: string;
  depends_on: string[];
  may_run_parallel_with: string[];
  expected_paths: string[];
  notes?: string;
};

const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8')) as {
  planned_at: string;
  stages: Stage[];
  predictions: Array<{ id: string; claim: string; rationale: string; falsified_if: string }>;
  revisions: unknown[];
  about: Record<string, unknown>;
};

const byId = new Map(plan.stages.map((s) => [s.id, s]));

describe('the manifest is well-formed', () => {
  it('is valid JSON with the required top-level keys', () => {
    for (const key of ['about', 'planned_at', 'stages', 'predictions', 'revisions']) {
      expect(plan, `missing top-level key: ${key}`).toHaveProperty(key);
    }
  });

  it('every stage carries the documented fields', () => {
    for (const s of plan.stages) {
      expect(typeof s.id, `${s.id}.id`).toBe('string');
      expect(typeof s.title, `${s.id}.title`).toBe('string');
      expect(Array.isArray(s.owner), `${s.id}.owner`).toBe(true);
      expect(s.owner.length, `${s.id} has no owner`).toBeGreaterThan(0);
      expect(Array.isArray(s.depends_on), `${s.id}.depends_on`).toBe(true);
      expect(Array.isArray(s.may_run_parallel_with), `${s.id}.may_run_parallel_with`).toBe(true);
      expect(['feature', 'telemetry', 'e2e'], `${s.id}.kind`).toContain(s.kind);
    }
  });

  it('stage ids are unique', () => {
    const ids = plan.stages.map((s) => s.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it('covers every stage named in the brief', () => {
    for (const id of ['0a', '0b', '1', '2', '3', '4', '5', '6', '6.5', '7', '8', '9']) {
      expect(byId.has(id), `missing stage ${id}`).toBe(true);
    }
  });
});

describe('owners are comparable with the real ownership map', () => {
  it('every planned owner is a key the ownership map knows', () => {
    // Otherwise "planned owner" and "attributed owner" cannot be compared and
    // the planned-vs-actual view is meaningless.
    const valid = new Set(knownOwners());
    for (const s of plan.stages) {
      for (const o of s.owner) {
        expect(valid, `stage ${s.id} names unknown owner "${o}"`).toContain(o);
      }
    }
  });

  it("every stage's expected_paths actually attribute to one of its owners", () => {
    for (const s of plan.stages) {
      for (const p of s.expected_paths) {
        const actual = attributeOwner(p);
        expect(
          s.owner,
          `stage ${s.id}: expected_paths "${p}" attributes to "${actual}", not in owner ${JSON.stringify(s.owner)}`
        ).toContain(actual);
      }
    }
  });

  it('multi-owner stages are the ones that genuinely span lanes', () => {
    // Stage 1 is design work, but the fonts load from index.html, which the
    // ownership table assigns to infra — so it spans two lanes whether or not
    // that is obvious to whoever picks it up.
    expect(byId.get('1')!.owner.sort()).toEqual(['infra', 'ui-designer']);
    expect(byId.get('6.5')!.owner.sort()).toEqual(['backend-dev', 'system-architect']);
    expect(byId.get('7')!.owner.sort()).toEqual(['frontend-dev', 'ui-designer']);
    expect(byId.get('9')!.owner.sort()).toEqual(['backend-dev', 'frontend-dev', 'system-architect']);
  });
});

describe('the dependency graph matches the stated shape', () => {
  it('every depends_on references a real stage', () => {
    for (const s of plan.stages) {
      for (const d of s.depends_on) {
        expect(byId.has(d), `stage ${s.id} depends on unknown stage ${d}`).toBe(true);
      }
    }
  });

  it('every may_run_parallel_with references a real stage', () => {
    for (const s of plan.stages) {
      for (const p of s.may_run_parallel_with) {
        expect(byId.has(p), `stage ${s.id} parallels unknown stage ${p}`).toBe(true);
      }
    }
  });

  it('parallelism is symmetric (an asymmetric claim is a planning error)', () => {
    for (const s of plan.stages) {
      for (const p of s.may_run_parallel_with) {
        expect(
          byId.get(p)!.may_run_parallel_with,
          `${s.id} claims parallel with ${p}, but ${p} does not claim ${s.id}`
        ).toContain(s.id);
      }
    }
  });

  it('a stage never both depends on and parallels the same stage', () => {
    for (const s of plan.stages) {
      for (const d of s.depends_on) {
        expect(s.may_run_parallel_with, `${s.id} both depends on and parallels ${d}`).not.toContain(d);
      }
    }
  });

  it('has no dependency cycle', () => {
    const state = new Map<string, number>(); // 0=unseen 1=visiting 2=done
    const walk = (id: string, trail: string[]): void => {
      if (state.get(id) === 2) return;
      expect(state.get(id), `dependency cycle: ${[...trail, id].join(' -> ')}`).not.toBe(1);
      state.set(id, 1);
      for (const d of byId.get(id)!.depends_on) walk(d, [...trail, id]);
      state.set(id, 2);
    };
    for (const s of plan.stages) walk(s.id, []);
  });

  it('encodes 0 → 1 → 2 → 3 → {4,5} → 6 → 7', () => {
    expect(byId.get('0a')!.depends_on).toEqual([]);
    expect(byId.get('0b')!.depends_on).toEqual([]);
    expect(byId.get('1')!.depends_on).toContain('0a');
    expect(byId.get('2')!.depends_on).toContain('1');
    expect(byId.get('3')!.depends_on).toContain('2');
    // 4 and 5 both fan out of 3, and run alongside each other.
    expect(byId.get('4')!.depends_on).toContain('3');
    expect(byId.get('5')!.depends_on).toContain('3');
    expect(byId.get('4')!.may_run_parallel_with).toContain('5');
    // 6 joins them back together.
    expect(byId.get('6')!.depends_on.sort()).toEqual(['4', '5']);
    expect(byId.get('7')!.depends_on).toContain('6');
  });

  it('leaves 6.5, 8 and 9 independent after 6', () => {
    for (const id of ['6.5', '8', '9']) {
      expect(byId.get(id)!.depends_on, `${id} should depend on 6`).toContain('6');
    }
    // Independent of each other => mutually parallel, and neither depends on the
    // others.
    for (const [a, b] of [['6.5', '8'], ['6.5', '9'], ['8', '9']]) {
      expect(byId.get(a)!.may_run_parallel_with).toContain(b);
      expect(byId.get(a)!.depends_on).not.toContain(b);
    }
  });

  it('every multi-owner stage would pass its own scope check on union coverage', () => {
    // The plan predicts these PRs pass the gate stage 0b installs. Check that
    // against the real checkScope, not by eye.
    const labelFor: Record<string, string> = {
      'system-architect': 'agent: architect',
      'frontend-dev': 'agent: frontend',
      'backend-dev': 'agent: backend',
      'ui-designer': 'agent: design',
      'qa-agent': 'agent: qa',
      infra: 'agent: infra',
    };
    for (const s of plan.stages) {
      const r = parser.checkScope(s.expected_paths, s.owner.map((o) => labelFor[o]));
      expect(r.ok, `stage ${s.id} would fail its own scope check: ${r.reasons.join('; ')}`).toBe(true);
    }
  });

  it('0a and 0b are independent of everything and of each other', () => {
    expect(byId.get('0a')!.may_run_parallel_with).toContain('0b');
    // 0b touches no src/, so it cannot conflict with 0a's deletions.
    for (const p of byId.get('0b')!.expected_paths) {
      expect(p.startsWith('src/'), `0b should not touch src/, but lists ${p}`).toBe(false);
    }
  });
});

describe('the QA follow-ups — the specific failure this manifest exposes', () => {
  const qaStages = plan.stages.filter((s) => s.kind === 'e2e');

  it('models a QA-owned e2e follow-up after each of 2, 3, 4, 5 and 6', () => {
    // QA authored 1 of 57 PRs last time. These five are the falsifiable claim.
    expect(qaStages).toHaveLength(5);
    const followed = qaStages.flatMap((s) => s.depends_on).sort();
    expect(followed).toEqual(['2', '3', '4', '5', '6']);
  });

  it('every e2e stage is owned by QA alone and touches only e2e/', () => {
    for (const s of qaStages) {
      expect(s.owner, `${s.id} must be QA-owned`).toEqual(['qa-agent']);
      expect(s.expected_paths).toEqual(['e2e/']);
    }
  });

  it('each e2e stage lands AFTER the stage it covers', () => {
    for (const s of qaStages) {
      expect(s.depends_on, `${s.id} must depend on exactly one feature stage`).toHaveLength(1);
      const covered = byId.get(s.depends_on[0])!;
      expect(covered.kind).not.toBe('e2e');
    }
  });
});

describe('the plan is falsifiable, and documented as such', () => {
  it('revisions is an array, empty for now', () => {
    expect(Array.isArray(plan.revisions)).toBe(true);
    expect(plan.revisions).toEqual([]);
  });

  it('documents in-file that changes are APPENDED, not edited', () => {
    // The whole value of a committed prediction is that it is not quietly
    // corrected after the fact.
    const raw = readFileSync(PLAN_PATH, 'utf8');
    expect(raw).toMatch(/append/i);
    expect(raw).toMatch(/DO NOT edit/i);
    expect(raw).toMatch(/revisions/);
  });

  it('records when it was written, so "before the work" is checkable', () => {
    expect(plan.planned_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('carries explicit, falsifiable predictions', () => {
    expect(plan.predictions.length).toBeGreaterThanOrEqual(4);
    for (const p of plan.predictions) {
      expect(typeof p.claim, `${p.id}.claim`).toBe('string');
      expect(p.falsified_if, `${p.id} must say what would falsify it`).toBeTruthy();
    }
  });

  it('any future revision must name a stage, a date and a reason', () => {
    // Shape-checks entries as they get appended; vacuously true while empty.
    for (const r of plan.revisions as Array<Record<string, unknown>>) {
      expect(r).toHaveProperty('date');
      expect(String(r.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r).toHaveProperty('stage');
      expect(r).toHaveProperty('change');
      expect(r).toHaveProperty('reason');
      expect(byId.has(String(r.stage)), `revision names unknown stage ${r.stage}`).toBe(true);
    }
  });
});
