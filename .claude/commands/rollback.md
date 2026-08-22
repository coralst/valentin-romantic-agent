---
description: Roll the running dev deployment back to the last verified-good release
allowed-tools: Bash(bash scripts/rollback.sh:*), Bash(npm run rollback:*), Bash(aws ecs describe-services:*), Bash(aws s3 ls:*), Bash(curl:*), Read
argument-hint: "[--to <tag>] [--list] [--dry-run]"
---

Roll back the Valentin dev deployment.

1. Run `bash scripts/rollback.sh dev $ARGUMENTS --dry-run` first and show the user exactly which
   release it selected: image tag, timestamp, and what's running now.
2. Unless the user already said to just do it, confirm that target with them.
3. Run it for real. Report the ECS stabilisation and the CloudFront invalidation as they
   complete — the whole thing is ~3 minutes and is bound by ECS draining.
4. Verify: report the `/api/health` result the script prints, and give the user the website URL.
5. Offer, but do not run, the git revert. The script prints the exact
   `git revert -m 1 <merge-sha>` line. Note that reverting `main` is a PR that has to clear the
   full four CI gates, and that it does not gate the AWS rollback that already landed.

Constraints:
- This script only handles **dev**. Do not try to make it touch staging or prod.
- If it refuses (dirty target tag, image missing from ECR, target digest identical to current),
  relay the reason rather than working around it — each refusal is protecting against a
  rollback that would not actually roll anything back.
