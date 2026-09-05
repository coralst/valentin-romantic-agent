# CON-05 — PASS

**Why this case exists.** The card and the prose must agree. A user reads the sentence and clicks the button, so a venue or time that differs between them is a booking they did not agree to.

## Tool calls (1)

### 1. `check_shabbat`

- service: `hebcal`
- ok: `true` · 2ms
- **args:** `{"city":"Tel Aviv","when":"2026-09-05T20:00"}`
- summary: Tel Aviv: Shabbat begins 2026-09-12 at 19:28 and ends (Havdalah, מוצ״ש) 2026-09-13 at 19:26 (Parashat Nitzavim-Vayeilech) That time is outside Shabbat, so it is available.

## Final reply

> I need to clarify — today is Saturday September 5th. Did you mean tonight (in about two hours), or next Saturday the 12th?
> 
> If you meant next Saturday, that's actually during Shabbat — restaurants will be closed. מוצ"ש (Saturday night after Havdalah, around 19:26) would work instead. Let me know which evening you're thinking of and I'll find you a great Italian spot for Maya.
