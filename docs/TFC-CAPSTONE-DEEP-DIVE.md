# Valentin — GenAI TFC Capstone Deep Dive

**Author:** Coral Magen · Technical Account Manager, AWS
**Repo:** `coralst/valentin-romantic-agent` · **Deployed (dev):** https://d26dwovftfq9oe.cloudfront.net
**Doc date:** 2026-09-05 · **Companion deck:** `public/deck-tfc.html` (13 slides) + `docs/deck-tfc-runsheet.md`

---

## 0 · How to read this

This is the written companion to the capstone deck. The deck is a set of cues for a
45-minute talk; this document is the evidence behind every cue, plus the two things a
deck cannot carry: the full lessons-learned list, and a prepared answer to the hardest
question in the room.

| § | What it covers |
|---|---|
| 1–2 | The use case, and exactly what the application does |
| 3 | The project lifecycle — five months, fourteen working days, 119 PRs |
| 4 | The two engines, component by component — the exact resource inventories |
| 5 | The comparison, with numbers, including the two places AgentCore loses |
| 6 | What AgentCore bought, the four faults, and "healthy lies" |
| 7 | The agentic development workflow, supported with data |
| 8 | Why this is an agentic application and not a chatbot with plugins |
| 9 | Lessons learned |
| 10 | The answer to *"what did you actually do?"* |
| 11 | What I could not verify — read before presenting |
| A–C | Numbers with provenance · what to know cold · a Q&A bank per section |

**A note on honesty.** Every number here is either counted from the repo, produced by a
committed script, or quoted from a vendor page — and where a figure is an assumption it
says so. §11 lists ten things I could not verify, including one input that would flip
the headline cost result. A capstone that overclaims is worth less than one that does
not, and a reviewer who finds an unmarked assumption stops trusting every other number.

---

## 1 · The use case

**The problem.** The details that make a relationship legible arrive in conversation,
scattered across weeks, months before they matter. A partner mentions in March that
they have never been to Kyoto; in April, that they cannot stand tasting menus; in May,
that their sister's wedding is in October. By the time the anniversary is on the
calendar, all of it has been forgotten — and "anniversary" *on the day* is already too
late. Existing tools split the problem badly: a calendar reminder knows the date but
nothing about the person, and a notes app knows the person but never speaks first.

**The shape of the solution.** One conversational surface doing three things no single
existing tool does together:

1. **Extract** structured preferences from unstructured conversation, continuously,
   without anyone filling in a form.
2. **Remember** them against a partner profile that accumulates over months.
3. **Act early** — decide on its own when a date is close enough to matter, reach real
   services (restaurants, music, gifts, calendar, mail), and come back with a concrete
   plan a human confirms.

**The four beats of the product**, which is also the demo:

| # | Beat | What happens |
|---|---|---|
| 1 | You talk about your partner | Claude Sonnet 4.5 on Bedrock, in character as Valentin |
| 2 | The profile fills itself | Preferences extracted into eight categories, with confidence |
| 3 | He keeps the dates | Lead time is itself a preference — a month, a week, a day |
| 4 | The reminder arrives | A real email: restaurants with live availability, a playlist, a link back into the conversation |

The eight extraction categories are food, hobbies, music, travel, gifts, love language,
important dates, and personality.

**Why an agent rather than a form with a cron job** — the one-line version, expanded in §8:

> Unstructured input arriving over weeks; a plan whose next tool call depends on what
> the last one returned; and a human in the loop before anything sends.

---

## 2 · What the application actually does

### 2.1 The capability surface

**21 registered tools across 14 integration ids** (10 provider groups), all against live
APIs — there are no mock providers in the deployed path:

| Integration | Tools | What it reaches |
|---|---|---|
| Ontopo | `find_restaurants`, `check_availability`, `propose_reservation` | Real Israeli restaurant availability and booking |
| Spotify | `find_music`, `propose_playlist` | Track search and playlist creation on a real account |
| Google | `find_occasions`, `propose_calendar_event`, `propose_email` | Calendar and Gmail, via OAuth refresh token |
| Google Places | `find_places_nearby` | Venue discovery beyond the curated list |
| Hebcal | `check_shabbat`, `get_hebrew_occasions` | Candle-lighting, Havdalah, Hebrew calendar |
| Amadeus | `search_hotels`, `search_activities`, `propose_hotel_booking` | Travel inventory |
| Wolt | `find_gift_delivery`, `propose_gift` | Gift delivery and gift cards |
| WhatsApp | `propose_whatsapp_nudge` | Message templates |
| Web | `search_web`, `read_webpage` | Open-web search and page reading |
| First-party | `set_reminder`, `create_conversation_link` | Scheduling; a resumable share link |

The registry is **credential-gated** — `buildToolRegistry()` (`src/server/integrations/index.ts:180`)
drops any group whose credentials are absent, so the live tool count is a property of
the deployment, not of the code. In the demo environment six integrations are live.

The split that matters is **14 read / 7 propose**. Nothing in the model's tool list
writes to the world. Every write is a `propose_*` returning a card; the corresponding
`confirm_*` is **hidden from the model entirely** (`agentcore/agent.py:158`,
`HIDDEN_TOOL_PREFIXES = ("confirm_",)`) and callable only by the application after a
human clicks. That is human-in-the-loop by construction rather than by prompt
instruction — see §8.3.

### 2.2 The autonomy that makes it an agent, not a tool palette

- **Continuous extraction.** Every turn runs a second model pass that pulls preferences
  out of the transcript and writes them to the profile with a confidence score. Nobody
  types into a field. (This is engine A's `extract-preferences` Converse; in engine B it
  is a managed Memory strategy — and it is the single largest cost term in the whole
  system, §5.1.)
- **A scheduler that fires with nobody watching.** `set_reminder` writes a row with
  `gsi1pk = DUE#<date>`; an in-process sweeper (`src/server/reminders/scheduler.ts`)
  queries the due-index every minute and dispatches. The **model is not in the send
  path** — it decided *that* a reminder should exist, weeks earlier; the dispatch is
  deterministic code. The file documents why this is not a scheduled Lambda: the row is
  in the table this task already owns, and `markSent` is a conditional write, so
  correctness does not depend on exactly one sweeper existing — which removes the only
  real argument for a second compute, a second IAM principal, and a second deployment
  artefact that can drift to a different version.
- **Multi-step plans across providers.** "Plan something for our anniversary" produces
  a Shabbat-time check, a restaurant search bounded by that result, an availability
  check on the survivors, and a proposal card — in one turn, each call's arguments
  derived from the previous call's output. The loop is capped at
  `MAX_TOOL_ITERATIONS = 5` (`src/server/agent/tool-loop.ts:35`), described in the code
  as "a latency budget as much as a safety net."
- **Proposals that outlive the conversation.** A proposal is persisted so a human can
  confirm it later, from a different session, through a share link.

### 2.3 The honest edges

- The reminder mail **really sends** (Gmail API, real inbox).
- The WhatsApp nudge is **blocked by the guardrail**, deliberately, and the panel says
  so rather than claiming a capability.
- The day-after survey in the demo is **labelled SUBSTITUTED on screen**, because a day
  cannot pass on stage.

---

## 3 · The project lifecycle

### 3.1 Shape of the effort

Five calendar months, but **fourteen actual working days** — concentrated sessions,
visible in the commit histogram:

| Date (2026) | Commits | What that session was |
|---|---|---|
| 04-04 | 26 | Genesis: steering files, specs, the six agent prompts, first vertical slice |
| 07-04 / 07-05 | 68 | The workflow crisis and its rewrite — event-led → orchestrator-led |
| 08-01 | 51 | Product depth: session history, partner-profile panel; first CDK stacks |
| 08-21 / 08-22 / 08-23 | 172 | The vitrine shell, the Inspector, the infra audit, integration |
| 08-28 / 08-29 | 75 | The integration layer and the AgentCore engine |
| 09-01 / 09-02 | 44 | **Engine B's first working turn**; the engine scoreboard |
| 09-03 / 09-04 / 09-05 | 133 | Credentials, reminders, the Gateway in engine B's real path, the bug hunt |
| **Total** | **569** | of which 181 are merge commits |

### 3.2 The five phases, as actually operated

Defined in `.kiro/steering/git-workflow.md` and followed for essentially every change:

1. **Spec.** A GitHub Issue. The orchestrator states the feature and acceptance
   criteria; the System Architect replies in-thread with a technical specification —
   libraries, contracts, data shapes. No code yet. Five full specs live under
   `.kiro/specs/`, each with `requirements.md` + `design.md` + `tasks.md`.
2. **Branch.** Once the spec is approved: feature branches and **draft** PRs, one per
   assigned agent, each carrying `Resolves #N`.
3. **Build + review.** Agents push micro-commits. The orchestrator reviews the diff,
   posts a review comment tagging the owning sub-agent(s), then *invokes* them. Repeat
   until resolved (§7).
4. **CI.** Four ruleset-required checks — `Lint (tsc --noEmit)`, `Unit Tests (vitest)`,
   `Build (vite)`, `E2E Tests (playwright)` — plus three informative jobs and a scope
   check that fails a PR whose changed paths do not match its `agent:` labels.
5. **Merge.** An approval comment carrying the token `APPROVED-BY-MASTER-AGENT`, a
   pre-merge gate that validates the conversation shape, then a merge commit and branch
   deletion.

