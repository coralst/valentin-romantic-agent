# Proposal — a third engine: direct Anthropic API

Status: **proposal, not implemented.** Educational value only: it is the control
arm that makes the other two engines legible.

## 1. What exists today, and what the letters mean

The code has **two** engines, selected per *process* by `AGENT_ENGINE`:

| Code id | This doc calls it | What it is |
|---|---|---|
| `valentin` | **Engine B** | hand-built orchestrator in `src/server/agent/`, model calls via **Bedrock** `InvokeModelWithResponseStream` |
| `agentcore` | **Engine C** | thin proxy; the loop, memory and tools run in **Bedrock AgentCore Runtime** |
| *(new)* `anthropic` | **Engine A** | same hand-built orchestrator, model calls go **direct to `api.anthropic.com`** |

⚠️ **Naming collision to settle before any code lands.** In the source today
`valentin` *is* "engine A" — `engine.ts`, `config.ts` and `compute-stack.ts` all
say so in comments, and `architecture-engine-context.tsx` starts the UI on
"engine A" meaning `valentin`. Your A/B/C mapping is the opposite. Pick one:

- **(recommended)** keep code ids (`valentin`, `agentcore`, `anthropic`) and put
  the letters only in the UI label map. Zero renames, no churn in ~15 test files.
- or do a mechanical rename pass first, as its own refactor commit (per
  `project-conventions.md`: never rename and add behavior in one commit).

The rest of this doc uses **your** letters: A = direct, B = Bedrock, C = AgentCore.

## 2. Why add A at all

B and C differ on *two* axes at once — who owns the agent loop (us vs. AWS) *and*
how much AWS is in the path. So a B↔C comparison can't answer "what is Bedrock
costing me, in latency and in code?" Engine A holds the loop constant and removes
AWS from the inference path, so the demo can show three honest deltas:

1. **A vs. B** — identical orchestrator, different transport. Isolates Bedrock:
   SigV4 + inference-profile routing + guardrails vs. a bare `x-api-key`. This is
   where the interesting teaching lives: A needs no IAM, no region/inference-profile
   dance (the fault fixed in `beee5ce`), and no VPC egress rules — and in exchange
   loses Guardrails, CloudTrail/model-invocation logging, and data residency.
2. **B vs. C** — already built; who owns the loop.
3. **A vs. C** — the two extremes: nothing managed vs. everything managed.

It is also the only engine that runs **with no AWS account at all**, which fixes a
real pain recorded in project memory: the local IAM user has no
`bedrock:InvokeModel`, so today a live chat turn can only be seen on the deployed
app. Engine A makes `npm run dev:server` a fully working agent on a laptop.

## 3. Design

### 3.1 Server

Smallest possible change: one new client class behind the interface the
orchestrator already depends on.

```
src/server/agent/
  bedrock-client.ts          # exists — BedrockClient + toLlmMessages
  anthropic-client.ts        # NEW — same shape, POST /v1/messages, SSE stream
  engine.ts                  # extend AgentEngine union + resolveEngine()
  agent-orchestrator.ts      # unchanged — it takes a `BedrockClient`-shaped dep
```

- `AgentOrchestrator` already accepts its model client as a constructor dep
  (`import type { BedrockClient }`). Extract that into a named
  `LlmStreamClient` interface in `src/shared/interfaces/` (system-architect's
  domain) and have both clients implement it. That is the whole seam.
- `anthropic-client.ts` talks HTTP directly — no SDK dependency needed, `fetch` +
  SSE parsing, ~120 lines. Tool-use blocks are the same JSON shape the tool loop
  already handles, because Bedrock's Anthropic messages API *is* this API.
- `resolveEngine()` gains `'anthropic'`, and downgrades **loudly** to `valentin`
  when `ANTHROPIC_API_KEY` is unset — exactly the existing `agentcore` /
  missing-`runtimeArn` precedent, same `agent.engine.unavailable` log line. No new
  failure mode invented.
- `config.ts` gains:
  ```ts
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,        // never checked in; see §5
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
    maxSpendUsd: Number(process.env.ANTHROPIC_MAX_SPEND_USD ?? '5'),
  }
  ```
