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
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

/**
 * The CI entrypoint. Reads its inputs from FILES rather than argv, because PR
 * labels and branch-derived paths are attacker-influenced text that must not be
 * interpolated into a shell command line — and because keeping the logic in a
 * committed file is what stops the workflow needing an inline `node -e`, which is
 * how invalid YAML shipped here once before.
 */
describe('the CI entrypoint (scope-check-ci.js)', () => {
  const CI_SKILL = '.kiro/skills/shared/scope-check-ci.js';

  function runCi(paths: string | null, labels: string | null) {
    const dir = mkdtempSync(join(tmpdir(), 'scope-ci-'));
    const pathsFile = join(dir, 'changed-paths.txt');
    const labelsFile = join(dir, 'labels.json');
    if (paths !== null) writeFileSync(pathsFile, paths);
    if (labels !== null) writeFileSync(labelsFile, labels);
    try {
      const stdout = execFileSync('node', [CI_SKILL, pathsFile, labelsFile], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      return { code: 0, out: stdout };
    } catch (err: any) {
      return { code: err.status as number, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  }

  it('passes a single-lane diff', () => {
    const r = runCi('src/client/App.tsx\n', '["agent: frontend"]');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Every changed path is covered');
  });

  it('passes the multi-label union case', () => {
    const r = runCi(
      'src/shared/interfaces/profile-item.ts\nsrc/server/api/http-routes.ts\n',
      '["agent: architect","agent: backend"]'
    );
    expect(r.code).toBe(0);
  });

  it('fails an out-of-lane path and names the owner', () => {
    const r = runCi('src/shared/index.ts\n', '["agent: frontend"]');
    expect(r.code).toBe(1);
    expect(r.out).toContain('Out of scope');
    expect(r.out).toContain('system-architect');
  });

  it('fails loudly on an unattributable path', () => {
    const r = runCi('terraform/main.tf\n', '["agent: infra"]');
    expect(r.code).toBe(1);
    expect(r.out).toContain('cannot be attributed');
  });

  it('tolerates blank lines and CRLF in the paths file', () => {
    const r = runCi('src/client/App.tsx\r\n\n\n', '["agent: frontend"]');
    expect(r.code).toBe(0);
  });

  it('treats an empty diff as success, not a violation', () => {
    // e.g. a merge commit whose changes are all already on the base.
    const r = runCi('', '["agent: infra"]');
    expect(r.code).toBe(0);
  });

  it('exits 2 (not 1) on malformed labels JSON — a harness fault, not a scope violation', () => {
    const r = runCi('src/client/App.tsx\n', '{not json');
    expect(r.code).toBe(2);
  });

  it('exits 2 on missing arguments', () => {
    let code = 0;
    try {
      execFileSync('node', [CI_SKILL], { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
    } catch (err: any) {
      code = err.status;
    }
    expect(code).toBe(2);
  });

  it('treats a missing labels file as no labels (and therefore a failure)', () => {
    const r = runCi('src/client/App.tsx\n', null);
    expect(r.code).toBe(1);
    expect(r.out).toContain('no recognized `agent: *` label');
  });

  it('reports the same verdict the pure function does, for this PR’s own diff', () => {
    // The gate must pass on the PR that introduces it.
    const own = [
      '.kiro/skills/shared/persona-format.js',
      '.kiro/skills/shared/scope-check-ci.js',
      '.kiro/skills/pr-monitoring/review-parser-skill.js',
      '.github/workflows/ci.yml',
      'scripts/persona_format.py',
      'docs/refactor-plan.json',
      'CONTRIBUTING.md',
    ];
    expect(checkScope(own, ['agent: infra']).ok).toBe(true);
    const r = runCi(own.join('\n') + '\n', '["agent: infra"]');
    expect(r.code).toBe(0);
  });
});
