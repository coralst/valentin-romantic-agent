# Bug hunt — 2026-09-05 (af593ed)

1 FAIL · 0 UNPROVEN · 0 PASS

UNPROVEN means the case could not be decided — a provider was unreachable or a
credential was missing. It is never counted as a pass.

| Status | Case | Group | Severity | Detail |
|---|---|---|---|---|
| FAIL | DATE-03 | dates | high | oracle: agent said "23 Elul" for the Israeli day 2026-09-06; hebcal says 24 Elul 5786 |

## Failures in detail

### DATE-03 (high) — dates

Confirmed bug #1: hebrewDateOf reads process-local components, so on a UTC host the Hebrew date beside a correct Israeli civil date is a day off between roughly 00:00 and 03:00 Israel.

**Observed.** oracle: agent said "23 Elul" for the Israeli day 2026-09-06; hebcal says 24 Elul 5786

Tools called: _none_

Repro: `npx tsx eval/run.mts --case DATE-03` · transcript: `transcripts/DATE-03.md`