- **Budget stop (non-negotiable for a $5 key).** Wrap the client in a token
  counter that accumulates `usage.input_tokens`/`output_tokens` per process,
  converts at a hardcoded price table, and throws `LlmError` once
  `maxSpendUsd` is hit. Emit `anthropic.budget` telemetry each turn so the
  drawer can show spend live — that display *is* a demo feature, not just a guard.
  Also set `max_tokens` low (1024) and disable retries beyond one.

### 3.2 Client / diagram

`src/client/utils/aws-architecture.ts`:
- `ArchitectureEngine` union and `ARCHITECTURE_ENGINES` gain `'anthropic'`.
- Engine A's topology is B's with the compute→Bedrock hop replaced by a single
  **external** node (`anthropic-api`, tier `compute`, rendered outside the VPC
  boundary — visually the point of the whole exhibit). Nodes absent in A:
  Bedrock, Guardrails, and the inference profile. `isNodeInEngine`,
  `isSegmentInEngine`, `nodeForEngine` are already the only three places that
  need to know.
- The engine switch in the icon rail becomes 3-way; `servingEngine` /
  `isDowngraded` logic needs no change, it already compares strings.

### 3.3 Infra — deliberately *not* a third Fargate service

Engine A is **local-and-dev-only.** Do not add a third task definition:

- It would mean putting a third-party API key in the deployed app's Secrets
  Manager and letting a public CloudFront origin spend it. Memory already records
  two separate incidents of secrets in this stack orphaning and blocking Compute
  deploys (`retained-secret-orphans-and-blocks-redeploy`,
  `orphaned-cdk-secret-blocks-backend-deploys`) — adding one more secret to that
  path buys nothing for a teaching demo.
- Egress from the Fargate task to `api.anthropic.com` is new NAT traffic and a new
  security-group hole in an otherwise AWS-internal data path.
- The comparison A vs. B does not need both to be *deployed*; it needs both to be
  *measured*. Measure A locally, screenshot it, put the numbers in the deck.

So: `AGENT_ENGINE=anthropic` is documented for `npm run dev:server` and for a
`verify:local` variant, and the deployed engine switch offers B and C only —
with A shown in the drawer as an explicitly "local only" engine rather than
hidden, since the diagram is the lesson.

### 3.4 Tests

- `engine.test.ts`: `anthropic` resolves when key present; downgrades + logs when
  absent; unknown value still falls back.
- `anthropic-client.test.ts`: SSE fixture → streamed deltas; tool_use block
  round-trip; budget ceiling throws `LlmError` and does not issue the request.
- `aws-architecture.test.ts`: engine-A node/segment membership; no Bedrock node.
- E2E: no new spec. Playwright runs against the local server, so one existing
  chat spec parameterized on the engine is enough — and chromium-only, per CLAUDE.md.

Quality signal: 🟢 achievable; the only 🟡 is the price table in the budget
counter, which is hardcoded and will drift — `// TODO(yellow): prices are a
snapshot, see docs/`.

### 3.5 Effort

~1 day. `anthropic-client.ts` + budget wrapper (half), diagram + switch (quarter),
tests and docs (quarter). No CDK change, so no deploy risk.

## 4. What the three engines teach, side by side

| | A — direct | B — Bedrock | C — AgentCore |
|---|---|---|---|
| Auth | `x-api-key` header | SigV4 / task role | SigV4 / task role |
| Agent loop | ours (`tool-loop.ts`) | ours (`tool-loop.ts`) | AWS-managed Runtime |
| Memory | our DynamoDB | our DynamoDB | AgentCore Memory |
| Guardrails | none | Bedrock Guardrails | Bedrock Guardrails |
| Audit | vendor dashboard | CloudTrail + model-invocation logs | ditto + Runtime traces |
| Data leaves AWS | **yes** | no | no |
| Works with no AWS account | **yes** | no | no |
| Region/profile complexity | none | inference profiles, per-region enablement | ditto |

