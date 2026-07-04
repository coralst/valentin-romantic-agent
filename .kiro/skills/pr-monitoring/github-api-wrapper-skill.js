#!/usr/bin/env node

/**
 * GitHub API Wrapper Skill - Helper utilities for GitHub operations
 * 
 * Provides wrapper functions for common GitHub operations using gh CLI.
 * This abstracts away the GitHub API details from other skills.
 */

const { execSync } = require('child_process');

function exec(command) {
  try {
    return execSync(command, { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
  } catch (error) {
    console.error(`Command failed: ${command}`);
    console.error(error.message);
    return null;
  }
}

function fetchPRReviews(owner, repo, prNumber) {
  const cmd = `gh pr view ${prNumber} --repo ${owner}/${repo} --json reviews --jq '.reviews'`;
  const output = exec(cmd);
  return output ? JSON.parse(output) : [];
}

function fetchPRComments(owner, repo, prNumber) {
  const cmd = `gh pr view ${prNumber} --repo ${owner}/${repo} --json comments --jq '.comments'`;
  const output = exec(cmd);
  return output ? JSON.parse(output) : [];
}

function postPRComment(owner, repo, prNumber, body) {
  const escapedBody = body.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const cmd = `gh pr comment ${prNumber} --repo ${owner}/${repo} --body "${escapedBody}"`;
  const output = exec(cmd);
  return output !== null;
}

function getPRStatus(owner, repo, prNumber) {
  const cmd = `gh pr view ${prNumber} --repo ${owner}/${repo} --json state,isDraft,reviewDecision --jq '{state: .state, isDraft: .isDraft, reviewDecision: .reviewDecision}'`;
  const output = exec(cmd);
  return output ? JSON.parse(output) : { state: 'UNKNOWN', isDraft: false, reviewDecision: null };
}

function getPRDetails(owner, repo, prNumber) {
  const cmd = `gh pr view ${prNumber} --repo ${owner}/${repo} --json number,title,state,author,reviews,comments,commits`;
  const output = exec(cmd);
  return output ? JSON.parse(output) : null;
}

function listOpenPRs(owner, repo) {
  const cmd = `gh pr list --repo ${owner}/${repo} --json number,title,author,state --limit 50`;
  const output = exec(cmd);
  return output ? JSON.parse(output) : [];
}

function approvePR(owner, repo, prNumber, comment = '') {
  const commentFlag = comment ? `--body "${comment.replace(/"/g, '\\"')}"` : '';
  const cmd = `gh pr review ${prNumber} --repo ${owner}/${repo} --approve ${commentFlag}`;
  const output = exec(cmd);
  return output !== null;
}

function requestChanges(owner, repo, prNumber, body) {
  const escapedBody = body.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const cmd = `gh pr review ${prNumber} --repo ${owner}/${repo} --request-changes --body "${escapedBody}"`;
  const output = exec(cmd);
  return output !== null;
}

// CLI usage
if (require.main === module) {
  const operation = process.argv[2];
  const owner = process.argv[3];
  const repo = process.argv[4];
  const prNumber = process.argv[5];

  if (!operation || !owner || !repo || !prNumber) {
    console.error('Usage: node github-api-wrapper-skill.js <operation> <owner> <repo> <pr-number>');
    console.error('Operations: reviews, comments, status, details');
    process.exit(1);
  }

  let result;
  switch (operation) {
    case 'reviews':
      result = fetchPRReviews(owner, repo, prNumber);
      break;
    case 'comments':
      result = fetchPRComments(owner, repo, prNumber);
      break;
    case 'status':
      result = getPRStatus(owner, repo, prNumber);
      break;
    case 'details':
      result = getPRDetails(owner, repo, prNumber);
      break;
    default:
      console.error(`Unknown operation: ${operation}`);
      process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  fetchPRReviews,
  fetchPRComments,
  postPRComment,
  getPRStatus,
  getPRDetails,
  listOpenPRs,
  approvePR,
  requestChanges
};