### 3.3 Lifecycle metrics

| Metric | Value | How counted |
|---|---|---|
| Pull requests | **119** (109 merged, 9 closed unmerged, 1 open) | `gh pr list --state all` |
| Commits on `main` | **569** (181 merge commits) | `git log` |
| Tracked TS/TSX/PY/JS | **131,986 lines in 560 files** | `git ls-files`, counted |
| …of which tests and live evals | **54,057 lines in 218 files** (41%) | same |
| Unit test cases | **3,604 green** | `npm test` |
| E2E specs | 6 (chromium only) | `e2e/tests/` |
| Live agent eval cases | 29 | `eval/cases/` |
| Persona-signed review comments | **136** | GraphQL, parsed by persona header |
| Median PR open → merge | **10 min** (p25 5 · p75 26 · 91 of 109 under 2h) | GraphQL timestamps |
| CI wall-clock | **~3.5 min** for the full seven-job run | last 15 `ci.yml` runs |
| Commit types | 157 `feat` · 135 `fix` · 37 `chore` · 32 `docs` · 27 `test` · 14 `refactor` | `git log` subjects |
| PRs by lane | infra 62 · backend 44 · frontend 33 · architect 24 · qa 16 · design 14 | `agent:` labels |
| CDK stacks | 8 deployed (Network, Data, Compute, CDN, Auth, Safety, Monitoring, AgentCore) | `infra/lib/` |

Two rows carry the story:

- **`fix` is 135 of 569 commits — 24%.** A real system with real defects, found and
  fixed, not a demo that worked first try.
- **The infra/workflow lane is the largest, at 62 PRs.** More engineering went into
  building the *process* than into any single part of the *product*. That is lesson 1.

---

## 4 · Two engines, one product — the exact components

### 4.1 The experiment

The same product is implemented **twice**, and which one serves a turn is selectable
from the UI:

- **Engine A — `valentin`, "my glue code."** Everything an agent needs, assembled by
  hand from primitives: ECS Fargate, DynamoDB, a second Bedrock call for extraction, an
  in-process TypeScript tool registry, hand-written telemetry spans.
- **Engine B — `agentcore`.** The same five responsibilities delegated to Bedrock
  AgentCore: Runtime, Memory, Gateway, workload Identity, Observability.

**How the switch actually works** — worth stating precisely, because it is a nice piece
of design and an easy question to get wrong on stage. There is *no* per-request engine
switch inside one process. `compute-stack.ts` runs **two Fargate services off one
image**, distinguished only by the env var `AGENT_ENGINE` (`'valentin'` / `'agentcore'`,
`src/server/agent/engine.ts:9`). The ALB routes `/api/agentcore/*`, `/ws/agentcore` and
the header `X-Valentin-Engine: agentcore` to the second service; engine A is the
listener default. The UI toggle sets that header. Engine resolution happens once per
process at boot.

It **downgrades loudly, never silently**: a bad value logs `agent.engine.unknown`; a
missing runtime ARN logs `agent.engine.unavailable` and falls back to A. A missing
`AGENTCORE_MEMORY_ID` once killed the proxy at boot, which is why `index.ts` also
catches construction failure — `resolveEngine` checks only the runtime ARN while the
adapter needs both.

**What is held constant.** Both engines call the *same* model
(`us.anthropic.claude-sonnet-4-5-20250929-v1:0`, a cross-region inference profile),
pass the *same* guardrail id and version, write to the *same* DynamoDB table, sit behind
the *same* CloudFront distribution and the *same* frontend, and receive the same
`MAX_CONTEXT_TOKENS = 4096` budget — engine A exports that constant so engine B cannot
drift from it. Engine B's orchestrator deliberately **reuses engine A's**
`buildSystemPrompt`, `buildWelcomeMessage` and `readKnownFacts`.

That parity is the entire reason the comparison is worth anything: the differences
below are attributable to the *agent platform*, not to a rewrite. Most "should I use
AgentCore" answers are architectural opinion. This one is a controlled A/B, in one
account, on one product, with the model, the prompt, the guardrail and the datastore
pinned.

### 4.2 The five-row mapping

| Responsibility | Engine A | Engine B |
|---|---|---|
| **Compute / isolation** | Fargate service `valentin-service-<env>`, one long-lived container, all sessions in one Node process | **AgentCore Runtime** `valentin_agent_<env>` — a microVM per session, `InvokeAgentRuntimeForUser` |
| **Conversation memory** | DynamoDB single table, session + message items, read back per turn | **AgentCore Memory** — `CreateEvent` per turn (both halves in one call), 90-day expiry |
| **Preference extraction** | **A second, forced-tool Bedrock `Converse` on every turn** (`extract-preferences`) + our own extractor, mapper and name resolver | **AgentCore Memory `userPreferenceMemoryStrategy`** — managed, asynchronous; namespace `/valentin/{actorId}/{sessionId}` |
| **Tool access** | In-process tool registry — tool code runs *inside* the agent process, with the agent's IAM role and network egress | **AgentCore Gateway over MCP** — two Lambda targets, `CUSTOM_JWT` inbound, `allowedClients` scoped to two machine clients |
| **Observability** | `src/server/telemetry/span-bridge.ts` — spans I define, name and emit by hand, with real durations and token counts | **AgentCore Observability** — OTEL from the platform, but see §5.5: not queryable without a manual account switch, and it reports no tokens |

### 4.3 The AWS resource inventory, side by side

This is the answer to *"specify the exact different components."*

**Engine A requires:**

- ECS Fargate service `valentin-service-<env>`, task family `valentin-task-<env>`,
  container `valentin-backend` on :3001, dev size 512 CPU / 1024 MiB, `desiredCount: 1`
- Task role `valentin-task-role-<env>` with `bedrock:InvokeModel` +
  `InvokeModelWithResponseStream` on `arn:aws:bedrock:*::foundation-model/*` and the
  inference profile, plus `bedrock:ApplyGuardrail`
- ALB, listener (engine A is the default action), target group, 1-hour stickiness cookie
- VPC, subnets, NAT, security groups, **and a Bedrock VPC interface endpoint**
- ECR repo `valentin-backend-<env>` and an **amd64** image
- DynamoDB `ValentinTable-dev`: `pk`/`sk`, PAY_PER_REQUEST, PITR, TTL, deletion
  protection, `RETAIN`, one GSI (`gsi1pk`/`gsi1sk`, projection ALL)
- Log group `/valentin/<env>/service`; CPU-70% autoscaling to max 4
- Bedrock `Converse` **≥2× per turn** (reply + extraction; 3 with a tool round)
- 4 CloudWatch alarms + 1 dashboard
- Boot-time Bedrock preflight probe (reports, deliberately does not gate)

**Engine B requires, *in addition to* the shared table, guardrail, ALB and CloudFront:**

| Resource | CFN type | Detail |
|---|---|---|
| `CfnRuntime` | AgentCore Runtime | `valentin_agent_<env>`, `networkMode: PUBLIC`, `protocolConfiguration: HTTP`, 11 env vars, **arm64 image only** |
| `CfnMemory` | AgentCore Memory | `eventExpiryDuration: 90` (the maximum), one `userPreferenceMemoryStrategy` |
| `CfnGateway` | AgentCore Gateway | `protocolType: MCP`, `authorizerType: CUSTOM_JWT`, `allowedClients` = 2 machine clients, `exceptionLevel: DEBUG` |
| `CfnGatewayTarget` ×2 | Gateway targets | `valentin-profile` → Lambda (3 tools); `valentin-integrations` → Lambda (19 offered + 7 derived `confirm_*` = 26 definitions) |
| 3 IAM roles | — | memory, gateway, runtime |
| Workload identity grant | IAM | `GetWorkloadAccessToken`, `…ForJWT`, `…ForUserId` — "without it `InvokeAgentRuntime` fails before the agent starts" |
| 2 Cognito machine clients | — | resource server `valentin-tools`, scope `invoke`; secrets deliberately **not** in the template |
| A second ECR repo + **arm64** image | — | `valentin-agentcore-<env>` |
| **A second always-on Fargate service** | — | `valentin-ac-proxy-<env>`, *same* CPU/memory, *same* min capacity |

Plus, on the Python side: Strands Agents, `bedrock-agentcore` 0.1.x, MCP 1.x, and
`aws-opentelemetry-distro`, running as `opentelemetry-instrument python agent.py` on
`python:3.12-slim` for **linux/arm64**, non-root uid 10001.

**Two components engine B does *not* remove, and this is the honest headline:**

1. **The ALB and a Fargate task.** An AgentCore Runtime **cannot be an ALB target** —
   targets are instance / ip / lambda / alb only — and ALB-to-Lambda cannot
   response-stream. So engine B is a Fargate *proxy* in front of the Runtime, the same
   size as engine A's service and with the same minimum capacity. It is **not one task
   fewer.** The UI scoreboard originally had a tile claiming `1 → 0` always-on tasks;
   it was **deleted** because it was false.
2. **DynamoDB.** AgentCore Memory has no "keep forever" — 90 days is the maximum — so
   DynamoDB stays the source of truth for the profile and engine B *mirrors* extracted
   preferences back into it. Managed extraction is also asynchronous and takes seconds,
   so each mirror lands the *previous* turn's extractions: engine B's profile drawer
   trails engine A's by about one message. That is a real, visible product difference.

