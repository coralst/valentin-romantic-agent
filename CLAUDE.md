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
AWS_PROFILE=dev-devops-agent AWS_REGION=us-east-1 npx tsx src/server/dev-server.ts  # :3001
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

## Branching

Feature branches open a PR into `main`; when several branches have to be combined,
they are merged into an `integration/*` branch first and that branch opens the one
PR. There is no `integration/main-line` — an earlier draft of this file mandated
one, and no such branch was ever created.

```
feat/your-thing ──PR──> main            (single change)
feat/a, feat/b ──> integration/x ──PR──> main   (several at once)
```

- A PR whose base is not `main` gets `.github/workflows/fast-lane.yml`: lint + unit
  + build in parallel, **~2 minutes**, no e2e.
- The `fast-lane` label makes such a PR merge itself when green. **The label does
  not exist yet and should not be created until the rollback drill has passed** —
  self-merging PRs on an untested drill is how unverified work reaches the shared
  line.
- `main` still gets the full four gates (Lint · Unit · Build · E2E). Do not rename
  a job in `.github/workflows/ci.yml` — its job names are the ruleset's required
  contexts, and renaming one makes every PR to main unmergeable.

## The loop: verify locally, deploy deliberately

**Do not use a deploy to find out whether your change works.** A full
`scripts/deploy.sh` is ~7 minutes; `npm run verify:local` is ~15 seconds and produces the same
screenshots. Deploying was how defects used to get found, which is why a one-line UI fix cost
20+ minutes.

```bash
npm run verify:local            # boots/reuses local servers, runs rehearsal.mjs, writes screenshots
```

Screenshots land in `screenshots/verify/`. Attach them to your PR — that, not a deploy log, is
what a reviewer looks at.

Only deploy once the change is verified locally, and **match the scope to what you changed**:

| You changed | Command | Cost |
|---|---|---|
| Frontend only (`src/client/**`, styles, assets) | `npm run deploy:frontend` | **~45s** |
| Backend (`src/server/**`, Dockerfile) | `npm run deploy:backend` | ~5 min |
| CDK / infra | `bash scripts/deploy.sh dev --scope=infra` | varies |
| Genuinely everything, or you're unsure | `npm run deploy:dev` | ~7 min |

`--scope=all` is still the default for a bare `scripts/deploy.sh`, so nothing breaks if you
forget — you just pay for it. `cdk deploy --all` walks 7 stacks, 6 of which are ~16s no-ops,
and the Compute stack is a multi-minute ECS rolling deploy. A CSS change needs none of that.

**Batch your deploys.** If you have three fixes in flight, verify all three locally, then
deploy once. Each deploy is also a window in which `s3 sync --delete` can clobber another
agent's frontend, so fewer deploys is safer as well as faster.


## Rolling back

If something is wrong in dev, restore the last verified-good release:

```bash
bash scripts/rollback.sh --list      # what's recorded
bash scripts/rollback.sh --dry-run   # what it would do
bash scripts/rollback.sh             # do it (~3 min)
```

This rolls back backend **and** frontend together from one manifest entry, because rolling back
one layer alone risks a frontend/backend contract mismatch. It restores the *running system*
only; git history is untouched, and the script prints the `git revert -m 1 <merge-sha>` line if
you also want to revert the code.

**Commit before you deploy.** A dirty worktree tags the image `<sha>-dirty`, which cannot be
reconstructed from any commit — so `deploy.sh` refuses to record it as a rollback target, and
you lose the ability to return to it.
