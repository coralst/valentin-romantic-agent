# PR Conversation Monitoring Bugfix Design

## Overview

This design implements a **hybrid hook-based PR monitoring system** that enables agents to engage in iterative code review conversations after posting "Ready for Review" comments. The system uses hooks to automatically trigger PR monitoring, polls GitHub API every 1-2 minutes for new reviews, and invokes agents with structured feedback data. Skills provide reusable parsing and formatting utilities, while prompt updates add human-like conversation templates and behavioral guidance. Agents never directly poll or implement monitoring logic — hooks handle all detection and triggering.

**Architecture**: Hook-triggered (automatic), skill-supported (parsing/formatting), prompt-guided (human-like responses).

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when agents post "Ready for Review" but never check the PR again for master-agent feedback
- **Property (P)**: The desired behavior - agents actively monitor their PRs after "Ready for Review" and respond to feedback until APPROVE
- **Preservation**: All existing git-workflow behavior (8 regression clauses) must remain unchanged
- **Hook**: A `.kiro.hook` file that triggers agent actions based on IDE events (file changes, prompts, task execution)
- **Skill**: A reusable utility script or function stored in `.kiro/skills/` that can be invoked by agents or hooks
- **Ready for Review**: The signal comment format agents post on their PR when work is complete (defined in git-workflow.md)
- **REQUEST_CHANGES Review**: A GitHub review type that indicates blocking issues requiring fixes before merge
- **APPROVE Review**: A GitHub review type that signals the PR is ready to merge
- **Polling Interval**: Time between GitHub API checks for new reviews (1-2 minutes per requirements)
- **Structured Feedback Data**: Parsed review content categorized by severity (❌ blocking, ⚠️ suggestions, ✅ positive)
- **Multi-Round Conversation**: Iterative back-and-forth between agent and master-agent across multiple review cycles

## Bug Details

### Bug Condition

The bug manifests when an agent posts a "Ready for Review" comment on their PR. After posting this comment, the agent has no mechanism to monitor the PR for new reviews, comments, or feedback from master-agent. The workflow is one-directional: agents signal completion but never check back for responses.

**Formal Specification:**
```
FUNCTION isBugCondition(prState)
  INPUT: prState of type PullRequestState
  OUTPUT: boolean
  
  RETURN prState.hasReadyForReviewComment
         AND prState.hasNewReviewsFromMasterAgent
         AND NOT prState.agentHasRespondedToLatestReview
END FUNCTION
```

### Examples

- **Example 1**: Backend-dev posts "Ready for Review" on PR #42. Master-agent posts a REQUEST_CHANGES review with 3 ❌ blocking issues 10 minutes later. Backend-dev never sees the feedback. The PR sits idle.

- **Example 2**: Frontend-dev posts "Ready for Review" on PR #38. Master-agent approves the PR immediately. No bug occurs because no iteration is needed (existing flow works).

- **Example 3**: QA-agent posts "Ready for Review" on PR #51. Master-agent posts line-specific comments requesting test coverage for edge cases. QA-agent never reads the comments. Master-agent eventually merges the PR without the additional tests being added.

- **Edge Case**: UI-designer posts "Ready for Review" on PR #29. Master-agent posts a review, then immediately closes the PR without merge (design rejected). UI-designer never learns why the PR was closed.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Agents MUST CONTINUE TO follow the existing git-workflow.md Phase 1-5 structure
- Master-agent MUST CONTINUE TO create Issues, approve specs, create branches, and open Draft PRs as defined
- Agents MUST CONTINUE TO push incremental commits during development (route handlers → services → tests → fixes)
- Agents MUST CONTINUE TO post "Ready for Review" comments using the existing format from git-workflow.md
- CI pipeline MUST CONTINUE TO run on every push (lint → test → build) with existing failure handling
- Master-agent MUST CONTINUE TO merge PRs via GitHub API (squash merge) once all conditions are met
- Branch deletion and Issue closure MUST CONTINUE TO happen automatically after merge
- Multiple agents working on different PRs MUST CONTINUE TO work independently on their own branches

**Scope:**
All inputs that do NOT involve a PR with a "Ready for Review" comment followed by new reviews should be completely unaffected by this fix. This includes:
- Initial PR creation and Draft PR workflows
- Incremental commit pushes during development
- CI pipeline execution and failure handling
- Master-agent's Issue creation and spec approval workflows
- Branch creation and management
- PR merge operations

