# Live Architecture inspector — flow inventory and bug hunt

**Reported:** the inspector "jumps over steps" and "won't start from the browser."
**Scope:** both engines — A (`valentin`, the hand-built Bedrock pipeline) and B
(`agentcore`, Runtime + Memory + Gateway behind `valentin-ac-proxy-dev`).
**Method:** read the model, then reproduce every claim in a real Chromium against a
live server. Screenshots in this folder are the evidence, not decoration.

---

## 1. What was actually broken

One defect, in the **live** path only. `use-live-architecture.ts`'s `record()` took the
highlight on every arriving event using a single shared timer and no queue, and the
traversal was keyed on *the current beat*. So each new arrival restarted the walk at
leg 0 of a different route. A turn that emits five events in a burst — `typing_start`,
two `aws_span`s, `agent_message`, `preference_update` — rendered as five aborted
walks, each visible for however many milliseconds separated it from the next.

That produces exactly the two reported symptoms and they are the same symptom: the
walk is cut off partway (**"jumps over steps"**), and whichever event happens to
arrive last wins the diagram, which is rarely the one that starts at the browser
(**"won't start from the browser"**).

**Fix:** a bounded FIFO queue (`LIVE_QUEUE_LIMIT = 8`) that collapses duplicate
routes, plus a per-beat hold derived from the route's own length rather than a fixed
timeout — `legs × FLOW_LEG_MS + LIVE_BEAT_REST_MS` (240 / 900). The old fixed 2600 ms
truncated any route longer than ~7 legs, which is most of engine B's.

Two supporting fixes shipped alongside it:

- **DynamoDB and External APIs are now one card each**, in a `SHARED` column between
  the two engine bands, reached from both. They used to be drawn twice (`dynamodb` +
  `ac-dynamodb`, `integrations` + `ac-integrations`), which put `ValentinTable-dev` on
  screen twice and invited a room to read one account as two systems.
