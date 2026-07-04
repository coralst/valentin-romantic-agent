---
inclusion: always
---

# Git Workflow

These rules govern how all agents interact with Git and GitHub.

## CRITICAL RULE: Issue-First, PR-Second Flow

**NEVER merge locally with `git merge`.** All merges happen through GitHub PRs.
**Use GitHub via MCP server** for all GitHub API interactions (issues, PRs, comments, merges).

### Phase 1: Planning (GitHub Issue)

High-level design happens in the Issue thread. No code is written yet.

1. **Master-agent** creates a GitHub Issue with: feature description, agent assignments, acceptance criteria, test requirements
2. **System-architect** replies in the Issue thread with a proposed technical specification (libraries, patterns, data schema, contracts)
3. **Master-agent** reviews the spec in the Issue, gives the green light or requests changes
4. Planning discussion stays in the Issue until the spec is approved

### Phase 2: Handoff (Branch + Draft PR)

Once the spec is approved, master-agent shifts the team from planning to building.

5. **Master-agent** creates feature branches from main and opens Draft PRs for each agent
6. Each PR includes `Resolves #<issue-number>` to link back to the planning Issue
7. The Issue thread is now closed for planning — all further discussion moves to the PR

### Phase 3: Build & Review (Pull Request)

The PR is the "room" where coding and code review happen.

8. **Agents** work on their branches, pushing micro-commits incrementally
9. **Agents** comment "Ready for Review" on their PR when done
10. **Master-agent** (and other reviewing agents) post line-specific review comments on the PR diff
11. **QA-agent** runs E2E tests against the branch and posts results on the PR
12. Agents push fixes until all ❌ blocking issues are resolved

### Phase 4: CI/CD Validation

13. CI pipeline runs on every push: lint → test → build
14. Reviewers check that CI shows a green checkmark before approving

### Phase 5: Resolution

15. **Master-agent** merges the PR via GitHub API (`merge_method: "merge"` — this
    repo has squash merges disabled) once:
    - CI passes (the `E2E Tests (playwright)` status check is enforced by a repo ruleset)
    - Master-agent has posted an **approval comment** carrying the token
      `APPROVED-BY-MASTER-AGENT` (see "Approval in a single-account repo" below)
    - All ❌ blocking issues are resolved
    - QA-agent has signed off (for user-facing changes)
16. Merging the PR auto-closes the linked Issue via `Resolves #N`
17. Delete the feature branch after merge

#### Approval in a single-account repo

Every agent in this system acts under the **same GitHub account** (the repo
owner). GitHub forbids a PR author from submitting a formal `APPROVE` review on
their own PR — that API call returns `422 Can not approve your own pull request`.
Waiting for a formal approval that can never arrive is what stalls the merge.

To stay within GitHub's rules **without a second account**, approval is expressed
as an explicit **approval comment** rather than GitHub's formal approve event:

- The master-agent posts a normal PR comment (allowed on your own PR) containing
  the machine-readable token `APPROVED-BY-MASTER-AGENT` once CI is green, all ❌
  blocking issues are resolved, and QA has signed off.
- This comment IS the approval gate. The merge step checks for the presence of
  the token in a master-agent comment — not GitHub's approval count.
- The master-agent then merges via `merge_pull_request`. This repo's ruleset does
  NOT require a formal approval, so a self-merge is allowed — but it DOES require
  the `E2E Tests (playwright)` status check to pass first. If the merge call
  returns `Required status check ... is in progress`, wait for CI to finish and
  retry; this is expected, not an error.

A comment-only review (`create_pull_request_review` with `event: "COMMENT"`) is
also permitted on your own PR and may be used for the line-specific review; only
`event: "APPROVE"` is blocked. Never use `event: "APPROVE"` on your own PR — it
will fail. Use the approval-comment token instead.

## Branch Strategy (Trunk-Based Development)

