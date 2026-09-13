# Does a cold start increase latency on the AgentCore Runtime's first turn?

**Yes — about +1.1 s on a turn that makes two tool calls, and it comes back after
roughly 20 minutes of idle.** It is not a once-a-day cost paid by the first
visitor; it is paid by any turn that arrives at an idle runtime.

It is **not a fixed boot cost**. On a turn that makes no tool calls the same cold
runtime costs only ~+0.3 s. The penalty grows with the number of round-trips the
turn makes, which points at per-connection setup inside a fresh microVM rather
than image boot.

This corrects `runs/report.md` (2026-09-12), which concluded "**No cold-start
penalty was observed**". That conclusion rested on the wrong comparison, and the
run it was drawn from contained only one genuinely cold sample.

Measured 2026-09-13 against the deployed dev stack. No redeploy; probes only.

## Why the earlier conclusion was wrong

`report.md` compared **the first turn of a conversation (4.4 s p50) against later
turns (5.4 s)** and read "first turn is faster" as "no cold start". That
comparison cannot detect a cold start, for two reasons:

1. **It confounds warmth with context size.** Later turns carry more history, so
   they are slower for a reason that has nothing to do with the microVM. The
   comparison measures history growth.
2. **It also confounds tool-call count**, which dominates engine B's latency.
   Conversation 1's first turn made 2 tool calls while 9 of the 12 first turns
   made none — 0-tool turns run at a ~4.1 s median and 2-tool turns at ~8.0 s. The
   apparent ~5 s "first conversation is slow" gap in that run is tool calls, not
   temperature.

Both are fixed here by comparing **only samples that made the same number of tool
calls**, each on a **fresh session with empty history**, so the sole difference
between a cold and a warm sample is how long the runtime had been idle.

## Method

Each probe is one `drive.mts --turns=1` run: demo login, new session, one turn,
socket closed. Within a bucket, cold and warm samples use **the same corpus
prompt**, so the model is asked to do the same work; the two buckets use different
prompts chosen for their tool-call behaviour, selected with `drive.mts --only=ID`
(added for this probe, since `--limit` can only take a prefix of the corpus).

The metric is the `InvokeAgentRuntime` span's `durationMs`, measured in the
engine-B proxy. It excludes CloudFront, the ALB and the WebSocket, which are warm
in every sample — a cold-start claim must not include layers that are not cold.
Server-side CloudWatch `Latency` is used as an independent check.

Idle time is taken from the CloudWatch `Invocations` metric, **not** from the
proxy log group. `describe-log-streams`' `lastEventTimestamp` is eventually
consistent and lagged by over an hour during this session — it reported 19:05 as
the last event while turns were being served at 20:19, which would have mislabelled
every sample's idle time.

Take a probe, then re-derive the table:

```bash
# one probe = one fresh session, one turn. Name it cold-* or warm-* yourself:
# only you know how long the runtime had been idle.
npx tsx scripts/experiment/drive.mts --engine=b --only=c01-onboarding-core \
  --turns=1 --out=runs/cold-start/cold-04.jsonl
node scripts/experiment/cold-start-report.mjs runs/cold-start
```

## Results

### Two tool calls

Same prompt (`c01-onboarding-core` turn 1), fresh session, **2 tool calls in every
sample**:

| sample | idle before | `InvokeAgentRuntime` |
|---|---|---|
| **cold-01** 20:16 | **~3 h** (last traffic 17:1x) | **9,954 ms** |
| warm-01 20:17 | 30 s | 8,849 ms |
| warm-02 20:17 | 30 s | 8,198 ms |
| warm-03 20:18 | 30 s | 8,129 ms |
| warm-04 20:18 | 30 s | 8,754 ms |
| **cold-02** 20:40 | **~21 min** | **10,115 ms** |
| warm-05 20:41 | 40 s | 9,005 ms |

Paired against the warm sample taken immediately after — which controls for
drift in model latency between the two probe windows:

- cold-01 − warm-01 = **+1,105 ms**
- cold-02 − warm-05 = **+1,110 ms**

The 2026-09-12 run supplies a third, independent cold sample: its first-ever
invocation, 2 tool calls, **9,215 ms** against a warm median of **8,006 ms** for
the eight other 2-tool turns = **+1,209 ms**.

Three cold samples across two days and two separate idle windows, all **+1.1 to
+1.2 s**. Both of today's cold samples are above **every** warm sample in the
bucket (warm range 8,129–9,005 ms), so the separation does not depend on which
average you pick.

### The same runtime, cold, on a turn that makes no tool calls

Same probe design, stimulus `c11-chatter-short` turn 1, **0 tool calls in every
sample**, fired at 21:16 after 35 min of idle:

