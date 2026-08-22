# Valentin — Claude Code project instructions

React client (`src/client`), Express + Bedrock server (`src/server`), shared
contracts (`src/shared`), Playwright E2E (`e2e`), CDK infra (`infra`).

## Project rules

This repo's conventions live in `.kiro/steering/` and are shared with Kiro.
**Edit them there — never duplicate them here.** The two files below are
`inclusion: always` in Kiro and are imported so Claude Code sessions are bound by
the same rules:

@.kiro/steering/project-conventions.md
@.kiro/steering/git-workflow.md

Two steering files are deliberately **not** imported:

- `architecture.md` is `inclusion: fileMatch` (only when touching `src/**`). Its
  ownership table is reproduced below; read the file directly for the full tree.
- `testing.md` is stale (see Corrections). Use the testing rules below instead.
- `review-checklist.md` is `inclusion: manual`; run `/review-checklist`.

## Corrections to the imported steering — these win

The steering files predate a directory restructure. Where they conflict with
this section, **this section is correct.** (Fixing them upstream is tracked as a
follow-up; until then, do not trust the paths or command lines in them.)

- **Test command is `npm test`.** The `test` script is already `vitest --run`, so
  the steering's `npm test -- --run` passes `--run` twice. CI runs plain `npm test`.
- **Real paths.** Contracts are `src/shared/interfaces/` — *not* `src/shared/types/`.
  These do **not** exist and appear only in stale docs: `src/components/`,
  `src/hooks/`, `src/api/`, `src/services/`, `src/design-system/`, `src/styles/`,
  `src/shared/utils/`.
- **E2E is chromium-only.** `playwright.config.ts` defines one project
  (`chromium`) and CI installs only chromium. Ignore any Firefox/WebKit
  requirement — it cannot pass.
- **Four checks are ruleset-*required*** — `Lint (tsc --noEmit)`,
  `Unit Tests (vitest)`, `Build (vite)`, `E2E Tests (playwright)` — and the steering
  file is correct to say so. `ci.yml` runs seven jobs; the other three
  (`Infra Tests`, `Smoke Test`, `Workflow Automation Regression`) are informative but
  still must be green before you merge. Note *why* `Build`/`E2E` always run: this
  repo's ruleset treats a **skipped** required check as unsatisfied, so those jobs run
  unconditionally with step-level path guards and report green via a no-op step (see
  `ci.yml` lines 18–36). A required check that is *pending* means wait, not skip.
- **Import aliases already exist** in `tsconfig.json`: `@shared/*`, `@client/*`,
  `@server/*`. Use them; don't invent new ones.
- **`invokeSubAgent` does not exist** in Claude Code — use the Agent tool. Likewise
  `#review-checklist` is Kiro syntax; use `/review-checklist`.
- **`@backend-dev`-style GitHub tags notify nobody.** This is a single-account repo;
  they are routing labels rendered as plain text, not real users.

## Commands

| Task | Command |
|---|---|
| Unit tests | `npm test` |
| Lint / typecheck | `npm run lint` |
| Build | `npm run build` |
| Infra tests | `npm run test:infra` |
| Smoke test | `npm run smoke-test` |
| E2E | `npx playwright test` (chromium only) |

Local dev — Bedrock **requires** the `dev-devops-agent` profile; the default
identity lacks `bedrock:InvokeModel` and the agent silently returns an error
fallback:

```bash
AWS_PROFILE=dev-devops-agent AWS_REGION=us-west-2 npx tsx src/server/dev-server.ts  # :3001
npx vite                                                                            # :5173
```

## File ownership

Agents must not modify files outside their domain. (Reproduced from
`.kiro/steering/architecture.md`; corrects the stale paths in
`.kiro/agents/ui-designer/prompt.md`.)

| Owner | Owns |
|---|---|
| `system-architect` | `src/shared/` |
| `frontend-dev` | `src/client/components/`, `hooks/`, `context/`, `App.tsx`, `main.tsx` |
| `backend-dev` | `src/server/api/`, `agent/`, `extraction/`, `persistence/`, `index.ts`, `dev-server.ts` |
| `ui-designer` | `src/client/design-system/` |
| `qa-agent` | `e2e/`, `playwright.config.ts` |

Owned by nobody yet — claim explicitly in the PR before editing:
`src/client/utils/`, `src/server/telemetry/`, `src/server/fixtures/`,
`src/server/__tests__/`, `src/shared/__tests__/`.

Specialist subagents are in `.claude/agents/`. The PR orchestration workflow that
Kiro ran as `master-agent` is the **main session's** job here — see the
`pr-orchestration` skill.

## Operational notes (Claude Code specific)

- **`scripts/deploy.sh` clobbers parallel work.** It rebuilds the Docker image and
  runs `aws s3 sync dist/ … --delete`, overwriting whatever else is deployed. For
  infra-only changes run `cdk deploy` directly. Never run it to get an E2E
  environment.
- **One worktree per feature**, under `.claude/worktrees/`. Never point two
  sessions at the same directory — they fight over the branch and index silently.
- **Ports 3001 and 5173 are fixed** in `playwright.config.ts`. Concurrent E2E runs
  across worktrees collide on them and on `test-results/`. Serialize, or change
  ports for the run.
- Worktree branches are auto-named `agent-<hash>`, which violates the
  `feat/<domain>-<feature>` grammar. Rename before opening a PR:
  `git branch -m feat/<domain>-<feature>`.
- **MCP comes from `.mcp.json`, a symlink to `.kiro/settings/mcp.json`** — servers
  `github` and `playwright`. Editing either edits both. `.claude/settings.json`
  pre-approves them via `enabledMcpjsonServers` so sessions don't start with MCP
  silently absent pending an interactive trust prompt. The file's Kiro-only
  `disabled` and `autoApprove` keys are tolerated but **`autoApprove` is not
  honored by Claude Code** — expect permission prompts where Kiro auto-approved.
  The `github` server reads `GITHUB_PERSONAL_ACCESS_TOKEN`; if that is unset it
  registers but fails to authenticate, so prefer the `gh` CLI, which works today.