### 4.4 What moved, conceptually

1. **Extraction stopped being my code.** Engine A: a forced-tool Converse per turn, a
   prompt to maintain, a JSON parse to defend, a write path, plus a category mapper and
   a partner-name resolver. Engine B: a Memory strategy. This is the largest code
   deletion *and* the largest cost saving the migration offers (§5.1).
2. **Tools crossed a trust boundary.** The most important architectural change in the
   project, and easy to miss. In engine A the tools run *inside* the agent process: a
   prompt injection that convinces the model to misuse a tool operates with the agent's
   credentials on the agent's network. In engine B they are Lambdas behind a Gateway,
   each with its own execution role, reached over MCP with a JWT naming which client may
   call them. The model's reach becomes **enumerable and enforced outside the model's
   own process**. Tool names are namespaced `<target>___<tool>`.
3. **Session isolation went from logical to physical.** Engine A's sessions are objects
   in one process; engine B's are microVMs.
4. **The confirm authority moved.** Engine A's orchestrator calls the confirm tool
   directly. In engine B the *proxy* calls the Gateway itself, and confirm tools are
   filtered out of what the model ever sees.

---

## 5 · The comparison, with numbers

| Dimension | Winner | The number |
|---|---|---|
| **Cost** | **B** | 13.5× cheaper per user — but 99.95% of the win is deleting one model call, and one unresolved rate would flip it to 3.8× *worse* |
| **Tool boundary** | **B** | Tools leave the agent's process; JWT-scoped, per-Lambda roles, confirms hidden |
| **Blast radius** | **B** | Tool-target failure: **40 of 40 tools lost vs 1 of 40** |
| **Latency** | **A** | Worse in B *by construction* — `InvokeAgentRuntime` adds a network hop around the model call |
| **Observability** | **A, today** | B reports **no token usage at all**, has **zero alarms or dashboards**, and its traces need a manual account-level switch |
| **Guardrail policy** | tie | Same guardrail id and version passed to both |
| **Identity** | **B** | Per-session actor identity + workload identity; A has none of it |

### 5.1 Cost — AgentCore wins, for a reason that is not AgentCore

The audit trail is `scripts/cost-model.mjs` (287 lines, committed, run read-only):
sourced unit rates, counted quantities, and every unsourced input labelled `ASSUMPTION`.

**The two cost functions**, for *n* turns per month:

```
Engine A = $18.02      + n × $0.013326
Engine B = $0.0006     + n × $0.0008022
```

| Layer | Engine A | Engine B | Direction |
|---|---|---|---|
| Fixed compute | Fargate **$18.02/mo**, always on | Runtime **$0.0006/mo** (per-second, 1s minimum) | **B** — despite the Runtime's vCPU-hour being **2.20× dearer** |
| Memory, per turn | DynamoDB $0.00000606 | AgentCore Memory $0.000750 | **A**, by **124×** |
| Tool invocation | in-process, free | Gateway $0.005/1k + Lambda (**Lambda deliberately excluded**) | **A** |
| **Extraction, per turn** | **$0.013320** | **$0** | **B**, decisively |
| Model tokens | identical | identical | tie by design |

**Read that table again.** Engine A's per-turn cost is $0.013326, of which **$0.013320
— 99.95% — is the forced `extract-preferences` Converse.** AgentCore is not cheaper
because AgentCore compute is cheap; it is *dearer* per vCPU-hour and *124× dearer* on
memory. It is cheaper because a managed Memory strategy replaces a per-turn model call,
and because per-second billing beats an always-on task at low utilisation. **At 500
turns a month, engine A's Fargate task runs at 0.057% utilisation.**

Per-user model (104 turns/user/month):

| Users | Ratio (A ÷ B) |
|---|---|
| 1 | **187.5×** |
| 10 | 31.0× |
| 100 | 15.2× |
| 1,000 | 13.6× |
| 10,000 | **13.5×** |

At 1M users the model puts engine A at **$1,386,491.64/mo** against engine B's
**$102,925.33/mo** — about **$15.4M a year**.

**And now the caveat that belongs in the same breath.** AgentCore Memory's retrieval
rate is $0.50 per 1,000 *retrievals*. The adapter uses `ListMemoryRecords` with
`MAX_MEMORY_RECORDS = 100`. **If that rate is billed per record returned rather than
per call, the retrieval layer costs $0.05030 per turn and engine B becomes 3.8× *worse*
than glue code.** Nothing in the repo settles which it is. The deck slide carries the
note "confirm with AWS before presenting," and so does this document. That single
unresolved rate is the difference between a 13.5× saving and a 3.8× penalty.

Labelled assumptions, all of them load-bearing: Sonnet at $3/$15 per M tokens (the
Bedrock pricing table is JS-rendered and did not load); `SEC_PER_TURN = 3`;
`SESSIONS_PER_TASK = 500`; `SESSION_MINUTES = 12`. Lambda execution is excluded, which
**understates** engine B.

A previous version of this chart was **retracted in full** (commit `ccf4975`): "The old
one invented AgentCore's entire line, half-derived engine A's, excluded model tokens on
a false premise, contradicted itself on whether ALB and NAT were counted, and claimed
1 → 0 always-on tasks." Retracting my own chart is, I think, the most defensible thing
in this project.

### 5.2 The tool trust boundary — the strongest architectural argument

Engine A's 21 tools execute in the agent's process. Engine B's reach the model over MCP
through a Gateway that:

- accepts **`CUSTOM_JWT` only** — there is no unauthenticated inbound path;
- restricts `allowedClients` to **two named machine clients**, one for the agent and one
  for the proxy;
- fronts **two Lambda targets**, each with its own execution role, so a compromised tool
  has that Lambda's blast radius, not the agent's;
- **hides all 7 `confirm_*` tools from the model** — they are defined but never
  advertised, so no prompt injection can surface them;
- runs `exceptionLevel: DEBUG`, which passes tool *validation* errors back to the model
  so it can correct its own arguments instead of failing the turn opaquely — a
  schema-invalid call is an error the user sees in engine A and a message the model
  reads and retries in engine B;
- **withholds one tool on purpose**: `create_conversation_link` is not offered, because
  `SHARE_TOKEN_SECRET` never reaches the Lambda, so a link minted there would fail
  verification and point at `localhost:5173`.

There is also a nice piece of engineering in `_bind_identity()`: `user_id` and
`session_id` are **stripped from the schema the model sees** and injected at call time
by wrapping the tool's invoke. The model cannot spoof an identity it cannot name. Any
tool that fails to bind is dropped, with a log line.

### 5.3 Blast radius — the honest win, with two honest footnotes

