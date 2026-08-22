/**
 * Ownership Tests — the path→owner map, and the prose/code drift gate.
 *
 * `attributeOwner()` used to return null for everything outside `src/`
 * (`.kiro/`, `.github/`, `scripts/`, `public/`, `index.html`, `docs/`, and
 * `src/client/utils/`), which is why 29 of 57 PRs — 51% — were labelled
 * `agent: infra`: a lane that had no row in CONTRIBUTING.md's ownership table at
 * all. Everything unattributable fell into it by default.
 *
 * Two things are pinned here:
 *   1. the ownership map itself, including the docs/ prefix-ordering subtlety;
 *   2. a DRIFT TEST between CONTRIBUTING.md's table (prose) and the OWNERSHIP
 *      list (code). They are two halves of one contract; this fails if only one
 *      half gets updated.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
// @ts-expect-error - JS skill module without type declarations
import parser from '../../../skills/pr-monitoring/review-parser-skill.js';

const {
  attributeOwner,
  attributeChangedPaths,
  assertOwnershipOrdering,
  knownOwners,
  ownerForLabel,
  OWNERSHIP,
} = parser;

const REPO_ROOT = resolve(__dirname, '../../../..');
const CONTRIBUTING = readFileSync(resolve(REPO_ROOT, 'CONTRIBUTING.md'), 'utf8');

describe('attributeOwner — application code (unchanged behaviour)', () => {
  const cases: Array<[string, string]> = [
    ['src/shared/index.ts', 'system-architect'],
    ['src/client/design-system/tokens.ts', 'ui-designer'],
    ['src/client/components/MessageBubble.tsx', 'frontend-dev'],
    ['src/client/hooks/use-chat-state.ts', 'frontend-dev'],
    ['src/client/context/websocket-context.tsx', 'frontend-dev'],
    ['src/client/App.tsx', 'frontend-dev'],
    ['src/client/main.tsx', 'frontend-dev'],
    ['src/server/api/http-routes.ts', 'backend-dev'],
    ['e2e/onboarding.spec.ts', 'qa-agent'],
    ['playwright.config.ts', 'qa-agent'],
  ];
  for (const [path, owner] of cases) {
    it(`${path} → ${owner}`, () => {
      expect(attributeOwner(path)).toBe(owner);
    });
  }
});

describe('attributeOwner — the rows that were missing', () => {
  const cases: Array<[string, string]> = [
    // These all returned null before, and are the reason `agent: infra` swallowed
    // half the PR history.
    ['.github/workflows/ci.yml', 'infra'],
    ['.kiro/skills/pr-monitoring/review-parser-skill.js', 'infra'],
    ['.kiro/hooks/post-task-ci-review.kiro.hook', 'infra'],
    ['scripts/generate-agent-graph.py', 'infra'],
    ['scripts/deploy.sh', 'infra'],
    ['infra/lib/cdn-stack.ts', 'infra'],
    ['public/logo.svg', 'infra'],
    ['index.html', 'infra'],
    // Frontend utils — client code, so the frontend owns it.
    ['src/client/utils/profile-field-registry.ts', 'frontend-dev'],
    ['src/client/utils/__tests__/occasion-derivation.test.ts', 'frontend-dev'],
  ];
  for (const [path, owner] of cases) {
    it(`${path} → ${owner}`, () => {
      expect(attributeOwner(path)).toBe(owner);
    });
  }
});

describe('attributeOwner — docs/ prefix ordering (the specific rule wins)', () => {
  it('docs/design/ belongs to the UI Designer, per CONTRIBUTING.md', () => {
    expect(attributeOwner('docs/design/visual-language.md')).toBe('ui-designer');
    expect(attributeOwner('docs/design/tokens/claret.md')).toBe('ui-designer');
  });

  it('the rest of docs/ documents the workflow, so it is infra', () => {
    expect(attributeOwner('docs/METHODOLOGY.md')).toBe('infra');
    expect(attributeOwner('docs/refactor-plan.json')).toBe('infra');
    expect(attributeOwner('docs/assets/graph/agent-contribution-graph.svg')).toBe('infra');
  });

  it('is order-dependent, and the order is asserted rather than assumed', () => {
    // If someone moves `docs/` above `docs/design/`, docs/design/ becomes
    // unreachable and the designer silently loses its lane.
    expect(assertOwnershipOrdering()).toEqual([]);
  });

  it('no OWNERSHIP entry is shadowed by a broader prefix ahead of it', () => {
    const specificFirst = OWNERSHIP.map(([p]: [string, string]) => p);
    for (let i = 0; i < specificFirst.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        if (specificFirst[i] !== specificFirst[j]) {
          expect(
            specificFirst[i].startsWith(specificFirst[j]),
            `"${specificFirst[i]}" is shadowed by earlier "${specificFirst[j]}"`
          ).toBe(false);
        }
      }
    }
  });
});

describe('attributeOwner — hygiene', () => {
  it('returns null for a genuinely unknown top-level surface', () => {
    // This is the signal that OWNERSHIP needs a new row; CI fails loudly on it.
    expect(attributeOwner('terraform/main.tf')).toBeNull();
    expect(attributeOwner('LICENSE')).toBeNull();
  });

  it('returns null for junk input', () => {
    expect(attributeOwner('')).toBeNull();
    expect(attributeOwner(undefined)).toBeNull();
    expect(attributeOwner(null)).toBeNull();
    expect(attributeOwner(42)).toBeNull();
  });

  it('normalises a leading ./ so raw git output can be passed verbatim', () => {
    expect(attributeOwner('./src/shared/index.ts')).toBe('system-architect');
    expect(attributeOwner('/index.html')).toBe('infra');
  });

  it('matches an exact-file rule without requiring a trailing path', () => {
    expect(attributeOwner('index.html')).toBe('infra');
    expect(attributeOwner('playwright.config.ts')).toBe('qa-agent');
  });

  it('attributeChangedPaths groups by owner and collects the unattributable', () => {
    const { byOwner, unattributed } = attributeChangedPaths([
      'src/shared/index.ts',
      'src/server/api/http-routes.ts',
      'src/server/api/__tests__/http-routes.test.ts',
      'terraform/main.tf',
      '',
    ]);
    expect(byOwner['system-architect']).toEqual(['src/shared/index.ts']);
    expect(byOwner['backend-dev']).toHaveLength(2);
    expect(unattributed).toEqual(['terraform/main.tf']);
  });
});

describe('every file actually in the repo attributes to an owner', () => {
  // The property the CI scope check relies on: after the workflow/platform rows,
  // NOTHING tracked is unattributable. If this fails, a new top-level surface
  // landed and OWNERSHIP needs a row — which is the signal, not a nuisance.
  it('git ls-files has no unattributable path', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(100); // sanity: we really listed the repo
    const { unattributed } = attributeChangedPaths(files);
    expect(unattributed, `add an OWNERSHIP row for: ${unattributed.join(', ')}`).toEqual([]);
  });
});

describe('agent: * label → owner', () => {
  it('maps every label in the ownership table', () => {
    expect(ownerForLabel('agent: architect')).toBe('system-architect');
    expect(ownerForLabel('agent: frontend')).toBe('frontend-dev');
    expect(ownerForLabel('agent: backend')).toBe('backend-dev');
    expect(ownerForLabel('agent: design')).toBe('ui-designer');
    expect(ownerForLabel('agent: qa')).toBe('qa-agent');
    expect(ownerForLabel('agent: infra')).toBe('infra');
  });

  it('accepts the bare suffix and is case-insensitive', () => {
    expect(ownerForLabel('frontend')).toBe('frontend-dev');
    expect(ownerForLabel('Agent: Frontend')).toBe('frontend-dev');
  });

  it('does not map agent: master — the orchestrator owns no paths', () => {
    // Otherwise `agent: master` would be a universal scope-check bypass.
    expect(ownerForLabel('agent: master')).toBeNull();
  });

  it('returns null for a non-agent or unknown label', () => {
    expect(ownerForLabel('documentation')).toBeNull();
    expect(ownerForLabel('agent: release-manager')).toBeNull();
  });
});

/**
 * The drift gate. CONTRIBUTING.md's table and the OWNERSHIP list are two
 * expressions of one contract; if a PR updates only one, this fails.
 */
