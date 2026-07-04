#!/usr/bin/env node

/**
 * PR Monitor Skill - Polls GitHub API for new reviews
 * 
 * This script polls a PR every 1-2 minutes for new reviews.
 * When new reviews are detected, it triggers the handle-pr-feedback hook.
 * Stops when APPROVE review is detected or PR is closed.
 * 
 * Required env vars: GITHUB_TOKEN, PR_NUMBER, REPO_OWNER, REPO_NAME
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const POLL_INTERVAL_MS = 90 * 1000; // 1.5 minutes
const MARKER_FILE = '.kiro/.pr-monitoring-active';
const STATE_FILE = '.kiro/.pr-monitoring-state.json';

// Read from environment or state file
function getConfig() {
  const prNumber = process.env.PR_NUMBER || getPRFromBranch();
  const repoOwner = process.env.REPO_OWNER || 'coralst';
  const repoName = process.env.REPO_NAME || 'valentin-romantic-agent';
  
  return { prNumber, repoOwner, repoName };
}

function getPRFromBranch() {
  try {
    // Try to find PR number from branch name or git config
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    // Extract number from branch if present (e.g., fix/pr-123 -> 123)
    const match = branch.match(/pr-(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {
    // Ignore parse errors
  }
  return { lastReviewedAt: null, reviewCount: 0 };
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function fetchPRReviews(owner, repo, prNumber) {
  try {
    // Use GitHub CLI (gh) to fetch reviews
    const cmd = `gh pr view ${prNumber} --repo ${owner}/${repo} --json reviews --jq '.reviews'`;
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    return JSON.parse(output);
  } catch (error) {
    console.error('Failed to fetch PR reviews:', error.message);
    return [];
  }
}

function getPRStatus(owner, repo, prNumber) {
  try {
    const cmd = `gh pr view ${prNumber} --repo ${owner}/${repo} --json state,reviews --jq '{state: .state, reviewCount: (.reviews | length)}'`;
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    return JSON.parse(output);
  } catch (error) {
    console.error('Failed to get PR status:', error.message);
    return { state: 'UNKNOWN', reviewCount: 0 };
  }
}

function hasNewReviews(reviews, lastReviewedAt) {
  if (!lastReviewedAt) return reviews.length > 0;
  
  const lastTime = new Date(lastReviewedAt);
  return reviews.some(review => new Date(review.submittedAt) > lastTime);
}

function hasApprove(reviews) {
  return reviews.some(review => review.state === 'APPROVED');
}

function startMonitoring() {
  const { prNumber, repoOwner, repoName } = getConfig();
  
  if (!prNumber) {
    console.error('PR_NUMBER not found. Set env var or ensure branch name includes PR number.');
    process.exit(1);
  }

  console.log(`Starting PR monitoring for ${repoOwner}/${repoName}#${prNumber}`);
  console.log(`Polling every ${POLL_INTERVAL_MS / 1000} seconds...`);

  // Create marker file
  fs.mkdirSync(path.dirname(MARKER_FILE), { recursive: true });
  fs.writeFileSync(MARKER_FILE, JSON.stringify({
    prNumber,
    repoOwner,
    repoName,
    startedAt: new Date().toISOString()
  }));

  const poll = () => {
    try {
      const state = loadState();
      const prStatus = getPRStatus(repoOwner, repoName, prNumber);

      // Stop if PR is closed or merged
      if (prStatus.state === 'CLOSED' || prStatus.state === 'MERGED') {
        console.log(`PR is ${prStatus.state}. Stopping monitoring.`);
        cleanup();
        process.exit(0);
      }

      const reviews = fetchPRReviews(repoOwner, repoName, prNumber);

      // Stop if APPROVE found
      if (hasApprove(reviews)) {
        console.log('APPROVE review detected. Stopping monitoring.');
        cleanup();
        process.exit(0);
      }

      // Check for new reviews
      if (hasNewReviews(reviews, state.lastReviewedAt)) {
        console.log('New reviews detected! Triggering feedback handler...');
        
        // Update state
        const latestReview = reviews.sort((a, b) => 
          new Date(b.submittedAt) - new Date(a.submittedAt)
        )[0];
        
        state.lastReviewedAt = latestReview.submittedAt;
        state.reviewCount = reviews.length;
        saveState(state);

        // Trigger feedback handling (this would invoke the handle-pr-feedback hook)
        console.log('Feedback handler would be triggered here.');
        // In a real implementation, this would use Kiro's hook system
      } else {
        console.log(`No new reviews. (${reviews.length} total reviews checked)`);
      }

    } catch (error) {
      console.error('Error during polling:', error.message);
      // Continue polling despite errors
    }
  };

  // Initial poll
  poll();

  // Set up interval
  const intervalId = setInterval(poll, POLL_INTERVAL_MS);

  // Handle cleanup on exit
  process.on('SIGTERM', () => {
    clearInterval(intervalId);
    cleanup();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    clearInterval(intervalId);
    cleanup();
    process.exit(0);
  });
}

function cleanup() {
  if (fs.existsSync(MARKER_FILE)) {
    fs.unlinkSync(MARKER_FILE);
  }
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
}

// Run if executed directly
if (require.main === module) {
  startMonitoring();
}

module.exports = { startMonitoring, fetchPRReviews, getPRStatus };
