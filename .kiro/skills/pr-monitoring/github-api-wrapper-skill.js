#!/usr/bin/env node

/**
 * GitHub API Wrapper Skill - Helper utilities for GitHub operations
 * 
 * Provides wrapper functions for common GitHub operations using gh CLI.
 * This abstracts away the GitHub API details from other skills.
 */

const { execFileSync } = require('child_process');

/**
 * Run `gh` with an argv array (never a shell string) so that comment bodies and
 * other arguments cannot be interpreted by a shell. This closes the command
 * injection surface that string interpolation opened (backticks, $(), quotes).
 * @param {string[]} args - argv passed directly to gh
 * @param {string} [stdin] - optional stdin payload (used for --body-file -)
 * @returns {string|null} stdout, or null on failure
 */
function ghExec(args, stdin) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf-8',
      stdio: stdin !== undefined ? ['pipe', 'pipe', 'ignore'] : ['ignore', 'pipe', 'ignore'],
      input: stdin,
    });
  } catch (error) {
    console.error(`gh command failed: gh ${args.join(' ')}`);
    console.error(error.message);
    return null;
  }
}

function fetchPRReviews(owner, repo, prNumber) {
  const output = ghExec([
    'pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`,
    '--json', 'reviews', '--jq', '.reviews',
  ]);
  return output ? JSON.parse(output) : [];
}

function fetchPRComments(owner, repo, prNumber) {
  const output = ghExec([
    'pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`,
    '--json', 'comments', '--jq', '.comments',
  ]);
  return output ? JSON.parse(output) : [];
}

/**
 * Post a PR comment. The body is streamed via `--body-file -` (stdin) so
 * multi-line markdown is preserved verbatim — no `\n`-escaping and no shell
 * quoting. This fixes the defect where multi-line comments rendered as a single
 * line containing literal "\n" sequences.
 */
function postPRComment(owner, repo, prNumber, body) {
  const output = ghExec(
    ['pr', 'comment', String(prNumber), '--repo', `${owner}/${repo}`, '--body-file', '-'],
    body,
  );
  return output !== null;
}

function getPRStatus(owner, repo, prNumber) {
  const output = ghExec([
    'pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`,
    '--json', 'state,isDraft,reviewDecision',
    '--jq', '{state: .state, isDraft: .isDraft, reviewDecision: .reviewDecision}',
  ]);
  return output
    ? JSON.parse(output)
    : { state: 'UNKNOWN', isDraft: false, reviewDecision: null };
}

function getPRDetails(owner, repo, prNumber) {
  const output = ghExec([
    'pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`,
    '--json', 'number,title,state,author,reviews,comments,commits',
  ]);
  return output ? JSON.parse(output) : null;
}

function listOpenPRs(owner, repo) {
  const output = ghExec([
    'pr', 'list', '--repo', `${owner}/${repo}`,
    '--json', 'number,title,author,state', '--limit', '50',
  ]);
  return output ? JSON.parse(output) : [];
}

/**
 * NOTE: There is intentionally no `approvePR` helper here.
 *
 * In this single-account repo a formal `gh pr review --approve` on your own PR
 * always fails with HTTP 422 ("Can not approve your own pull request"). Approval
 * is expressed as a master-agent COMMENT carrying the APPROVED-BY-MASTER-AGENT
 * token (see approval-gate-skill.js and git-workflow.md). Use `postPRComment`
 * with that token instead. A `requestChanges` review is likewise omitted; the
 * master-agent posts blocking (❌) items as a normal comment via `postPRComment`.
 */

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
  ghExec,
  fetchPRReviews,
  fetchPRComments,
  postPRComment,
  getPRStatus,
  getPRDetails,
  listOpenPRs,
};
