# Requirements Document

## Introduction

This feature integrates **Cubic AI code review** — a third-party GitHub App that
automatically reviews pull requests by posting inline comments and a summary when a
PR is opened or updated — into this repository's existing Kiro-based multi-agent
GitHub PR workflow.

The central challenge is integrating an autonomous, server-side reviewer into a
workflow that already has a well-defined review authority model (the master-agent),
a single-account approval mechanism (the `APPROVED-BY-MASTER-AGENT` comment token),
and a turn-based PR-conversation-monitoring system (hooks + skills). The integration
must add Cubic's value (fast, first-pass security/bug/performance review) **without**
creating reviewer-authority conflicts, without introducing an independent merge gate,
and without flooding PR threads with duplicate or overlapping comments.

The integration adopts **Model A**: Cubic is an advisory, first-pass reviewer. The
master-agent remains the sole arbiter and owner of the single merge gate. Cubic's
findings are triaged by the master-agent; unresolved Cubic blocking findings are
treated as blocking unless the master-agent records an explicit waiver with a reason.

A critical architectural fact constrains every requirement: **Cubic runs server-side
on GitHub as a webhook-triggered GitHub App.** It is not a Kiro power, not an MCP
server, and not a `.kiro` hook. Kiro agents cannot invoke Cubic directly. Kiro agents
interact with Cubic **only** by reading its comments through the GitHub API (via the
GitHub Power). Cubic's trigger timing and review scope are controlled by Cubic's own
GitHub App configuration, not by Kiro.

### Scope Summary

**In scope:** changes to the `git-workflow` steering document, changes to the
master-agent prompt, extension of `review-parser-skill.js`, documentation of Cubic
GitHub App setup/configuration, definition of how Cubic findings flow into the
existing monitoring→response loop, the Phase 5 approval checklist update, and an
**automated regression test-set (the Regression_Suite) for the agentic workflow
automation** that runs on every PR touching Workflow_Automation_Content and verifies
that the multi-agent PR conversation flow and the Merge_Gate still work, including a
deterministic unit tier (always run in CI) and a Self_Cleaning_Live_Test integration
tier that opens a real throwaway PR against the repository.

**Out of scope:** implementing Cubic itself (third-party GitHub App), changing the
single-account approval mechanism, and changing the required `E2E Tests (playwright)`
status check.

## Glossary

- **Cubic** — the third-party Cubic AI code review GitHub App. Runs server-side on
  GitHub, triggered by GitHub webhooks (PR opened/updated). Posts inline review
  comments and a summary comment on PRs. Its behavior is controlled by its own GitHub
  App configuration, not by Kiro.
- **Cubic_Finding** — an individual issue, suggestion, or observation posted by Cubic
  as a PR comment (inline or summary). A Cubic_Finding classified as blocking is
  denoted a **Cubic ❌ finding**.
- **Master_Agent** — the orchestrating Kiro agent defined in
  `.kiro/agents/master-agent/prompt.md`. Sole arbiter of review outcomes and sole
  owner of the merge gate. Posts human-like persona reviews (👔 with ✅/⚠️/❌).
- **Sub_Agent** — one of the specialized Kiro agents (`system-architect`,
  `frontend-dev`, `backend-dev`, `ui-designer`, `qa-agent`) that owns a defined set of
  file paths and responds to review feedback on its PR.
- **Owning_Agent** — the Sub_Agent whose ownership boundary contains the file(s) a
  given Cubic_Finding refers to.
- **Approval_Token** — the exact string `APPROVED-BY-MASTER-AGENT`, posted in a
  Master_Agent PR comment. The single machine-readable approval signal in this
  single-account repository.
- **Merge_Gate** — the single condition set that permits a merge, keyed off the
  presence of the Approval_Token in a Master_Agent comment plus the required CI check.
- **Waiver** — an explicit Master_Agent record, posted as a PR comment, that
  documents a decision NOT to act on a specific Cubic ❌ finding, including a reason.
