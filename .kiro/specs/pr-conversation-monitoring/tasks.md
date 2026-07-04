# Implementation Plan

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Agent Fails to Monitor PR After Ready for Review
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate agents cannot respond to PR feedback
  - **Scoped PBT Approach**: For this deterministic bug, scope the property to concrete failing case: agent posts "Ready for Review" → master-agent posts REQUEST_CHANGES review → verify agent does not respond within 5 minutes
  - Test implementation details from Bug Condition in design:
    - Given: PR state where agent has posted "Ready for Review" comment
    - And: Master-agent has posted REQUEST_CHANGES review with ❌ blocking issues
    - When: 5 minutes have elapsed
    - Then: Agent has NOT detected the review (no polling mechanism exists)
    - And: Agent has NOT responded to the blocking issues
  - The test assertions should match the Expected Behavior Properties from design:
    - Agent SHALL detect new review within 1-2 minutes (currently fails)
    - Agent SHALL read blocking issues and respond (currently fails)
    - Agent SHALL engage in iterative conversation until APPROVE (currently fails)
  - Run test on UNFIXED code (before any hooks/skills/prompt updates are implemented)
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: "Agent posted 'Ready for Review' on PR #X, master-agent posted REQUEST_CHANGES 10 minutes ago, agent still has not responded"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing Git Workflow Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (PR lifecycle events that do NOT involve post-"Ready for Review" feedback):
    - Initial PR creation without "Ready for Review" comment
    - Incremental commit pushes during development (before "Ready for Review")
    - Master-agent immediate APPROVE reviews (no iteration needed)
    - CI pipeline execution and failure handling
    - Branch creation, deletion, and naming conventions
    - Issue closure after PR merge via `Resolves #N`
    - GitHub MCP tool usage (create PR, get PR details, merge)
    - Multiple agents working independently on different PRs
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements (requirements 3.1-3.8):
    - Property: Initial PR creation follows git-workflow Phase 2 (branch + Draft PR creation by master-agent)
    - Property: Incremental pushes trigger CI (lint → test → build) without monitoring interference
    - Property: Immediate APPROVE reviews proceed directly to merge without agent response requirement
    - Property: CI failures invoke existing failure handling (agent reads logs, fixes, pushes)
    - Property: Branch naming conventions from git-workflow.md are followed (feat/<domain>-<feature>)
    - Property: Merging PR auto-closes linked Issue via `Resolves #N`
    - Property: GitHub MCP tools continue to work for all existing operations
    - Property: Multiple agents on different PRs maintain independent workflows
  - Property-based testing generates many test cases for stronger preservation guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [ ] 3. Implement PR conversation monitoring system

  - [ ] 3.1 Create hook files in `.kiro/hooks/`
    - Create `monitor-pr-after-ready.kiro.hook` (triggers when agent posts "Ready for Review")
      - Event type: `userTriggered` (invoked by agent after posting "Ready for Review")
      - Action: Start polling loop via `pr-monitor-skill.js` that checks PR every 1-2 minutes
      - Stops when APPROVE review detected or PR closed
    - Create `handle-pr-feedback.kiro.hook` (triggers when new reviews detected)
      - Event type: Custom event emitted by polling script
      - Action: Parse review content via `review-parser-skill.js`, invoke agent with structured feedback
    - Create `stop-pr-monitoring.kiro.hook` (triggers when stopping conditions met)
      - Event type: Custom event emitted when APPROVE or PR closure detected
      - Action: Terminate polling loop, post final acknowledgment comment
    - _Bug_Condition: isBugCondition(prState) where prState.hasReadyForReviewComment AND prState.hasNewReviewsFromMasterAgent AND NOT prState.agentHasRespondedToLatestReview_
    - _Expected_Behavior: Agent detects new review within 1-2 minutes and responds with fixes or explanations_
    - _Preservation: Hook creation does not interfere with existing git-workflow Phase 1-5 structure_
    - _Requirements: 2.1, 2.2, 3.1_

  - [ ] 3.2 Create skill files in `.kiro/skills/pr-monitoring/`
    - Create `pr-monitor-skill.js` (polling and detection)
      - Polls GitHub API every 1-2 minutes for new reviews on specified PR
      - Emits custom event when new reviews detected
      - Stops when APPROVE or PR closed
      - Requires: GITHUB_TOKEN, repo, prNumber, lastReviewedAt
    - Create `review-parser-skill.js` (parse master-agent reviews)
      - Extracts ❌/⚠️/✅ items from review body text
      - Returns structured object: { blocking: [], suggestions: [], positive: [] }
      - Handles line-specific comments and general review comments
    - Create `response-formatter-skill.js` (format agent responses)
      - Takes agent's plain text response and formats as proper GitHub comment
      - Adds agent emoji, conversational tone, structured sections
      - Ensures "Ready for re-review" signal is clear
    - Create `github-api-wrapper-skill.js` (GitHub MCP helper utilities)
      - Wrapper functions: fetchPRReviews, fetchPRComments, postPRComment, getPRStatus
      - Uses GitHub MCP server internally (mcp-server-github)
    - _Bug_Condition: Skills implement the detection and parsing mechanisms missing in unfixed system_
    - _Expected_Behavior: Skills enable agents to monitor, parse, and respond to PR feedback_
    - _Preservation: Skills are new utilities and do not modify existing git-workflow behavior_
    - _Requirements: 2.2, 2.3, 2.6_

  - [ ] 3.3 Update agent prompts for human-like PR conversations
    - Update `.kiro/agents/backend-dev/prompt.md` with "PR Feedback Response" section
    - Update `.kiro/agents/frontend-dev/prompt.md` with "PR Feedback Response" section
    - Update `.kiro/agents/ui-designer/prompt.md` with "PR Feedback Response" section
    - Update `.kiro/agents/qa-agent/prompt.md` with "PR Feedback Response" section
    - Each section includes:
      - Conversation tone guidance (collegial, appreciative, non-defensive)
      - Response format template (address each ❌/⚠️ explicitly)
      - Examples of multi-round PR conversations (2-3 realistic scenarios)
    - Prompts do NOT contain polling logic or direct GitHub API calls
    - Prompts do NOT contain monitoring implementation details
    - Prompts DO emphasize natural, human-like communication
    - _Bug_Condition: Prompts currently lack guidance on responding to code review feedback_
    - _Expected_Behavior: Prompts enable agents to engage in natural PR conversations_
    - _Preservation: Prompt updates are additive and do not remove existing git-workflow guidance_
    - _Requirements: 2.3, 2.4, 2.5_

  - [ ] 3.4 Modify existing hook for monitoring integration
    - Update `.kiro/hooks/push-and-notify-pr.kiro.hook` to trigger monitoring after "Ready for Review"
    - Add step to agent prompt: "After posting 'Ready for Review', the PR monitoring system will automatically start checking for feedback"
    - Integration point: After agent posts review request comment, hook invokes `monitor-pr-after-ready.kiro.hook`
    - _Bug_Condition: Existing hook posts review request but never sets up follow-up monitoring_
    - _Expected_Behavior: Existing hook now triggers monitoring setup as final step_
    - _Preservation: Hook modification is additive, existing push/notify behavior unchanged_
    - _Requirements: 2.1, 3.1_

  - [ ] 3.5 Add error handling for monitoring system
    - Handle GitHub API rate limits: exponential backoff on 403/429 responses
    - Handle malformed reviews: gracefully process reviews without ❌/⚠️/✅ markers (treat as general feedback)
    - Handle timeout cases: post warning comment after 24 hours without APPROVE, continue polling
    - Handle network failures: retry with backoff, log errors, don't crash polling loop
    - Handle missing PR context: log error and skip monitoring setup if PR number/repo info missing
    - _Bug_Condition: Error handling prevents monitoring system failures from blocking workflows_
    - _Expected_Behavior: System recovers gracefully from API failures and edge cases_
    - _Preservation: Error handling is defensive and does not alter existing error flows_
    - _Requirements: 2.6_

  - [ ] 3.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Agent Successfully Monitors and Responds to PR Feedback
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1 on FIXED code (with hooks/skills/prompts implemented)
    - Test should now verify:
      - Agent DOES detect new reviews within 1-2 minutes (polling works)
      - Agent DOES read blocking issues (parsing works)
      - Agent DOES respond with fixes or explanations (conversation works)
      - Agent DOES engage in multi-round conversation until APPROVE (iteration works)
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - Document that the bug is resolved: "Agent now monitors PR after 'Ready for Review', detects master-agent feedback within 1-2 minutes, and responds appropriately"
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 3.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing Git Workflow Still Unchanged After Fix
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2 on FIXED code (with hooks/skills/prompts implemented)
    - Tests should still verify all 8 preservation requirements:
      - Initial PR creation still follows git-workflow Phase 2
      - Incremental pushes still trigger CI without monitoring interference
      - Immediate APPROVE reviews still proceed directly to merge
      - CI failures still invoke existing failure handling
      - Branch naming conventions still followed
      - Merging PR still auto-closes linked Issue
      - GitHub MCP tools still work for all operations
      - Multiple agents still maintain independent workflows
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix implementation
    - Document that preservation requirements are satisfied: "All existing git-workflow behaviors remain unchanged"
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [ ] 4. Implement agent branch visualization system (PARALLEL to tasks 1-3)
  
  - [ ] 4.1 Create GitHub agent labels with color coding
    - Run `.kiro/scripts/setup-agent-labels.sh` to create labels in repository
    - Verify labels exist with correct colors:
      - `agent: master` (Purple #7B68EE)
      - `agent: architect` (Orange #FF8C00)
      - `agent: frontend` (Blue #1E90FF)
      - `agent: backend` (Green #32CD32)
      - `agent: design` (Pink #FF69B4)
      - `agent: qa` (Red #FF4500)
    - _Goal: Visual differentiation of agent work in GitHub UI_
    - _Preservation: Label creation does not affect existing workflow_
    - _Requirements: New feature, no bugfix requirements_

  - [ ] 4.2 Update git-workflow.md with agent branch naming convention
    - Add branch naming format: `<type>/<agent>-<feature-description>`
    - Update examples in "Branch Naming" section:
      ```
      feat/master-<feature>       — Master Agent work
      feat/architect-<feature>    — System Architect work
      feat/frontend-<feature>     — Frontend Dev work
      feat/backend-<feature>      — Backend Dev work
      feat/design-<feature>       — UI Designer work
      feat/qa-<feature>          — QA Agent work
      ```
    - Add agent color scheme reference table
    - _Goal: Standardize branch naming for visual clarity_
    - _Preservation: Extends existing conventions, does not break current branches_
    - _Requirements: New feature, no bugfix requirements_

  - [ ] 4.3 Update master-agent prompt for automatic label application
    - Modify `.kiro/agents/master-agent/prompt.md` PR creation section
    - Add instruction: "When creating PRs via GitHub API, automatically apply the corresponding agent label based on branch prefix"
    - Add lookup table: branch prefix → label mapping
    - Example: branch `feat/frontend-chat-panel` → apply label `agent: frontend`
    - _Goal: Automatic label application during PR creation_
    - _Preservation: Additive change, existing PR creation flow unchanged_
    - _Requirements: New feature, no bugfix requirements_

  - [ ] 4.4 Update push-and-notify-pr hook to apply agent labels
    - Modify `.kiro/hooks/push-and-notify-pr.kiro.hook`
    - Add step after PR status comment: "Apply agent label to PR based on branch name"
    - Use GitHub MCP tools to add label: `gh pr edit --add-label "agent: <type>"`
    - Extract agent type from current branch name
    - _Goal: Ensure all PRs get labeled even if master-agent misses it_
    - _Preservation: Additive step, existing hook behavior unchanged_
    - _Requirements: New feature, no bugfix requirements_

  - [ ] 4.5 Update PR templates to include agent identification
    - Modify PR description template in git-workflow.md
    - Add agent emoji and name in header: `## [emoji] [Agent Name] — [Feature]`
    - Add "Agent" field with agent type and label
    - Example:
      ```markdown
      ## ⚛️ Frontend Dev — Message History Component

      **Branch**: feat/frontend-message-history
      **Agent**: Frontend Dev (label: `agent: frontend`)
      **Quality Signal**: 🟡 Yellow
      ```
    - _Goal: Human-readable agent identification in PR descriptions_
    - _Preservation: Template enhancement, existing fields unchanged_
    - _Requirements: New feature, no bugfix requirements_

  - [ ] 4.6 Verify agent visualization in GitHub UI
    - Check network graph shows branch names with agent prefixes
    - Check PR list shows agent labels with correct colors
    - Check filtered views work: `is:pr label:"agent: frontend"`
    - Check branch list sorting by agent prefix
    - Document any visual inconsistencies or improvements needed
    - _Goal: Confirm visualization system works end-to-end_
    - _Preservation: Visual verification only, no code changes_
    - _Requirements: New feature, no bugfix requirements_

- [ ] 5. Checkpoint - Ensure all tests pass
  - Verify bug condition test passes (agent monitors and responds to PR feedback)
  - Verify preservation tests pass (existing workflows unchanged)
  - Verify unit tests pass for new skills (review-parser, response-formatter, github-api-wrapper, pr-monitor)
  - Run integration test: full multi-round conversation flow ("Ready for Review" → REQUEST_CHANGES → agent fixes → "Ready for re-review" → APPROVE → merge)
  - Verify agent labels appear on all new PRs
  - Verify branch naming convention is followed for all new branches
  - If any questions or issues arise during testing, ask the user for guidance