## 5. Can you create a toy $5 Anthropic API key? — internal-policy answer

Short answer: **for this project as a personal, on-your-own-time learning
exercise, yes; for anything Amazon-related, no — and do not expense it.**

Sources read:

- **Third Party Generative AI Use and Interaction Policy, Doc 568686**
  (`https://policy.a2z.com/docs/568686/publication`). A direct vendor API is
  squarely a "Third-Party GenAI Service": services "external to, and not managed
  by, Amazon… usually only accessible as an API or web application." Explicitly
  contrasted with Bedrock/SageMaker, which are **not** third-party GenAI services
  and are out of scope of that policy. Key clauses:
  - **Confidential Information may not be submitted** without business-director
    *and* legal approval plus your org's security review. Amazon confidential
    explicitly includes **code**, non-public docs, wikis, customer data.
  - **Generating code for an Amazon product or service** via a third-party GenAI
    service requires **business SVP + legal director approval**.
  - **Personal-usage carve-out:** "Your use of generative AI on your own time,
    using your personal devices, for personal purposes is not subject to this
    Policy" — subject to the Conflict of Interest Policy.
- **AWS ProServe GenAI Prescriptive Guidance**
  (`w.amazon.com/bin/view/AWS/Proserve/Security/GenAI-Guidance/`), Prohibited
  list, verbatim: "Direct vendor APIs that bypass enterprise controls when an
  approved internal path exists. Example: **api.anthropic.com direct access is
  not authorized** for engagement work — Claude must route through Bedrock." Also
  prohibited: "Personal subscriptions to any AI service."
- **ProServe A1-Corporate-Policy** hard-stop table, PR-2, verbatim: "Personal or
  **P-card-reimbursed subscriptions to 3P GenAI services (Cursor, Anthropic
  direct**, OpenAI direct, …). **Expense approval ≠ tool approval.**"

What that means concretely for this repo:

| | Verdict |
|---|---|
| Personal Anthropic account, personal card, ~$5, on your own device/time, for learning | ✅ Out of scope of Doc 568686 (personal-usage carve-out) |
| Expensing the $5 / putting it on a P-card | ❌ Hard stop, PR-2 |
| Key in an Isengard/Amazon AWS account, or in the deployed dev stack | ❌ That is Amazon infrastructure — no longer "personal device", and it is the pattern §1 prohibits |
| Sending this repo's source, internal wikis, or anything Amazon non-public into it | ❌ Needs director + legal + security review |
| Using it in any customer engagement | ❌ Explicitly prohibited; Claude must go via Bedrock |
| Using it to generate code for an Amazon product/service | ❌ SVP + legal director |

Practical consequences, which is also *why* §3.3 keeps engine A off the deployed
stack:

1. Key lives in a git-ignored `.env` on your own machine only — never Secrets
   Manager, never CDK, never a commit. (`.env` is already the local pattern per
   `google-credentials-two-environments`.)
2. Feed it only the demo's own synthetic romantic-planning content. That data is
   already synthetic and non-Amazon, which is what makes this safe — do not point
   engine A at anything else.
3. Expect a **third-party GenAI pop-up alert** from Amazon Security on first hit
   to `api.anthropic.com` from a managed device (documented in the internal Claude
   Code setup wiki). Acknowledging it is not an approval — the analysis above is
   what makes the use legitimate.
4. If this project ever stops being personal learning — presented as Amazon work,
   shown to a customer, or built into anything shipped — engine A must be
   switched off, not re-approved. That is a one-line `AGENT_ENGINE` change by
   design.

**Not legal advice.** If you intend to present this capstone in any Amazon or
customer forum, run the engine-A arm past your BLL first; the cheap alternative is
to present A's numbers from a screenshot taken at home and keep the live demo on
B and C.

## 6. Recommendation

Build it, local-only, with the budget stop. It is a day of work, it needs no CDK
change and carries no deploy risk, it materially improves the story the deck tells
about Bedrock's value, and it makes a working agent runnable on a laptop with no
AWS account — which nothing else in this repo does. Settle the A/B/C naming first,
in its own commit.
