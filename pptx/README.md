# Decks

Built artefacts, committed so a version can be opened without rebuilding it. The
generators live in `../scripts/`.

| File | Built by | What changed |
|---|---|---|
| `Valentin-Presentation-v9.pptx` | `build-pptx.py` + hand edits | last version before the cost/assumptions rework |
| `Valentin-Presentation-v10.pptx` | `swap-official-aws-icons.py` | official AWS service icons |
| `Valentin-Presentation-v11.pptx` | `build-v11-edits.py`, then `patch-slide6.py` | **current working deck** — slide 6 rebuilt from `cost-one-user.mjs` |
| `Valentin-Presentation-v12.pptx` | `build-v12-slide5.py` | v11 + a slide-5 variant; forked from v11, not a successor to it |
| `Valentin-Presentation-v13.pptx` | hand-edited from v11 | **current deck** — slide 6 reworked by hand |
| `Valentin-Assumptions-Slide.pptx` | `patch-slide6.py` + extract | slide 6 alone, for review in isolation |

**v13 is the live one, and it is hand-edited.** Do not regenerate it with
`patch-slide6.py` — that script targets v11 and would discard the hand edits. v12
branched off an earlier v11 to try a slide-5 layout and never carried the slide-6
corrections, so it is a variant rather than a successor. The numbering implies a
straight line; the table is right.

## Rebuilding

`build-v11-edits.py` reads and writes the **same** file and is not idempotent —
running it twice double-applies or crashes. To change slide 6, edit
`slide6_body`/`HERO6` in that script and run `patch-slide6.py`, which strips the
generated body of slide 6 in place and lays it out again.

Numbers on slide 6 come from `scripts/cost-one-user.mjs`. Change the model, re-run
it, then re-patch — the two are not wired together automatically.
