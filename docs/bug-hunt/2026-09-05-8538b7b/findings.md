# Bug hunt — 2026-09-05 (8538b7b)

6 FAIL · 1 UNPROVEN · 20 PASS

UNPROVEN means the case could not be decided — a provider was unreachable or a
credential was missing. It is never counted as a pass.

| Status | Case | Group | Severity | Detail |
|---|---|---|---|---|
| FAIL | CON-01 | consistency | high | no date reached any tool across three turns |
| FAIL | DATE-03 | dates | high | oracle: agent said "23 Elul" for the Israeli day 2026-09-06; hebcal says 24 Elul 5786 |
| FAIL | DATE-04 | dates | medium | expected one of [search_restaurants, check_availability] to be called; called [check_shabbat] |
| FAIL | PLAY-03 | playlist | high | oracle: no ids were passed, so nothing could be cross-checked |
| FAIL | PLAY-04 | playlist | medium | 2 duplicate ids padded the playlist |
| FAIL | ROB-05 | robustness | low | reply does not match /\S{20,}/ |
| UNPROVEN | PLAY-02 | playlist | high | oracle unavailable: Spotify /v1/tracks: 403 |
| PASS | CON-02 | consistency | high | — |
| PASS | CON-03 | consistency | high | — |
| PASS | CON-04 | consistency | medium | — |
| PASS | CON-05 | consistency | medium | — |
| PASS | CON-06 | consistency | low | — |
| PASS | DATE-01 | dates | high | — |
| PASS | DATE-02 | dates | high | — |
| PASS | DATE-05 | dates | high | — |
| PASS | DATE-06 | dates | high | — |
| PASS | DATE-07 | dates | medium | — |
| PASS | DATE-08 | dates | medium | — |
| PASS | DATE-09 | dates | medium | — |
| PASS | DATE-10 | dates | low | — |
| PASS | PLAY-01 | playlist | high | — |
| PASS | PLAY-05 | playlist | high | — |
| PASS | ROB-01 | robustness | high | — |
| PASS | ROB-02 | robustness | medium | — |
| PASS | ROB-03 | robustness | medium | — |
| PASS | ROB-04 | robustness | medium | — |
| PASS | ROB-06 | robustness | medium | — |

## Failures in detail

### CON-01 (high) — consistency

The date agreed in turn one must be the date in the proposal three turns later. A silent change between search and card is the failure that books the wrong night.

**Observed.** no date reached any tool across three turns

Tools called: `find_restaurants({"query":"Italian"})`

Repro: `npx tsx eval/run.mts --case CON-01` · transcript: `transcripts/CON-01.md`

### DATE-03 (high) — dates

Confirmed bug #1: hebrewDateOf reads process-local components, so on a UTC host the Hebrew date beside a correct Israeli civil date is a day off between roughly 00:00 and 03:00 Israel.

**Observed.** oracle: agent said "23 Elul" for the Israeli day 2026-09-06; hebcal says 24 Elul 5786

Tools called: _none_

Repro: `npx tsx eval/run.mts --case DATE-03` · transcript: `transcripts/DATE-03.md`

### DATE-04 (medium) — dates

"Next Friday" asked on a Friday is the ambiguous case; either reading is defensible but a past date never is, and the reply must say which day it picked.

**Observed.** expected one of [search_restaurants, check_availability] to be called; called [check_shabbat]

Tools called: `check_shabbat({"when":"2026-09-11"})`

Repro: `npx tsx eval/run.mts --case DATE-04` · transcript: `transcripts/DATE-04.md`

### PLAY-03 (high) — playlist

The artists named in the prose must be the artists on the ids in the card. Naming a real song and attaching a different track is invisible until she plays it.

**Observed.** oracle: no ids were passed, so nothing could be cross-checked

Tools called: `find_music({"query":"Fleetwood Mac","limit":1})`, `find_music({"query":"Norah Jones","limit":1})`, `find_music({"query":"warm mellow folk rock female vocals","limit":1})`

Repro: `npx tsx eval/run.mts --case PLAY-03` · transcript: `transcripts/PLAY-03.md`

### PLAY-04 (medium) — playlist

A round-number request must not become a 400 or a quiet truncation. Whatever count reaches the card, the prose must state the real one.

**Observed.** 2 duplicate ids padded the playlist

Tools called: `find_music({"query":"Norah Jones","limit":10})`, `find_music({"query":"Fleetwood Mac","limit":10})`, `propose_playlist({"name":"Road Trip with Maya","note":"A mix of Fleetwood Mac's driving rhythms and Norah Jones' smooth vocals — perfect for the open road with her favorites","occasion":"your road trip","trackIds":["0ofHAoxe9vBkTCp2UQIavz","6jGnykaS6TkWp15utXSAeI","5e9TFTbltYBg2xThimr0rU","1zNXF2svmdlNxfS5XeNUgr","07GvNcU1WdyZJq3XxP0kZa","7zkLpY72g6lKQbiHDqri1S","5ihS6UUlyQAfmp48eSkxuQ","1qzHqfvKrZWo6dVHM1dXrj","1prZ0pr6XoRCxcrC3MCL0M","0AMKZWRgdFfGYYTxiWrwwH","4nZi6XNe36Ut4Nij3IQ1yC","36614jRE5gbd32fL1yAxv7","05oETzWbd4SI33qK2gbJfR","3pBncKks8ZvP64uXIPms7Q","19Ym5Sg0YyOCa6ao21bdoG","4yzFhsULEg65lbA7wjKaAQ","19Shlms2uTnOjIUg50TXzd","7zkLpY72g6lKQbiHDqri1S","254bXAqt3zP6P50BdQvEsq","1zNXF2svmdlNxfS5XeNUgr"]})`

Repro: `npx tsx eval/run.mts --case PLAY-04` · transcript: `transcripts/PLAY-04.md`

### ROB-05 (low) — robustness

A very long message must complete rather than blowing the context or timing out. Users paste.

**Observed.** reply does not match /\S{20,}/

Tools called: _none_

Repro: `npx tsx eval/run.mts --case ROB-05` · transcript: `transcripts/ROB-05.md`

