# ROB-03 — PASS

**Why this case exists.** Non-Latin text must reach the tool arguments unmangled. A Hebrew venue or name corrupted on the way in produces a search for nothing and a card nobody can read.

## Tool calls (1)

### 1. `check_availability`

- service: `ontopo`
- ok: `false` · 0ms
- **args:** `{"restaurant":"Mika","date":"2026-09-10","time":"20:00","party_size":2}`
- summary: "Mika" is not one of the restaurants Valentin can book. Use find_restaurants and offer something from that list instead of promising this one.

## Final reply

> מיקה אינה במערכת ההזמנות שלי. אני יכול לבדוק לך מסעדות אחרות בתל אביב שאני כן יכול להזמין. איזה סוג של אווירה או מטבח מעניין אתכם? או שיש לכם שכונה מועדפת?
