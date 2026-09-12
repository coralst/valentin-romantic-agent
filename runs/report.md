# Engine A vs engine B — measured, one user, one month

Run date **2026-09-12**. One user, 120 turns per engine, the same 12 conversations
(10 turns each) replayed identically to both sides against the deployed dev stack
`https://d26dwovftfq9oe.cloudfront.net`. Nothing below is modelled unless the row
says so.

| Arm | Window (UTC) | Turns | Failed | Engine asserted per turn |
|---|---|---|---|---|
| A (`valentin`) | 10:20:58 → 10:39:56 | 120 | 0 | `turn_metrics.engine == valentin`, 120/120 |
| B (`agentcore`) | 10:47:38 → 11:11:43 | 120 | 0 | `turn_metrics.engine == agentcore`, 120/120 |

The arms are sequential and disjoint, which is what makes the account-level
DynamoDB and Bedrock deltas attributable to one engine. A Logs Insights count of
`agent.turn` per arm window returned exactly 120 with the expected `engine` on
each — no third-party traffic contaminated either window.

## Headline

**Engine B costs 3.1× more per turn and 2.3× more per month. There is no
crossover.** The deck's framing — B cheaper per turn, dearer per month, crossing
over at some user count — is contradicted by the measurement. B is dearer on
*both* axes, so no volume makes it win.

| | Engine A | Engine B |
|---|---|---|
| Total $/user/month @ 120 turns | **$24.12** | **$54.77** |
| Variable $/turn (ex-Fargate rent) | **$0.0508** | **$0.1560** |
| Crossover | — | none exists |

Full line items:

| Line | Engine A | Engine B |
|---|---|---|
| Bedrock tokens | $6.0987 | $18.5239 |
| AgentCore Memory | — | $0.1380 |
| AgentCore Runtime | — | $0.0534 |
| AgentCore Gateway | — | $0.0082 |
| Tool Lambdas | — | $0.0003 |
| DynamoDB | $0.0008 | $0.0005 |
| Fargate rent (730 h) | $18.0208 (1 task) | $36.0416 (2 tasks) |
| **TOTAL** | **$24.12** | **$54.77** |

Two things drive the whole gap, and neither is an AgentCore service price:
**tokens** ($12.43 of the $30.65 difference) and **a second always-on Fargate
task** ($18.02). Every metered AgentCore service together — Memory, Runtime,
Gateway — comes to **$0.20/user/month**. The AgentCore bill is not the problem;
the token bill and the proxy container are.

## Claimed vs measured, one row per slide-6 claim

| Claim on slide 6 | Source of the claim | Measured | Delta |
|---|---|---|---|
| Turn latency ~2.1 s (A) / ~2.4 s (B) | code-derived | p50 **3.2 s** / **5.2 s** | 1.5× / 2.2× worse |
| Engine B adds no always-on rent | assumed | **2 Fargate tasks** (the `valentin-ac-proxy-dev` task is always on, same 512/1024 as A) | one whole task uncounted, $18.02/mo |
| 3 tools indexed | counted from 3 profile tools | **29** (3 profile + 26 integration targets) | ~10× |
| Runtime 3 s/turn (`cost-model.mjs` ASSUMPTION) | assumed | **1,467 s billed per conversation**; 0.4076 GB-h/conversation, 4.891 GB-h total | ~490× — but priced it is still only $0.0534/mo |
| 9 writes/turn | counted from code | **8.5 WCU/turn** (A: 1,018 WCU / 120; B: 657 WCU / 120 = 5.5) | claim was close for A, generous for B |
| 7 reads/turn | counted from code | **13.7 RCU/turn** (A: 1,641.5 / 120); `storeReads` reports 9.77 (A) / 8.75 (B) as a floor | ~2× |
| Extraction call 2,940 in / 300 out | estimated from the prompt | **3,900 in / 230 out** per call, 120 calls | +33% input, −23% output |
| Gateway overhead ~300 ms/turn | assumed | **523 ms** for `tools/call`; the MCP handshake adds 48 ms (`initialize` 6.0 + `notifications/initialized` 3.9 + `tools/list` 37.8) | 1.7× worse than claimed |
| 0.5 vCPU / 1 GiB container | read from the task definition | confirmed | correct |
| 26 profile fields | counted from the schema | confirmed | correct |
| 1.4 Gateway calls/turn | assumed | **4.06 calls/turn** (487 total: 120 initialize + 120 notifications + 120 tools/list + 127 tools/call) | 2.9× — the handshake does not amortise |

## Tokens — the finding that moves the bill

| | Engine A | Engine B |
|---|---|---|
| Input tokens, 120 turns | **1,809,635** | **5,822,274** |
| Output tokens | 44,652 | 70,470 |
| Model calls | 292 Converse calls (2.43/turn) | 522 LLM spans (4.35/turn) |
| Source | `bedrock.converse` log lines, `/valentin/dev/service` | `gen_ai.usage.*_tokens` on spans in `aws/spans` |

Engine B sends **3.2× the input tokens for the same 120 turns of the same
conversations**. It makes 1.8× the model calls and each carries more context —
the Strands agent re-sends its tool catalogue (29 tools) and history on every
loop iteration, and `agentcore/agent.py` has **no tool-loop cap** where engine A
caps at 5 iterations.

Engine A per operation:

| Operation | Calls | Input | Output | Input/call | Max input |
|---|---|---|---|---|---|
| `chat-tools` | 172 | 1,341,681 | 17,097 | 7,800 | 15,328 |
| `extract-preferences` | 120 | 467,954 | 27,555 | 3,900 | 4,682 |

There is no `chat-reply` operation — every turn goes through the tool loop.