- **GitHub_Power** — the GitHub integration path invoked through the `kiroPowers`
  tool. The single permitted path for all GitHub interactions in this workflow.
- **Review_Parser** — the skill at `.kiro/skills/pr-monitoring/review-parser-skill.js`
  that extracts structured feedback (❌/⚠️/✅) from PR review comments and routes it to
  the Owning_Agent.
- **Monitoring_System** — the existing turn-based PR-conversation-monitoring mechanism
  composed of the hooks in `.kiro/hooks/` and the skills in
  `.kiro/skills/pr-monitoring/`.
- **Required_Check** — the `E2E Tests (playwright)` GitHub status check enforced by the
  repository ruleset as a precondition for merge.
- **Workflow_Automation_Content** — the explicitly enumerated set of files that
  implement the agentic PR workflow automation, whose modification MUST trigger the
  Regression_Suite. The set includes at minimum: `.kiro/steering/git-workflow.md`;
  `.kiro/agents/**/prompt.md`; the hooks under `.kiro/hooks/**` (specifically
  monitor-pr-after-ready, handle-pr-feedback, stop-pr-monitoring, push-and-notify-pr,
  post-task-ci-review, write-ownership-guard, prompt-routing, agent-stop-autopush);
  and the skills under `.kiro/skills/pr-monitoring/**` (specifically
  `review-parser-skill.js`, `response-formatter-skill.js`, `pr-monitor-skill.js`,
  `github-api-wrapper-skill.js`, `approval-gate-skill.js`).
- **Regression_Suite** — the automated test-set that verifies the multi-agent PR
  conversation/comment flow and the Merge_Gate machinery are not broken by a change.
  It is composed of a deterministic Unit_Tier and a live Integration_Tier and is
  triggered by a path-filtered CI job (a GitHub Actions workflow) on PRs that modify
  Workflow_Automation_Content.
- **Unit_Tier** — the deterministic layer of the Regression_Suite. Exercises the
  skills' pure logic (for example `evaluateMergeGate`, Review_Parser classification
  including the Cubic author, the forbidden-self-approve guard, and response
  formatting) with mocked GitHub interactions and no live credentials, so it can run
  in CI unconditionally.
- **Integration_Tier** — the live layer of the Regression_Suite, implemented as a
  Self_Cleaning_Live_Test. It runs in the path-filtered workflow job and may be gated
  behind an environment flag or secret token.
- **Self_Cleaning_Live_Test** — a live integration test that creates a throwaway
  branch and a real PR against the repository (`coralst/valentin-romantic-agent`) using
  a `test/workflow-selftest-*` naming prefix, exercises the relevant automations and
  GitHub edge cases against that PR, and then removes all residue (closing/merging the
  throwaway PR and deleting the throwaway branch and any marker files) in a teardown
  step that runs even when assertions fail.
- **GitHub_Edge_Case** — a documented GitHub API behavior the Regression_Suite must
  assert against, such as self-`APPROVE` returning HTTP 422, squash merges being
  disallowed, or a required status check being in progress at merge time.

## Requirements

### Requirement 1 — Reviewer role separation and merge authority (Model A)

**User Story:** As the workflow owner, I want Cubic to act as an advisory first-pass
reviewer while the Master_Agent remains the sole arbiter and merge-gate owner, so that
adding an autonomous reviewer does not create competing sources of merge authority.

#### Acceptance Criteria

1. THE git-workflow steering document SHALL define Cubic as a first-pass, advisory
   reviewer whose findings are inputs to Master_Agent triage.
2. THE git-workflow steering document SHALL define the Master_Agent as the sole
   arbiter of review outcomes and the sole owner of the Merge_Gate.
3. WHERE Cubic posts findings on a PR, THE Master_Agent SHALL triage those findings
   before the PR is approved.
4. IF a Cubic ❌ finding is unresolved at the time of approval, THEN THE Master_Agent
   SHALL treat that finding as blocking unless a Waiver for that finding exists.