**The measured figure (PR #93):** when a tool target fails, engine A loses **40 of 40**
tools; engine B loses **1 of 40**. That is what AgentCore actually sold me, and it is
not money — it is blast radius.

Two footnotes, both of which belong on the slide:

1. **This is a statement about *tools*, not sessions.** It is the property of splitting
   an in-process registry into Gateway targets. Do not upgrade it on stage into "39 of
   40 users kept talking."
2. **The deployed engine B still has a single shared Fargate proxy** in front of the
   Runtime (§4.3), so end-to-end availability retains a bottleneck the Runtime itself
   does not have. Per-session microVM isolation is real; my *deployment* does not yet
   fully realise it.

### 5.4 Security — a tie on policy, a win on identity, three owned gaps

Both engines are passed the **same guardrail id and version**. The guardrail is
deliberate engineering, not a default — `POLICY_REVISION = 7`, with content filters,
5 PII entities set to BLOCK, 3 custom regexes, and one DENY topic
(`system-prompt-extraction`). Two decisions are worth telling:

- **The `ADDRESS` entity was removed and replaced with regexes.** The entity filter
  destroyed legitimate restaurant addresses — the agent's whole job — while regexes
  still catch a home address.
- **Engine A guards only the newest user turn** with real text. The docblock cites the
  live incident behind it: guarding a tool's *own output* made the off-topic topic
  filter block the reply (2026-09-04T16:24:39Z), with a trace showing 42 guarded
  characters out of 3,752.

Every such decision is a dated comment in `infra/lib/safety-stack.ts`, so the next
reader learns *why*, not just *what*.

Where engine B wins is identity: per-session actor identity, workload identity, and
JWT-scoped tool access — none of which engine A has. It costs a real complication:
**two ids per person**, an `actorId` sanitised for Memory and a raw `userId` for
DynamoDB.

**Four gaps owned rather than hidden:** the ALB listener is HTTP; Cognito is
provisioned but not enforced on the app path; secrets are populated by hand; and
`guardrailVersion` is exported by SafetyStack but **consumed by nobody** — both stacks
take a `--context` literal defaulting to `DRAFT`, so the deployed engines may be running
the draft policy rather than the published one. I could not confirm which without a live
read (§11).

### 5.5 Observability — and this one goes to engine A

This is where I expected AgentCore to win outright and it does not, today:

- **Engine B reports no token usage at all.** The Runtime surfaces none, so
  `turn-metrics` records `0` for every engine-B turn and the span bridge carries a
  `TODO(yellow)`. Both layers keep the field *absent* rather than zero, and the
  scoreboard renders `—`, never `0` — because a zero would be a lie. Any token
  comparison between the engines is therefore structurally one-sided.
- **Engine B's spans are collected and not queryable** until CloudWatch Transaction
  Search is enabled, which is **not a CloudFormation resource**. The stack emits the
  literal CLI command as an output called `TransactionSearchCommand`. It is the one
  manual step engine B needs.
- **`monitoring-stack.ts` covers engine B not at all** — no alarm, metric or widget for
  the proxy service, its target group, or its log group.
- Read-path Gateway spans carry **no duration by design**; only the confirm path does.
- Engine B also **emits no thinking or tool-activity trail**, because the tool calls
  happen inside the Runtime and reach the proxy only as names. The orchestrator says so
  plainly: "Engine B's honest answer is therefore no trail rather than a reconstructed
  one." Rather than fake a trail, the UI shows none.

Engine A, by contrast, has hand-written spans with real durations and real token counts,
4 alarms and a dashboard. The platform *can* win here; my engine B does not yet.

### 5.6 Latency — worse in engine B, by construction

Three deliberate choices mean engine B cannot flatter itself:

- The adapter **does not stream**, so engine B gets no transport-only TTFT advantage.
- There is **no retry and no Bedrock fallback** in engine B's orchestrator: "a second
  attempt hidden at this layer would report AgentCore's p99 as though the first failure
  had not happened."
- `InvokeAgentRuntime` wraps the model call in a **second network hop**.

**What is measured, and what is not.** The repo is blunt about this: *no persisted
engine-A-vs-engine-B latency comparison exists*, and the scoreboard refuses to show
digits in demo mode because the demo durations are authored. What does exist:

- My live eval harness against the real deployed agent and real providers, 27 cases:
  **median 9.1s, p90 16.6s, max 22.7s**.
- Commit `38d7c84` (2026-09-05): 5/5 real replies on engine A at **3.0–9.8s**, 3/3 on
  engine B with zero fallbacks — **but no engine-B duration was recorded.**
- One profiled engine-A turn: **~412ms of Bedrock I/O out of ~450ms** — used to argue
  that CPU utilisation is the wrong autoscaling signal for this workload.
- Tool-call spans: `check_shabbat` at 20ms; integration proof durations of 1–317ms.

A multi-tool turn against six live third-party APIs is not fast, and the correct thing
to say on stage is "engine A is 3–10 seconds, engine B is architecturally slower, and I
have not published a paired measurement."

---

## 6 · What AgentCore bought, what it cost

### 6.1 What it genuinely bought

1. **The forced second Converse goes away** — 99.95% of engine A's per-turn cost.
2. **~656 lines of extraction and conversation-memory code stop being mine.**
3. **One MCP endpoint with schemas declared once**, reached by both the agent and the
   application, with the JWT handled for me.
4. **Per-second billing with a 1-second minimum** instead of an always-on task — the
   reason the ratio holds even though the Runtime's unit price is *higher*.
5. **Blast radius**: 40-of-40 → 1-of-40 on tool-target failure.

### 6.2 Three arguments the work itself killed

From the commit body that retired them:

- **Store reads are a wash or worse.** Engine B calls the same `readKnownFacts()` and
  adds a `findPreference` per mirrored record.
- **Idle cost is halved at best, not eliminated** — the second always-on dev task is
  engine B's own proxy.
- **Latency is worse by construction** — the extra hop.

I regard killing my own three arguments as a better result than keeping them.

### 6.3 The four faults between "deployed" and "working"

Engine B was deployed, green and `HEALTHY` for **weeks** and had **never served a
turn**. First working turn: **1 September 2026.** Four independent faults, each
producing a symptom that pointed away from its cause. This is the most transferable
content in the capstone, because every one is a mistake a customer will make.

1. **A missing CloudFront behaviour.** No `/ws/agentcore` route, so the WebSocket
   upgrade was refused at the edge with **403** — which reads as authorisation and was
   routing; the UI just said "Reconnecting to Valentin…". The behaviour had existed in
   `cdn-stack.ts` for weeks; the CDN stack simply had not been deployed since 22 August,
   and **no deploy scope could ship it.** Hence a new `--scope=cdn`.
2. **Half an IAM permission.** The proxy had `InvokeAgentRuntime` but not
   `InvokeAgentRuntimeForUser`. Because the proxy sends the Runtime-User-Id header,
   AgentCore authorises against **both** and refuses a call naming both if either is
   missing — so every turn was AccessDenied, and engine B "looked broken rather than
   unauthorized."
3. **A region-pinned foundation-model ARN.** The policy pinned
   `arn:aws:bedrock:${this.region}::foundation-model/…`, but a `us.`-prefixed
   cross-region inference profile authorises against **the region that actually fulfils
   the call** — failures cited `us-east-2` from a `us-east-1` stack. Fixed to
   `arn:aws:bedrock:*::foundation-model/*` on the Runtime role **and** the Memory
   extraction role. The Memory variant is the quieter and nastier one: it "surfaces as
   engine B simply never learning anything, with no failed turn to trace it back from."
4. **An `actorId` containing `#`.** A demo visitor's storage id is
   `<sub>#<visitorId>`, and `#` is outside AgentCore's allowed `actorId` pattern, so
   **every** `CreateEvent` was rejected — "the reply streamed but nothing was ever
   remembered." `actorIdFor()` now sanitises to `-`, and deliberately never `/`, because
   a slash would silently deepen the memory namespace.

### 6.4 Why "healthy" lies — the rule I would give any customer

Two mechanisms conspired to make a broken system look fine:

- `agent.py` catches its own exceptions and answers **HTTP 200** with
  `{content: '', tools_used: [], error: '<Type>: <message>'}`. `parseRuntimeReply`
  **never read that `error` field**, so the one string naming the cause was dropped.
- **The Runtime's managed log group does not exist until its container writes to it** —
  so the reply body was the *only* place the reason existed at all. An absent log group
  reads as "nothing has gone wrong"; it means "nothing has run."

The fix makes swallowing structurally impossible:

```ts
const failed = Boolean(parsed.error) || !parsed.content.trim();
logger[failed ? 'error' : 'info']('agentcore.invoke', { ok: !failed, traceId, runtimeError: … });
```

with the comment: "A 200 is not the same as a turn that worked… Logging that as
`ok: true` is how an unusable engine B looked healthy in the proxy's log group." The PR
notes the compounding effect: **fixing this is what made fault 3 findable in one
attempt.**

The same pathology showed up twice more, which is why it is a rule and not an anecdote:
`Valentin-Data-dev` read `UPDATE_COMPLETE` while listing a DynamoDB table the account
janitor had already deleted — and PITR does not survive its table, so that data was
unrecoverable. And `NoHealthyHostsAlarm` is permanently false.

### 6.5 Everything else it cost

- **Two contradictory naming rules.** Runtime and Memory reject hyphens; Gateway rejects
  underscores. A violation is a synth *warning*, so it fails at `CreateStack` instead.
- **`GatewayTarget` is untaggable** — no `tags` prop, does not implement `ITaggableV2` —
  so the janitor-exemption tag cannot be applied to it.
- **Unknown props in `inlinePayload` fail ten minutes into a deploy, not at synth.**
- **The ESM bundle threw at import**: `Dynamic require of "node:https" is not
  supported` — total failure, every tool call a Gateway error, and **unreproducible by
  any unit test** because tests import the TypeScript. Found only by running `node`
  against the synthesised asset. Format is now CJS.
- **esbuild must be pinned locally** or CDK silently bundles in Docker, which in CI is a
  slow failure. One version mismatch broke all 118 infra assertions.
- **Ordering is rigid.** Compute imports three exports from the AgentCore stack, so
  `cdk deploy --exclusively` on Compute rolls back with "No export named
  …RuntimeAgentRuntimeArn… found" — exactly how the first `--scope=backend` deploy of
  engine B failed. Replacing a Runtime/Memory/Gateway needs a two-step deploy with the
  proxy scaled to zero first.
- **A target added without its Lambda grant** updates cleanly and then fails
  AccessDenied at invoke — which the agent reports as the integration being broken.
- **A rollback can leave the Runtime a version behind the proxy**, "which surfaces as
  engine B apologising and reads like AgentCore latency."
- **`--scope=infra` remains unsafe**: it derives the agent image tag from the running
  backend task's tag, and the two ECR repos have independent tag histories, so it can
  point the Runtime at an image that never existed.
- **Cold start is sticky**: the Runtime builds its MCP client and calls
  `list_tools_sync()` **once**, so a Runtime that came up before the integration target
  existed holds 3 tools for the life of the container.
- **arm64 only.** An amd64 image is accepted at deploy time and then fails at cold start
  with an exec-format error — which surfaces as an **invoke timeout**.

### 6.6 The verdict I would give a customer

> Adopt AgentCore for two things: **blast radius**, because one failing tool target
> stops being every tool; and **the tool trust boundary**, because a Gateway with scoped
> JWTs and per-tool Lambda roles makes the model's reach enumerable and enforceable
> outside the model's own process. The cost saving is real at low utilisation but it is
> mostly *managed extraction replacing a model call you were paying for anyway* — check
> whether you can get that saving without the migration, and get the Memory retrieval
> rate confirmed in writing, because per-record billing inverts the answer. Then budget
> real time for IAM, routing and image architecture before your first working turn — mine
> took weeks — and **do not believe the health check.**

---

## 7 · The agentic development workflow

The product is one artefact. The **process that built it** is the other, and it is the
part I would argue is more interesting to a field community: an attempt to run a
software team where every engineer is a model, and to find out what actually breaks.

### 7.1 The org chart

Six personas, each with a prompt file, a persona header, and — critically — a
**disjoint file ownership** boundary:

| Persona | Owns |
|---|---|
| 👔 Master Agent (orchestrator) | nothing; drives the loop, reviews, approves, merges |
| 🏗️ System Architect | `src/shared/` — contracts and types only |
| ⚛️ Frontend Dev | `src/client/components/`, `hooks/`, `context/`, `App.tsx`, `main.tsx` |
| 🔧 Backend Dev | `src/server/api/`, `agent/`, `extraction/`, `persistence/`, entrypoints |
| 🎨 UI Designer | `src/client/design-system/` |
| 🧪 QA Agent | `e2e/`, `playwright.config.ts` — and must not touch `src/` |

**Ownership is enforced, not requested.** A CI scope check fails a PR whose changed
paths do not match its `agent:` labels. Some directories are declared **owned by nobody**
(`src/client/utils/`, `src/server/telemetry/`, `src/server/fixtures/`, the `__tests__`
dirs) and must be claimed explicitly in the PR before editing. That was a deliberate
choice: an unowned directory is where a multi-agent team silently produces two
incompatible implementations.

### 7.2 The crisis, and the redesign that is the real contribution

**The first design was event-led.** Agents would post `@`-tagged comments on the PR and
the next agent would react to the webhook. It looked elegant. It deadlocked.

The failure mode: control flow depended on an event that might not fire, might fire
twice, or might fire for a comment that tagged nobody. A conversation would simply stop,
with no error anywhere — the PR just sat there, apparently mid-discussion.

**The redesign is orchestrator-led — hub-and-spoke with explicit returns:**

1. The orchestrator reviews the diff and posts a comment **tagging the owning
   sub-agent(s)** — possibly two or more when a change spans domains.
2. It then **invokes** each tagged sub-agent directly, passing the PR number and the
   review body.
3. Each sub-agent works, pushes, posts a reply tagging the orchestrator, and **returns**.
   The return *is* the hand-back. A sub-agent never re-invokes the orchestrator.
4. The orchestrator reads the returns and decides: another round, or close.

**Control advances by a function call, never by hoping a webhook fires.** The `@`-tags
became the human-readable transcript of a control flow that no longer depends on them —
and then, because a transcript that is also a protocol can be checked, they were made
machine-checkable.

Two invariants fell out, and both are enforced by code:

- **Every non-terminal comment must tag the next actor.** A comment tagging nobody that
  is not the orchestrator's closing comment is a *protocol error* — it would stall the
  loop — and the turn router rejects it.
- **The orchestrator always posts the final message.** No PR thread ends on a
  sub-agent's turn.

### 7.3 The determinism layer

`turn-router-skill.js` parses the conversation and answers four questions
deterministically — `parseTurn`, `lastWordIsMaster`, `allTaggedResponded`,
`evaluateConversationGate`. The gate runs before merge. This matters more than it
sounds: **the decision to merge is not itself made by a model.** A model writes the
code, a model reviews it, and then a deterministic function checks that the conversation
has the required shape and that the approval token is present. Eight Kiro hooks handle
the mechanical steps around it.

### 7.4 The single-account approval problem

Every persona acts under the **same GitHub account**. GitHub forbids a PR author from
submitting a formal `APPROVE` review on their own PR:

```
422 Can not approve your own pull request
```

Waiting for an approval that can never arrive is exactly the kind of silent stall the
event-led design produced. The resolution: approval is expressed as a **comment
containing the machine-readable token `APPROVED-BY-MASTER-AGENT`** — comments on your own
PR are permitted, and so is `create_pull_request_review` with `event: "COMMENT"`. The
merge step checks for that token rather than GitHub's approval count. The repo ruleset
does not require a formal approval but **does** require the four status checks, so the
safety property is preserved while the impossible gate is removed.

This is a small thing that is worth a slide, because it is the general shape of the
problem: **an agentic workflow will hit platform constraints that assume humans, and you
have to notice the stall rather than wait through it.**

### 7.5 The data

| Signal | Value | What it says |
|---|---|---|
| PRs | **119** (109 merged) | The loop ran to completion 109 times |
| Persona-signed review comments | **136** | Master 101 · Architect 8 · QA 6 · Frontend 4 · Backend 4 · Design 1 |
| PRs carrying an orchestrator comment | **82 of 119** | Review was the norm, not the exception |
| Median open → merge | **10 min** (p25 5 · p75 26) | The loop is fast when it works |
| PRs merged in under 2h | **91 of 109** | 18 took longer — those are the interesting ones |
| CI | **~3.5 min**, 7 jobs, 4 required | Fast enough that the loop is not CI-bound |
| Unit tests | **3,604** | 41% of the codebase by line is test or eval code |
| Parallel worktrees | **6** | Genuine concurrency, one per feature |
| Lane distribution | infra 62 · backend 44 · frontend 33 · architect 24 · qa 16 · design 14 | |

**The distribution is the finding.** 101 of 136 review comments are the orchestrator's.
The sub-agents built; almost all the *reviewing* came from one role. A real team's review
graph is far flatter. If I ran this again I would force cross-agent review, because a
single reviewer is a single point of judgement, and I have 101 pieces of evidence that
that is what I built.

### 7.6 The correction layer — the honest bit about steering files

`CLAUDE.md` carries an explicit **"Corrections to the imported steering — these win"**
section. The steering files predate a directory restructure, and rather than let agents
follow stale paths, the corrections are stated where they will be read: the real test
command, the real contract paths, the directories that *do not exist* and appear only in
stale docs, that E2E is chromium-only so a Firefox requirement cannot pass, that
`invokeSubAgent` does not exist in Claude Code, and that `@backend-dev`-style tags notify
nobody because this is a single-account repo — they are routing labels rendered as plain
text.

That last one is the kind of thing that makes a demo look like magic and is in fact
plumbing. Saying so is more useful than letting a reviewer discover it.

There are also **38 operational lessons captured in project memory** — things like
"`/tmp` `@types` poison `tsc`", "a cancelled check run blocks merge while `gh pr checks`
reads green", "`AWS_REGION` in the environment silently overrides the deploy region",
"the account janitor deletes untagged resources and ignores CloudFormation retain
policies". None of those are in the code. All of them cost time once and never again.

---

## 8 · Why this is an agentic application, not a chatbot

The word "agent" has been devalued, so rather than assert it, here is a six-part test I
would defend in front of a skeptic — and an honest score on each.

| # | Criterion | Valentin | Evidence |
|---|---|---|---|
| 1 | **Goals, not turns** — the system pursues an objective across sessions | ✅ | A reminder set in March fires in October. State outlives every conversation. |
| 2 | **It acts without being prompted** | ✅ | The sweeper dispatches with no user present and no model in the send path. A chatbot cannot speak first. |
| 3 | **The plan is not predetermined** | ✅ | `runToolLoop` iterates up to 5 times; each call's arguments come from the previous call's output. There is no scripted sequence. |
| 4 | **It changes the world, through tools** | ✅ | 21 tools, 6 live integrations. Real bookings, real playlists, real mail. |
| 5 | **It maintains its own model of the domain** | ✅ | Continuous extraction into 8 categories with confidence, unprompted, from unstructured text. |
| 6 | **Its authority is bounded by design** | ✅ | 14 read / 7 propose; confirms hidden from the model; identity injected server-side and stripped from the schema. |

### 8.1 The three properties that a chatbot-with-plugins does not have

**Temporal autonomy.** A chatbot's lifetime is a request. Valentin's unit of work spans
months: extract in March, decide in September, act in October. The most important code
in the system — the sweeper — runs when no human is present and no model is invoked. If
you unplugged the model tonight, the reminders already scheduled would still send.

**Emergent plans.** The tool loop is a loop, not a pipeline. "Plan our anniversary"
produces a Shabbat check whose result bounds a restaurant search whose survivors get an
availability check. Nobody wrote that sequence; it is the model's, per turn, and it
differs per turn. The 5-iteration cap is a budget, not a script.

**Self-maintained state.** Nobody fills in a form. The profile is the agent's own model
of a person, built from conversation, with confidence scores — and it is *used*, not just
displayed: the reminder lead time is itself an extracted preference.

### 8.2 The strongest counter-argument, and my answer

> "It's a Bedrock Converse loop with function calling and a cron job. That's a chatbot
> with plugins."

Mechanically, yes — and I would rather concede the mechanism than argue about the word.
What makes it an agent is not the API surface, it is **where the decisions live**. Three
decisions are the model's and are not encoded anywhere in my code: *what is worth
remembering* about a person, *which tools to call in what order* to satisfy a goal, and
*when* a date is close enough to matter. A plugin chatbot has none of those. Delete the
model from Valentin and you do not get a worse chatbot; you get a database with a cron
job and nothing to put in it.

### 8.3 Where the agency is deliberately removed — and why that is the point

The most important design decision in the product is a **restriction** on the agent:

- The model's tool list contains **no tool that writes to the world.** Seven `propose_*`
  tools return cards. The seven matching `confirm_*` tools are defined, deployed, and
  **never shown to the model.**
- The tool-loop appends "This is a PROPOSAL and nothing has happened yet" to every gated
  result, so the model cannot honestly claim it acted.
- Identity is **injected server-side and stripped from the schema**, so the model cannot
  name, let alone spoof, whose data it is touching.

An agent trusted to book a restaurant on someone's behalf on the strength of a prompt
instruction is not a safe agent; it is an unsafe agent with a polite prompt. Making
confirmation *structurally* unreachable by the model is the difference, and it is also
the honest answer to "what did you do that the model didn't" — a model asked to build
this will happily give itself `book_restaurant`.

---

## 9 · Lessons learned

**1. The workflow cost more than the product.** 62 of 119 PRs are infra/workflow — the
largest lane. Building a six-agent team with enforced ownership, a deterministic turn
router and eight hooks was more engineering than any product feature. Worth it once, as
a capability; do not price it as free.

**2. Event-led orchestration deadlocks. Orchestrator-led does not.** If control flow
depends on an event that may not fire, the failure mode is silence, and silence is the
worst failure mode to debug. Advance control with a function call and use the visible
transcript as *description*, not mechanism.

**3. Do not trust "healthy."** Engine B was `HEALTHY` for weeks and had never served a
turn. A 200 with an empty body is not success; an absent log group is not calm, it is
proof nothing ran; `UPDATE_COMPLETE` can describe a stack whose table has been deleted.
Make the error path structurally impossible to swallow, then trust your own logs and
nobody's console.

**4. 3,591 hermetic tests proved nothing about agent behaviour.** They were green while
twelve real defects sat in the product. Unit tests verify the code you wrote against the
assumptions you had. An agent's failures live in the gap between your assumptions and a
live provider's actual behaviour, and only a live harness with **independent oracles**
finds them (§10.3).

**5. `TZ=UTC` is not optional.** Production ECS containers run UTC; an Israel-timezone
laptop **hid two of the twelve bugs entirely.** Your development environment is a
configuration, and a wrong one is an invisible test oracle.

**6. What AgentCore sold me was blast radius, not money.** And when it *did* save money,
99.95% of the saving was deleting one per-turn model call — which is a fact about my
architecture, not about the platform. Always ask whether the saving requires the
migration.

**7. Retract your own numbers when they are wrong.** I deleted an entire cost chart that
"invented AgentCore's line, half-derived engine A's, excluded model tokens on a false
premise, and claimed 1 → 0 always-on tasks," and a UI tile that claimed a task reduction
that does not happen. The credibility of every remaining number depends on doing this.

**8. Managed services have unmanaged edges.** Two contradictory naming rules across
sibling resources. An untaggable target. A prop typo that fails ten minutes into a
deploy rather than at synth. arm64-only images that fail as *timeouts*. A trace pipeline
that needs a manual account switch that is not a CloudFormation resource. None of this
is in the tutorial.

**9. Plan with the strong model, execute with the cheap one.** Spec quality dominates
outcome; execution of a good spec is mostly mechanical.

**10. Write down the operational lesson the first time it costs you.** 38 memory notes,
each of which was a wasted hour once. Almost none of them belong in the code.

**11. A single reviewer is a single point of judgement.** 101 of 136 review comments came
from one role. I would force cross-agent review next time.

**12. Enforce ownership mechanically, and name the unowned areas.** Six disjoint domains
with a CI scope check, and an explicit list of directories nobody owns that must be
claimed in the PR. Ambiguous ownership is where parallel agents silently build two
incompatible things.

---

## 10 · "What did you actually do, other than ask Kiro/Claude to do it for you?"

This is the right question and it deserves a direct answer rather than a defensive one.

**The honest framing first:** I did not hand-write most of the application code, and I
will not pretend otherwise — the deck says so on the team slide. That is the premise of
the project, not a gap in it. The interesting question is what work remained, and
whether it is the *engineering* or the *typing* that was automated.

Here is the answer in one line, and then the evidence:

> I designed the experiment, set the boundaries the agents could not cross, found the
> defects the agents could not see, and refused the conclusions that were flattering but
> unsupported.

### 10.1 I designed the experiment — and the constraint that makes it valid

Deciding to build the product **twice** is a research design, not an implementation
task. And the value is entirely in the *control*: same model id, same prompt builder,
same guardrail id and version, same DynamoDB table, same CloudFront distribution, same
context-token budget — with engine A **exporting** `MAX_CONTEXT_TOKENS` so engine B
cannot drift from it, and engine B's orchestrator deliberately **reusing** engine A's
`buildSystemPrompt` and `readKnownFacts` rather than having its own.

Every one of those is a decision to *give up freedom* in order to make a measurement
mean something. A model asked to "implement an AgentCore version" produces a second
implementation. It does not produce a controlled A/B, because it was not asked what the
comparison is *for*.

Two more choices in the same category, both of which make engine B look worse:

- Engine B **does not stream**, so it gets no transport-only TTFT advantage.
- Engine B has **no retry and no fallback**, because "a second attempt hidden at this
  layer would report AgentCore's p99 as though the first failure had not happened."

Deliberately declining an advantage for the thing you are advocating is the part of this
project I am most confident no model would have volunteered.

### 10.2 I set the safety architecture

- **Propose-then-confirm.** 14 read / 7 propose, with all 7 `confirm_*` tools deployed
  and **hidden from the model**. Ask a model to build a booking agent and it gives itself
  `book_restaurant`. The decision that the model's tool list may contain *no* tool that
  writes to the world is mine, and it is the reason this system can touch a real calendar
  and a real inbox.
- **Identity injected server-side**, stripped from the schema the model sees, so it
  cannot name whose data it is touching. Any tool that fails to bind is dropped.
- **Guardrail policy as product judgement.** Removing the `ADDRESS` PII entity because it
  destroyed restaurant addresses — the agent's whole purpose — and replacing it with
  three regexes that still catch a home address. Leaving name and email unblocked because
  a romantic agent that cannot hold a partner's name is not a product. Guarding only the
  newest user turn, after a live incident where guarding a tool's own output made the
  off-topic filter block the reply. These are trade-offs between safety and usefulness;
  a model will pick the safe default and ship something useless.
- **Withholding a tool on purpose**: `create_conversation_link` is not offered in engine B
  because its signing secret never reaches the Lambda, so the link would verify-fail and
  point at localhost. Noticing that a *present* capability is a *broken* capability is
  review work.

### 10.3 I found the defects the agents could not see

This is the strongest single piece of evidence, and it is the one to lead with.

The repo had **3,591 passing unit tests** and twelve real bugs in the product. I made the
call that hermetic tests were structurally incapable of finding them, and specified a
**live behavioural eval harness** with three properties that are the whole point:

- **It drives the real agent against real providers** — 29 cases, three passes, ~110 model
  turns.
- **Its oracles bypass our own clients.** Correctness is checked against the hebcal REST
  API directly and against Spotify via an independent `client_credentials` token. If our
  Spotify client is wrong, the oracle still knows the truth. A test that uses the code
  under test as its own oracle cannot fail correctly.
- **`UNPROVEN` is a first-class third result**, alongside pass and fail. A case that did
  not establish anything must not be allowed to report as a pass.
- **A hard denylist on write tools**, so an eval run can never book anything.

Result: **twelve bugs found and fixed** — eleven from the hunt, plus a twelfth found in
production while verifying the second. And the finding inside the finding: **`TZ=UTC`
was hiding two of them**, because my laptop is on Israel time and production containers
are UTC. That is a class of bug no amount of test-writing finds; it requires someone to
ask "what is different about the environment where this actually runs."

I also root-caused the **four AgentCore faults** (§6.3). Each one had a symptom that
pointed away from its cause: a 403 that was routing, not authorisation; an
`AccessDenied` from *half* a permission pair; a region-pinned ARN broken by cross-region
inference profiles authorising against the fulfilling region; and an `actorId` containing
a `#`. The fourth had **no failed turn to trace back from** — the reply streamed and
nothing was remembered. Debugging by symptom would not have reached any of them, and
three of the four are IAM/routing/platform issues that no amount of application code
review surfaces.

### 10.4 I refused the flattering conclusions

| I could have claimed | What I did instead |
|---|---|
| AgentCore saves 13.5× | Published it **with** the sensitivity in which it is **3.8× worse**, and the note "confirm with AWS before presenting" |
| A cost chart that favoured my thesis | **Retracted the whole chart** — it "invented AgentCore's entire line… and claimed 1 → 0 always-on tasks" |
| "AgentCore removes an always-on task" | **Deleted the UI tile** that said so, because engine B has its own always-on proxy |
| 40-of-40 vs 1-of-40 session survival | Kept it accurate: it is about **tools**, and footnoted that my deployment still has a shared proxy |
| Engine B has better observability | Reported that it emits **no tokens at all**, has **zero alarms**, and needs a manual switch — engine A wins today |
| A latency comparison | Stated plainly that **no paired measurement exists**, and made the scoreboard refuse to render digits for authored durations |
| 727 lines of code deleted | Flagged that the constant is stale — the real figure is **656** — and that a 10% test tolerance let it pass CI |

Every row of that table is a place where the easy thing was to let a favourable number
stand. Marking `SEC_PER_TURN = 3` and the Sonnet token prices as `ASSUMPTION` in the
committed cost model, and **excluding Lambda cost in a way that understates my preferred
engine**, is the same discipline.

### 10.5 I built the process, and fixed it when it deadlocked

The event-led → orchestrator-led redesign (§7.2) is a distributed-systems diagnosis:
control flow was depending on an unreliable event, so the failure mode was silence.
Moving to explicit invoke-and-return, then making the transcript machine-checkable with
a deterministic gate, is the single most transferable piece of engineering in the repo —
and note what it means: **the decision to merge is not made by a model.** Likewise
noticing that a formal self-approval returns `422` *forever*, rather than waiting through
another silent stall, and replacing it with a token-in-comment gate that preserves the
four required checks.

### 10.6 The one-sentence answer for the room

> I was the principal engineer and the reviewer of record, not the typist: I chose to
> build it twice and pinned everything that had to stay constant for the comparison to
> mean anything, I designed the propose-then-confirm boundary that lets a model touch a
> real calendar safely, I found twelve live defects that 3,591 green unit tests could
> not, I root-caused four platform faults that made a "healthy" system serve zero turns,
> and I retracted my own cost chart and my own headline numbers when the evidence did not
> support them. The models wrote the code. The judgement calls — and every one of the
> uncomfortable conclusions in this document — are mine.

---

## 11 · What I could not verify — read this before presenting

A reviewer who finds an unmarked gap discounts everything else. These are marked.

1. **No paired latency measurement exists** for engine A vs engine B. The repo says so
   itself. Engine A is measured at 3.0–9.8s live and 9.1s median in the eval harness;
   engine B has no recorded duration.
2. **Engine B's token usage is unmeasurable today** — the Runtime surfaces none. Any
   token comparison is one-sided. Fixing it means extending and redeploying the Runtime.
3. **The decisive cost input is unresolved.** Whether AgentCore Memory's $0.50/1k
   retrieval rate is per call or per record swings engine B from 13.5× cheaper to 3.8×
   worse. **Get this confirmed before you present the cost slide.**
4. **`SEC_PER_TURN = 3`, `SESSIONS_PER_TASK = 500`, `SESSION_MINUTES = 12`** and the
   Sonnet token prices ($3/$15) are all labelled assumptions. The whole scale model rests
   on them. The measured turn is ~9s, so the compute line is understated.
5. **Lambda execution cost is excluded** from engine B's figure, understating it by an
   unknown amount.
6. **`parseMemoryRecord()` is untested against a live Memory** — the managed extractor's
   record schema is undocumented, and confidence defaults to 0.8 as a deliberate hedge.
7. **`guardrailVersion` is exported but consumed by nobody** — both stacks take a
   `--context` literal defaulting to `DRAFT`, so the deployed engines may be running the
   draft policy. Unconfirmed without a live read.
8. **One live defect, found while assembling this document:** the scoreboard's
   `EXTRACTION_LINES = 624` is stale — the actual count is **656**, so the displayed
   "727 lines replaced" should read **759**. The guard test uses a 10% tolerance, so the
   stale figure passes CI, and the number is quoted on the deck and the cost page. Worth
   correcting before the talk. The comment beside it also cites a test file that does not
   exist; the assertion lives in `EngineScoreboard.test.tsx`.
9. **The 90-day Memory expiry** is a data-retention property to disclose, not a bug.
10. **Three security gaps are dev-appropriate and production-blocking**: HTTP ALB
    listener, Cognito not enforced on the app path, secrets populated by hand.

---

## Appendix A · Every number, with provenance

| Number | Value | Source |
|---|---|---|
| PRs | 119 (109 merged / 9 closed / 1 open) | `gh pr list --state all` |
| Commits | 569 (181 merges) | `git log` |
| Working days | 14 | commit-date histogram |
| Tracked code | 131,986 lines / 560 files | `git ls-files` + line count |
| Test + eval code | 54,057 lines / 218 files (41%) | same |
| Unit tests | 3,604 | `npm test` |
| Infra assertions | 118 | `npm run test:infra` |
| E2E specs | 6 (chromium) | `e2e/tests/` |
| Live eval cases | 29 | `eval/cases/` |
| Bugs found by live eval | 12 | `docs/bug-hunt/BUGS.md` |
| Persona review comments | 136 (Master 101) | GitHub GraphQL |
| Median PR → merge | 10 min | GraphQL timestamps |
| CI | ~3.5 min, 7 jobs, 4 required | `ci.yml` runs |
| Tools | 21 registered · 14 read / 7 propose · 6 live integrations | `src/server/integrations/*/tools.ts` |
| Engine B tools | 19 offered + 7 hidden confirms; 1 withheld | `agentcore-stack.ts` |
| Engine A cost | $18.02/mo + $0.013326/turn | `scripts/cost-model.mjs` |
| Engine B cost | $0.0006/mo + $0.0008022/turn | same |
| Extraction share of A's turn cost | $0.013320 of $0.013326 = 99.95% | same |
| Ratio at 10k users | 13.5× | same |
| Ratio at 1 user | 187.5× | same |
| Retrieval sensitivity | B becomes 3.8× worse | `public/engine-comparison.html` |
| Blast radius | 40/40 tools lost vs 1/40 | PR #93 |
| Fargate utilisation @500 turns | 0.057% | `cost-model.mjs` |
| Engine A live latency | 3.0–9.8s (5/5); eval median 9.1s, p90 16.6s | commit `38d7c84`; `eval/` |
| Engine A profiled turn | ~412ms Bedrock I/O of ~450ms | `docs/PRODUCTIONIZE-PLAN.md` |
| Guardrail | POLICY_REVISION 7 · 6 filters · 5 PII BLOCK · 3 regexes · 1 DENY topic | `infra/lib/safety-stack.ts` |
| Memory expiry | 90 days (the maximum) | `agentcore-stack.ts` |
| Stacks | 8 deployed | `infra/lib/` |
| Memory lessons | 38 | project memory |
| Deploy times | frontend ~45s · CDN ~2min · backend ~5min · full ~7min · rollback ~3min | `scripts/deploy.sh` |

---

## Appendix B · What you need to know cold

Twelve facts. If you know only these, you can survive any question in the room.

1. **The thesis.** One product, built twice, everything else pinned: same model, prompt,
   guardrail, table, CDN. The comparison isolates the *agent platform*.
2. **The five-row mapping.** Fargate→Runtime · DynamoDB→Memory · a second Bedrock
   call→Memory strategies · in-process registry→Gateway (MCP, 2 Lambda targets) ·
   hand-written spans→Observability.
3. **The cost functions.** A = $18.02 + n×$0.013326. B = $0.0006 + n×$0.0008022. 13.5× at
   scale, 187.5× at one user. **99.95% of A's per-turn cost is the forced extraction
   Converse.**
4. **The cost caveat.** Per-record Memory retrieval billing flips B to **3.8× worse**.
   Unconfirmed. Say so before anyone asks.
5. **What AgentCore really bought.** Blast radius (40/40 → 1/40 tools) and the tool trust
   boundary. Not money, primarily — and not a task reduction: **engine B still runs its
   own always-on Fargate proxy, because a Runtime cannot be an ALB target.**
6. **Where AgentCore loses.** Latency (extra hop, by construction), observability today
   (no tokens, no alarms, manual Transaction Search switch), Memory is 124× dearer per
   turn than DynamoDB, and Memory expires at 90 days so DynamoDB stays source of truth.
7. **The four faults.** Missing CloudFront `/ws/agentcore` behaviour (403 that was
   routing) · missing `InvokeAgentRuntimeForUser` (half a permission pair) ·
   region-pinned foundation-model ARN vs cross-region inference profiles ·
   `#` in `actorId`. Deployed and green for weeks, zero turns served. First working turn
   1 Sep 2026.
8. **"Do not trust healthy."** 200 with an empty body; `parseRuntimeReply` dropped the
   error field; **the log group does not exist until the container writes to it.**
9. **The safety architecture.** 14 read / 7 propose; all 7 confirms hidden from the model;
   identity injected server-side and stripped from the schema; nothing in the model's tool
   list writes to the world.
10. **Why it is an agent.** Temporal autonomy (a March reminder fires in October, with no
    model in the send path), emergent plans (tool loop, ≤5 iterations, each call bounded by
    the last), self-maintained state (8 categories, extracted, with confidence, and *used*
    — lead time is itself a preference).
11. **The workflow.** Six personas, disjoint ownership enforced by a CI scope check,
    orchestrator-led invoke-and-return after event-led deadlocked, a deterministic turn
    router as the merge gate, and approval-by-token because GitHub returns `422` on
    self-approve forever.
12. **Your part.** Designed the experiment and the controls; set the propose/confirm
    boundary; built the live eval harness that found 12 bugs behind 3,591 green tests
    (`TZ=UTC` hid two); root-caused the four faults; retracted your own cost chart and
    three flattering claims.

**Three numbers to never get wrong on stage:** 13.5× (with the 3.8× caveat), 40-of-40
vs 1-of-40 **tools**, and 12 bugs behind 3,591 green tests.

---

## Appendix C · Q&A bank

Answers are what I would actually say, at the length I would say it.

### On the use case

**Q. Isn't this a toy?**
The domain is personal, the engineering is not: 8 CDK stacks, 6 live third-party
integrations, real OAuth, a real guardrail, 3,604 tests, and a live eval harness that
found 12 defects. I picked a domain I would notice being wrong in. A benchmark dataset
would not have told me that a PII filter was eating restaurant addresses.

**Q. Who would use it?**
Today, one person, on purpose. The capstone claim is about the architecture and the
build method, not about product-market fit, and I would rather be precise about that
than pitch you a business.

**Q. Privacy?**
It is the reason for the guardrail work and the reason `ADDRESS` handling was
re-engineered rather than dropped. Also the reason I list the three security gaps: HTTP
listener, Cognito not enforced, secrets by hand. All dev-appropriate; all
production-blocking, and I would not deploy this for anyone else without closing them.

### On the two engines

**Q. Why build it twice? Isn't that wasteful?**
It is the only way to get an answer worth anything. Every "should I use AgentCore"
comparison I could find was architectural opinion. Holding the model, prompt, guardrail
and datastore constant and swapping only the agent platform turns opinion into
measurement.

**Q. So should customers use AgentCore?**
For blast radius and the tool trust boundary, yes. For cost, look carefully at *why* it
was cheaper for me — 99.95% of my saving was deleting a per-turn extraction model call,
which is a fact about my architecture. Ask whether you can get that saving without the
migration. And confirm the Memory retrieval billing unit first.

**Q. 13.5× cheaper sounds too good. What's wrong with it?**
Three things, and I would rather tell you than have you find them. It is dominated by one
deleted model call, not by AgentCore compute — which is 2.20× *dearer* per vCPU-hour. It
excludes Lambda cost, which understates AgentCore. And if Memory retrieval is billed per
record rather than per call, AgentCore becomes 3.8× worse than my glue code. That last
one is unconfirmed and it is on my list to resolve with the service team.

**Q. Which components exactly did AgentCore replace?**
Fargate service → Runtime microVM. DynamoDB conversation items → Memory events. My
second per-turn Bedrock extraction call → a `userPreferenceMemoryStrategy`. My in-process
TypeScript tool registry → a Gateway over MCP with two Lambda targets. My hand-written
span bridge → platform OTEL.

**Q. And which did it *not* replace?**
The ALB and a Fargate task — a Runtime cannot be an ALB target, and ALB-to-Lambda cannot
response-stream, so engine B is a proxy in front of the Runtime, same size, same minimum
capacity. And DynamoDB, because Memory maxes out at 90 days and the profile must not
expire. I had a UI tile claiming a 1→0 task reduction; I deleted it because it was false.

**Q. Which engine is in front of your users?**
Engine A is the ALB listener default. Engine B is selected by path or the
`X-Valentin-Engine` header, which the UI toggle sets. Two Fargate services off one image,
distinguished only by an env var, resolved once at boot — there is no per-request switch
inside a process.

**Q. Isn't the per-session microVM just expensive isolation?**
At high utilisation, yes, and the Runtime's unit price is 2.20× Fargate's. What makes it
win here is per-second billing with a one-second minimum against a task that runs at
0.057% utilisation at 500 turns a month. Utilisation is the whole question.

**Q. Why does Memory cost 124× DynamoDB per turn and you still call it a win?**
Because the extraction call it eliminates is two orders of magnitude bigger than either.
$0.013320 versus $0.000750. The expensive layer is not the one you would guess.

### On AgentCore adoption pain

**Q. What was the hardest part?**
Getting from "deployed and green" to "served one turn." Four independent faults, each
with a symptom pointing away from its cause, over weeks. Three were IAM, routing or
image architecture — none of them application code.

**Q. Give me the one you'd warn a customer about first.**
The region-pinned foundation-model ARN. A `us.`-prefixed inference profile authorises
against the region that *fulfils* the call, not yours — my us-east-1 stack was denied on a
`us-east-2` ARN. Use `arn:aws:bedrock:*::foundation-model/*`. And put it on the **Memory
extraction role** too, because there the symptom is just "the agent never learns
anything," with no failed turn to trace.

**Q. How did it look healthy for weeks?**
The Python agent caught its own exceptions and returned HTTP 200 with an empty body and
an `error` field, and my parser dropped that field. And an AgentCore Runtime's log group
does not exist until the container writes to it — so an absent log group read as calm
when it meant nothing had ever run.

**Q. What would you do differently in the AgentCore deployment?**
Assert on the *content* of a turn, not the status of a deploy, from the first commit.
Fail loudly on an empty reply. And treat "no log group" as an alarm condition rather than
a quiet default.

### On "is it really agentic"

**Q. This is a chatbot with function calling and a cron job.**
Mechanically that is fair. What makes it an agent is where the decisions live: what is
worth remembering about a person, which tools to call in what order, and when a date is
close enough to matter. None of those are in my code. Delete the model and you get a
database with a cron job and nothing to put in it.

**Q. Where's the autonomy? A human is always in the loop.**
Two places. The reminder fires with no human and no model present — the model decided
*that* a reminder should exist, weeks earlier, and the dispatch is deterministic code.
And within a turn the plan is emergent: up to five tool iterations, each call's arguments
derived from the last result.

**Q. Then why gate every write behind a human?**
Because an agent trusted to spend money on a prompt instruction is an unsafe agent with a
polite prompt. The model's tool list contains no tool that writes to the world; the seven
confirm tools are deployed and never shown to it. That restriction is what makes it
acceptable to point at a real calendar and a real inbox.

**Q. Couldn't a prompt injection unlock the confirms?**
It cannot surface a tool that is not in the advertised list. It also cannot spoof
identity, because `user_id` and `session_id` are stripped from the schema the model sees
and injected server-side at call time.

### On the agentic development workflow

**Q. Did the multi-agent workflow actually help, or is it theatre?**
Both, honestly. It produced 109 merged PRs with a 10-minute median and enforced clean
domain boundaries. It also cost more engineering than any product feature — 62 of 119 PRs
are the process — and 101 of 136 review comments came from one role, which means my review
graph had a single point of judgement. I would force cross-agent review next time.

**Q. What broke?**
Event-led orchestration deadlocked. Control depended on webhooks that might not fire,
fire twice, or fire for a comment tagging nobody, and the failure mode was silence. I
rewrote it hub-and-spoke: the orchestrator invokes a sub-agent and waits for a return.
The `@`-tags became a transcript of control flow rather than the mechanism of it.

**Q. Who decides to merge?**
Not a model. A deterministic function checks that the conversation has the required shape
— every non-terminal comment tags the next actor, the orchestrator posts last — and that
the approval token is present, on top of four required CI checks.

**Q. Why a token instead of a GitHub approval?**
Every persona runs under one account, and GitHub returns `422 Can not approve your own
pull request` — forever. Waiting for it is another silent stall. So approval is a comment
containing `APPROVED-BY-MASTER-AGENT`, which is permitted, and the four required status
checks still gate the merge.

**Q. How did you stop agents from overwriting each other?**
Disjoint file ownership per persona, enforced by a CI scope check against `agent:` labels,
one worktree per feature (six ran in parallel), and an explicit list of directories owned
by nobody that must be claimed in the PR before editing. Ambiguous ownership is where you
get two incompatible implementations of the same thing.

### On the challenge question

**Q. What did you actually do, other than ask the AI?**
I designed the experiment and every control that makes it valid, set the safety boundary
the model cannot cross, found the defects the agents could not see, root-caused four
platform faults that no application-code review would surface, and retracted my own
conclusions when the evidence did not support them. The models wrote the code.

**Q. Be specific: name one thing a model would not have done.**
Deliberately declining engine B's advantages. It does not stream and it has no retry,
because a hidden retry would report AgentCore's p99 as though the first failure had not
happened. A model asked to make AgentCore look good would not remove its own advantages.

**Q. Name another.**
Concluding that 3,591 passing tests proved nothing about agent behaviour, and specifying a
live harness whose oracles *bypass our own clients* — hebcal over REST, Spotify over an
independent `client_credentials` token — so that if our client is wrong the oracle still
knows the truth. That found 12 bugs. And `TZ=UTC` was hiding two of them, because my
laptop is on Israel time and production is UTC.

**Q. Isn't the eval harness also AI-written?**
The code, largely. The design decisions are not: independent oracles, `UNPROVEN` as a
first-class third result so a case that established nothing cannot report as a pass, and a
hard denylist on write tools so a run can never book anything. Those are the properties
that make it a test rather than a demo.

**Q. What did you get wrong?**
I let a cost chart ship that invented AgentCore's entire line and claimed a task reduction
that does not happen; I retracted it. A UI constant on the deck is stale by 5% and a 10%
test tolerance let it pass CI — it is in §11 and I am fixing it. And I have no paired
latency measurement, which is the most obvious hole in the comparison.

**Q. If you had two more weeks?**
Resolve the Memory retrieval billing question, publish a paired latency measurement,
instrument engine B's token usage, and put engine B under the same alarms and dashboard as
engine A. In that order — the first one can change the headline.

### On production readiness

**Q. Would you run this in production?**
Not as it stands, and I can tell you exactly why: the ALB listener is HTTP, Cognito is
provisioned but not enforced on the app path, secrets are populated by hand, engine B has
no alarms, and `guardrailVersion` may be resolving to `DRAFT`. Those are five specific,
closeable items rather than a vague reservation.

**Q. What did you learn about running agents on AWS that you'll take to customers?**
Three things. Confirm the unit of billing before you model cost — per call and per record
differ by 60×. Assert on the content of a turn, never on the status of a deploy, because
managed services report healthy long before they are useful. And your development
environment is a test oracle: mine was on the wrong timezone and it hid two production
bugs from 3,591 tests.
