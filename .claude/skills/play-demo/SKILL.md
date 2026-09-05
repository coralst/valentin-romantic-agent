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

It opens a headed Chromium on **the login page**, signs in, starts a new profile,
holds the eleven-turn conversation at typing speed, shows the rail filling in,
opens the architecture drawer and the integrations panel, waits out the
60-second scheduler sweep while the real email is sent, and ends on the
day-after survey. Roughly **12–15 minutes** at `--speed=1`.

The browser window stays open at the end on purpose. Ctrl-C closes it.

## Before you run it

1. **The servers must be up.** Check `curl -s localhost:3101/api/health`. If it is
   not answering, start both from the worktree (ports are deliberately not the
   defaults — 3001/5173 are usually held by stale processes from the main
   checkout):

   ```bash
   AWS_PROFILE=dev-devops-agent AWS_REGION=us-east-1 PORT=3101 npx tsx src/server/dev-server.ts
   PORT=3101 VITE_PORT=5273 npx vite
   ```

   Bedrock needs `AWS_PROFILE=dev-devops-agent`; without it every turn silently
   returns an error fallback and the demo is worthless.

2. **You need their email address.** `--to` is required and must never be guessed
   or assembled — the run sends a real reminder, and mail to an invented address
   reaches a stranger and cannot be un-sent. If you do not have it, ask for it, or
   offer `--no-mail` to rehearse without the send.

3. **Say what will happen** before starting a run that sends mail. One line is
   enough: it will take about a quarter of an hour and will email that address.

## Flags

| Flag | For |
|---|---|
| `--to=addr` | Required unless `--no-mail`. Where the reminder goes. |
| `--speed=1.6` | Rehearse faster. Model reply time does not scale — only the human pacing does. |
| `--no-mail` | Drops the address turn *and* the send turn, so nothing is emailed. |
| `--no-survey` | Skip the final substituted beat. |
| `--no-hold` | Exit instead of leaving the window open. For checking the script itself. |
| `--base=url` | Point at a different origin (default `http://localhost:5273`). |

## Afterwards

Screenshots land in `screenshots/demo/` (gitignored), numbered in play order.

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
