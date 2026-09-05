# CON-05 — PASS

**Why this case exists.** The card and the prose must agree. A user reads the sentence and clicks the button, so a venue or time that differs between them is a booking they did not agree to.

## Tool calls (1)

### 1. `check_shabbat`

- service: `hebcal`
- ok: `true` · 1ms
- **args:** `{"city":"Tel Aviv","when":"2026-09-05T20:00"}`
- summary: Tel Aviv: Shabbat begins 2026-09-12 at 19:28 and ends (Havdalah, מוצ״ש) 2026-09-13 at 19:26 (Parashat Nitzavim-Vayeilech) That time is outside Shabbat, so it is available.

## Final reply

> Just to confirm — you mean tonight, Saturday September 5th, or next Saturday the 12th?
> 
> Tonight is already 21:16, so 8pm has passed. If you're thinking of next Saturday, that's מוצ"ש (after Havdalah at 19:26), so 8pm works perfectly. Let me know which Saturday and I'll find you a great Italian spot for Maya.