- `main` is the trunk — always deployable
- Feature branches are short-lived: `feat/<domain>-<feature>`
- One branch per agent per feature — no two agents on the same branch
- Branches live max 1-2 days before merging to trunk
- Delete branches after merge

## Branch Naming

```
feat/<domain>-<feature>     — new feature work
fix/<domain>-<issue>        — bug fixes
refactor/<domain>-<scope>   — refactoring (no behavior change)
docs/<scope>                — documentation only
chore/<scope>               — tooling, config, dependencies
```

Domains: `frontend`, `backend`, `design`, `arch`, `infra`, `qa`

## Commit Convention (Conventional Commits)

Format: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `style`
Scopes: `frontend`, `backend`, `design`, `arch`, `shared`, `qa`

**Push frequently** — after each logical unit of work, not one big commit at the end. This makes the PR diff readable and the commit history useful.

## Pull Request Rules

### Creating PRs (master-agent responsibility)

Create Draft PRs via GitHub API AFTER the spec is approved in the Issue. PR description must include:

```markdown
## Summary
[What this PR does]

## Agent
[Which agent owns this PR]

## Quality Signal
🟡 Yellow — In Progress

## Test Requirements
- [ ] [Specific test 1 that must be written]
- [ ] [Specific test 2 that must be written]
- [ ] [Specific test 3 that must be written]

## Acceptance Criteria
- [ ] [Criterion 1]
- [ ] [Criterion 2]

## Related
- Resolves #[issue-number]
- ADR: [link if applicable]
```

### PR Review Comments (human-like conversation)

Reviews must feel like a real team conversation. Use line-specific comments on the PR diff when reviewing code. Format:

```
**[emoji] [Agent Name]** — Code Review

[Conversational opening — acknowledge the work]

✅ [What looks good]
✅ [What looks good]
⚠️ [Suggestion — not blocking]
❌ [Blocking issue — must fix]

Overall: [🟢/🟡/🔴] [verdict]
```

Agent personas:
- 👔 **Master Agent** — big-picture, integration-focused
- 🏗️ **System Architect** — contracts, patterns, boundaries
- ⚛️ **Frontend Dev** — UX, accessibility, components
- 🔧 **Backend Dev** — security, performance, data integrity
- 🎨 **UI Designer** — visual consistency, tokens, accessibility
- 🧪 **QA Agent** — E2E coverage, browser testing, user flows

### Merging PRs

- Merge via GitHub API only (`merge_method: "merge"` — squash merges are disabled
  on this repo; a squash attempt returns "Squash merges are not allowed")
- CI must pass before merge (the `E2E Tests (playwright)` check is required by a ruleset)
- Master-agent has posted an approval comment containing `APPROVED-BY-MASTER-AGENT`
  (see "Approval in a single-account repo" in Phase 5 — never use a formal
  `APPROVE` review on your own PR)
- All ❌ blocking issues must be resolved
- QA-agent sign-off required for user-facing changes
- PR description quality signal updated to final state before merge

#### Master-agent approval comment format

```
**👔 Master Agent** — Review Complete

✅ CI green
✅ All ❌ blocking issues resolved
✅ QA signed off (for user-facing changes)

APPROVED-BY-MASTER-AGENT 🟢 — merging.
```

## CI/CD Pipeline

Every push to a feature branch triggers:

```
1. npm run lint          — TypeScript type checking (tsc --noEmit)
2. npm test -- --run     — Run all tests (single execution, no watch)
3. npm run build         — Verify production build succeeds
```

**CI must pass before any PR can be merged.** If CI fails:
- Master-agent posts a comment on the PR explaining the failure
- The owning agent must fix and push again
- CI re-runs automatically on the new push

## GitHub Tooling

All GitHub interactions (issues, PRs, comments, reviews, merges) MUST use the **GitHub MCP server** (`mcp-server-github`).
Ensure the `GITHUB_TOKEN` environment variable is set for authentication.