5. THE git-workflow steering document SHALL state that Cubic does not hold an
   independent merge gate and cannot approve, block, or merge a PR on its own
   authority.

### Requirement 2 — Preservation of the single-account approval token

**User Story:** As the workflow owner, I want the existing single-account approval
mechanism preserved unchanged, so that the Cubic integration does not break the
established merge gate.

#### Acceptance Criteria

1. THE Merge_Gate SHALL continue to key off the presence of the Approval_Token in a
   Master_Agent comment as the sole approval signal.
2. THE Cubic integration SHALL NOT introduce any alternative or additional approval
   signal that permits a merge.
3. WHERE Cubic posts an approving or summary comment, THE Monitoring_System SHALL NOT
   interpret that comment as an Approval_Token or as satisfaction of the Merge_Gate.
4. THE Master_Agent SHALL continue to express approval by posting the Approval_Token
   via the GitHub_Power `add_issue_comment` operation, and SHALL NOT use a formal
   GitHub `APPROVE` review event.

### Requirement 3 — Cubic finding ingestion via the GitHub API

**User Story:** As a Kiro agent, I want to read Cubic's findings through the GitHub
API, so that the workflow can act on Cubic's output given that Cubic cannot be invoked
directly by Kiro.

#### Acceptance Criteria

1. THE workflow SHALL obtain Cubic_Findings by reading PR comments and reviews through
   the GitHub_Power (for example `get_pull_request_comments` and
   `get_pull_request_reviews`).
2. THE workflow SHALL NOT assume any capability to invoke, trigger, or configure Cubic
   from within Kiro, a Kiro power, an MCP server, or a `.kiro` hook.
3. THE workflow SHALL identify Cubic_Findings by matching the Cubic GitHub App comment
   author against a documented, configurable author identity.
4. IF no comments from the Cubic author are present on a PR, THEN THE workflow SHALL
   proceed as though no Cubic_Findings exist and SHALL NOT block on Cubic output.
5. THE documentation SHALL record the Cubic author identity used for matching so the
   value can be updated when Cubic's configuration changes.

### Requirement 4 — Routing Cubic blocking findings to owning agents

**User Story:** As an Owning_Agent, I want Cubic's blocking findings routed to me
through the existing monitoring and response loop, so that I address Cubic ❌ items the
same way I address Master_Agent findings.

#### Acceptance Criteria

1. THE Review_Parser SHALL be extended to recognize the Cubic comment author in
   addition to the Master_Agent author.
2. WHEN the Review_Parser processes a Cubic comment, THE Review_Parser SHALL classify
   its content into blocking, suggestion, and positive categories using the existing
   severity scheme.
3. WHEN a Cubic ❌ finding is detected, THE Monitoring_System SHALL deliver the parsed
   finding to the Owning_Agent through the existing feedback-dispatch path.
4. WHEN an Owning_Agent receives a routed Cubic ❌ finding, THE Owning_Agent SHALL
   respond by applying a code fix or posting a documented explanation, using the same
   response path used for Master_Agent findings.
5. WHERE a Cubic_Finding cannot be attributed to a single Owning_Agent, THE workflow
   SHALL route the finding to the Master_Agent for triage and assignment.
6. THE extension of the Review_Parser SHALL preserve existing parsing behavior for
   Master_Agent comments.

### Requirement 5 — Noise and duplication control

**User Story:** As a reviewer reading a PR thread, I want Cubic and the Master_Agent
personas to avoid overlapping comments, so that the PR conversation stays readable and
free of duplicate findings.

#### Acceptance Criteria

1. THE git-workflow steering document SHALL define review-scope boundaries that assign
   security, bug, and performance classes to Cubic and assign architecture, ownership,
   and style classes to the Master_Agent personas.
2. WHEN the Master_Agent triages Cubic_Findings, THE Master_Agent SHALL consolidate
   and deduplicate findings that overlap with its own persona findings before posting
   its review.
3. WHERE a Cubic_Finding and a Master_Agent finding describe the same issue, THE
   Master_Agent SHALL represent the issue once rather than restating it.
