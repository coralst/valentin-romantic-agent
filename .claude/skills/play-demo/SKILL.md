---
name: play-demo
description: Use when asked to "play the demo", "run the demo", "show me the demo" or "drive the demo" for the Valentin app. Boots the local servers if needed, then opens a real browser on the login page and plays the whole scripted demo at human speed - typing character by character, moving the pointer, sending the real reminder email - so a person can watch it happen live.
---

# Play the demo

`scripts/demo-drive.mts` is the whole thing. **Run it — do not drive the browser
by hand** with Playwright MCP or by pasting messages into the UI; the point of the
script is that the pacing, the pointer, the captions and the wait-for-reply logic
are all already correct in it, and a hand-driven run reproduces none of that.

## What "play the demo" means

One command, watched live:

```bash
npm run demo:drive -- --to=<their email>
```

It opens a headed Chromium on **the login page** and plays **four acts**:

1. **The entrance** — the landing page, the way in, and a profile that knows
   nothing yet.
2. **The conversation** — everything else the product does, in one unbroken
   thread. The facts about her, typed at human speed; the rail filling in and the
   countdown; the live architecture drawer, opened once and never closed; two
   memory questions on the Glue code and the same two on AgentCore; the
   scoreboard; her file; the integrations panel; then the plan — a **Google
   Calendar** clash check, an **Ontopo** table and a **Spotify** playlist he asks
   to keep as a surprise, each confirmed on camera; his own address; and a change
   of notice period to a fortnight, which is what makes the reminder due. The
   last thing this act does is **post a letter**: the 60-second sweep fires and
   the real mail goes out.
3. **The inbox** — his actual Gmail, opened in the same browser. The newest
   message, the restaurant he chose confirmed back to him, and the surprise
   playlist link opened.
4. **The day-after survey** — the one substituted beat.

The anniversary date is **computed at launch**, at least **eight days out** and
never Shabbat, so the script can be run on any day. Eight is a floor and not a
taste: `leadTimeDays` defaults to a week and `syncReminders` arms the row the
moment the date lands on the profile, so a nearer occasion is already overdue at
turn 1 and the sweep mails at ninety seconds — before there is a restaurant or a
playlist to put in it. Act 2's closing turn asks for **two weeks'** notice, and
that is what brings the row due on camera. A fortnight and not "five days":
`REMINDER_LEAD_OPTIONS` has no five-day entry and `leadTimeDays` silently falls
back to a week, so that ask would look like it worked and never come due.

### The four marked inspection moments

The drawer is opened once, early, and at four points the caption **turns blue**
to say *this is the bit to look at*. Each one is read off the screen and then
**asserted**, so a take that would ship a false claim dies instead of the claim
being discovered in review:

1. **Engine A spends two Bedrock calls on one turn** — the reply plus the
   forced-tool `extract-preferences` pass. Fails the take if the newest group
   holds fewer than two `Converse` rows.
2. **That call replayed hop by hop** through the drawer's step control. Fails if
   there is no step counter to step.
3. **Engine B spends none on extraction** — AgentCore Memory's managed strategy
   holds the fact, so there is no extraction span at all. Fails if an extraction
   row appears, *and* fails on an empty group, which would make the claim true
   for the wrong reason.
4. **One `check_availability` span per restaurant offered**, with a real clock
   time in the reply. Fails on zero spans: those times would then have to have
   come from the model, which is the one thing the beat claims cannot happen.

Her file is checked too — the music card must exist before the playlist beat, so
the Nina Simone chain cannot break silently between being stored and being used.

Roughly **22–28 minutes** at `--speed=1`, most of it model reply time.

**The run reviews itself.** Every scripted turn carries reply assertions —
the restaurant turn must talk about restaurants, the music turn must not, a
reply that names a weekday must name the *right* one. A reply that violates one
**fails the take immediately** with the offending text in the log, instead of
the failure being discovered in video review afterwards.

The browser window stays open at the end on purpose. Ctrl-C closes it.

## Recording it

```bash
npm run demo:drive -- --to=<their email> --record
```

Same run, written to `screenshots/demo/video/` as `.webm` **and** `.mp4` (ffmpeg
converts it; Keynote and Slack will not play the webm). Recording implies
headless — the pointer and captions are drawn into the page, so the frames are
identical and nobody's screen is held for twenty minutes. Add `--headed` to watch
it being made.

`--record` also implies `--no-hold`, and must: the video file is only finalised by
`context.close()`, so a run left holding at the end and then Ctrl-C'd leaves a
truncated file.

## Before you run it

1. **The servers must be up.** Check `curl -s localhost:3101/api/health`. If it is
   not answering, start both from the worktree (ports are deliberately not the
   defaults — 3001/5173 are usually held by stale processes from the main
   checkout):

   ```bash
   AWS_PROFILE=dev-devops-agent AWS_REGION=us-east-1 PORT=3101 \
     REMINDER_CHANNEL=gmail npx tsx src/server/dev-server.ts
   PORT=3101 VITE_PORT=5273 npx vite
   ```

   Bedrock needs `AWS_PROFILE=dev-devops-agent`; without it every turn silently
   returns an error fallback and the demo is worthless. `REMINDER_CHANNEL=gmail`
   is what makes act 2's last beat and the whole of act 3 possible — the default
   channel is `log`, which renders the reminder and never sends it.

   Vite reads `PORT` to know where to proxy, so the two must agree.

