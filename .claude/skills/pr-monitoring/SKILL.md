---
name: pr-monitoring
description: Use when you need to poll a GitHub PR for new reviews or comments, parse review bodies into blocking/suggestion/positive buckets, decide who should speak next in a multi-agent PR thread, evaluate whether a PR may merge, or format an agent reply comment. Wraps the existing Node helpers in .kiro/skills/pr-monitoring. Requires an authenticated gh CLI.
---

# PR monitoring helpers

Six dependency-free Node scripts already exist at `.kiro/skills/pr-monitoring/`.
**Reuse them — do not reimplement this logic.** This skill is a usage guide; the
code stays in `.kiro/` as the single source of truth shared with Kiro.

## Prerequisites

- **`gh` CLI, authenticated.** Nothing here reads `GITHUB_TOKEN` or
  `GITHUB_PERSONAL_ACCESS_TOKEN` — auth is entirely delegated to `gh`. Check with
  `gh auth status`.
- **Run from the repo root.** All paths inside the scripts are relative to `cwd`.
- The scripts are CommonJS (their own `package.json` sets `"type": "commonjs"` to
  override the root's `"type": "module"`). They have no npm dependencies. They are
  not executable (`-rw-r--r--`), so always invoke via `node <file>`, never `./<file>`.

## Commands

```bash
# Poll a PR once; prints JSON, exit 0
PR_NUMBER=123 REPO_OWNER=coralst REPO_NAME=valentin-romantic-agent \
  node .kiro/skills/pr-monitoring/pr-monitor-skill.js --once

# Read from GitHub
node .kiro/skills/pr-monitoring/github-api-wrapper-skill.js reviews  coralst valentin-romantic-agent 123
node .kiro/skills/pr-monitoring/github-api-wrapper-skill.js comments coralst valentin-romantic-agent 123
node .kiro/skills/pr-monitoring/github-api-wrapper-skill.js status   coralst valentin-romantic-agent 123
node .kiro/skills/pr-monitoring/github-api-wrapper-skill.js details  coralst valentin-romantic-agent 123

# Parse a review body into blocking / suggestions / positive / general
node .kiro/skills/pr-monitoring/review-parser-skill.js "$REVIEW_BODY"

# Merge gate — exit 0 = mergeable, 1 = blocked, 2 = bad JSON
node .kiro/skills/pr-monitoring/approval-gate-skill.js \
  '{"ciStatus":"success","prOpen":true,"blockingIssues":0,"isUserFacing":false,"comments":[]}'

# Who speaks next, for a given comment body
node .kiro/skills/pr-monitoring/turn-router-skill.js '**👔 Master Agent** @backend-dev please fix X'

# Format an agent reply comment
node .kiro/skills/pr-monitoring/response-formatter-skill.js backend-dev "Fixed the null check in abc1234."
```

`REPO_OWNER` and `REPO_NAME` are **required** — the scripts refuse to guess.
`PR_NUMBER` is optional and falls back to deriving it from the current branch.

## Functions with no CLI

The richest helpers are `require()`-only: `evaluateConversationGate`,
`allTaggedResponded`, `lastWordIsMaster` (turn-router); `formatForAgent`,
`attributeOwner` (review-parser); `postPRComment`, `listOpenPRs`
(github-api-wrapper). Reach them with a one-liner:

```bash
node -e 'const r=require("./.kiro/skills/pr-monitoring/turn-router-skill.js");
const s=JSON.parse(require("fs").readFileSync(0,"utf8"));
console.log(JSON.stringify(r.evaluateConversationGate(s),null,2));' <<<"$STATE_JSON"
```

## Caveats

- **`--watch` spawns a 90-second polling loop.** Only run it detached, never from a
  blocking call. Prefer `--once` and poll deliberately.
- `pr-monitor-skill.js` writes state into a hardcoded `.kiro/` directory:
  `.pr-monitoring-active-<PR>.json`, `.pr-monitoring-state-<PR>.json`,
  `.pr-feedback-<PR>.json`, `.pr-monitor-<PR>.log`. These are now gitignored. It
  calls `mkdirSync('.kiro')`, so running it from the wrong cwd silently creates a
  stray `.kiro/` — another reason to run from the repo root.
- The signal file `.pr-feedback-<PR>.json` was consumed by the Kiro
  `handle-pr-feedback` hook, which is **not ported**. Nothing reads it now; poll
  explicitly instead of expecting to be woken.
- `review-parser-skill.js` carries its own `OWNERSHIP` path→agent table and
  `CUBIC_AUTHOR = 'cubic-dev-ai[bot]'`; `turn-router-skill.js` carries the `AGENTS`
  handle map. If ownership changes in `CLAUDE.md`, these will drift out of sync.
