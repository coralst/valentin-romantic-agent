# Valentin — GenAI TFC capstone · run of show

**Slot: 45 minutes, live demo included.** Deck: `public/deck-tfc.html` (13 slides) /
`docs/Valentin-TFC.pptx`.

45 minutes is a comfortable budget for these 13 slides, so nothing needs to be cut
or merged — Resilience and Security stay as separate slides, and the demo gets the
room it deserves.

The slides carry very little text on purpose. **You are the content** — each card is
a cue, not a script. The notes below are what you say out loud.

## The clock

| At | Slide | Min | What you're actually doing |
|---|---|---|---|
| 00:00 | 01 · Title | 1.5 | Who you are, what Valentin is, and the one line that sets up the whole talk: he remembers what she said once. |
| 01:30 | 02 · Agenda | 0.5 | Read the eleven sections in one breath, flag the demo at 04 so they know it's coming. Don't dwell. |
| 02:00 | 03 · Use case | 2.5 | The problem, then say **the agent test** out loud — unstructured input over weeks, next tool depends on what came back, human in the loop before anything sends. It's the rubric's "why agentic" question. |
| 04:30 | 04 · What the app can do | 2.0 | Four beats, conversation in → booked evening out. Name the honest edges out loud (the mail really sends; the WhatsApp nudge is blocked by the guardrail). |
| 06:30 | 05 · Architecture | 4.0 | The anchor slide. Walk one request top to bottom, then use the A→B mapping to set up the four comparison slides. |
| 10:30 | **06 · LIVE DEMO** | **9.0** | See below — measured, not estimated. The slide carries the app link if you'd rather click through than run the script. |
| 19:30 | 07 · Comparison — Cost | 3.5 | The ledgers, then the scale table. Lead with the honest read: 187× collapses to 13.5× once Fargate's fixed $18 amortises. |
| 23:00 | 08 · Comparison — Tool use | 2.5 | 20 tools, 13 read / 7 propose. The human-in-the-loop-by-construction point lands here. |
| 25:30 | 09 · Comparison — Resilience | 3.5 | The 40-dot picture does the work. This is your strongest AgentCore argument — give it more air than Cost. |
| 29:00 | 10 · Comparison — Security | 2.5 | One guardrail, both engines, tuned not switched on. Own the three known gaps rather than being asked about them. |
| 31:30 | 11 · The agent team | 2.5 | Disjoint ownership is the reason five agents editing at once isn't a merge-conflict generator. |
| 34:00 | 12 · The PRs graph | 2.0 | Every node is a real PR. Land the 422-self-approve detail — that's why approval is a comment token. |
| 36:00 | 13 · Lessons learned | 2.0 | Four conclusions. End on "don't trust healthy" — it's the one they'll remember. |
| 38:00 | Q&A | 7.0 | |
| 45:00 | — | | |

Content is 38 minutes, Q&A 7. If you overrun, the two slides that survive
compression best are **04 · What the app can do** (the demo shows it anyway) and
**12 · The PRs graph** (the graph reads without narration). Never compress
Architecture or Resilience.

## The demo — 9 minutes

Slide 06 carries a live link to the deployed app
(`https://d26dwovftfq9oe.cloudfront.net`) — clicking it opens the real thing, past
the login gate. But drive the demo with the script, don't hand-drive it:

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
