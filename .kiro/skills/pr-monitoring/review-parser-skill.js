#!/usr/bin/env node

/**
 * Review Parser Skill - Extracts structured feedback from PR reviews
 * 
 * Parses master-agent review comments and categorizes them by severity:
 * - ❌ Blocking issues (must fix)
 * - ⚠️ Suggestions (should address)
 * - ✅ Positive feedback
 */

function parseReview(reviewBody) {
  if (!reviewBody) {
    return { blocking: [], suggestions: [], positive: [], general: [] };
  }

  const lines = reviewBody.split('\n');
  const result = {
    blocking: [],
    suggestions: [],
    positive: [],
    general: []
  };

  // Match a leading severity emoji regardless of variation selectors (e.g. the
  // U+FE0F in ⚠️) or an optional list marker: bullet ("- ", "* ") OR ordered
  // ("1. ", "2) "). Ordered markers matter because formatForAgent emits findings
  // as numbered lists, so parser output must be round-trip parseable. Using a
  // regex avoids the fragile substring(1)/substring(2) code-unit slicing that
  // silently ate a character when the emoji width or variation selector differed.
  const LIST_MARKER = /^[-*\s]*(?:\d+[.)]\s*)?/.source;
  const SEVERITY = [
    { key: 'blocking', re: new RegExp(`${LIST_MARKER}❌\uFE0F?\\s*`) },
    { key: 'suggestions', re: new RegExp(`${LIST_MARKER}⚠\uFE0F?\\s*`) },
    { key: 'positive', re: new RegExp(`${LIST_MARKER}✅\uFE0F?\\s*`) },
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let matched = false;
    for (const { key, re } of SEVERITY) {
      if (re.test(trimmed)) {
        result[key].push(trimmed.replace(re, '').trim());
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Not a severity line: keep only substantive prose (skip headers/emphasis).
    if (!trimmed.startsWith('#') && !trimmed.startsWith('**')) {
      result.general.push(trimmed);
    }
  }

  return result;
}

function parseReviews(reviews) {
  return reviews.map(review => ({
    id: review.id,
    author: review.author?.login || 'unknown',
    state: review.state,
    submittedAt: review.submittedAt,
    parsed: parseReview(review.body)
  }));
}

function formatForAgent(parsedReviews) {
  const latest = parsedReviews[parsedReviews.length - 1];
  if (!latest) return 'No reviews found.';

  const { author, state, parsed } = latest;

  let message = `**${author}** posted a ${state} review:\n\n`;

  if (parsed.blocking.length > 0) {
    message += '**❌ Blocking Issues (Must Fix):**\n';
    parsed.blocking.forEach((item, i) => {
      message += `${i + 1}. ${item}\n`;
    });
    message += '\n';
  }

  if (parsed.suggestions.length > 0) {
    message += '**⚠️ Suggestions:**\n';
    parsed.suggestions.forEach((item, i) => {
      message += `${i + 1}. ${item}\n`;
    });
    message += '\n';
  }

  if (parsed.positive.length > 0) {
    message += '**✅ What Looks Good:**\n';
    parsed.positive.forEach((item, i) => {
      message += `${i + 1}. ${item}\n`;
    });
    message += '\n';
  }

  if (parsed.general.length > 0) {
    message += '**💬 General Feedback:**\n';
    parsed.general.forEach((item, i) => {
      message += `${i + 1}. ${item}\n`;
    });
  }

  return message;
}

/**
 * The GitHub login/author identity Cubic posts under. Configurable because Cubic's
 * bot identity can change; documented in the cubic-ai-review-integration spec.
 */
const CUBIC_AUTHOR = 'cubic-dev-ai[bot]';

/**
 * Classify a comment's author as one of the recognized reviewers.
 * @param {string|undefined} authorLogin
 * @param {object} [opts] - { masterAgentLogin, cubicAuthor }
 * @returns {'cubic'|'master-agent'|'unknown'}
 */
function classifyAuthor(authorLogin, opts = {}) {
  const cubic = (opts.cubicAuthor || CUBIC_AUTHOR).toLowerCase();
  const login = (authorLogin || '').toLowerCase();
  if (!login) return 'unknown';
  if (login === cubic || login.includes('cubic')) return 'cubic';
  if (opts.masterAgentLogin && login === opts.masterAgentLogin.toLowerCase()) {
    return 'master-agent';
  }
  return 'unknown';
}

/**
 * Ownership map: file path prefix → owning sub-agent. Mirrors architecture.md
 * and the ownership table in CONTRIBUTING.md — a drift test in
 * __tests__/ownership.test.ts asserts the prose and this list agree, so the
 * table cannot quietly fall out of date.
 *
 * ORDER MATTERS: the list is scanned top-down and the FIRST matching prefix
 * wins, so more specific prefixes MUST precede the broader ones they sit inside
 * (`docs/design/` before `docs/`, `src/client/design-system/` before
 * `src/client/`). `assertOwnershipOrdering()` proves this holds.
 *
 * This list used to stop at `src/`, returning null for `.kiro/`, `.github/`,
 * `scripts/`, `public/`, `index.html`, `docs/` and `src/client/utils/` — which
 * is why 29 of 57 PRs (51%) ended up labelled `agent: infra`, a lane that had no
 * row in CONTRIBUTING.md at all. The workflow and platform surface is real work
 * and now has a real owner.
 */
const OWNERSHIP = [
  // ── most specific first ──────────────────────────────────────────────────
  ['src/client/design-system/', 'ui-designer'],
  ['docs/design/', 'ui-designer'],
  // ── application code ────────────────────────────────────────────────────
  ['src/client/components/', 'frontend-dev'],
  ['src/client/auth/', 'frontend-dev'],
  ['src/client/hooks/', 'frontend-dev'],
  ['src/client/context/', 'frontend-dev'],
  ['src/client/utils/', 'frontend-dev'],
  // The guided intro: a client-side script and the hook that plays it through
  // the same reducers the socket feeds, so it is frontend work like any view.
  ['src/client/demo/', 'frontend-dev'],
  ['src/client/App.tsx', 'frontend-dev'],
  ['src/client/main.tsx', 'frontend-dev'],
  ['src/client/vite-env.d.ts', 'frontend-dev'],
  ['src/server/', 'backend-dev'],
  // The Strands agent that runs inside the AgentCore Runtime. Python, and its own
  // image, but it is engine B's agent turn — the same work `src/server/agent/`
  // does for engine A, so the same lane owns both sides of the comparison.
  ['agentcore/', 'backend-dev'],
  ['src/shared/', 'system-architect'],
  ['e2e/', 'qa-agent'],
  ['playwright.config.ts', 'qa-agent'],
  // The Vitest setup file is shared test harness, not app code — QA's.
  ['src/test-setup.ts', 'qa-agent'],
  // ── workflow & platform ─────────────────────────────────────────────────
  // The frontend shell (index.html) and static assets (public/) are platform
  // wiring, not component work: they change when the build or the deploy target
  // changes, not when a feature does.
  ['.github/', 'infra'],
  ['.kiro/', 'infra'],
  ['scripts/', 'infra'],
  ['infra/', 'infra'],
  ['public/', 'infra'],
  ['index.html', 'infra'],
  // Repo-root config and top-level docs. Enumerated rather than wildcarded so a
  // NEW root-level file still comes back unattributed and gets a decision, which
  // is the whole point of failing loudly on null.
  ['package.json', 'infra'],
  ['package-lock.json', 'infra'],
  ['tsconfig.json', 'infra'],
  ['tsconfig.server.json', 'infra'],
  ['vite.config.ts', 'infra'],
  ['Dockerfile', 'infra'],
  ['.dockerignore', 'infra'],
  ['.gitignore', 'infra'],
  ['README.md', 'infra'],
  ['CONTRIBUTING.md', 'infra'],
  // `docs/` LAST among the docs rules: docs/design/ is the UI Designer's (per
  // CONTRIBUTING.md), and the rest — METHODOLOGY.md, refactor-plan.json, the
  // workflow write-ups — is documentation OF the workflow, which is infra's.
  ['docs/', 'infra'],
];

/**
 * Attribute a file path to an owning agent, or null when it cannot be uniquely
 * attributed (caller routes null to the master-agent for triage).
 *
 * A null return is a real signal, not a shrug: after the workflow/platform rows
 * above, an unattributable path means a genuinely new top-level surface appeared
 * and OWNERSHIP needs a row. The CI scope-check job fails loudly on it.
 *
 * @param {string|undefined} filePath
 * @returns {string|null}
 */
function attributeOwner(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  // Normalise a leading './' and any accidental leading slash so callers can
  // pass git output verbatim.
  const p = filePath.replace(/^\.\//, '').replace(/^\/+/, '');
  for (const [prefix, owner] of OWNERSHIP) {
    if (p === prefix || p.startsWith(prefix)) return owner;
  }
  return null;
}

/**
 * The distinct owners named by OWNERSHIP. Used by the CI scope check to validate
 * the `agent: *` labels it is handed.
 * @returns {string[]}
 */
function knownOwners() {
  return [...new Set(OWNERSHIP.map(([, owner]) => owner))];
}

/**
 * Prove the "most specific prefix first" invariant: no entry may be shadowed by
 * a broader prefix that precedes it. Exported so a unit test can assert it
 * rather than relying on reviewers eyeballing the list order.
 * @returns {string[]} human-readable violations; empty when the ordering is sound
 */
function assertOwnershipOrdering() {
  const problems = [];
  for (let i = 0; i < OWNERSHIP.length; i += 1) {
    const [prefix, owner] = OWNERSHIP[i];
    for (let j = 0; j < i; j += 1) {
      const [earlier, earlierOwner] = OWNERSHIP[j];
      if (prefix !== earlier && prefix.startsWith(earlier)) {
        problems.push(
          `"${prefix}" (${owner}) is unreachable: the broader "${earlier}" ` +
            `(${earlierOwner}) precedes it. Move the specific rule above it.`
        );
      }
    }
  }
  return problems;
}

/**
 * GitHub `agent: *` label suffix → the owner key OWNERSHIP uses. The labels are
 * short (`agent: frontend`) and the owner keys are the agent handles
 * (`frontend-dev`); this is the one place that translation lives.
 * `agent: master` is deliberately absent: the master orchestrates and owns no
 * paths, so it can never satisfy a scope check on its own.
 */
const LABEL_TO_OWNER = {
  architect: 'system-architect',
  frontend: 'frontend-dev',
  backend: 'backend-dev',
  design: 'ui-designer',
  qa: 'qa-agent',
  infra: 'infra',
};

/**
 * Resolve an `agent: *` label to an owner key.
 * @param {string} label - e.g. 'agent: frontend' or just 'frontend'
 * @returns {string|null}
 */
function ownerForLabel(label) {
  if (typeof label !== 'string') return null;
  const suffix = label.replace(/^agent:\s*/i, '').trim().toLowerCase();
  return LABEL_TO_OWNER[suffix] || null;
}

/**
 * Attribute a list of changed paths.
 * @param {string[]} paths
 * @returns {{ byOwner: Record<string, string[]>, unattributed: string[] }}
 */
function attributeChangedPaths(paths) {
  const byOwner = {};
  const unattributed = [];
  for (const p of Array.isArray(paths) ? paths : []) {
    if (typeof p !== 'string' || p.trim() === '') continue;
    const owner = attributeOwner(p.trim());
    if (owner === null) {
      unattributed.push(p.trim());
    } else {
      (byOwner[owner] ||= []).push(p.trim());
    }
  }
  return { byOwner, unattributed };
}

/**
 * Scope check: do a PR's changed paths agree with its `agent: *` labels?
 *
 * Called by the `scope-check` CI job (.github/workflows/ci.yml) and by the
 * post-task-ci-review hook, which previously asked an agent to eyeball this by
 * hand and recorded nothing.
 *
 * MULTI-LABEL is legitimate and must pass. Some changes genuinely span two
 * domains — e.g. a registry change in `src/shared/` plus its demo fixture in
 * `src/server/`, which `src/server/api/__tests__/http-routes.test.ts` forces
 * into one commit. So the rule is UNION coverage: every changed path must be
 * owned by AT LEAST ONE of the PR's labels. It is not per-label exact matching.
 *
 * Two failure modes, reported separately because they call for different fixes:
 *   - `unattributed` — attributeOwner() cannot place the path at all. After the
 *     workflow/platform rows there should be none; a new one means OWNERSHIP
 *     needs a row. Fail loudly rather than silently treating it as in-scope.
 *   - `outOfScope`   — the path IS owned, but by an agent this PR is not
 *     labelled for. Either add that label or split the PR.
 *
 * A label that owns nothing in the diff is reported as `unusedLabels`: a
 * warning, not a failure — a PR may carry a label for a file it ended up not
 * needing to touch, and failing that would push agents to drop labels.
 *
 * @param {string[]} changedPaths
 * @param {string[]} labels - full label names; non-`agent:` labels are ignored
 * @returns {{
 *   ok: boolean,
 *   owners: string[],
 *   labelOwners: string[],
 *   unknownLabels: string[],
 *   unattributed: string[],
 *   outOfScope: Array<{ path: string, owner: string }>,
 *   unusedLabels: string[],
 *   reasons: string[]
 * }}
 */
function checkScope(changedPaths, labels) {
  const agentLabels = (Array.isArray(labels) ? labels : []).filter((l) =>
    typeof l === 'string' && /^agent:\s*/i.test(l)
  );
  const labelOwners = [];
  const unknownLabels = [];
  for (const l of agentLabels) {
    const owner = ownerForLabel(l);
    if (owner === null) unknownLabels.push(l);
    else if (!labelOwners.includes(owner)) labelOwners.push(owner);
  }

  const { byOwner, unattributed } = attributeChangedPaths(changedPaths);
  const owners = Object.keys(byOwner);

  const outOfScope = [];
  for (const owner of owners) {
    if (!labelOwners.includes(owner)) {
      for (const p of byOwner[owner]) outOfScope.push({ path: p, owner });
    }
  }
  const unusedLabels = labelOwners.filter((o) => !owners.includes(o));

  const reasons = [];
  if (labelOwners.length === 0) {
    reasons.push(
      'PR carries no recognized `agent: *` label. Apply the label matching the ' +
        'domain you changed (see the ownership table in CONTRIBUTING.md).'
    );
  }
  if (unknownLabels.length) {
    reasons.push(`Unrecognized agent label(s): ${unknownLabels.join(', ')}.`);
  }
  if (unattributed.length) {
    reasons.push(
      `${unattributed.length} path(s) cannot be attributed to any owner: ` +
        `${unattributed.join(', ')}. This is a new top-level surface — add a row ` +
        'to OWNERSHIP in review-parser-skill.js and to the table in CONTRIBUTING.md.'
    );
  }
  for (const { path: p, owner } of outOfScope) {
    reasons.push(`${p} is owned by \`${owner}\`, which this PR is not labelled for.`);
  }

  return {
    ok: reasons.length === 0,
    owners,
    labelOwners,
    unknownLabels,
    unattributed,
    outOfScope,
    unusedLabels,
    reasons,
  };
}

// CLI usage.
//   node review-parser-skill.js "<review body>"           → parse a review
//   node review-parser-skill.js --scope <paths> -- <labels> → run the scope check
// The scope form is what CI invokes; it exits non-zero on a violation so the job
// fails without any shell-side interpretation of the result.
if (require.main === module) {
  const argv = process.argv.slice(2);

  if (argv[0] === '--scope') {
    const sep = argv.indexOf('--');
    const paths = (sep === -1 ? argv.slice(1) : argv.slice(1, sep)).filter(Boolean);
    const labels = sep === -1 ? [] : argv.slice(sep + 1).filter(Boolean);
    const ordering = assertOwnershipOrdering();
    if (ordering.length) {
      console.error('OWNERSHIP ordering is broken:');
      ordering.forEach((p) => console.error('  - ' + p));
      process.exit(2);
    }
    const result = checkScope(paths, labels);
    console.log(`Changed paths: ${paths.length}`);
    console.log(`Labels:        ${labels.length ? labels.join(', ') : '(none)'}`);
    console.log(`Label owners:  ${result.labelOwners.join(', ') || '(none)'}`);
    console.log(`Path owners:   ${result.owners.join(', ') || '(none)'}`);
    if (result.unusedLabels.length) {
      console.log(`Note: label(s) with no matching file in this diff: ${result.unusedLabels.join(', ')}`);
    }
    if (result.ok) {
      console.log('\nScope check PASSED — every changed path is covered by the PR labels.');
      process.exit(0);
    }
    console.error('\nScope check FAILED:');
    result.reasons.forEach((r) => console.error('  - ' + r));
    process.exit(1);
  }

  const reviewBody = argv[0];

  if (!reviewBody) {
    console.error('Usage: node review-parser-skill.js "<review body>"');
    console.error('       node review-parser-skill.js --scope <path...> -- <label...>');
    process.exit(1);
  }

  const parsed = parseReview(reviewBody);
  console.log(JSON.stringify(parsed, null, 2));
}

module.exports = {
  parseReview,
  parseReviews,
  formatForAgent,
  classifyAuthor,
  attributeOwner,
  attributeChangedPaths,
  assertOwnershipOrdering,
  knownOwners,
  ownerForLabel,
  checkScope,
  OWNERSHIP,
  LABEL_TO_OWNER,
  CUBIC_AUTHOR,
};
