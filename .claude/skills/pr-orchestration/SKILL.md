---
name: pr-orchestration
description: Use when driving this project's Issue-first / PR-second GitHub workflow end to end - creating the Issue, opening feature branches and draft PRs, delegating to specialist subagents, running the PR review conversation round by round, verifying CI, and gating the merge. Invoke for any multi-step feature larger than a single-file change, or when open PRs need a review turn advanced. Replaces Kiro's master-agent role.
---

# PR orchestration

Kiro ran this as a `master-agent` sub-agent that delegated via `invokeSubAgent`.
**Under Claude Code the main session is the orchestrator** — it already has the
Agent tool. Do not spawn a "master agent" subagent; that would nest an orchestrator
inside an orchestrator, and the nested one could not report turn-by-turn.

So: *you*, the main session, play this role. Read
`.kiro/agents/master-agent/prompt.md` for the full role definition, and
`.kiro/steering/git-workflow.md` for the five-phase workflow it references.

## Translation from Kiro

| Kiro | Claude Code |
|---|---|
| `invokeSubAgent(agent, body)` | Agent tool with `subagent_type: "<agent>"` |
| `#review-checklist` | `/review-checklist` |
| `route-turn-after-comment` hook | not ported — you advance turns yourself |
| `pre-merge-conversation-gate` hook | **not ported — the merge gate is unenforced** |
| `mcp-server-github` | the server is registered as `github` in `.mcp.json` |

Specialist subagents are registered in `.claude/agents/`: `system-architect`,
`frontend-dev`, `backend-dev`, `ui-designer`, `qa-agent`. Delegate with the Agent
tool, passing the PR number, the branch, the relevant contracts, the file scope
(see the ownership table in `CLAUDE.md`), test requirements, and acceptance
criteria. Launch several in one message when the work spans domains.

## The approval gate — read this before merging

This is a single-account repo, so GitHub **rejects self-approval**:
`create_pull_request_review` with `event: "APPROVE"` returns
`422 Can not approve your own pull request`. Never attempt it.

Approval is instead a comment containing the literal token
`APPROVED-BY-MASTER-AGENT`. That comment **is** the gate. Then merge with
`merge_method: "merge"` — squash is disabled on this repo.

⚠️ **In Kiro this gate was enforced by the `pre-merge-conversation-gate` hook. That
hook is not ported, so nothing mechanically prevents a merge without it.** Until it
is, check by hand — or run the gate logic yourself:

```bash
node .kiro/skills/pr-monitoring/approval-gate-skill.js '<state-json>'
# exit 0 = mergeable, 1 = blocked, 2 = bad JSON
```

## Non-negotiables from `git-workflow.md`

- **Never `git merge` locally.** All merges go through a GitHub PR.
- Never merge to `main` casually: `.github/workflows/deploy.yml` fires on push to
  `main`, and `scripts/deploy.sh` does `aws s3 sync … --delete`. Every merge
  redeploys and clobbers whatever else is live.
- Verify **all seven** CI jobs, not the four the steering file lists. Path-skipped
  jobs count as satisfied.
- Branch grammar `feat|fix|refactor|docs|chore/<domain>-<scope>`. Worktree branches
  are auto-named `agent-<hash>`; rename before opening the PR.
- `@agent-name` tags notify nobody here. They are routing labels, not mentions —
  never wait on one.
- You post the final message on the thread.
