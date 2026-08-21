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

| Agent | Owns | Must not touch |
|---|---|---|
| 🏗️ System Architect | `src/shared/` | `src/client/`, `src/server/` |
| ⚛️ Frontend Dev | `src/client/{components,hooks,context}`, `App.tsx`, `main.tsx` | `src/shared/`, `src/client/design-system/`, `src/server/` |
| 🔧 Backend Dev | `src/server/{api,agent,extraction,persistence}`, entry points | `src/client/`, `src/shared/` |
| 🎨 UI Designer | `src/client/design-system/`, `docs/design/` | component logic, `src/server/`, shared types |
| 🧪 QA Agent | `e2e/`, `playwright.config.ts` | all of `src/` |

If your change needs something outside your boundary, **say so in the PR and name
the agent who should own it.** Do not reach across — disjoint ownership is what
makes parallel agent work safe.

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