### The `turn_metrics` frame is not a cost source

Engine A's `turn_metrics` frames report **1,341,681** input tokens for the run.
`bedrock.converse` reports **1,809,635**. The 467,954-token gap is exactly the
`extract-preferences` call, fired fire-and-forget
(`agent-orchestrator.ts:321` — `this.extractor.extract(...).catch(() => {})`, not
awaited) *after* `withTurn`'s `finally` has already serialized and emitted the
frame. That is **26% of engine A's input bill, structurally invisible** to the
frame the UI reads, and it is why engine A's `replyLatencyMs` is also an
undercount of work done. Any cost figure taken from the frame understates engine A
by a quarter.

## Latency

| | Engine A | Engine B |
|---|---|---|
| p50 | 3,196 ms | 5,181 ms |
| p90 | 9,792 ms | 10,100 ms |
| p99 | 31,962 ms | **70,612 ms** |
| worst turn | 33,210 ms | **100,323 ms** |
| turns > 30 s | 2 | 4 |

At p90 the two engines are within 3%. The difference is entirely in the tail, and
the tail has a cause: engine A truncates at its 5-iteration cap (**5 turns hit it**
and were cut off mid-answer — a correctness cost, not a latency one), while engine
B has no cap and simply runs, to 100 s in the worst case.

**No cold-start penalty was observed.** On engine B the first turn of a
conversation runs at 4.4 s p50 against 5.4 s for later turns — the microVM stays
billed-warm across the conversation, and later turns are slower because they carry
more history, not because of scaling. The expected cold-start finding did not
appear.

## AgentCore service detail (engine B)

| Service | Measured |
|---|---|
| Runtime | 120 invocations, 12 sessions, 0 errors, 0 throttles, avg 12,965 ms billed latency, 0.0801 vCPU-h, 4.891 GB-h |
| Memory | 120 `CreateEvent` (78 ms avg), 120 `ListMemoryRecords` (152 ms), **0 `RetrieveMemoryRecords`**, 64 records extracted, 26 Extraction + 21 Consolidation runs (33,734 in / 8,160 out tokens) |
| Gateway | 487 calls, 100% inbound auth success, `tools/call` 523 ms avg |
| Tool Lambdas | profile 59 invocations / 5.2 s total, integration 68 / 31.7 s total, 0 errors |

Two structural notes:

- **`RetrieveMemoryRecords` is never called.** The agent calls
  `ListMemoryRecords` 120 times instead — it is paying the $0.50/1k retrieval
  meter's cheaper sibling but also not using semantic retrieval at all. The Memory
  strategy's namespace is per-session (`/valentin/{actorId}/{sessionId}`), so the
  64 extracted records are 12 disjoint sets that cannot amortise across
  conversations.
- **Memory `CreateEvent` had 0 failures this run**, against ~4% in the September
  sample. Not a recurring reliability finding.

## Runtime billing shape

Billed on **session wall clock**, not turns. 12 conversations produced 12 microVM
sessions totalling 1,434.6 s of driver-observed wall clock and 4.891 GB-h billed
— i.e. **1,467 s billed per conversation**, roughly 12× the wall clock the driver
saw, because the microVM is held across the whole session including the 4 s
inter-turn think time and teardown. The old `SEC_PER_TURN = 3` assumption was
wrong by ~490×. It barely matters to the bill ($0.0534/mo) but it matters to the
claim: Runtime cost scales with **conversation duration**, not turn count, so a
user who leaves a tab open costs more than one who sends the same turns quickly.

## Methodology and its limits

- **Usage-billed** items (tokens, Memory events/records, Gateway calls, Lambda,
  DynamoDB, Runtime vCPU/GB-hours) are measured directly at the full 120 turns.
  **No extrapolation.**
- **Time-billed** items (Fargate 730 h/month) are analytic — they cost the same at
  1 turn as at 120, so scaling them from a 20-minute window would be wrong.
- **Excluded from both bills**, as on slide 6: ALB, CloudFront, S3, Secrets
  Manager. Newly named as excluded: NAT, interface endpoints, CloudWatch Logs
  ingestion. These are shared and would not change the comparison's direction.
- **n = 1 user, 1 run.** Read p50/p90 with confidence; p99 is a single sample of a
  tail.
- **Order effect.** Arm A ran first, so it saw a colder DynamoDB partition and B a
  warmer Bedrock endpoint. A B→A second pass was not run.
- **Turn attribution is timestamp-windowed, not id-joined** — there is no turn id
  in any log line. Serial execution (one conversation, one socket, at a time) is
  the mitigation.
- **Engine A's latency excludes its deferred extraction call**; engine B's
  excludes AgentCore Memory's asynchronous extraction. Both are legitimately fast
  for the user; neither `replyLatencyMs` is a proxy for total work. Latency and
  cost are two separate claims here and neither explains the other.

## Reproducing

```bash
npx tsx scripts/experiment/drive.mts --engine=a --out=runs/engine-a.jsonl
npx tsx scripts/experiment/drive.mts --engine=b --out=runs/engine-b.jsonl
AWS_PROFILE=dev-devops-agent node scripts/experiment/collect.mjs --arm=a --run=runs/engine-a.jsonl
AWS_PROFILE=dev-devops-agent node scripts/experiment/collect.mjs --arm=b --run=runs/engine-b.jsonl
node scripts/cost-model.mjs --from-measured runs/
python3 scripts/build-results-slide.py --from runs/ \
  --out docs/Valentin-Results-MEASURED.pptx \
  --latency-out docs/Valentin-Latency-MEASURED.pptx
```

All AWS access was read-only under `AWS_PROFILE=dev-devops-agent`. Nothing was
redeployed to produce these numbers.
