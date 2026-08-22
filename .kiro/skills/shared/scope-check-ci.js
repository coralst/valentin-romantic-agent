#!/usr/bin/env node

/**
 * Scope Check (CI entrypoint) — compare a PR's changed paths to its `agent: *`
 * labels and fail the build when they disagree.
 *
 * Invoked by the `scope-check` job in .github/workflows/ci.yml:
 *
 *     node .kiro/skills/shared/scope-check-ci.js changed-paths.txt labels.json
 *
 * Lives under skills/shared/ rather than skills/pr-monitoring/ deliberately:
 * this is a static ownership check on a diff, NOT part of the PR-monitoring
 * (polling / conversation) machinery. A preservation test asserts that CI never
 * grows PR-monitoring steps, and that boundary is worth keeping legible.
 *
 * WHY A FILE, NOT AN INLINE SCRIPT: a previous workflow edit in this repo
 * shipped invalid YAML because a nested `python3 -c "…"` inside a `run: |` block
 * scalar had its quotes terminate the string early. Keeping the logic in a
 * committed, unit-tested file means the workflow's `run:` steps stay one plain
 * command each, with nothing for a YAML parser to trip over. It also means the
 * gate is testable offline — see __tests__/scope-check.test.ts.
 *
 * INPUTS ARE READ FROM FILES, never from argv-interpolated workflow
 * expressions: PR labels and branch-derived paths are attacker-influenced text
 * and must not be pasted into a shell command line.
 *
 * The decision is `checkScope()` in review-parser-skill.js — the same
 * `attributeOwner()` ownership list the review router uses. There is exactly one
 * ownership source.
 *
 * Exit codes:  0 = in scope · 1 = violation · 2 = bad usage / broken OWNERSHIP
 */

const fs = require('fs');
const parser = require('../pr-monitoring/review-parser-skill.js');

/** Read a newline-delimited path list. Missing file => empty (nothing changed). */
function readPathList(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/** Read the JSON array of label names GitHub handed us. */
function readLabels(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (raw === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`labels file is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('labels file must contain a JSON array');
  return parsed.filter((l) => typeof l === 'string');
}

/** Render the result for the Actions log and the job summary. */
function report(result, paths, labels) {
  const lines = [];
  lines.push('### Scope check');
  lines.push('');
  lines.push(`- **Changed paths:** ${paths.length}`);
  lines.push(`- **Labels:** ${labels.length ? labels.map((l) => `\`${l}\``).join(', ') : '_none_'}`);
  lines.push(`- **Lanes claimed:** ${result.labelOwners.join(', ') || '_none_'}`);
  lines.push(`- **Lanes touched:** ${result.owners.join(', ') || '_none_'}`);
  lines.push('');
  if (result.ok) {
    lines.push('✅ Every changed path is covered by this PR’s `agent: *` label(s).');
    if (result.unusedLabels.length) {
      lines.push('');
      lines.push(
        `> Note: no file in this diff belongs to ${result.unusedLabels
          .map((o) => `\`${o}\``)
          .join(', ')}. Harmless, but the label may be unnecessary.`
      );
    }
  } else {
    lines.push('❌ **Out of scope.**');
    lines.push('');
    for (const r of result.reasons) lines.push(`- ${r}`);
    lines.push('');
    lines.push(
      'Fix by applying the matching `agent: *` label (two labels are fine when a ' +
        'change genuinely spans two lanes) or by splitting the PR. Ownership table: ' +
        'CONTRIBUTING.md.'
    );
  }
  return lines.join('\n');
}

function main() {
  const [pathsFile, labelsFile] = process.argv.slice(2);
  if (!pathsFile || !labelsFile) {
    console.error('Usage: node scope-check-ci.js <changed-paths.txt> <labels.json>');
    process.exit(2);
  }

  // A broken OWNERSHIP list would make every downstream answer meaningless, so
  // check the invariant before trusting the result.
  const ordering = parser.assertOwnershipOrdering();
  if (ordering.length) {
    console.error('OWNERSHIP ordering is broken — a specific rule is shadowed by a broader one:');
    ordering.forEach((p) => console.error('  - ' + p));
    process.exit(2);
  }

  let paths;
  let labels;
  try {
    paths = readPathList(pathsFile);
    labels = readLabels(labelsFile);
  } catch (err) {
    console.error(`Could not read inputs: ${err.message}`);
    process.exit(2);
  }

  // An empty diff is not a violation: a PR can legitimately change nothing
  // (e.g. a merge commit whose changes are all already on the base).
  if (paths.length === 0) {
    console.log('No changed paths to check. Reporting success.');
    process.exit(0);
  }

  const result = parser.checkScope(paths, labels);
  const summary = report(result, paths, labels);
  console.log(summary);

  // Surface it on the PR's Checks tab, not just buried in the log.
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
    } catch {
      /* a summary write failure must never change the verdict */
    }
  }

  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { readPathList, readLabels, report };
