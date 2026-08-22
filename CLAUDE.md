# Valentin — working agreement for agents

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

## Branching: stack your PRs, don't queue on main

Agents open PRs into the shared integration line **`integration/main-line`**, not `main`.

```
feat/your-thing ──PR──> integration/main-line ──one PR──> main (human review)
```

- A PR into `integration/main-line` gets `.github/workflows/fast-lane.yml`: lint + unit +
  build in parallel, **~2 minutes**, no e2e.
- Add the **`fast-lane` label** to have it merge itself when green. Omit the label when you
  want human eyes on it.
- `main` still gets the full four gates (Lint · Unit · Build · E2E) on the single
  `integration/main-line → main` PR. Do not change `.github/workflows/ci.yml` — its job names
  are the ruleset's required contexts, and renaming one makes every PR to main unmergeable.
- Never `git merge` locally to move work between branches; it produces merge commits that
  didn't go through review.

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

## Verification commands

```bash
npm run lint          # tsc --noEmit (there is no ESLint in this repo)
npm test              # vitest
npm run verify:local  # the full local rehearsal + screenshots
npm run test:infra    # CDK assertions, run from infra/
```

Note `npm test` also picks up the `.kiro/**` workflow-automation suites, because
`vite.config.ts`'s `test.exclude` does not exclude them. Scope to `npx vitest --run src/` when
you only care about app tests.

## Ports

One assumption each, please: **frontend 5173, backend 3001.** The backend needs real AWS
credentials for Bedrock, so local development is local but not offline.
