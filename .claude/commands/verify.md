---
description: Verify the app locally with screenshots — the fast alternative to deploying
allowed-tools: Bash(npm run verify:local:*), Bash(bash scripts/verify-local.sh:*), Bash(node rehearsal.mjs:*), Read, Glob
argument-hint: "[runLabel]"
---

Verify the current change against a local server, no deploy.

1. Run `npm run verify:local $ARGUMENTS`. It reuses dev servers that are already up and boots
   only what's missing.
2. Read the PASS/FAIL lines and report them. If anything FAILED, fix it and re-run — this is a
   ~15s loop, so iterate here rather than deploying.
3. Point the user at the screenshots in `screenshots/verify/` and describe what they show.
4. If the run fails because the local backend isn't wired to the dev AWS account, retry with
   `--no-live-resources` and say that you skipped the two live-resource assertions.

Do NOT deploy to check whether something works. Deploy only after this passes.
