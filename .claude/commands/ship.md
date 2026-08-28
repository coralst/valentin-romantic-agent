---
description: Verify, push, and open a stacked PR into the integration branch with screenshots
allowed-tools: Bash(npm run verify:local:*), Bash(git:*), Bash(gh pr:*), Bash(gh api:*), Read, Glob
argument-hint: "[pr title]"
---

Ship the current change as a stacked PR. The point is that the user sees screenshots within
~2 minutes, not a deploy log after 25.

1. **Verify locally first.** Run `npm run verify:local`. If anything FAILS, stop and fix it —
   do not open the PR.
2. **Commit** anything outstanding, following the repo's Conventional Commits style with a
   domain scope (`feat(frontend): ...`, `fix(inspector): ...`). Lowercase, imperative,
   prose-y subject lines.
3. **Push** the branch.
4. **Open the PR with `--base integration/main-line`**, not `main`. Create the base branch off
   main if it doesn't exist yet. Title from $ARGUMENTS if given.
5. **Post one comment** containing everything the user needs, in this order:
   - what changed, in a sentence or two
   - the screenshots from `screenshots/verify/`
   - the local URL (http://localhost:5173) if a server is still up
   - the deployed URL, only if you actually deployed
   - a copy-pasteable rollback line: `bash scripts/rollback.sh`
6. **Add the `fast-lane` label** so it self-merges when green — unless the change is visually
   significant or you are unsure, in which case leave the label off and say you want the user's
   eyes on it.
7. Report the PR URL.

Never open a PR directly against `main` from a feature branch — that queues on the full 7-9
minute gate set and makes the user the bottleneck. The single `integration/main-line → main` PR
is the one that gets human review.