2. **The engine switch needs the deployed app, not localhost.** `resolveEngine` is
   per *process*, not per request — it reads `AGENT_ENGINE` and ignores what the
   request asked for, because `compute-stack.ts` runs two Fargate services off one
   image and the **ALB** is what routes `X-Valentin-Engine: agentcore` to the
   second. So a single `dev-server.ts` serves one engine however the rail is
   flipped, and against `localhost` the engine-B act correctly captions an amber
   downgrade and skips inspection moment 3.

   Do **not** "fix" this by setting `AGENT_ENGINE=agentcore` on the local server:
   that serves engine B for the *whole* run, including the beats whose entire point
   is engine A's double Bedrock call. Record the take against the deployed app if
   you need all four inspection moments. (Prod has a login gate — the driver clicks
   `demo-login-button` before waiting for the icon rail.)

3. **You need their email address.** `--to` is required and must never be guessed
   or assembled — the run sends a real reminder, and mail to an invented address
   reaches a stranger and cannot be un-sent. If you do not have it, ask for it, or
   offer `--no-mail` to rehearse without the send.

4. **Say what will happen** before starting a run that sends mail. One line is
   enough: it will take about a quarter of an hour and will email that address.

## Flags

| Flag | For |
|---|---|
| `--to=addr` | Required unless `--no-mail`. Where the reminder goes. |
| `--speed=1.6` | Rehearse faster. Model reply time does not scale — only the human pacing does. |
| `--dwell=0.4` | Trim the standing-still pauses only, leaving typing alone. Default `0.62`. |
| `--no-mail` | Drops the address turn *and* the send turn, so nothing is emailed. |
| `--no-survey` | Skip the final substituted beat. |
| `--no-hold` | Exit instead of leaving the window open. For checking the script itself. |
| `--base=url` | Point at a different origin (default `http://localhost:5273`). |
| `--record` | Write a video as well. Implies headless and `--no-hold`. |
| `--headed` | Show the window during a `--record` run. |
| `--gmail-login` | Open Gmail and wait for a human to sign in, then exit. One-time setup for act 3 — see below. |
| `--no-inbox` | Skip act 3. Implied by `--no-mail`: there is nothing to read. |
| `--profile-dir=path` | Where the reused browser profile lives. Default `.demo-chrome-profile/` (gitignored). |

## Act 3 needs a signed-in browser profile

Reading the mail means reading *his* mailbox, so the run reuses one Chrome
profile (`launchPersistentContext`) instead of a fresh one. Sign in by hand,
once:

```bash
npm run demo:drive -- --gmail-login    # opens Gmail; sign in, then close the window
```

The session then survives across runs. Nothing about this is scripted — no
credentials are typed by the driver and none are stored in the repo; the profile
directory is gitignored because it holds a live Google session.

If the profile is not signed in when act 3 arrives, the run **captions an amber
SKIPPED and carries on**. That is deliberate: a run that dies at minute eighteen
on a Gmail selector costs the whole take, and a missing act costs one beat.
`--no-inbox` skips it outright.

`--record` prefers the real `chrome` channel over bundled Chromium — Google's
automation checks are friendlier to it — and falls back with a log line if Chrome
is not installed.

## What the plan beats need, and what they do when they do not have it

These beats are written to degrade honestly rather than to be skipped, because a
missing credential is a normal state of this app and pretending otherwise is the
one thing the script must not do.

- **Calendar** needs `GOOGLE_*` in `.env`; the clash check is read-only either way.
- **Ontopo** needs nothing — but `confirm` only *books* when a full
  `ONTOPO_GUEST_*` identity is set, which no local `.env` has. Without it the
  confirm mints a checkout link and hands it over, which is why it is safe to press
  Confirm on camera. **Do not set the guest variables to make the demo look
  better** — that books a real table at a real restaurant.
- **Spotify** searches on the client-credentials pair alone; without
  `SPOTIFY_REFRESH_TOKEN` a confirmed playlist hands over track links instead of
  saving into a library, and says so.
- **The engine switch** reads the serving chip back before captioning it. If
  AgentCore is not wired on the deployment, the caption says so in amber and the
  engine-B turn is skipped, rather than narrating engine A's answers as AgentCore's.

## Afterwards

Screenshots land in `screenshots/demo/` (gitignored), numbered in play order; the
video, if any, in `screenshots/demo/video/`.

To prove the email arrived from the mailbox side rather than trusting the log:

```bash
npm run verify:reminder-mail -- --to=<their email>
```

This needs **one** Google Disconnect→Connect in the integrations panel first,
because a refresh token never gains the `gmail.readonly` scope it was not minted
with. Without that it exits `2` and says the mailbox cannot be read — which is
deliberately not the same exit code as "the mail did not arrive".

## The one thing that is not real

The day-after survey. A survey exists because a date passed, and a day cannot
pass during a demo, so the last beat seeds the demo fixture whose outings are
already in the past and lets the real `unratedOutings` path raise the prompt. The
script captions this in amber on screen while it happens. **Do not describe it as
real, and do not remove the caption** — everything else in the run genuinely is,
and that claim is only worth anything if this exception stays visible.
