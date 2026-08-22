---
description: Run the project's 9-section PR review checklist against a PR or the current diff
argument-hint: "[PR number, or blank for the working diff]"
---

Read `.kiro/steering/review-checklist.md` — it is the project's review gate and is
`inclusion: manual`, so it is never auto-loaded. This command is the Claude Code
replacement for Kiro's `#review-checklist` syntax.

Target: **$ARGUMENTS** (if blank, review the uncommitted working diff).

Work through all nine sections of that file. Apply these corrections to it — the
checklist is partly stale and some boxes cannot honestly pass as written:

- **Shared types live in `src/shared/interfaces/`.** The checklist says
  `src/shared/types/`, which does not exist.
- **Cross-browser (Chromium/Firefox/WebKit) is not achievable** — the config is
  chromium-only. Skip that box rather than failing it.
- **The CI command is `npm test`**, not `npm test -- --run`.
- **There are seven gating CI jobs**, not three: `Lint (tsc --noEmit)`,
  `Unit Tests (vitest)`, `Infra Tests (cdk assertions)`, `Smoke Test (server boot)`,
  `Workflow Automation Regression (unit tier)`, `Build (vite)`,
  `E2E Tests (playwright)`. Path-skipped jobs count as satisfied.
- **"Branch name follows convention"** fails automatically for worktree-generated
  names like `agent-<hash>`. Flag it as a rename-before-merge, not a blocker.
- **File-ownership boundaries** are in `CLAUDE.md`; use that table, not the stale
  paths in `.kiro/agents/ui-designer/prompt.md`.

Report findings as prose, grouped by severity, ending with an overall 🟢/🟡/🔴
signal. Do not emit a fill-in-the-blank scoreboard — `git-workflow`'s style note
asks for natural prose.

Be specific: cite `file:line` for every issue so it is clickable.
