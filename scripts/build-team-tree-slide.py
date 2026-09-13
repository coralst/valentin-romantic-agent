#!/usr/bin/env python3
"""Build the team slide as a family tree of ghost personas — one slide, one file.

The card-grid version of this slide lost the thing that made it read as a team:
the ghost icons and the human → orchestrator → crew descent that
``public/deck-v2.html`` §15 has. This rebuilds that tree in the deck's own
palette so it can be pasted straight into the deck, and takes every number from
``scripts/deck_stats.py`` so it cannot drift from the PR-graph slide.

Run:  python3 scripts/build-team-tree-slide.py
Out:  pptx/Valentin-Slide-Team-Tree.pptx
"""

from __future__ import annotations

import pathlib
import sys

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import deck_stats  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS = ROOT / "docs" / "assets" / "agents" / "png"
OUT = ROOT / "pptx" / "Valentin-Slide-Team-Tree.pptx"

# ── the deck's palette, sampled from the slide this replaces ────────────────
NAVY = RGBColor(0x23, 0x2F, 0x3E)
ORANGE = RGBColor(0xFF, 0x99, 0x00)
MUTED = RGBColor(0x54, 0x5B, 0x64)
BODY = RGBColor(0x16, 0x19, 0x1F)
CARD = RGBColor(0xF7, 0xF8, 0xFA)
BORDER = RGBColor(0xE4, 0xE7, 0xEA)
CHIP = RGBColor(0xFF, 0xEF, 0xD6)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
FONT = "Calibri"

# Lane colours, shared with scripts/generate-agent-graph.py so a persona reads
# as the same character on both slides.
LANE = {
    "master": RGBColor(0x7B, 0x68, 0xEE),
    "architect": RGBColor(0xFF, 0x8C, 0x00),
    "frontend": RGBColor(0x1E, 0x90, 0xFF),
    "backend": RGBColor(0x32, 0xCD, 0x32),
    "design": RGBColor(0xFF, 0x69, 0xB4),
    "qa": RGBColor(0xFF, 0x45, 0x00),
}


def text_box(slide, left, top, width, height, *, anchor=MSO_ANCHOR.TOP,
             align=PP_ALIGN.LEFT, wrap=True):
    box = slide.shapes.add_textbox(Inches(left), Inches(top),
                                   Inches(width), Inches(height))
    frame = box.text_frame
    frame.word_wrap = wrap
    frame.vertical_anchor = anchor
    frame.margin_left = frame.margin_right = 0
    frame.margin_top = frame.margin_bottom = 0
    frame.paragraphs[0].alignment = align
    return frame


def write(frame, runs, *, size=11, colour=BODY, bold=False, spacing=None):
    """Fill a text frame with one paragraph of runs. `runs` is str or [(t, bold)]."""
    para = frame.paragraphs[0]
    if spacing is not None:
        para.line_spacing = spacing
    if isinstance(runs, str):
        runs = [(runs, bold)]
    for text, is_bold in runs:
        run = para.add_run()
        run.text = text
        run.font.name = FONT
        run.font.size = Pt(size)
        run.font.bold = is_bold
        run.font.color.rgb = colour
    return para


def rect(slide, left, top, width, height, fill, *, shape=MSO_SHAPE.RECTANGLE,
         line=None, adjust=None):
    box = slide.shapes.add_shape(shape, Inches(left), Inches(top),
                                 Inches(width), Inches(height))
    box.fill.solid()
    box.fill.fore_color.rgb = fill
    if line is None:
        box.line.fill.background()
    else:
        box.line.color.rgb = line
        box.line.width = Pt(1)
    box.shadow.inherit = False
    if adjust is not None and box.adjustments:
        box.adjustments[0] = adjust
    return box