| sample | idle before | `InvokeAgentRuntime` |
|---|---|---|
| **cold-03** 21:16 | **~35 min** | **4,007 ms** |
| warm-06 21:16 | 40 s | 3,773 ms |
| warm-07 21:17 | 30 s | 3,504 ms |
| warm-08 21:18 | 30 s | 3,350 ms |

Only **+234 ms** against the adjacent warm sample, +503 ms against the warm
median — and unlike the 2-tool bucket, the cold sample is *not* clearly outside
the warm spread (which is 423 ms wide here). Server-side CloudWatch agrees:
3,857 ms cold against 3,524 / 3,238 ms warm.

So the cold penalty is roughly **+0.3 s with no tool calls and +1.1 s with two**.
A single fixed boot cost would appear identically in both. A per-round-trip setup
cost — the fresh microVM establishing its first connection to Bedrock, then to the
Gateway, each of which a 2-tool turn pays more often than a 0-tool turn — fits
what was measured. This is an inference from two buckets, not something the probes
can prove; see the note on runtime logs below.

## Confirmed server-side, and localised

CloudWatch `AWS/Bedrock-AgentCore` → `Latency`, `ComputeType=MicroVM`, per minute:

| minute | avg | n |
|---|---|---|
| 20:16 (cold) | 9,819 ms | 1 |
| 20:17 (warm) | 8,401 ms | 2 |
| 20:18 (warm) | 8,326 ms | 2 |

**+1,455 ms** server-side against **+1,478 ms** from the client spans over the same
minutes — two independent sources within 23 ms of each other.

The cost is **inside the microVM**, not in the surrounding AgentCore services:

- **Gateway MCP `initialize` was 5.5–7 ms in every minute**, cold and warm alike.
  The handshake is re-done on every new session regardless of temperature, so it
  cancels out of the comparison and is not the source.
- **Memory** spans were flat: `CreateEvent` 108 ms cold vs 89 ms warm,
  `ListMemoryRecords` 187 ms cold vs 250 ms warm.

It cannot be decomposed further from outside. `valentin_agent_dev` has **no
`/aws/bedrock-agentcore/runtimes/…` log group** — the container writes nothing to
stdout — so there is no boot timestamp to read. Splitting boot from first-token
time would need runtime logging enabled, which needs a redeploy.

## What is *not* a cold start

**Starting a new session is nearly free.** Every conversation in the 2026-09-12
run was its own session, so that run contains 12 session-level cold starts. In the
0-tool bucket, session-first turns (n=10) ran at a **4,226 ms** median against
**4,072 ms** for later turns (n=65) — **+154 ms**, and the later turns carry more
history, which biases that number *upward*. Paired turn-0-vs-turn-1 within each
session gives a **+302 ms** median (n=6).

So the penalty tracks **runtime idleness**, not session creation.

## Threats to validity

- **n = 3 cold samples** (two at 2 tool calls, one at 0). Enough to establish that
  the effect reproduces and to size it at ~1 s on a 2-tool turn; not enough for a
  distribution, and the 0-tool figure rests on a single sample.
- **The 20-minute figure is a bound, not a threshold.** 21 min of idle was enough
  to lose warmth and ~3 h was no worse, so the penalty saturates somewhere at or
  below 21 min. The exact teardown point was not bisected, and no AWS
  documentation was consulted for the platform's stated idle timeout — the number
  here is only what these probes show.
- **Single account, single runtime, one region** (us-east-1), one image. Warm-pool
  behaviour is a platform property and may differ elsewhere or change.
- **The absolute numbers belong to their stimulus** — ~8–10 s for a 2-tool turn,
  ~3.5–4 s for a 0-tool one. The +1.1 s / +0.3 s deltas are what transfer; neither
  9,954 ms nor 4,007 ms is a general first-turn figure.
- **Idle was measured, warmth was inferred.** Nothing observable says "this
  microVM is new" — only that the runtime had served no traffic for N minutes. A
  platform that kept the container but dropped its connections would produce the
  same numbers, which is in fact what the tool-count dependence suggests.

## What this means for the comparison

+1.1 s on an idle-arrival turn is real but small next to what already dominates
engine B: the uncapped tool loop, which produced a 70.6 s p99 and a 100.3 s worst
turn in the same experiment. Cold start is a footnote to that, not a headline —
but "no cold-start penalty" should not be claimed, because there is one, and a
low-traffic demo hits it on most first turns.

Note also that the penalty and the tool loop are the *same* lever: because the cold
cost scales with round-trips rather than being a flat boot charge, capping the tool
loop shrinks the cold-start penalty too.