## Hypothesized Root Cause

Based on the bug description, the most likely issues are:

1. **No Polling Mechanism**: Agents have no hook or scheduled task to check PRs for new activity after posting "Ready for Review"
   - The `push-and-notify-pr.kiro.hook` posts the review request but doesn't set up any follow-up monitoring
   - No existing hook triggers when new reviews are posted to a PR

2. **No Feedback Detection Logic**: Even if an agent wanted to check for feedback, there's no code to detect new reviews or parse their content
   - No utility to fetch PR reviews via GitHub API
   - No parser to extract ❌/⚠️/✅ items from review text

3. **No Conversation Templates**: Agent prompts don't include guidance on how to respond to code review feedback in a human-like manner
   - Master-agent prompt has review templates, but individual agent prompts don't have response templates
   - No examples of multi-round PR conversations

4. **No Stopping Condition**: Without detecting APPROVE reviews or PR closure, a monitoring system could poll indefinitely
   - Need clear exit criteria to stop polling once PR is approved or closed

## Correctness Properties

Property 1: Bug Condition - PR Monitoring After Ready for Review

_For any_ PR where the agent has posted "Ready for Review" and master-agent subsequently posts a REQUEST_CHANGES review with blocking issues, the agent SHALL detect the new review within 1-2 minutes, read the blocking issues, address each issue with either a code fix or explanatory comment, and respond on the PR with a summary of changes.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation - Existing Git Workflow Unchanged

_For any_ PR lifecycle event that is NOT a post-"Ready for Review" feedback cycle (initial PR creation, incremental pushes, CI runs, merge operations), the system SHALL execute exactly as defined in the current git-workflow.md without any behavioral changes.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**Component 1: Hook Files** (New)

Create three new hooks in `.kiro/hooks/`:

1. **`monitor-pr-after-ready.kiro.hook`** — Triggers immediately when an agent posts "Ready for Review"
   - Event: `userTriggered` (invoked by the agent after posting "Ready for Review")
   - Action: Start a polling loop that checks the PR every 1-2 minutes for new reviews
   - Delegates to `pr-monitor-skill.js` for polling logic
   - Stops when APPROVE review detected or PR closed

2. **`handle-pr-feedback.kiro.hook`** — Triggers when new review feedback is detected
   - Event: Custom event emitted by the polling script when new reviews found
   - Action: Parse the review content using `review-parser-skill.js`, invoke agent with structured feedback
   - Agent prompt includes human-like conversation guidance and examples

3. **`stop-pr-monitoring.kiro.hook`** — Triggers when stopping conditions are met
   - Event: Custom event emitted when APPROVE review or PR closure detected
   - Action: Terminate the polling loop, post final acknowledgment comment

**Component 2: Skills** (New)

Create skill files in `.kiro/skills/pr-monitoring/`:

1. **`pr-monitor-skill.js`** — Polling and detection script
   ```javascript
   // Polls GitHub API every 1-2 minutes for new reviews on the specified PR
   // Emits custom event when new reviews detected
   // Stops when APPROVE or PR closed
   // Requires: GITHUB_TOKEN, repo, prNumber, lastReviewedAt
   ```

2. **`review-parser-skill.js`** — Parse master-agent reviews
   ```javascript
   // Extracts ❌/⚠️/✅ items from review body text
   // Returns structured object: { blocking: [], suggestions: [], positive: [] }
   // Handles line-specific comments and general review comments
   ```

3. **`response-formatter-skill.js`** — Format agent responses
   ```javascript
   // Takes agent's plain text response and formats it as a proper GitHub comment
   // Adds agent emoji, conversational tone, structured sections
   // Ensures "Ready for re-review" signal is clear
   ```

4. **`github-api-wrapper-skill.js`** — GitHub MCP helper utilities
   ```javascript
   // Wrapper functions for common GitHub operations:
   // - fetchPRReviews(repo, prNumber)
   // - fetchPRComments(repo, prNumber)
   // - postPRComment(repo, prNumber, body)
   // - getPRStatus(repo, prNumber)
   // Uses GitHub MCP server internally
   ```

**Component 3: Prompt Updates** (Modified)

Update agent prompt files in `.kiro/agents/{agent-name}/prompt.md`:

1. **Add "PR Feedback Response" section** to backend-dev, frontend-dev, ui-designer, qa-agent prompts:
   ```markdown
   ## Responding to Code Review Feedback

   When you receive code review feedback from master-agent or other reviewers, respond like a real human teammate:

   ### Conversation Tone
   - Be collegial and appreciative (thank reviewers for catching issues)
   - Acknowledge valid criticism without being defensive
   - Ask clarifying questions if feedback is unclear
   - Show your reasoning when you disagree respectfully

   ### Response Format
   Address each ❌ blocking issue and ⚠️ suggestion explicitly:

   **[Your Agent Emoji] [Your Name]** — Feedback Response

   Thanks for the review! Here's what I've addressed:

   ✅ [Blocking issue 1]: Fixed in [commit hash]. [Brief explanation of fix]
   ✅ [Blocking issue 2]: Fixed in [commit hash]. [Brief explanation of fix]
   💬 [Suggestion 1]: [Your response — applied/deferred/alternative approach]
   ❓ [Unclear point]: Can you clarify what you mean by [specific quote]?

   Pushed [N] commits addressing the blocking issues. Ready for re-review.

   ### Examples of Human-Like PR Conversations
   [Include 2-3 realistic examples of multi-round conversations]
   ```

2. **NO polling logic** — Prompts do not contain API polling instructions
3. **NO GitHub API calls** — Prompts do not contain direct GitHub tool usage for monitoring
4. **YES conversation examples** — Prompts include realistic PR discussion examples
5. **YES human tone guidance** — Prompts emphasize natural, collegial communication

**Component 4: Integration with Existing Workflow** (Modified)

Modify `.kiro/hooks/push-and-notify-pr.kiro.hook`:

```json
{
  "enabled": true,
  "name": "Push & Notify PR",
  "description": "Manually triggered: pushes uncommitted work, posts status comment, AND STARTS PR MONITORING.",
  "version": "2.0.0",
  "when": {
    "type": "userTriggered"
  },
  "then": {
    "type": "askAgent",
    "prompt": "[Existing prompt content...]\n\n5. After posting your 'Ready for Review' comment, the PR monitoring system will automatically start checking for feedback. You don't need to manually poll — the system will invoke you when new reviews arrive."
  }
}
```

**Component 5: Error Handling** (New)

Add error handling for:

1. **GitHub API Rate Limits**: Exponential backoff if 403/429 responses received during polling
2. **Malformed Reviews**: Gracefully handle reviews without ❌/⚠️/✅ markers (treat as general feedback)
3. **Timeout Cases**: If no APPROVE after 24 hours of monitoring, post a warning comment and continue polling (don't silently stop)
4. **Network Failures**: Retry with backoff, log errors, don't crash the polling loop
5. **Missing PR Context**: If PR number or repo info is missing, log error and skip monitoring setup

### Architecture Diagram

```
User Action: Agent posts "Ready for Review" comment
    ↓
[push-and-notify-pr.kiro.hook] (modified)
    ↓
Triggers → [monitor-pr-after-ready.kiro.hook] (new)
    ↓
Invokes → [pr-monitor-skill.js] (new)
    ↓ (every 1-2 minutes)
Polls GitHub API via [github-api-wrapper-skill.js] (new)
    ↓ (when new reviews detected)
Emits custom event → [handle-pr-feedback.kiro.hook] (new)
    ↓
Parses review via [review-parser-skill.js] (new)
    ↓
Invokes Agent with structured feedback + conversation templates (prompt.md updated)
    ↓
Agent reads feedback, makes fixes, posts response
    ↓
Agent pushes commits → [pr-monitor-skill.js] continues polling
    ↓ (when APPROVE or PR closed)
Emits stop event → [stop-pr-monitoring.kiro.hook] (new)
    ↓
Terminates polling loop, posts acknowledgment
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, demonstrate the bug on the UNFIXED system (no PR monitoring exists), then verify the fix enables iterative PR conversations while preserving all existing workflows.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that agents cannot currently respond to PR feedback.

**Test Plan**: Manually test the existing workflow by having an agent post "Ready for Review", then immediately post a REQUEST_CHANGES review as master-agent. Observe that the agent never responds. This confirms the bug exists.

**Test Cases**:
1. **No Monitoring Test**: Agent posts "Ready for Review" on PR #1, wait 5 minutes, verify agent does not check the PR again (will demonstrate bug on unfixed system)
2. **Feedback Ignored Test**: Master-agent posts REQUEST_CHANGES review with 2 ❌ blocking issues on PR #1, wait 10 minutes, verify agent never responds (will demonstrate bug on unfixed system)
3. **APPROVE Immediate Test**: Master-agent posts APPROVE review immediately after "Ready for Review", verify no bug occurs (existing behavior is correct)
4. **Multi-Agent Test**: Two agents (backend-dev, frontend-dev) post "Ready for Review" on different PRs simultaneously, verify neither monitors their PR (will demonstrate bug on unfixed system)

**Expected Counterexamples**:
- Agents do not poll PRs after "Ready for Review"
- Possible causes: no polling hook, no detection script, no conversation guidance

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds (PR has "Ready for Review" + new reviews), the fixed system enables agents to respond iteratively.

**Pseudocode:**
```
FOR ALL prState WHERE isBugCondition(prState) DO
  result := monitorAndRespondToPR(prState)
  ASSERT result.agentDetectedReview = true
  ASSERT result.agentRespondedWithin120Seconds = true
  ASSERT result.agentAddressedBlockingIssues = true
  ASSERT result.conversationContinuedUntilApprove = true
END FOR
```

### Preservation Checking

**Goal**: Verify that for all PR lifecycle events that do NOT involve post-"Ready for Review" feedback cycles, the system behaves identically to the original workflow.

**Pseudocode:**
```
FOR ALL prEvent WHERE NOT isPostReadyForReviewFeedback(prEvent) DO
  ASSERT fixedWorkflow(prEvent) = originalWorkflow(prEvent)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the PR lifecycle
- It catches edge cases that manual unit tests might miss (branch creation, CI failures, merge operations)
- It provides strong guarantees that behavior is unchanged for all non-monitoring scenarios

**Test Plan**: Document the existing workflow behavior for non-monitoring scenarios FIRST (using the current unfixed system), then write property-based tests that verify this behavior persists after implementing the fix.

**Test Cases**:
1. **Initial PR Creation Preservation**: Create a PR without "Ready for Review" comment, verify workflow matches original (no monitoring starts)
2. **Incremental Push Preservation**: Push commits during development (before "Ready for Review"), verify CI runs as before, no monitoring triggered
3. **Immediate APPROVE Preservation**: Master-agent approves PR on first review, verify merge proceeds without agent response requirement
4. **CI Failure Preservation**: CI fails after push, verify agent fixes and pushes again using existing CI failure handling (no monitoring interference)
5. **Multi-Agent Independence Preservation**: Multiple agents work on different PRs simultaneously, verify each agent's workflow is independent (monitoring doesn't interfere across agents)
6. **Branch Management Preservation**: Branch creation, deletion, and naming conventions continue to work as defined in git-workflow.md
7. **Issue Closure Preservation**: Merging PR auto-closes linked Issue via `Resolves #N` as before
8. **GitHub MCP Usage Preservation**: All existing GitHub MCP tool calls continue to work (create PR, get PR details, merge, etc.)

### Unit Tests

- Test `review-parser-skill.js` with various review body formats (with/without ❌/⚠️/✅ markers, line-specific vs general comments)
- Test `response-formatter-skill.js` outputs valid GitHub comment markdown
- Test `github-api-wrapper-skill.js` handles API errors gracefully (rate limits, network failures)
- Test `pr-monitor-skill.js` stops polling when APPROVE detected or PR closed
- Test hook trigger conditions (userTriggered, custom events)

### Property-Based Tests

- Generate random PR states and verify monitoring starts only when "Ready for Review" comment exists
- Generate random review content and verify parser extracts all ❌/⚠️/✅ items correctly
- Generate random polling intervals and verify system respects 1-2 minute frequency
- Generate random stopping conditions (APPROVE, PR closed, timeout) and verify polling terminates cleanly

### Integration Tests

- Test full multi-round conversation flow: "Ready for Review" → REQUEST_CHANGES → agent fixes → "Ready for re-review" → APPROVE → merge
- Test error recovery: GitHub API fails mid-polling, system retries and resumes
- Test concurrent monitoring: Multiple agents monitor their own PRs simultaneously without interference
- Test monitoring does not start for PRs without "Ready for Review" comment
- Test monitoring stops immediately when APPROVE review posted or PR closed
- Test human-like conversation tone: Agent responses match templates, include agent emoji, sound natural
