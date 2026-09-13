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
| `Valentin-Slide-Team-Tree.pptx` | `build-team-tree-slide.py` | slide 14 alone — the team as a ghost-icon family tree, replacing the card grid |
| `Valentin-Slide-PR-Graph.pptx` | `build-pr-graph-slide.py` | slide 15 alone — same design, PR graph and figures re-rendered from live data |

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

## The two team slides

Both single-slide files are built standalone and pasted into the live deck, and
both read every figure from `scripts/deck_stats.py`, so they cannot quote
different totals. To bring them up to date:

```bash
python3 scripts/generate-agent-graph.py --refresh   # re-query GitHub
npm test                                            # then update UNIT_TESTS
npx playwright test --list                          # then update E2E_SPECS
python3 scripts/build-team-tree-slide.py
python3 scripts/build-pr-graph-slide.py
```

`deck_stats.py` carries the two test counts as constants because no snapshot
holds them; everything else comes out of `docs/assets/graph/pr-history.json`.
`build-pr-graph-slide.py` re-renders the graph at whatever node spacing makes the
current PR count fit the slide's picture box, and drops the PR numbers inside the
nodes once they would be unreadable — the graph's design is otherwise untouched.
Check a rebuilt slide with `qlmanage -t -s 2200 -o . <file>.pptx`; there is no
LibreOffice on this machine.
