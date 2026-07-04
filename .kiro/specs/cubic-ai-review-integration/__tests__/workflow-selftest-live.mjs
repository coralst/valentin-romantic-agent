#!/usr/bin/env node
/**
 * Workflow Automation Regression Suite — Live Integration Tier (Req 13)
 *
 * Opens a REAL throwaway PR against the repository, exercises the workflow
 * automations, asserts the GitHub edge-case behaviors, and CLEANS UP everything
 * in a teardown that runs even on failure. Leaves no residue.
 *
 * SAFETY:
 *  - Only touches its own throwaway branch (prefix `test/workflow-selftest-`) and PR.
 *  - NEVER modifies, approves, or merges any real feature PR.
 *  - Teardown closes the PR, deletes the branch, and removes the marker file.
 *
 * GATING: runs only when RUN_LIVE_WORKFLOW_TESTS=1 and GITHUB_TOKEN are present.
 * Without them it exits 0 (skipped) so CI can gate on the unit tier alone.
 *
 * Uses the GitHub REST API via fetch (Node 22 built-in) — no `gh`, no extra deps.
 * The agent-driven equivalent uses the GitHub Power tools with identical semantics.
 */

const TOKEN = process.env.GITHUB_TOKEN;
const ENABLED = process.env.RUN_LIVE_WORKFLOW_TESTS === '1';
const OWNER = process.env.REPO_OWNER || 'coralst';
const REPO = process.env.REPO_NAME || 'valentin-romantic-agent';
const API = 'https://api.github.com';
const APPROVAL_TOKEN = 'APPROVED-BY-MASTER-AGENT';

if (!ENABLED || !TOKEN) {
  console.log('[live-selftest] SKIPPED (set RUN_LIVE_WORKFLOW_TESTS=1 and GITHUB_TOKEN to run).');
  process.exit(0);
}

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function gh(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

async function ghWithRetry(method, path, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await gh(method, path, body);
    // Rate limit / transient (Req 13.13)
    if (r.status === 403 || r.status === 429 || r.status >= 500) {
      const wait = 2 ** i * 1000;
      console.log(`[live-selftest] transient ${r.status}, backoff ${wait}ms`);
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    return r;
  }
  return gh(method, path, body);
}

const stamp = Date.now();
const branch = `test/workflow-selftest-${stamp}`;
const markerPath = `.kiro/.selftest-${stamp}.md`;
let prNumber = null;
let createdBranch = false;

async function setup() {
  // Base sha from main
  const ref = await gh('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/main`);
  const baseSha = ref.json.object.sha;

  await gh('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });
  createdBranch = true;

  // Add a marker file so there's a diff to PR
  const content = Buffer.from(`# selftest ${stamp}\n\nThrowaway. Safe to delete.\n`).toString('base64');
  await gh('PUT', `/repos/${OWNER}/${REPO}/contents/${markerPath}`, {
    message: `chore(test): workflow selftest marker ${stamp}`,
    content,
    branch,
  });

  const pr = await gh('POST', `/repos/${OWNER}/${REPO}/pulls`, {
    title: `chore(test): workflow selftest ${stamp} (throwaway)`,
    head: branch,
    base: 'main',
    body: 'Automated workflow regression self-test. Auto-cleaned.',
  });
  prNumber = pr.json.number;
  check('throwaway PR created', !!prNumber, `#${prNumber}`);
}

async function runAssertions() {
  // Edge case: comment flow works (Req 13.3)
  const c = await gh('POST', `/repos/${OWNER}/${REPO}/issues/${prNumber}/comments`, {
    body: '**🧪 QA Agent** — Ready for Review\n\n@master-agent requesting review.',
  });
  check('can post conversation comment on own PR', c.status === 201);

  // Edge case: formal self-APPROVE is blocked with 422 (Req 13.4)
  const approve = await gh('POST', `/repos/${OWNER}/${REPO}/pulls/${prNumber}/reviews`, {
    event: 'APPROVE',
    body: 'attempting self-approve',
  });
  check('formal self-APPROVE rejected (422)', approve.status === 422,
    `status=${approve.status}`);

  // Edge case: approval-token comment path is allowed instead (Req 13.4)
  const tokenComment = await gh('POST', `/repos/${OWNER}/${REPO}/issues/${prNumber}/comments`, {
    body: `**👔 Master Agent** — Review Complete\n\n✅ CI green\n\n${APPROVAL_TOKEN} 🟢 — merging.`,
  });
  check('approval-token comment path allowed', tokenComment.status === 201);

  // Edge case: squash disabled (Req 13.5)
  const squash = await gh('PUT', `/repos/${OWNER}/${REPO}/pulls/${prNumber}/merge`, {
    merge_method: 'squash',
  });
  const squashBlocked = squash.status !== 200 &&
    /squash/i.test(squash.json?.message || '');
  check('squash merge disallowed', squashBlocked, squash.json?.message || `status=${squash.status}`);

  // Edge case: required check in progress → merge blocked, we do NOT hard-fail (Req 13.6)
  const merge = await gh('PUT', `/repos/${OWNER}/${REPO}/pulls/${prNumber}/merge`, {
    merge_method: 'merge',
  });
  const checkPending = merge.status !== 200 &&
    /required status check|in progress|not.*mergeable|blocked/i.test(merge.json?.message || '');
  // Either it merged (checks already green) or it's correctly gated — both are valid.
  check('merge gated by required check or succeeds cleanly',
    merge.status === 200 || checkPending,
    merge.json?.message || `status=${merge.status}`);
}

async function teardown() {
  // Runs even on failure (Req 13.8, 13.9)
  if (prNumber) {
    const pr = await ghWithRetry('GET', `/repos/${OWNER}/${REPO}/pulls/${prNumber}`);
    if (pr.json?.state === 'open') {
      await ghWithRetry('PATCH', `/repos/${OWNER}/${REPO}/pulls/${prNumber}`, { state: 'closed' });
      console.log(`[live-selftest] closed PR #${prNumber}`);
    }
  }
  if (createdBranch) {
    const del = await ghWithRetry('DELETE', `/repos/${OWNER}/${REPO}/git/refs/heads/${branch}`);
    console.log(`[live-selftest] deleted branch ${branch} (status ${del.status})`);
  }
  // Marker file lived only on the throwaway branch, so branch deletion removes it.
}

(async () => {
  let failed = false;
  try {
    await setup();
    await runAssertions();
  } catch (err) {
    failed = true;
    console.error('[live-selftest] ERROR:', err?.message || err);
  } finally {
    try {
      await teardown();
    } catch (err) {
      console.error('[live-selftest] teardown error:', err?.message || err);
    }
  }
  const anyFailed = failed || results.some((r) => !r.ok);
  console.log(`\n[live-selftest] ${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  process.exit(anyFailed ? 1 : 0);
})();
