# Valentin — GenAI TFC capstone · run of show

**Slot: 45 minutes, live demo included.** Deck: `public/deck-tfc.html` (12 slides) /
`docs/Valentin-TFC.pptx`.

45 minutes is a comfortable budget for these 12 slides, so nothing needs to be cut
or merged — Resilience and Security stay as separate slides, and the demo gets the
room it deserves.

## The clock

| At | Slide | Min | What you're actually doing |
|---|---|---|---|
| 00:00 | 01 · Title | 1.5 | Who you are, what Valentin is, and the one line that sets up the whole talk: he remembers what she said once. |
| 01:30 | 02 · Use case | 2.5 | The problem, then **the agent test** in the note — why this can't be a form plus a cron job. Do not skip the note; it's the rubric's "why agentic" question. |
| 04:00 | 03 · What it can do | 2.0 | Four beats, conversation in → booked evening out. Name the honest edges out loud (the mail really sends; the WhatsApp nudge is blocked by the guardrail). |
| 06:00 | 04 · Architecture | 4.0 | The anchor slide. Walk one request top to bottom, then use the A→B mapping to set up the four comparison slides. |
| 10:00 | **05 · LIVE DEMO** | **9.0** | See below — measured, not estimated. |
| 19:00 | 06 · Cost | 3.5 | The ledgers, then the scale table. Lead with the honest read: 187× collapses to 13.5× once Fargate's fixed $18 amortises. |
| 22:30 | 07 · Tool use | 2.5 | 20 tools, 13 read / 7 propose. The human-in-the-loop-by-construction point lands here. |
| 25:00 | 08 · Resilience | 3.5 | The 40-dot picture does the work. This is your strongest AgentCore argument — give it more air than Cost. |
| 28:30 | 09 · Security | 2.5 | One guardrail, both engines, tuned not switched on. Own the three known gaps rather than being asked about them. |
| 31:00 | 10 · The team | 2.5 | Disjoint ownership is the reason five agents editing at once isn't a merge-conflict generator. |
| 33:30 | 11 · The PRs | 2.0 | Every node is a real PR. Land the quote, then the 422-self-approve detail. |
| 35:30 | 12 · Lessons | 2.0 | Four conclusions. End on "don't trust healthy" — it's the one they'll remember. |
| 37:30 | Q&A | 7.5 | |
| 45:00 | — | | |

Content is 37.5 minutes, Q&A 7.5. If you overrun, the two slides that survive
compression best are **03 · What it can do** (the demo shows it anyway) and
**11 · The PRs** (the graph reads without narration). Never compress Architecture
or Resilience.

## The demo — 9 minutes

Drive it, don't hand-drive it:

```bash
npm run demo:drive -- --base=https://d26dwovftfq9oe.cloudfront.net --to=<your-address>
```

### Where the 9 minutes go

Measured against the deployed app on 2026-09-05, with `--no-mail --no-survey`:
**nine turns plus the entrance and the drawer/integrations tour ran in ~5 minutes**,
i.e. roughly **24 seconds per turn** end to end (typed at human speed, real Bedrock
reply, held on screen). The full run adds the two mail turns and the sweep:

| Act | Cost |
|---|---|
| Entrance — fresh profile, first greeting | ~30 s |
| Eleven turns, the profile filling itself | ~4.5 min |
| The drawer + integrations tour | ~45 s |
| **The 60-second sweep** | **95 s of deliberate waiting** |
| Day-after survey (substituted) | ~15 s |

That totals ~8 minutes; **budget 9** so a slow Bedrock turn doesn't eat into Cost.

Two moments carry the demo:

- **The sweep.** The script counts 95 seconds down on screen on purpose: nothing is
  clicked to make the mail send. Best moment in the talk and also the one place you
  can lose the room — talk over it. Use it to explain what the scheduler is and that
  the model isn't in the send path.
- **The survey** is explicitly labelled SUBSTITUTED on screen, because a day can't
  pass on stage. Say that out loud; it's a governance point in your favour, not an
  apology.

### Levers if you're behind

| Lever | Saves | Cost to the story |
|---|---|---|
| `--speed=1.4` | ~1.5–2 min | Typing and dwell get faster; Bedrock replies don't. Safe. |
| `--no-survey` | ~15 s | Small. Drop this first. |
| `--no-mail` | ~2.5 min | **Don't.** It removes the 95s sweep *and* two turns, and the unprompted mail is the payoff. |

### Before you present

1. Rehearse the full command once, timed — the 24s/turn figure moves with Bedrock
   latency, and the mail path is the part this rehearsal didn't exercise.
2. `npm run verify:reminder-mail -- --to=<your-address>` needs one Google
   Disconnect→Connect first, or it exits 2. Do that reconnect *before* the talk.
3. Have `screenshots/demo/` from the rehearsal open in a second window as the
   fallback. If the live run stalls, switch to the stills and keep talking — do not
   debug on stage.
