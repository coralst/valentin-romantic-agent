# DATE-03 — FAIL

**Why this case exists.** Confirmed bug #1: hebrewDateOf reads process-local components, so on a UTC host the Hebrew date beside a correct Israeli civil date is a day off between roughly 00:00 and 03:00 Israel.

**What went wrong.** oracle: agent said "23 Elul" for the Israeli day 2026-09-06; hebcal says 24 Elul 5786

## Tool calls (0)

_none_

## Final reply

> Today is **23 Elul 5786** in the Hebrew calendar.
