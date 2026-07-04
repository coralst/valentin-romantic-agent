#!/usr/bin/env node

/**
 * Response Formatter Skill - Formats agent responses for PR comments
 * 
 * Takes agent's plain text response and formats it as a proper GitHub comment
 * with agent emoji, conversational tone, and structured sections.
 */

const AGENT_EMOJIS = {
  'backend-dev': '🔧',
  'frontend-dev': '⚛️',
  'ui-designer': '🎨',
  'qa-agent': '🧪',
  'system-architect': '🏗️',
  'master-agent': '👔'
};

function formatResponse(agentType, responseText, options = {}) {
  const emoji = AGENT_EMOJIS[agentType] || '🤖';
  const agentName = agentType.split('-').map(w => 
    w.charAt(0).toUpperCase() + w.slice(1)
  ).join(' ');

  let formatted = `**${emoji} ${agentName}** — Feedback Response\n\n`;

  // Add conversational opening if not present
  if (!responseText.toLowerCase().includes('thanks') && 
      !responseText.toLowerCase().includes('appreciate')) {
    formatted += 'Thanks for the review! ';
  }

  formatted += responseText;

  // Add "Ready for re-review" if not present and fixes were made
  if (options.fixesApplied && !responseText.toLowerCase().includes('ready for')) {
    formatted += '\n\n---\n\n';
    formatted += `Pushed ${options.commitCount || 'several'} commits addressing the blocking issues. Ready for re-review.`;
  }

  return formatted;
}

function formatCommitSummary(commits) {
  if (!commits || commits.length === 0) {
    return 'No commits';
  }

  let summary = `Commits:\n`;
  commits.forEach(commit => {
    summary += `- ${commit.sha?.substring(0, 7) || 'unknown'}: ${commit.message}\n`;
  });

  return summary;
}

function createResponseTemplate(agentType, blockingIssues = []) {
  const emoji = AGENT_EMOJIS[agentType] || '🤖';
  const agentName = agentType.split('-').map(w => 
    w.charAt(0).toUpperCase() + w.slice(1)
  ).join(' ');

  let template = `**${emoji} ${agentName}** — Feedback Response\n\n`;
  template += `Thanks for the review! Here's what I've addressed:\n\n`;

  if (blockingIssues.length > 0) {
    // Use a neutral "in progress" marker (▫️), NOT ✅ — a checkmark implies the
    // fix is already verified, which is false in a fill-in template. The agent
    // flips each item to ✅ only after the fix is committed.
    blockingIssues.forEach((issue, i) => {
      template += `▫️ **Issue ${i + 1}**: ${issue}\n`;
      template += `   - [ ] Fix in [commit hash]. [Explanation of fix]\n\n`;
    });
  }

  template += `\n---\n\nReady for re-review.`;

  return template;
}

// CLI usage
if (require.main === module) {
  const agentType = process.argv[2];
  const responseText = process.argv[3];

  if (!agentType || !responseText) {
    console.error('Usage: node response-formatter-skill.js <agent-type> "<response text>"');
    console.error('Agent types: backend-dev, frontend-dev, ui-designer, qa-agent');
    process.exit(1);
  }

  const formatted = formatResponse(agentType, responseText, { fixesApplied: true });
  console.log(formatted);
}

module.exports = { formatResponse, formatCommitSummary, createResponseTemplate };