4. THE documentation SHALL record the configured Cubic review scope so that Cubic
   complements rather than duplicates the persona reviews.

### Requirement 6 — Master-agent triage and waiver mechanism

**User Story:** As the Master_Agent, I want a defined triage and waiver mechanism for
Cubic findings, so that I can accept, route, or explicitly waive each finding with an
auditable reason.

#### Acceptance Criteria

1. THE master-agent prompt SHALL define a triage procedure for Cubic_Findings that
   classifies each finding as accepted-and-routed, resolved, or waived.
2. WHEN the Master_Agent waives a Cubic ❌ finding, THE Master_Agent SHALL post a
   Waiver as a PR comment via the GitHub_Power that identifies the finding and states
   the reason.
3. IF a Cubic ❌ finding is neither resolved nor waived, THEN THE Master_Agent SHALL
   withhold the Approval_Token.
4. THE Waiver SHALL be recorded in the PR conversation so that the triage decision is
   auditable.
5. WHERE the Master_Agent accepts a Cubic ❌ finding, THE Master_Agent SHALL ensure the
   finding is routed to the Owning_Agent for resolution.

### Requirement 7 — Phase 5 approval checklist update

**User Story:** As the Master_Agent gating a merge, I want the Phase 5 approval
checklist to include a Cubic item, so that I cannot approve a PR while Cubic findings
remain unaddressed.

#### Acceptance Criteria

1. THE git-workflow steering document SHALL add the checklist item "Cubic findings
   resolved or waived" to the Phase 5 approval checklist.
2. THE master-agent prompt SHALL include verification that all Cubic ❌ findings are
   resolved or waived as a precondition for posting the Approval_Token.
3. WHEN the Phase 5 checklist is evaluated and any Cubic ❌ finding is neither resolved
   nor waived, THE Master_Agent SHALL NOT post the Approval_Token.
4. THE added checklist item SHALL NOT remove or alter the existing Phase 5 conditions
   (CI passing, blocking issues resolved, QA sign-off, Approval_Token).

### Requirement 8 — Cubic GitHub App configuration and setup documentation

**User Story:** As the workflow owner, I want documented Cubic GitHub App setup and
configuration, so that Cubic's trigger timing, review scope, and author identity are
recorded even though Kiro cannot control them at runtime.

#### Acceptance Criteria

1. THE documentation SHALL describe the steps to install and configure the Cubic
   GitHub App on the repository.
2. THE documentation SHALL record that Cubic's trigger timing is controlled by Cubic's
   GitHub App configuration and SHALL state the configured trigger as an assumption of
   the workflow.
3. WHERE the workflow prefers a "Ready for Review"-aligned trigger to reduce noise from
   incremental micro-commits, THE documentation SHALL record that preference and the
   corresponding Cubic configuration used to approximate it.
4. THE documentation SHALL record the configured Cubic review scope (restricted to
   security, bug, and performance classes) as a configuration decision.
5. THE documentation SHALL record the Cubic comment author identity used by the
   Review_Parser to match Cubic_Findings.
6. THE documentation SHALL state that Cubic is a server-side GitHub App and that Kiro
   agents interact with Cubic only by reading its comments through the GitHub API.

### Requirement 9 — Preservation of existing workflow behavior

**User Story:** As the workflow owner, I want the existing CI gate, merge method, and
approval mechanism preserved, so that the Cubic integration adds a reviewer without
regressing the established process.

#### Acceptance Criteria

1. THE Merge_Gate SHALL continue to require the Required_Check to pass before merge.
2. THE merge operation SHALL continue to use the GitHub_Power `merge_pull_request`
   with `merge_method: "merge"`, and SHALL NOT introduce squash merges.
3. THE five-phase Issue→PR workflow defined in the git-workflow steering document SHALL
   continue to apply, with Cubic integration affecting only the Phase 3 review inputs
   and the Phase 5 approval checklist.
