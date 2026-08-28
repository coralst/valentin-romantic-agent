#!/usr/bin/env bash
# PreToolUse guard for the fast-feedback workflow (see CLAUDE.md).
#
# Blocks two habits that make the user's feedback loop slow:
#   1. a full-scope deploy that was almost certainly meant to be scoped
#   2. a feature-branch PR opened straight against main
#
# Exit 0 = allow, exit 2 = block and show stderr to the agent.
#
# FAILS OPEN on purpose. This runs before every Bash call, so a bug here would
# wedge all tool use; anything unexpected exits 0 and allows the command.
set -uo pipefail

payload="$(cat 2>/dev/null || true)"
[[ -z "$payload" ]] && exit 0

command_line="$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("tool_input", {}).get("command", ""))
except Exception:
    pass
' 2>/dev/null || true)"
[[ -z "$command_line" ]] && exit 0

# --- 1. Unscoped deploy -----------------------------------------------------
# Allow anything that states a scope (including --scope=all), the npm wrappers
# that already carry one, --dry-run, and --help.
if printf '%s' "$command_line" | grep -Eq '(scripts/deploy\.sh|npm run deploy:dev)' \
  && ! printf '%s' "$command_line" | grep -Eq -- '--scope=|--dry-run|--help|-h\b'; then
  cat >&2 <<'MSG'
BLOCKED: unscoped deploy.

A full deploy is ~7 minutes: `cdk deploy --all` walks 7 stacks (6 of them ~16s
no-ops) plus a multi-minute ECS rolling deploy. Most changes need none of that.

First, verify without deploying at all — this is the fast loop:
    npm run verify:local          # ~15s, screenshots in screenshots/verify/

Then deploy only what you changed:
    npm run deploy:frontend                      # ~45s, frontend only
    npm run deploy:backend                       # ~5min, image + Compute stack
    bash scripts/deploy.sh dev --scope=infra     # CDK only

If you genuinely need everything, say so explicitly:
    bash scripts/deploy.sh dev --scope=all

See CLAUDE.md.
MSG
  exit 2
fi

# --- 2. Feature-branch PR straight into main --------------------------------
if printf '%s' "$command_line" | grep -Eq 'gh pr create' \
  && printf '%s' "$command_line" | grep -Eq -- '--base[= ]+main\b'; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
  if [[ "$branch" =~ ^(feat|fix|refactor|test|style|chore|docs)/ ]]; then
    cat >&2 <<MSG
BLOCKED: '$branch' should not open a PR directly against main.

A PR to main runs the full four gates (Lint, Unit, Build, E2E) — 7-9 minutes —
and waits on human review, which makes the user the bottleneck on every small fix.

Open it against the shared integration line instead:
    gh pr create --base integration/main-line ...

That gets the fast lane (lint + unit + build in parallel, ~2 min) and can merge
itself when green if you add the 'fast-lane' label. A single
integration/main-line -> main PR carries the whole batch through the full gates
for the user to review.

See CLAUDE.md.
MSG
    exit 2
  fi
fi

exit 0
