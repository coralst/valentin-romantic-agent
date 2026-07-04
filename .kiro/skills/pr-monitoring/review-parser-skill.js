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

module.exports = { parseReview, parseReviews, formatForAgent };