4. THE single-account approval mechanism SHALL remain unchanged except for the added
   triage, waiver, and checklist behavior defined in this document.
5. WHEN the Review_Parser extension is applied, THE existing Monitoring_System
   termination conditions (PR closed/merged, or Approval_Token detected) SHALL continue
   to apply unchanged.

### Requirement 10 — Trigger timing configuration decision

**User Story:** As the workflow owner, I want the Cubic trigger-timing decision
captured as a configuration requirement, so that the intended behavior is recorded
even though the actual trigger is enforced by Cubic's GitHub App.

#### Acceptance Criteria

1. THE documentation SHALL record the decision of when Cubic is intended to review
   (aligned to "Ready for Review" rather than every push) as the preferred
   configuration.
2. THE documentation SHALL state that the trigger is enforced by Cubic's GitHub App
   configuration and not by Kiro, and SHALL record this as an assumption.
3. WHERE Cubic reviews on every push regardless of the preference, THE Master_Agent
   triage procedure SHALL still consolidate findings at the "Ready for Review" stage so
   that incremental-commit noise does not reach the approval decision prematurely.

### Requirement 11 — Path-filtered regression suite triggered by workflow-automation changes

**User Story:** As the workflow owner, I want an automated Regression_Suite that runs
whenever a PR modifies Workflow_Automation_Content, so that future edits to the
automation — including this Cubic integration — cannot silently break the
review→approve→merge machinery.

#### Acceptance Criteria

1. THE Regression_Suite SHALL be implemented as a path-filtered CI job (a GitHub
   Actions workflow) that triggers on pull requests.
2. WHEN a pull request modifies any file in Workflow_Automation_Content, THE
   Regression_Suite SHALL run for that pull request.
3. WHERE a pull request modifies no file in Workflow_Automation_Content, THE
   Regression_Suite path-filtered job SHALL NOT be required to run.
4. THE Workflow_Automation_Content path set SHALL include, at minimum,
   `.kiro/steering/git-workflow.md`, `.kiro/agents/**/prompt.md`, `.kiro/hooks/**`, and
   `.kiro/skills/pr-monitoring/**`.
5. THE Regression_Suite SHALL verify that a change to Workflow_Automation_Content has
   not broken the multi-agent PR conversation/comment flow.
6. THE Regression_Suite SHALL verify that a change to Workflow_Automation_Content has
   not broken the Merge_Gate machinery.
7. THE Regression_Suite SHALL be organized into a deterministic Unit_Tier and a live
   Integration_Tier that are separately identifiable.

### Requirement 12 — Deterministic unit tier over skill logic and merge-gate behavior

**User Story:** As a CI maintainer, I want a deterministic Unit_Tier that validates the
pure logic of the PR-automation skills without live credentials, so that CI can gate
every change without depending on AWS or GitHub access.

#### Acceptance Criteria

1. THE Unit_Tier SHALL run under Vitest via `npm test -- --run` and SHALL reside under
   `.kiro/specs/*/__tests__/`.
2. THE Unit_Tier SHALL execute deterministically with GitHub interactions mocked and
   SHALL NOT require live AWS or GitHub credentials.
3. THE Unit_Tier SHALL assert that the conversation flow logic is preserved: an agent
   "Ready for Review" comment is recognized, Master_Agent and Cubic-authored findings
   are parsed by the Review_Parser and attributed to the Owning_Agent, and responses
   are formatted by `response-formatter-skill.js`.
4. WHEN the Approval_Token is absent from Master_Agent comments, THE Unit_Tier SHALL
   assert that `evaluateMergeGate` reports the PR as not mergeable.
5. WHEN the Approval_Token is present but the Required_Check is not green, THE
   Unit_Tier SHALL assert that `evaluateMergeGate` reports the PR as not mergeable.
6. WHEN the Approval_Token is present but a blocking issue is unresolved, THE Unit_Tier
   SHALL assert that `evaluateMergeGate` reports the PR as not mergeable.