- **Self-beat direction is inherited** rather than hardcoded as a request. A
  `browser → browser` beat has no hop, so nothing local settles its colour. It opens
  two flows (the user's own send) and closes two (the preference toast). Hardcoding it
  as a request relit the browser card in request-claret one beat *after* the reply had
  landed on it in response-teal — the diagram announcing a request that never
  happened, at the exact moment the flow ends.

---

## 2. Every flow, and what it should do

There are **three sources** that drive the diagram, not two. All three emit the same
shape (`LiveBeat extends FlowBeat`), so one renderer, one playback hook and one
replay serve all of them.

### 2.1 Source: LIVE — server events

Routes are table-driven. `EVENT_ROUTES` (`aws-architecture.ts:612`) and
`EVENT_ENDPOINTS` (`use-live-architecture.ts:189`) mirror each other.

| Event | From → To | Expected reading |
|---|---|---|
| `session_init` | dynamodb → browser | the stored profile arriving on connect |
| `send_message` | browser → fargate | the user's text going out |
| `typing_start` / `typing_stop` | fargate → browser | the server saying it is working |
| `agent_message` | bedrock → browser | the reply coming home |
| `preference_update` | dynamodb → browser | a learned preference landing |
| `action_proposal` | integrations → browser | a proposal offered for confirmation |
| `confirm_action` | browser → integrations | the confirmation travelling out to book |
| `error` | fargate → browser | a failure surfacing |
| `ping` / `pong` | *(absent, deliberately)* | keepalives are not traffic |

`aws_span` events are routed separately, by `resourceId` → node, with the origin
computed by `spanOrigin`: on engine B a span whose target is in
`AC_RUNTIME_CALLEES` (`ac-memory`, `ac-gateway`, `dynamodb`, `integrations`)
originates at `ac-runtime`; anything else at `ac-proxy`.

### 2.2 Source: DEMO — five authored scripts

A demo step's `from` is **never authored**. `resolve()` sets
`from = step.from ?? resting ?? step.to`, and `resting = restingNode(previous)`, where
a returning call rests at its *origin* and a one-way call at its *target*. That makes
a teleport unrepresentable rather than merely tested for — and there is a test
(`aws-demo-flows.test.ts:139`) asserting every step resumes exactly where the previous
one left the traffic.

Routes are computed by `routeBetween`, never authored, so an arrow the real topology
does not have cannot be drawn.

**`page-load`** — 4 steps, 5.2 s. The only flow that touches S3, asserted as such.
```
browser(self) → cloudfront → s3 → [cloudfront>browser]
```

**`chat-reply`** — 6 steps, 8.8 s. The baseline turn, no tools, no learning.
```
browser(self) → cloudfront → alb → fargate → bedrock[rt] → [alb>cloudfront>browser]
```

**`learns-something`** — 9 steps, 13.5 s. `DEFAULT_DEMO_FLOW_ID`, engine A's default.
Two `Converse` calls because the server really makes two (reply, then a forced-tool-use
extraction pass).
```
0 browser(self)          send_message
1 → cloudfront           ws-frame
2 → alb                  forward
3 → fargate              typing_start
4 → bedrock [rt]         Converse · chat-reply                      412 ms
5 → bedrock [rt]         Converse · extract-preferences             380 ms
6 → dynamodb [rt]        PutItem                                     18 ms
7 → [alb>cloudfront>browser]  agent_message
8 browser(self)          preference_update
```
Step 6 is a **round trip** on purpose: the write returns, so the traffic is back on
Fargate and step 7 needs no `from` override. Drawn one-way it parked the traffic in
DynamoDB and made step 7 teleport out of it. Step 8 is browser-local because the
server emits `preference_update` and `agent_message` in the same burst — two
simultaneous homeward deliveries cannot both be the one that travels, so the reply
gets the journey and the toast is rendered where the traffic already is. Which is also
literally true: nothing crosses the network for it a second time.

**`proposes-a-table`** — 9 steps, 17.0 s. The authority model.
```
… → bedrock [rt] Converse 486 ms
  → integrations [rt] check_shabbat        4 ms
  → integrations [rt] search_restaurants 612 ms
  → [alb>cloudfront>browser] action_proposal
  browser → [cloudfront>alb>fargate>integrations] confirm_action [rt] 388 ms  ← 17 legs
```
Calendar before restaurant, because in Israel a Saturday-night dinner is a
Hebrew-calendar question first; asking Ontopo first would demonstrate the bug rather
than the fix. Both provider calls start from `fargate`, not from each other — chaining
them would give `from === to`, which is no hop at all and lights nothing. The flow
**ends with the confirmation reaching the provider**, not with the proposal: the
confirm leg is the only step that reaches a provider with intent to write, and a flow
ending at the proposal would let a room assume the agent booked it.

**`agentcore-learns-something`** — 11 steps, 19.1 s. Engine B's default.
```
0  browser(self)                       send_message
1  → cloudfront                        ws-frame
2  → alb                               forward
3  → ac-proxy                          typing_start          ← the fork, not fargate
4  → ac-runtime                        InvokeAgentRuntime   486 ms
5  → ac-gateway [rt]                   get_partner_profile   94 ms
6  → [ac-gateway>dynamodb] [rt]        Query                 21 ms
7  → ac-memory [rt]                    CreateEvent           37 ms
8  → [ac-gateway>dynamodb] [rt]        PutItem               19 ms
9  → [ac-proxy>alb>cloudfront>browser] agent_message
10 browser(self)                       preference_update
```

### 2.3 Source: REPLAY — a recorded feed group

Not a mode, a third source. Clicking a group's caption in the event feed replays that
group's steps over the diagram. See §4.2 — this is where the second real bug lives.

### 2.4 Timing

| Constant | Value | Where |
|---|---|---|
| `FLOW_LEG_MS` | 240 | `aws-demo-flows.ts:777` |
| `DEFAULT_STEP_DWELL_MS` | 1100 | `use-flow-playback.ts:48` |
| `LIVE_BEAT_LIMIT` | 60 | `use-live-architecture.ts:60` |
| `LIVE_BEAT_REST_MS` | 900 | `use-live-architecture.ts:73` |
| `LIVE_QUEUE_LIMIT` | 8 | `use-live-architecture.ts:85` |
| `MARCHING_ANTS.durationMs` | 600 | `aws-diagram-layout.ts:494` |

Leg count is `1 + 2 × hops` one-way, `4 × hops + 1` returning, exactly 1 for a
self-beat. Demo dwell is `max(authored, legs × 240 + 500)`; a live beat holds
`legs × 240 + 900`, or a flat 900 under reduced motion.

---

## 3. Verified visually

Real Chromium, live server, drawer resized to 684 px (via the resize handle's `Home`
key) so nothing is clipped by the scroll container. Traces sampled **inside**
`page.evaluate` — sampling from outside started 720 ms late and produced a false
positive that made the animation look like it opened on CloudFront.

**Opens at the Browser, in order, nothing skipped.**
```
   4ms  —
  30ms  browser:lit
 284ms  browser-cloudfront > downstream
 546ms  cloudfront:lit
 788ms  cloudfront-alb > downstream
1031ms  alb:lit
1289ms  alb-fargate > downstream
1530ms  fargate:lit
```
`inspector-opens-at-browser.png`

**Shared cards, deduped.** Exactly 12 `aws-node-*` elements; one `aws-node-dynamodb`,
one `aws-node-integrations`, one `ValentinTable-dev` label. Both sit in the `SHARED`
column and neither mutes on either engine — asserted from the DOM in
`e2e/tests/engine-toggle.spec.ts`. `inspector-shared-cards-diy.png`

**Go-and-back is coherent.** Engine A full turn: 37 state transitions over 14.6 s.
Every round trip draws both directions — connector `downstream`, far node `lit`, the
same connector `upstream`, origin `response`. No truncation, no blank mid-beat frame.

**Engine B takes its own path.** Opens `browser:lit` at 21 ms, routes to `ac-proxy`
rather than engine A's Fargate, then Runtime / Memory / Gateway / integrations /
DynamoDB round trips all complete. A tool call correctly goes
`ac-runtime → ac-gateway → integrations` and back.

**External APIs lights on a tool call** — three independent triggers, each verified
`lit` immediately before *and* after the capture (the card is only lit for one beat,
so an MCP round-trip between poll and screenshot loses it):
1. a server-side `integrations` span (214 ms, duration pill on the card),
2. the same card driven from the AgentCore band via `agentcore-integrations`,
3. an outbound `confirm_action`, which parks it `lit` at 1980 ms.

`inspector-tool-call-lit-diy.png`, `inspector-tool-call-lit-agentcore.png`

---

## 4. Found and not fixed — each needs a decision

### 4.1 The live path teleports between beats

The demo flows guarantee "each step resumes where the last one rested." **The live
path has no such invariant and no such test.** `EVENT_ROUTES` authors every `from`
absolutely, and nothing reconciles a beat's start against the previous beat's rest.

Observed: at t=10432 the traffic rests on `fargate`; at t=11547 the next beat begins
on `bedrock`, with the `fargate-bedrock` connector never animated — then animated
*upstream* on the following leg. Four entries teleport this way: `agent_message`
(from `bedrock`), `preference_update` and `session_init` (from `dynamodb`),
`action_proposal` (from `integrations`).

Engine B has one much milder instance: `ac-proxy → ac-runtime` at t=4716, a single
link, from `spanOrigin`'s attribution.

Deliberately not fixed. Three defensible renderings of a mid-turn server push exist
and each makes a different claim about what travelled; and the naive fix — deriving
`from` from the previous rest — regresses the feed's origin-label column, whose
current values ("DynamoDB, Browser, Fargate, Bedrock, DynamoDB" rather than five
identical Browser rows) are explicitly defended in a comment at
`use-live-architecture.ts:244`. Recommended: keep the label absolute, insert a
synthetic connecting beat when a live beat's `from` differs from the current rest.

### 4.2 Replay is entered by accident, and is sticky

**This is a plausible alternative explanation for the original report, and I hit the
state myself while verifying.**

Replay starts when you click a feed group's **caption** — which is styled to look
exactly like the plain text label it replaced (`borderTop/Right/Bottom: 'none'`,
`font: 'inherit'`, transparent background). The only affordances are a pointer cursor
and a deliberately quiet `↻` in `#C3B4BA`. Clicking a caption to expand or collapse
it — the natural instinct — instead **seizes the diagram from live traffic** and
auto-plays, with no confirmation.

Two of `learns-something`'s five feed groups contain exactly **one** step. Replaying
one of those animates a single beat and stops: literally "jumps to one step."

It is also sticky in four ways the code does not cover:
- survives closing and reopening the drawer (only `isOpen` is cleared; the component
  stays mounted),
- switching Live ↔ Demo does not clear it, leaving a stale replay whose
  `selectedGroupId` matches no group — which collapses the *entire* feed to captions
  and highlights no row,
- reaching the last step does not exit,
- exiting does not restore the underlying flow's position.

The last two are unambiguous bugs with no design trade-off and are the cheapest fix
here. The entry affordance needs a design call: either make the caption look
clickable, or move replay onto the `↻` alone.

### 4.3 Engine B has two paths to the table; the tree can show one

`AGENTCORE_PARENT.dynamodb = 'ac-gateway'` is **correct**, and I had wrongly suspected
it. `infra/lib/agentcore-stack.ts` gives the Gateway two Lambda targets —
`valentin-profile-tools-${env}` (line 145) and `valentin-integration-tools-${env}`
(line 196) — and *both* carry `VALENTIN_TABLE_NAME` and are granted
`table.grantReadWriteData`. Tool-driven profile reads and writes genuinely reach the
table through the Gateway. `agentcore/agent.py` confirms the Runtime itself never
touches DynamoDB (its only boto3 client is `cognito-idp`).

But there is a **second** path the single-parent tree cannot express:
`agentcore-orchestrator.ts:422` `mirrorPreferences()` calls `this.storage.savePreference(...)`
directly, in the **proxy**. Those `preference.saved` spans are drawn as
`ac-runtime → ac-gateway → dynamodb` because `AC_RUNTIME_CALLEES` includes
`dynamodb`; the truth is `ac-proxy → dynamodb`. A modelling limitation rather than a
one-line bug — fixing it needs engine B's `dynamodb` to be reachable from two parents.

### 4.4 The confirm leg emits no span at all

`src/server/agent/agent-orchestrator.ts:416-418` calls `pending.tool.confirm(...)`
directly, bypassing `runToolConfirm`. `src/server/telemetry/span-bridge.ts` is the sole
span emitter, so **the one moment something is actually booked is invisible to the
span feed.** The `confirm_action` WS event still animates, so the diagram is not blank
— but there is no measured duration and no record that the provider was reached.

Not fixed: `src/server/` is `backend-dev`'s domain and this is the booking path.

Three smaller gaps in the same file: `GATEWAY_TOOL_SERVICES` (span-bridge.ts:60) is
hand-rolled, so an unmapped Gateway tool lights the Gateway card instead of the right
one; background reminder Gmail sends emit no span; and `sharing`/`reminders` are
in-process but still produce `integrations` spans, which slightly over-reports
outbound traffic.

### 4.5 Known and intended, but surprising

Two partner spans in one turn (`check_shabbat`, `search_restaurants`) collapse into
**one** animation, because the live queue dedupes identical routes. The feed correctly
keeps both rows. This is the queue fix working as designed, but on a projector it
reads as a dropped call.

### 4.6 A test claims more than it checks

`aws-demo-flows.test.ts:93` — "tells the same story on both engines, beat for beat" —
compares only the set of `action` strings. Engine A's flow has 9 steps and engine B's
has 11, so the claim in the test name is not literally true. Harmless, but the comment
is load-bearing documentation and currently overstates the guarantee.
