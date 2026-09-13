# Reproduce the demo yourself

One command plays the whole thing and records it. Everything below is what that
command needs, in the order it needs it, and what each step is for.

The driver is `scripts/demo-drive.mts` (`npm run demo:drive`). It types into the
real UI at human speed, waits for real model replies, presses Confirm on real
proposals, and **asserts its own claims as it goes** — a take that would put a
false statement on screen stops with `TAKE FAILED` and the offending text,
instead of the falsehood being found in review.

---

## 1. Start the servers

Two processes, on non-default ports so they cannot collide with stale servers
from the main checkout:

```bash
# backend — Bedrock needs this profile, or every turn silently returns a fallback
AWS_PROFILE=dev-devops-agent AWS_REGION=us-east-1 PORT=3111 \
  REMINDER_CHANNEL=gmail \
  AGENTCORE_RUNTIME_ARN="arn:aws:bedrock-agentcore:us-east-1:684394110906:runtime/valentin_agent_dev-Yn2GsXHG69" \
  AGENTCORE_MEMORY_ID="valentin_memory_dev-FVI2Rt3DEw" \
  AGENTCORE_GATEWAY_URL="https://valentin-gateway-dev-uv3esftjfc.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp" \
  npx tsx src/server/dev-server.ts

# frontend — reads PORT to know where to proxy, so the two must agree
PORT=3111 VITE_PORT=5283 npx vite
```

`REMINDER_CHANNEL=gmail` is not optional if you want the ending: the default
channel is `log`, which renders the reminder and never sends it — so act 2 would
stop one beat short and act 3 would have nothing to read.

Check it is up: `curl -s localhost:3111/api/health` should say `"model":"reachable"`.

## 2. Sign the browser profile into Gmail — once, by hand

Act 3 opens **your** inbox, so the run reuses one persistent Chrome profile
rather than a fresh one. A fresh Playwright profile cannot pass Google's 2FA, and
nothing here scripts a password.

```bash
npm run demo:drive -- --gmail-login     # opens Gmail; sign in, then close the window
```

The session then survives across runs. `.demo-chrome-profile/` is gitignored
because it holds a live Google session — never commit or share it.

If you skip this, the run does not fail: act 3 captions itself **SKIPPED** in
amber and carries on. That is deliberate — a missing act costs one beat, a run
that dies at minute eighteen costs the whole recording.

## 3. Play it

```bash
npm run demo:drive -- --base=http://localhost:5283 --to=<your email> --record
```

- `--to` is required and is **never** defaulted or guessed: this sends real mail.
- `--record` writes `.webm` **and** `.mp4` into `screenshots/demo/video/`, and
  implies headless (the pointer and captions are drawn into the page, so the
  frames are identical) plus `--no-hold` (the file is only finalised by
  `context.close()`).
- Add `--headed` to watch it being made.
- Rehearse without sending anything: `--no-mail` (which also skips act 3, since
  there would be nothing to read) and `--speed=3` to cut the human pacing.

Roughly **22–28 minutes** at `--speed=1`, most of it model reply time.

## 4. The one step that needs the deployed app

**The engine switch cannot work against a single local server.** `resolveEngine`
is per *process*, not per request: it reads `AGENT_ENGINE` and ignores what the
request asked for, because `compute-stack.ts` runs two Fargate services off one
image and the **ALB** is what routes `X-Valentin-Engine: agentcore` to the
second. Locally the engine-B act therefore captions an honest amber downgrade —
"asked for AgentCore; this deployment is serving DIY" — and skips inspection
moment 3.

So: rehearse locally, and record the take you keep against the deployed app,
where all four inspection moments are live.

Do **not** "fix" this by setting `AGENT_ENGINE=agentcore` locally. That serves
engine B for the *whole* run, including the beats whose entire point is engine
A's double Bedrock call.

---

## What the run proves, and where it says so

Four moments turn the caption blue and are each read off the screen and then
asserted:

1. **Engine A spends two Bedrock calls on one turn** — the reply, plus a
   forced-tool `extract-preferences` pass. Fails the take on fewer than two
   `Converse` rows in that turn, or none of them extraction.
2. **That call, replayed hop by hop** through the drawer's step control. It picks
   the group with the most spans, so there are hops to step.
3. **Engine B spends none on extraction** — AgentCore Memory's managed strategy
   already holds the fact. Fails if an extraction row appears, *and* fails on an
   empty turn, which would make the claim true for the wrong reason. Needs the
   deployed app (see above).
4. **One `check_availability` call per room offered**, with a real clock time in
   the reply. Fails on zero spans: those times would then have to have come from
   the model, which is the one thing the beat says cannot happen.

Plus: her file must hold the music card before the playlist beat, so the Nina
Simone chain cannot break silently between being stored and being used; and a
reply that *announces* a booking with no proposal card on screen fails the take,
because a table nobody is holding is the worst thing this demo could claim.

## The one thing that is not real

The day-after survey in act 4. A survey exists because a date has passed, and a
day cannot pass during a demo, so that beat seeds the demo fixture whose outings
are already in the past and then lets the real unrated-outings path raise the
prompt. The script captions this in **amber, on screen, while it happens**.
Everything else in the run genuinely is real, and that claim is only worth
anything if this exception stays visible.

## Afterwards

Stills land in `screenshots/demo/`, numbered in play order; the video in
`screenshots/demo/video/`. Both are gitignored.

To prove the mail arrived from the mailbox side rather than trusting the log:

```bash
npm run verify:reminder-mail -- --to=<your email>
```

That needs one Google Disconnect→Connect in the integrations panel first: a
refresh token never gains the `gmail.readonly` scope it was not minted with.
Without it the command exits `2` and says the mailbox cannot be read — which is
deliberately a different exit code from "the mail did not arrive".
