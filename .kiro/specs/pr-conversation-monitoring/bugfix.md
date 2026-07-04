# Bugfix Requirements Document

## Introduction

The current multi-agent workflow creates a one-way communication pattern in pull requests: agents open PRs and signal "Ready for Review," but lack any mechanism to monitor or respond to master-agent's feedback. When master-agent posts REQUEST_CHANGES reviews with ❌ blocking issues, the agent never sees this feedback, preventing iterative improvement and causing PRs to either merge without iteration or sit abandoned.

This bugfix introduces a **PR conversation monitoring mechanism** that enables agents to actively monitor their PRs after "Ready for Review," detect master-agent feedback, respond to blocking issues, and engage in back-and-forth conversations until merge approval.

**Impact**: Without this fix, agents cannot learn from code review feedback, cannot iterate on their implementations, and the team loses the collaborative improvement cycle that makes PR reviews valuable.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an agent comments "Ready for Review" on their PR THEN the agent never checks the PR again for new comments or reviews

1.2 WHEN master-agent posts a REQUEST_CHANGES review with ❌ blocking issues THEN the agent does not detect this feedback

1.3 WHEN master-agent provides line-specific code review comments THEN the agent has no mechanism to read or respond to these comments

1.4 WHEN a PR requires multiple rounds of review and revision THEN the conversation stops after the first "Ready for Review" comment (no iteration occurs)

1.5 WHEN an agent's PR has unaddressed blocking issues from master-agent THEN the PR either gets merged without fixes or sits indefinitely without progress

### Expected Behavior (Correct)

2.1 WHEN an agent comments "Ready for Review" on their PR THEN the agent SHALL actively monitor the PR by polling for new reviews and comments every 1-2 minutes

2.2 WHEN master-agent posts a REQUEST_CHANGES review with ❌ blocking issues THEN the agent SHALL detect the new review within 1-2 minutes

2.3 WHEN master-agent provides line-specific code review comments THEN the agent SHALL read each comment and respond with either an explanation or a commit that fixes the issue

2.4 WHEN a PR requires multiple rounds of review and revision THEN the agent SHALL engage in iterative back-and-forth conversation, responding to each round of feedback until master-agent posts an APPROVE review

2.5 WHEN an agent addresses all blocking issues from a review round THEN the agent SHALL push any necessary fixes and comment "Ready for re-review" with a summary of changes

2.6 WHEN an agent is monitoring a PR and detects no new feedback after reasonable time THEN the agent SHALL stop polling once master-agent posts APPROVE or closes the PR

### Unchanged Behavior (Regression Prevention)

3.1 WHEN an agent creates a PR and pushes commits THEN the agent SHALL CONTINUE TO follow the existing git-workflow steering file for branch naming, commit messages, and PR creation

3.2 WHEN master-agent posts an APPROVE review on first submission THEN the flow SHALL CONTINUE TO proceed directly to merge without requiring agent response

3.3 WHEN an agent pushes incremental commits during development THEN the agent SHALL CONTINUE TO follow the existing incremental push strategy (route handlers → services → tests → fixes)

3.4 WHEN CI fails on a PR THEN the existing CI failure handling SHALL CONTINUE TO work (agent reads logs, fixes issues, pushes again)

3.5 WHEN master-agent creates the initial Draft PR and branches THEN the existing Phase 2 handoff process SHALL CONTINUE TO function as defined

3.6 WHEN multiple agents work on different PRs for the same feature THEN each agent SHALL CONTINUE TO work independently on their own branch

3.7 WHEN GitHub MCP tools are used for PR operations THEN all existing tool usage patterns SHALL CONTINUE TO work (create PR, get PR details, add comments, create reviews, merge)

3.8 WHEN an agent's PR is merged THEN the existing cleanup process SHALL CONTINUE TO apply (branch deletion, linked issue closure)
