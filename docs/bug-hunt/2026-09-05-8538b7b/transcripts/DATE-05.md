# DATE-05 — PASS

**Why this case exists.** "In two weeks" is plain arithmetic: exactly +14 days from the Israeli today.

## Tool calls (1)

### 1. `set_reminder`

- service: `reminders`
- ok: `true` · 1ms
- **args:** `{"title":"Plan something for Maya","date":"2026-09-19"}`
- summary: The reminder is saved: "Plan something for Maya" on 2026-09-19, to go out on Saturday 19 September at 08:30 Israel time. But there is no email address on file for him, so it cannot actually be sent yet. Tell him it is noted, and ask what address he wants reminders at — once he gives it, this one will go out on its own.

## Final reply

> The reminder is noted — "Plan something for Maya" on Saturday 19 September. It'll go out at 8:30 that morning.
> 
> I don't have an email address for you yet, so I can't actually send it. What address should I use for reminders?
