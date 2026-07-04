#!/usr/bin/env node

/**
 * PR Monitor Skill - Detects new PR review feedback and signals the agent.
 *
 * Two run modes:
 *   --once   Single poll, then exit. Intended to be invoked on a schedule by a
 *            hook so nothing long-lived blocks the agent. This is the default in
 *            CI/hook contexts.
 *   --watch  Long-lived loop (setInterval). Only for a detached/background
 *            process, never from a blocking `runCommand` hook.
 *
 * Detection is real, not a no-op: when new feedback is found the poller writes a
 * per-PR signal file (.kiro/.pr-feedback-<pr>.json) containing the parsed
 * findings. The handle-pr-feedback hook consumes that file and invokes the
 * owning agent. All state/marker/signal files are keyed by PR number so multiple
 * PRs can be monitored concurrently without clobbering each other.
 *
 * Stop conditions: the PR is closed/merged, OR a master-agent approval COMMENT
 * carrying APPROVED-BY-MASTER-AGENT is present. (A formal GitHub APPROVE never
 * occurs in this single-account repo — see approval-gate-skill.js.)
 *
 * Env: PR_NUMBER (required unless derivable), REPO_OWNER, REPO_NAME.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const gate = require('./approval-gate-skill.js');
const parser = require('./review-parser-skill.js');

const POLL_INTERVAL_MS = 90 * 1000; // 1.5 minutes (within the 1-2 min requirement)
const KIRO_DIR = '.kiro';

// ── Per-PR file paths (concurrency-safe) ─────────────────────────────────────
function markerFile(prNumber) {
  return path.join(KIRO_DIR, `.pr-monitoring-active-${prNumber}.json`);
}
function stateFile(prNumber) {
  return path.join(KIRO_DIR, `.pr-monitoring-state-${prNumber}.json`);
}
function signalFile(prNumber) {
  return path.join(KIRO_DIR, `.pr-feedback-${prNumber}.json`);
}

// ── Config resolution ────────────────────────────────────────────────────────
function getConfig() {
  const prNumber = process.env.PR_NUMBER || getPRFromBranch();
  const repoOwner = process.env.REPO_OWNER;
  const repoName = process.env.REPO_NAME;
  return { prNumber, repoOwner, repoName };
}

/**
 * Derive a PR number from the current branch when possible. Supports both the
 * legacy `pr-<n>` marker and the actual repo convention (feat/<domain>-<feat>)
 * by asking gh for the PR associated with the current branch.
 */