def chrome(slide, *, number, title, lede, page):
    """The header, rule and footer every deck slide carries."""
    rect(slide, 0, 0, 13.333, 7.5, WHITE)
    badge = rect(slide, 0.55, 0.4, 0.65, 0.65, NAVY, shape=MSO_SHAPE.OVAL)
    frame = badge.text_frame
    frame.margin_left = frame.margin_right = 0
    frame.vertical_anchor = MSO_ANCHOR.MIDDLE
    frame.paragraphs[0].alignment = PP_ALIGN.CENTER
    write(frame, number, size=26, colour=ORANGE, bold=True)

    write(text_box(slide, 1.4, 0.4, 11.0, 0.65, anchor=MSO_ANCHOR.MIDDLE),
          title, size=30, colour=NAVY, bold=True)
    rect(slide, 0.55, 1.15, 1.5, 0.04, ORANGE)
    write(text_box(slide, 0.55, 1.4, 12.2, 0.42), lede, size=14, colour=MUTED)
    write(text_box(slide, 0.55, 7.05, 9.0, 0.35),
          "VALENTIN   ·   GenAI TFC Capstone Deep-Dive",
          size=10, colour=MUTED, bold=True)
    write(text_box(slide, 11.3, 7.05, 1.5, 0.35, align=PP_ALIGN.RIGHT),
          page, size=10, colour=MUTED)


def connector(slide, x, top, bottom):
    rect(slide, x - 0.008, top, 0.016, bottom - top, BORDER)


def ghost(slide, key, left, top, size):
    slide.shapes.add_picture(str(ICONS / f"{key}.png"), Inches(left),
                             Inches(top), Inches(size), Inches(size))


def crew_card(slide, agent, left, top, width, height):
    """One persona: ghost, name, owned path, remit, and what it actually shipped."""
    rect(slide, left, top, width, height, CARD, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
         line=BORDER, adjust=0.06)
    rect(slide, left, top, width, 0.055, LANE[agent["key"]])

    pad = 0.14
    inner = width - 2 * pad
    ghost(slide, agent["key"], left + pad, top + 0.13, 0.46)
    write(text_box(slide, left + pad + 0.54, top + 0.19, inner - 0.54, 0.34),
          agent["name"], size=12, colour=NAVY, bold=True)

    chip = rect(slide, left + pad, top + 0.66, inner, 0.24, CHIP,
                shape=MSO_SHAPE.ROUNDED_RECTANGLE, adjust=0.35)
    frame = chip.text_frame
    frame.margin_left = frame.margin_right = 0
    frame.margin_top = frame.margin_bottom = 0
    frame.vertical_anchor = MSO_ANCHOR.MIDDLE
    frame.paragraphs[0].alignment = PP_ALIGN.CENTER
    write(frame, agent["owns"], size=9.5, colour=MUTED, bold=True)

    write(text_box(slide, left + pad, top + 0.98, inner, 0.62),
          agent["remit"], size=10, colour=BODY, spacing=0.95)
    rect(slide, left + pad, top + height - 0.62, inner, 0.012, BORDER)
    write(text_box(slide, left + pad, top + height - 0.55, inner, 0.5),
          agent["shipped"], size=9.5, colour=MUTED, spacing=0.95)


