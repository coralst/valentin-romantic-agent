# DATE-04 — FAIL

**Why this case exists.** "Next Friday" asked on a Friday is the ambiguous case; either reading is defensible but a past date never is, and the reply must say which day it picked.

**What went wrong.** expected one of [search_restaurants, check_availability] to be called; called [check_shabbat]

## Tool calls (1)

### 1. `check_shabbat`

- service: `hebcal`
- ok: `true` · 9ms
- **args:** `{"when":"2026-09-11"}`
- summary: Tel Aviv: Shabbat begins 2026-09-12 at 19:28 and ends (Havdalah, מוצ״ש) 2026-09-13 at 19:26 (Parashat Ha’azinu)

## Final reply

> I'd be happy to help find a table! Just so I'm clear — next Friday is September 12th, and Shabbat starts at 19:28 that evening. Are you looking for a table before candle lighting (so around 18:00 or earlier), or did you mean Saturday night after Havdalah (which is 19:26)?
> 
> And how many people will be joining you?