function getPRFromBranch() {
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf-8',
    }).trim();
    const marker = branch.match(/pr-(\d+)/);
    if (marker) return marker[1];
    // Ask gh which PR (if any) is open for this branch.
    const out = execFileSync(
      'gh',
      ['pr', 'view', '--json', 'number', '--jq', '.number'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

// ── State ─────────────────────────────────────────────────────────────────────
function loadState(prNumber) {
  try {
    const f = stateFile(prNumber);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {
    // ignore parse errors, start fresh
  }
  return { lastReviewedAt: null, reviewCount: 0 };
}

function saveState(prNumber, state) {
  fs.mkdirSync(KIRO_DIR, { recursive: true });
  fs.writeFileSync(stateFile(prNumber), JSON.stringify(state, null, 2));
}

// ── GitHub reads (with simple backoff on transient failures) ─────────────────
function ghJson(args, { retries = 3 } = {}) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const out = execFileSync('gh', args, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out ? JSON.parse(out) : null;
    } catch (error) {
      attempt += 1;
      if (attempt > retries) {
        console.error(`gh read failed after ${retries} retries:`, error.message);
        return null;
      }
      // Exponential backoff for rate limits / transient network errors.
      const waitMs = 2 ** attempt * 500;
      sleepSync(waitMs);
    }
  }
}

function sleepSync(ms) {
  // Block synchronously without a busy loop (Atomics.wait on a throwaway buffer).
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function fetchReviews(owner, repo, prNumber) {
  return (
    ghJson([
      'pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`,
      '--json', 'reviews', '--jq', '.reviews',
    ]) || []
  );
}

function fetchComments(owner, repo, prNumber) {
  return (
    ghJson([
      'pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`,
      '--json', 'comments', '--jq', '.comments',
    ]) || []
  );
}

function fetchState(owner, repo, prNumber) {
  const res = ghJson([
    'pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`,
    '--json', 'state', '--jq', '.state',
  ]);
  return typeof res === 'string' ? res : 'UNKNOWN';
}

// ── Detection helpers (pure, exported for tests) ─────────────────────────────
function hasNewFeedback(items, lastReviewedAt) {
  if (!Array.isArray(items) || items.length === 0) return false;
  if (!lastReviewedAt) return true;
  const last = new Date(lastReviewedAt).getTime();
  return items.some((it) => {
    const ts = it.submittedAt || it.createdAt;
    return ts && new Date(ts).getTime() > last;
  });
}

/**
 * Approval is a master-agent COMMENT bearing the token — never a formal APPROVE
 * review (which is impossible on your own PR here). We also accept the rare case
 * of a genuine formal APPROVE (e.g. a second human account) for forward-compat.
 */
function isApproved(reviews, comments) {
  const approvedReview = (reviews || []).some((r) => r.state === 'APPROVED');
  const approvedComment = (comments || []).some((c) =>
    gate.isMasterApprovalComment({
      body: c.body,
      authorLogin: c.author && c.author.login,
    })
  );
  return approvedReview || approvedComment;
}

function latestTimestamp(items) {
  return items
    .map((it) => it.submittedAt || it.createdAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
}

/**
 * Write the parsed feedback signal the handle-pr-feedback hook consumes. This is
 * the real replacement for the old `console.log('would be triggered here')`.
 */
function writeFeedbackSignal(prNumber, payload) {
  fs.mkdirSync(KIRO_DIR, { recursive: true });
  fs.writeFileSync(signalFile(prNumber), JSON.stringify(payload, null, 2));
}

// ── Core single poll ─────────────────────────────────────────────────────────
function pollOnce(cfg) {
  const { prNumber, repoOwner, repoName } = cfg;
  const prState = fetchState(repoOwner, repoName, prNumber);
  if (prState === 'CLOSED' || prState === 'MERGED') {
    cleanup(prNumber);
    return { done: true, reason: prState };
  }

  const reviews = fetchReviews(repoOwner, repoName, prNumber);
  const comments = fetchComments(repoOwner, repoName, prNumber);

  if (isApproved(reviews, comments)) {
    cleanup(prNumber);
    return { done: true, reason: 'APPROVED' };
  }

  const state = loadState(prNumber);
  const feedbackItems = [...reviews, ...comments];
  if (hasNewFeedback(feedbackItems, state.lastReviewedAt)) {
    const parsedReviews = parser.parseReviews(
      reviews.map((r) => ({
        id: r.id,
        author: r.author,
        state: r.state,
        submittedAt: r.submittedAt,
        body: r.body,
      }))
    );
    writeFeedbackSignal(prNumber, {
      prNumber,
      repoOwner,
      repoName,
      detectedAt: new Date().toISOString(),
      reviews: parsedReviews,
    });
    state.lastReviewedAt = latestTimestamp(feedbackItems) || state.lastReviewedAt;
    state.reviewCount = reviews.length;
    saveState(prNumber, state);
    return { done: false, newFeedback: true };
  }
  return { done: false, newFeedback: false };
}

function writeMarker(cfg) {
  fs.mkdirSync(KIRO_DIR, { recursive: true });
  fs.writeFileSync(
    markerFile(cfg.prNumber),
    JSON.stringify({ ...cfg, pid: process.pid, startedAt: new Date().toISOString() }, null, 2)
  );
}

function cleanup(prNumber) {
  for (const f of [markerFile(prNumber), stateFile(prNumber), signalFile(prNumber)]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function resolveConfigOrExit() {
  const cfg = getConfig();
  if (!cfg.prNumber) {
    console.error(
      'PR_NUMBER not found. Set PR_NUMBER or run on a branch with an open PR.'
    );
    process.exit(1);
  }
  if (!cfg.repoOwner || !cfg.repoName) {
    console.error(
      'REPO_OWNER and REPO_NAME are required (no hardcoded fallback).'
    );
    process.exit(1);
  }
  return cfg;
}

function runOnce() {
  const cfg = resolveConfigOrExit();
  writeMarker(cfg);
  const result = pollOnce(cfg);
  console.log(JSON.stringify({ pr: cfg.prNumber, ...result }));
  process.exit(0);
}

function runWatch() {
  const cfg = resolveConfigOrExit();
  writeMarker(cfg);
  console.log(
    `Watching ${cfg.repoOwner}/${cfg.repoName}#${cfg.prNumber} every ${POLL_INTERVAL_MS / 1000}s`
  );
  const tick = () => {
    try {
      const result = pollOnce(cfg);
      if (result.done) {
        console.log(`Monitoring stopped: ${result.reason}`);
        clearInterval(id);
        process.exit(0);
      }
    } catch (error) {
      console.error('Poll error (continuing):', error.message);
    }
  };
  const id = setInterval(tick, POLL_INTERVAL_MS);
  tick();
  const stop = () => {
    clearInterval(id);
    cleanup(cfg.prNumber);
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  const mode = process.argv.includes('--watch') ? 'watch' : 'once';
  if (mode === 'watch') runWatch();
  else runOnce();
}

module.exports = {
  markerFile,
  stateFile,
  signalFile,
  hasNewFeedback,
  isApproved,
  latestTimestamp,
  pollOnce,
  cleanup,
  getConfig,
};
