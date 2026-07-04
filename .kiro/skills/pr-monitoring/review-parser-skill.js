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

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('❌')) {
      result.blocking.push(trimmed.substring(1).trim());
    } else if (trimmed.startsWith('⚠️')) {
      result.suggestions.push(trimmed.substring(2).trim());
    } else if (trimmed.startsWith('✅')) {
      result.positive.push(trimmed.substring(1).trim());
    } else if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('**')) {
      // General comment (not a header or emphasis)
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
 * Ownership map: file path prefix → owning sub-agent. Mirrors architecture.md.
 */
const OWNERSHIP = [
  ['src/client/design-system/', 'ui-designer'],
  ['src/client/components/', 'frontend-dev'],
  ['src/client/hooks/', 'frontend-dev'],
  ['src/client/context/', 'frontend-dev'],
  ['src/client/App.tsx', 'frontend-dev'],
  ['src/client/main.tsx', 'frontend-dev'],
  ['src/server/', 'backend-dev'],
  ['src/shared/', 'system-architect'],
  ['e2e/', 'qa-agent'],
  ['playwright.config.ts', 'qa-agent'],
];

/**
 * Attribute a file path to an owning agent, or null when it cannot be uniquely
 * attributed (caller routes null to the master-agent for triage).
 * @param {string|undefined} filePath
 * @returns {string|null}
 */
function attributeOwner(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  for (const [prefix, owner] of OWNERSHIP) {
    if (filePath.startsWith(prefix)) return owner;
  }
  return null;
}

// CLI usage
if (require.main === module) {
  const reviewBody = process.argv[2];
  
  if (!reviewBody) {
    console.error('Usage: node review-parser-skill.js "<review body>"');
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
  CUBIC_AUTHOR,
};
