# Orchestrator-Led PR Review Loop

How the multi-agent PR conversation actually advances. This documents the
mechanism implemented by the `master-agent` prompt, the `git-workflow` steering
Phase 3, `turn-router-skill.js`, and the two turn hooks.

## Why orchestrator-led (not event-led)

The original design was **event-led**: a sub-agent posted "Ready for Review",
and the flow depended on a hook/poller *firing* to wake the next agent. That
never worked reliably — Kiro hooks are not GitHub webhooks, there is no webhook
into Kiro, and the poller's dispatch was a no-op. The loop had no engine.

The current design is **orchestrator-led**: the master-agent drives every turn
by **calling** the next actor (`invokeSubAgent`) and waiting for the return.
Control advances by a function call, never by hoping a trigger fires.

## The loop (hub-and-spoke with returns)

```
master reviews the diff + CI
  └─ posts a comment tagging the owning sub-agent(s): @backend-dev [@qa-agent ...]
  └─ invokeSubAgent(<agent>, { prNumber, reviewBody })   <- control transfer
       sub-agent: pushes commits, posts a reply tagging @master-agent, RETURNS
  master reads the return(s) and decides:
       - another round -> tag + invoke again
       - done          -> post the APPROVED-BY-MASTER-AGENT closing comment -> merge
```

- The master may tag **two or more** agents in one comment for a genuine
  multi-agent discussion; the loop fans out to all of them and collects every
  reply before the master's next turn.
- A sub-agent never re-invokes the master — it **returns**. The return *is* the
  hand-back. This avoids unbounded mutual-invocation nesting.
- **The master always posts the terminal message** (approval or close). No PR
  thread ends on a sub-agent's turn.

## Two layers

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| Control | `invokeSubAgent` (master prompt) | The engine — advances turns deterministically, no triggers. |
| Determinism | tool-use hooks + `turn-router-skill.js` | Guardrails on the two fragile boundaries: each hand-off, and the merge. |

The GitHub `@`-tag comments are the human-readable transcript *and* the
machine-parseable routing signal — no longer the (broken) trigger mechanism.

## The turn router (`turn-router-skill.js`)

Pure, offline, unit-tested. Key functions:

- `parseTurn(comment)` -> `{ author, isMaster, isApproval, nextActors[],
  unknownMentions[], terminal, valid, problems[] }`. `nextActors` is a list
  (multi-agent). Flags a **stall** when a non-terminal comment tags no one.
- `lastWordIsMaster(comments)` — the master must have the final comment.
- `allTaggedResponded(comments)` — no tagged sub-agent left hanging (the master
  is the loop driver and is never counted as "awaiting").
- `evaluateConversationGate({ comments, ciGreen, blockingIssues })` — the merge
  backstop decision.

## The hooks

- `route-turn-after-comment.kiro.hook` — `postToolUse` on `add_issue_comment` /
  `create_pull_request_review`. After each comment, route to the tagged
  agent(s), recognize the terminal master comment, or flag a stall.
- `pre-merge-conversation-gate.kiro.hook` — `preToolUse` on `merge_pull_request`.
  Blocks the merge unless the master has the last word with a valid
  `APPROVED-BY-MASTER-AGENT` token, no tagged agent was left hanging, and CI is
  green.

Hooks gate and prompt; they do not write the comment. Quality of the prose comes
from the natural-voice exemplars in each agent prompt. In supervised mode
`invokeSubAgent` is unavailable, so the master drives turns manually; the hooks
still apply.

## Conversation style

Write like a real developer in a real PR review — prose, not fill-in-the-blank
`✅/❌` templates. Keep the persona header (e.g. `**🔧 Backend Dev**`) and the
`@`-tag hand-back, but let the body reference specific files, commits, and
trade-offs. See each agent's prompt for exemplars.