def build(stats):
    deck = Presentation()
    deck.slide_width, deck.slide_height = Inches(13.333), Inches(7.5)
    slide = deck.slides.add_slide(deck.slide_layouts[6])

    chrome(slide, number="14", title="I didn’t write it. They did.",
           lede="Six agent personas with disjoint file ownership, and one human "
                "who holds the veto.",
           page="15 / 18")

    centre = 13.333 / 2

    # ── tier 1 · the human ──────────────────────────────────────────────
    human_w, human_top, human_h = 5.6, 1.9, 0.5
    rect(slide, centre - human_w / 2, human_top, human_w, human_h, NAVY,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, adjust=0.18)
    frame = text_box(slide, centre - human_w / 2, human_top, human_w, human_h,
                     anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER)
    write(frame, [("Coral · human", True),
                  ("   product intent · final say · veto", False)],
          size=11.5, colour=WHITE)

    # ── tier 2 · the orchestrator ───────────────────────────────────────
    master_top, master_w, master_h = 2.62, 6.6, 0.82
    connector(slide, centre, human_top + human_h, master_top)
    master_left = centre - master_w / 2
    rect(slide, master_left, master_top, master_w, master_h, CARD,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, line=BORDER, adjust=0.09)
    rect(slide, master_left, master_top, master_w, 0.055, LANE["master"])
    ghost(slide, "master", master_left + 0.18, master_top + 0.17, 0.5)
    write(text_box(slide, master_left + 0.8, master_top + 0.17, 3.0, 0.3),
          "Master Agent", size=13, colour=NAVY, bold=True)
    chip = rect(slide, master_left + 2.0, master_top + 0.19, 1.5, 0.24, CHIP,
                shape=MSO_SHAPE.ROUNDED_RECTANGLE, adjust=0.35)
    chip.text_frame.vertical_anchor = MSO_ANCHOR.MIDDLE
    chip.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
    write(chip.text_frame, ".kiro/  ·  .github/", size=9.5, colour=MUTED, bold=True)
    write(text_box(slide, master_left + 3.3, master_top + 0.19, master_w - 3.5, 0.28,
                   anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.RIGHT, wrap=False),
          f"{stats['authored']['infra'] + stats['authored']['master']} PRs in its "
          f"lane  ·  reviewed {stats['reviewed']['master']} of {stats['prs']}",
          size=10, colour=MUTED, bold=True)
    write(text_box(slide, master_left + 0.8, master_top + 0.5, master_w - 1.6, 0.3),
          "Decomposes, delegates, reviews, merges — and posts the last word.",
          size=10.5, colour=BODY)

    # ── tier 3 · the crew ───────────────────────────────────────────────
    crew_top, card_w, card_h, gap = 3.78, 2.29, 2.06, 0.16
    left0 = 0.62
    bus_y = crew_top - 0.2
    connector(slide, centre, master_top + master_h, bus_y)
    first = left0 + card_w / 2
    last = left0 + 4 * (card_w + gap) + card_w / 2
    rect(slide, first, bus_y, last - first, 0.016, BORDER)

    crew = [
        {"key": "architect", "name": "System Architect", "owns": "src/shared/",
         "remit": "Contracts and shared types. Writes the spec before anyone "
                  "branches.",
         "shipped": f"{stats['authored']['architect']} PRs  ·  #2 shared types  ·  "
                    f"#44 preferenceCategoryCount"},
        {"key": "frontend", "name": "Frontend Dev", "owns": "src/client/",
         "remit": "Components, hooks, state. Cannot touch shared types.",
         "shipped": f"{stats['authored']['frontend']} PRs  ·  #3 chat UI  ·  "
                    f"#58 Partner Profile Panel, 27 files"},
        {"key": "backend", "name": "Backend Dev", "owns": "src/server/",
         "remit": "API, Bedrock extraction, persistence. Cannot touch the client.",
         "shipped": f"{stats['authored']['backend']} PRs  ·  #15 real Bedrock SDK  ·  "
                    f"#127 eleven tool-usage bugs"},
        {"key": "design", "name": "UI Designer", "owns": "design-system/",
         "remit": "Tokens, accessibility, eight real mockups to choose from.",
         "shipped": "#16 refined palette  ·  #22 component pass  ·  8 mockups, "
                    "one shipped"},
        {"key": "qa", "name": "QA Agent", "owns": "e2e/",
         "remit": "Playwright E2E and regression coverage. Cannot touch src at all.",
         "shipped": f"#8 onboarding and responsive  ·  {stats['e2e_specs']} E2E specs  "
                    f"·  {stats['unit_tests']:,} unit tests green"},
    ]
    for i, agent in enumerate(crew):
        left = left0 + i * (card_w + gap)
        connector(slide, left + card_w / 2, bus_y, crew_top)
        crew_card(slide, agent, left, crew_top, card_w, card_h)

    # ── the two closing lines ───────────────────────────────────────────
    write(text_box(slide, 0.62, 5.96, 12.1, 0.44),
          "Each is a prompt file in .kiro/agents/ with a voice exemplar and an "
          "explicit do-not-modify list. Disjoint ownership is what keeps five agents "
          "editing at once from being a merge-conflict generator. Lane counts are "
          "attributed the same way the PR graph attributes them — by the PR’s "
          "agent label, or its branch prefix.",
          size=10.5, colour=MUTED, spacing=0.95)

    strip = rect(slide, 0.62, 6.46, 12.1, 0.42, CHIP,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE, adjust=0.2)
    strip.text_frame.vertical_anchor = MSO_ANCHOR.MIDDLE
    strip.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
    write(strip.text_frame,
          [(f"{stats['prs']} pull requests  ·  {stats['merged']} merged  ·  "
            f"{stats['comments']} review comments  ·  ", True),
           ("I wrote none of the application code.", False)],
          size=11, colour=NAVY)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    deck.save(OUT)
    print(f"wrote {OUT.relative_to(ROOT)}  "
          f"({stats['prs']} PRs, {stats['merged']} merged, "
          f"{stats['comments']} review comments)")


if __name__ == "__main__":
    build(deck_stats.load())
