/**
 * Scope Check Tests — do a PR's changed paths agree with its `agent: *` labels?
 *
 * This is the decision the `scope-check` CI job runs. The
 * post-task-ci-review.kiro.hook already asked an agent to do this by hand and
 * recorded nothing; this makes the answer a recorded, deterministic check.
 *
 * The interesting case is MULTI-LABEL. Some PRs genuinely must span two domains
 * — a registry change in `src/shared/` plus the demo fixture in `src/server/`
 * that `src/server/api/__tests__/http-routes.test.ts` forces into the same
 * commit. So the rule is UNION coverage, not per-label exact matching.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
// @ts-expect-error - JS skill module without type declarations
import parser from '../../../skills/pr-monitoring/review-parser-skill.js';

const { checkScope } = parser;
const REPO_ROOT = resolve(__dirname, '../../../..');
const SKILL = '.kiro/skills/pr-monitoring/review-parser-skill.js';

describe('single-label PRs', () => {
  it('passes when every path is owned by the one label', () => {
    const r = checkScope(
      ['src/client/components/AppWindow.tsx', 'src/client/hooks/use-chat-state.ts'],
      ['agent: frontend']
    );
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('fails when a path is owned by an agent the PR is not labelled for', () => {
    const r = checkScope(
      ['src/client/components/AppWindow.tsx', 'src/shared/index.ts'],
      ['agent: frontend']
    );
    expect(r.ok).toBe(false);
    expect(r.outOfScope).toEqual([{ path: 'src/shared/index.ts', owner: 'system-architect' }]);
    expect(r.reasons.join(' ')).toContain('system-architect');
  });

  it('fails when the PR carries no agent label at all', () => {
    const r = checkScope(['src/client/App.tsx'], ['documentation']);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toContain('no recognized `agent: *` label');
  });

  it('fails on an unrecognized agent label', () => {
    const r = checkScope(['src/client/App.tsx'], ['agent: release-manager']);
    expect(r.ok).toBe(false);
    expect(r.unknownLabels).toEqual(['agent: release-manager']);
  });

  it('`agent: master` cannot satisfy a scope check on its own', () => {
    // The orchestrator owns no paths, so it must not be a universal bypass.
    const r = checkScope(['src/shared/index.ts'], ['agent: master']);
    expect(r.ok).toBe(false);
  });

  it('this very PR passes: .kiro/, .github/, scripts/, docs/, CONTRIBUTING.md under agent: infra', () => {
    const r = checkScope(
      [
        '.kiro/skills/shared/persona-format.js',
        '.kiro/skills/pr-monitoring/review-parser-skill.js',
        '.kiro/specs/pr-conversation-monitoring/__tests__/ownership.test.ts',
        '.github/workflows/ci.yml',
        'scripts/persona_format.py',
        'docs/refactor-plan.json',
        'CONTRIBUTING.md',
      ],
      ['agent: infra']
    );
    expect(r.unattributed).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe('multi-label PRs — the legitimate cross-domain case', () => {
  it('PASSES when the union of two labels covers every path', () => {
    // The real shape: a shared registry change plus the server fixture that
    // exercises it, forced into one commit by http-routes.test.ts.
    const r = checkScope(
      [
        'src/shared/interfaces/profile-item.ts',
        'src/server/api/http-routes.ts',
        'src/server/api/__tests__/http-routes.test.ts',
      ],
      ['agent: architect', 'agent: backend']
    );
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.labelOwners.sort()).toEqual(['backend-dev', 'system-architect']);
    expect(r.owners.sort()).toEqual(['backend-dev', 'system-architect']);
  });

  it('still FAILS when a third domain sneaks in beyond the two labels', () => {
    const r = checkScope(
      ['src/shared/interfaces/profile-item.ts', 'src/server/api/http-routes.ts', 'e2e/profile.spec.ts'],
      ['agent: architect', 'agent: backend']
    );
    expect(r.ok).toBe(false);
    expect(r.outOfScope).toEqual([{ path: 'e2e/profile.spec.ts', owner: 'qa-agent' }]);
  });

  it('handles the three-label case from the refactor plan (stage 9)', () => {
    const r = checkScope(
      [
        'src/shared/interfaces/profile-item.ts',
        'src/server/persistence/profile-item-store.ts',
        'src/client/hooks/use-profile-items.ts',
      ],
      ['agent: architect', 'agent: backend', 'agent: frontend']
    );
    expect(r.ok).toBe(true);
  });

  it('a label that owns nothing in the diff is a note, not a failure', () => {
    // A PR may carry a label for a file it ended up not needing to touch.
    // Failing that would push agents to drop labels, which is worse.
    const r = checkScope(['src/shared/index.ts'], ['agent: architect', 'agent: backend']);
    expect(r.ok).toBe(true);
    expect(r.unusedLabels).toEqual(['backend-dev']);
  });
});

describe('unattributable paths fail loudly', () => {
  it('fails, rather than passing silently, on a path no rule covers', () => {
    // After the workflow/platform rows there should be none of these. A new one
    // means OWNERSHIP needs a row — which is exactly what we want to hear about.
    const r = checkScope(['terraform/main.tf'], ['agent: infra']);
    expect(r.ok).toBe(false);
    expect(r.unattributed).toEqual(['terraform/main.tf']);
    expect(r.reasons.join(' ')).toContain('cannot be attributed');
    expect(r.reasons.join(' ')).toContain('add a row');
  });

  it('names the file to add the row to, so the fix is obvious', () => {
    const r = checkScope(['LICENSE'], ['agent: infra']);
    expect(r.reasons.join(' ')).toContain('review-parser-skill.js');
    expect(r.reasons.join(' ')).toContain('CONTRIBUTING.md');
  });
});

describe('the CLI CI actually invokes', () => {
  function runScope(paths: string[], labels: string[]) {
    try {
      const stdout = execFileSync(
        'node',
        [SKILL, '--scope', ...paths, '--', ...labels],
        { cwd: REPO_ROOT, encoding: 'utf8' }
      );
      return { code: 0, stdout };
    } catch (err: any) {
      return { code: err.status as number, stdout: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  }

  it('exits 0 and says PASSED on an in-scope diff', () => {
    const r = runScope(['src/client/App.tsx'], ['agent: frontend']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Scope check PASSED');
  });

  it('exits 0 on the multi-label union case', () => {
    const r = runScope(
      ['src/shared/interfaces/profile-item.ts', 'src/server/api/http-routes.ts'],
      ['agent: architect', 'agent: backend']
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Scope check PASSED');
  });

  it('exits 1 and explains itself on a violation', () => {
    const r = runScope(['src/shared/index.ts'], ['agent: frontend']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('Scope check FAILED');
    expect(r.stdout).toContain('system-architect');
  });

  it('exits 1 on an unattributable path', () => {
    const r = runScope(['terraform/main.tf'], ['agent: infra']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('cannot be attributed');
  });

  it('exits 0 with no paths (a PR whose whole diff was path-filtered away)', () => {
    const r = runScope([], ['agent: infra']);
    expect(r.code).toBe(0);
  });
});