7. WHEN a Cubic ❌ finding is unresolved and not waived, THE Unit_Tier SHALL assert
   that the Master_Agent withholds the Approval_Token so that the Merge_Gate stays
   closed.
8. WHEN a Cubic_Finding refers to a file that is not attributable to a single
   Owning_Agent, THE Unit_Tier SHALL assert that the Review_Parser routes the finding
   to the Master_Agent.
9. THE Unit_Tier SHALL assert that a formal self-`APPROVE` is treated as forbidden by
   the `isForbiddenSelfApproval` guard and that the Approval_Token comment path is used
   instead.
10. IF a comment author is not recognized as the Cubic author, THEN THE Unit_Tier SHALL
    assert that the associated findings are ignored without raising an error.
11. THE Unit_Tier SHALL preserve existing passing behavior for Master_Agent comment
    parsing.

### Requirement 13 — Self-cleaning live integration tier against a real PR

**User Story:** As the workflow owner, I want a live Integration_Tier that opens a real
throwaway PR and asserts the actual GitHub edge-case behaviors, so that the regression
guarantee reflects the real GitHub API and not only mocks — while leaving no residue in
the repository.

#### Acceptance Criteria

1. THE Integration_Tier SHALL be implemented as a Self_Cleaning_Live_Test that creates
   a throwaway branch and a real pull request against `coralst/valentin-romantic-agent`
   using a branch name with the `test/workflow-selftest-` prefix.
2. THE Self_Cleaning_Live_Test SHALL perform all GitHub interactions through the
   GitHub_Power.
3. THE Self_Cleaning_Live_Test SHALL exercise the conversation automations against its
   own throwaway PR, including posting a comment, parsing findings through the
   Review_Parser, and posting an Approval_Token comment.
4. WHEN the Self_Cleaning_Live_Test submits a `create_pull_request_review` with
   `event: APPROVE` on its own throwaway PR, THE Self_Cleaning_Live_Test SHALL assert
   that the call returns HTTP 422 and SHALL assert that the Approval_Token comment path
   is used instead.
5. WHEN the Self_Cleaning_Live_Test attempts a merge with `merge_method: "squash"`, THE
   Self_Cleaning_Live_Test SHALL assert that the response reports that squash merges are
   not allowed and SHALL assert that the merge uses `merge_method: "merge"`.
6. IF a merge attempt returns "Required status check ... is in progress", THEN THE
   Self_Cleaning_Live_Test SHALL wait and retry rather than failing the test.
7. THE Self_Cleaning_Live_Test SHALL restrict all mutating operations to its own
   throwaway PR and branch and SHALL NOT modify, approve, or merge any real feature PR.
8. WHEN the Self_Cleaning_Live_Test finishes, THE Self_Cleaning_Live_Test SHALL remove
   all residue by closing or merging its throwaway PR, deleting the throwaway branch,
   and deleting any marker files it created.
9. THE cleanup defined in acceptance criterion 8 SHALL run in a teardown step that
   executes even when assertions fail.
10. WHERE the environment flag or secret token that enables the Integration_Tier is
    absent, THE Regression_Suite SHALL skip the Integration_Tier while still running the
    Unit_Tier.
11. WHEN a throwaway PR is already closed or merged, THE Self_Cleaning_Live_Test SHALL
    stop monitoring and gating for that PR cleanly without raising an error.
12. WHILE more than one throwaway PR is open, THE Self_Cleaning_Live_Test SHALL scope
    its assertions to a single identified PR so that concurrent PRs do not interfere.
13. IF a GitHub API call fails with a rate-limit or transient error, THEN THE
    Self_Cleaning_Live_Test SHALL retry with backoff rather than crashing.
14. WHERE a throwaway PR is a draft, THE Self_Cleaning_Live_Test SHALL handle the draft
    state without raising an error.
15. WHEN a throwaway PR accumulates enough comments to span multiple API pages, THE
    Self_Cleaning_Live_Test SHALL page through all comments so that no Cubic_Finding is
    missed.
