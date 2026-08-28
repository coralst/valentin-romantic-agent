# Contributing

This repository has an unusual contribution model: **most of the code here was
written by AI agents**, not by humans typing directly into files. Before you
change anything, read [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) — it explains
the six-agent workflow, the ownership boundaries, and the merge gate.

## The short version

1. **Open an issue first.** Work starts at Phase 1 (SPEC), not at Phase 3 (BUILD).
   Use the [feature request template](.github/ISSUE_TEMPLATE/feature-request.yml).
2. **Pick your lane.** Every agent owns a disjoint slice of the tree and has an
   explicit *"Do NOT modify"* list. Stay inside it.
3. **Branch with an agent prefix.** `<type>/<agent>-<feature>` — e.g.
   `feat/backend-demo-seed`, `fix/frontend-scroll-anchor`.
4. **Apply the matching `agent: *` label** to your PR.
5. **Push incrementally.** Small, readable commits that tell a story — not one
   squashed dump.
6. **Let the master close the thread.** Sub-agents reply and tag
   `@master-agent`; they never approve or merge their own PR.

## Ownership boundaries

This table is the prose half of a contract. The machine-readable half is the
`OWNERSHIP` list in
[`.kiro/skills/pr-monitoring/review-parser-skill.js`](.kiro/skills/pr-monitoring/review-parser-skill.js),
and a [drift test](.kiro/specs/pr-conversation-monitoring/__tests__/ownership.test.ts)
asserts the two agree. **Change both, in the same PR** — the test fails otherwise.

<!-- OWNERSHIP-TABLE:START — parsed by the ownership drift test. Keep the `Paths`
     column as a comma-separated list of backticked prefixes. -->

| Agent | Label | Paths | Must not touch |
|---|---|---|---|
| 🏗️ System Architect | `agent: architect` | `src/shared/` | `src/client/`, `src/server/` |
| ⚛️ Frontend Dev | `agent: frontend` | `src/client/components/`, `src/client/auth/`, `src/client/hooks/`, `src/client/context/`, `src/client/utils/`, `src/client/demo/`, `src/client/App.tsx`, `src/client/main.tsx`, `src/client/vite-env.d.ts` | `src/shared/`, `src/client/design-system/`, `src/server/` |
| 🔧 Backend Dev | `agent: backend` | `src/server/` | `src/client/`, `src/shared/` |
| 🎨 UI Designer | `agent: design` | `src/client/design-system/`, `docs/design/` | component logic, `src/server/`, shared types |
| 🧪 QA Agent | `agent: qa` | `e2e/`, `playwright.config.ts`, `src/test-setup.ts`, `rehearsal.mjs` | all of `src/` |
| ⚙️ Infra / Workflow | `agent: infra` | `.github/`, `.kiro/`, `.claude/`, `.mcp.json`, `scripts/`, `infra/`, `public/`, `index.html`, `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`, `Dockerfile`, `.dockerignore`, `.gitignore`, `.env.example`, `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `docs/` | all of `src/` |

<!-- OWNERSHIP-TABLE:END -->

Two notes on the boundaries that are easy to get wrong:

- **`docs/` splits.** `docs/design/` is the UI Designer's. Everything else under
  `docs/` documents the workflow and belongs to Infra. The ownership list is
  scanned most-specific-first, so the `docs/design/` rule wins over `docs/`.
- **`index.html` and `public/` are Infra, not Frontend.** They change when the
  build or the deploy target changes, not when a feature does.

The **Infra / Workflow** lane was added late: it had been carrying 51% of PRs
(29 of 57) with no row in this table at all, because everything outside `src/`
attributed to nobody and fell through to `agent: infra` by default. If a path
still attributes to nobody, that is now a **CI failure**, not a shrug — see the
scope check below.

If your change needs something outside your boundary, **say so in the PR and name
the agent who should own it.** Do not reach across — disjoint ownership is what
makes parallel agent work safe.

Some changes genuinely span two lanes — a shared-type change plus the server
fixture that exercises it, for instance. Apply **both** `agent: *` labels; the
scope check passes when the union of your labels covers every changed path.

## Local checks before you push

```bash
npm run lint          # tsc --noEmit
npm test              # Vitest, single run
npx playwright test   # E2E — needs the dev server running
```

CI enforces four gates: **Lint · Unit · Build · E2E**. There's also a
[workflow-automation regression suite](.github/workflows/workflow-automation-regression.yml)
covering the agent workflow itself — if you touch anything under
`.kiro/skills/` or `.kiro/hooks/`, expect it to run.

### The scope check

A **Scope Check** job compares your PR's changed paths against its `agent: *`
labels using the same `attributeOwner()` map as the table above, and fails when
they disagree. It runs on every PR (never path-skipped — a skipped required check
counts as unsatisfied here). Three ways to fail it:

- **A path belongs to a lane you're not labelled for.** Add that label, or split
  the PR.
- **No `agent: *` label at all.** Apply one.
- **A path it can't attribute to anyone.** This means a genuinely new top-level
  surface appeared: add a row to `OWNERSHIP` *and* to the table above.

Spanning two lanes is legitimate — apply **both** labels and it passes on union
coverage. A label matching no file in the diff is a note, not a failure.

## Commit and branch conventions

Conventional Commits, with the scope naming the agent's domain:

```
feat(backend): add seedSession and resetSession HTTP handlers
fix(frontend): keep scroll anchored when a preference card animates in
test(qa): cover the 500-error path in onboarding
docs(infra): document the orchestrator-led PR review loop
```

Full detail in [`.kiro/steering/git-workflow.md`](.kiro/steering/git-workflow.md)
and [`.kiro/steering/project-conventions.md`](.kiro/steering/project-conventions.md).

## Review standards

The [review checklist](.kiro/steering/review-checklist.md) is what the master
agent applies. Severity language used throughout:

- 🔴 **Red** — blocking. Must be resolved before merge.
- 🟡 **Yellow** — should fix, but may be deferred with a documented
  `TODO(yellow)` linking a follow-up issue.
- 🟢 **Green** — cosmetic or optional.

### Write reviews like a person

The agent prompts explicitly rule out `✅/❌` scoreboards and boilerplate
footers. Reviews and replies should be prose that names actual files, commits,
and trade-offs — **including respectful pushback when you disagree with the
review.** Each prompt in [`.kiro/agents/`](.kiro/agents/) carries a worked voice
exemplar showing the bar.

## Modifying the workflow itself

The methodology is code, and it's tested. If you change the review loop, the turn
router, or the hooks:

- `turn-router-skill.js` and its siblings are **pure and offline** — keep them
  that way. Routing and merge decisions must stay deterministic and unit-testable
  rather than delegated to a model.
- Update [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) in the same PR, including
  the [honest scope](docs/METHODOLOGY.md#honest-scope) section if the change moves
  something from "convention" to "wired up" (or the reverse).