describe('CONTRIBUTING.md ownership table agrees with the OWNERSHIP list', () => {
  type Row = { agent: string; label: string; paths: string[] };

  function parseTable(): Row[] {
    const block = CONTRIBUTING.split('OWNERSHIP-TABLE:START')[1]?.split('OWNERSHIP-TABLE:END')[0];
    expect(block, 'ownership table markers missing from CONTRIBUTING.md').toBeTruthy();
    const rows: Row[] = [];
    for (const line of block!.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('|') || /^\|\s*-+/.test(t) || /\|\s*Agent\s*\|/.test(t)) continue;
      const cells = t.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.length < 4) continue;
      const [agent, label, paths] = cells;
      rows.push({
        agent,
        label: label.replace(/`/g, '').trim(),
        paths: [...paths.matchAll(/`([^`]+)`/g)].map((m) => m[1]),
      });
    }
    return rows;
  }

  const rows = parseTable();

  it('parses six lanes from the table', () => {
    expect(rows).toHaveLength(6);
  });

  it('every lane in the code has a row in the table (including infra)', () => {
    const tableOwners = new Set(rows.map((r) => ownerForLabel(r.label)));
    for (const owner of knownOwners()) {
      expect(tableOwners, `no CONTRIBUTING.md row for owner "${owner}"`).toContain(owner);
    }
  });

  it('every row in the table names a label the code recognizes', () => {
    for (const row of rows) {
      expect(ownerForLabel(row.label), `unrecognized label in table: ${row.label}`).not.toBeNull();
    }
  });

  it('every path the table claims actually attributes to that row’s owner', () => {
    for (const row of rows) {
      const owner = ownerForLabel(row.label);
      for (const path of row.paths) {
        expect(attributeOwner(path), `CONTRIBUTING.md says ${path} → ${owner}`).toBe(owner);
      }
    }
  });

  it('every prefix in the code appears in the table (no undocumented rules)', () => {
    const documented = new Set(rows.flatMap((r) => r.paths));
    for (const [prefix] of OWNERSHIP as Array<[string, string]>) {
      expect(documented, `OWNERSHIP has "${prefix}" but CONTRIBUTING.md does not list it`).toContain(
        prefix
      );
    }
  });

  it('the table lists no path the code does not implement', () => {
    const implemented = new Set((OWNERSHIP as Array<[string, string]>).map(([p]) => p));
    for (const row of rows) {
      for (const path of row.paths) {
        expect(implemented, `CONTRIBUTING.md lists "${path}" but OWNERSHIP has no such rule`).toContain(
          path
        );
      }
    }
  });
});
