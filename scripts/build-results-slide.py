#!/usr/bin/env python3
"""Builds the results slide for the engine A vs engine B experiment.

Run with dummy numbers to approve the FORMAT before spending a run:

    python3 scripts/build-results-slide.py --dummy --out docs/Valentin-Results-FORMAT.pptx

Later, after `scripts/experiment/collect.mjs` has written runs/*.json, the same
script fills the identical layout from measured values:

    python3 scripts/build-results-slide.py --from runs/ --out docs/Valentin-Results.pptx

Native editable shapes, not a screenshot — a raster slide's text is pixels, so
renames and font passes silently miss it.

Visual language is inherited from slide 6 ("What we assumed — and why"): ink navy
headings, an amber full-width band for the one sentence that matters, light grey
panels with a coloured left rule for supporting detail, and a dark footer band.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Inches, Pt

SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)

INK = RGBColor(0x1F, 0x2A, 0x37)       # headings, dark bands
BODY = RGBColor(0x44, 0x4C, 0x56)      # body copy
MUTED = RGBColor(0x7A, 0x84, 0x90)     # labels, footer
AMBER = RGBColor(0xE8, 0xA3, 0x3D)     # the band
GREEN = RGBColor(0x2E, 0x7D, 0x32)     # "cheaper / better" rule
RED = RGBColor(0xB0, 0x3A, 0x2B)       # "worse / wrong" rule
PANEL = RGBColor(0xF2, 0xF3, 0xF5)     # panel fill
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

FONT = 'Lato'


# --------------------------------------------------------------------- helpers
def textbox(slide, x, y, w, h, *, anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(x, y, w, h)
    frame = box.text_frame
    frame.word_wrap = True
    frame.vertical_anchor = anchor
    frame.margin_left = frame.margin_right = 0
    frame.margin_top = frame.margin_bottom = 0
    return frame


def line(frame, text, *, size, bold=False, color=BODY, first=False,
         align=PP_ALIGN.LEFT, space_before=0, italic=False):
    paragraph = frame.paragraphs[0] if first else frame.add_paragraph()
    paragraph.alignment = align
    paragraph.space_before = Pt(space_before)
    run = paragraph.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    run.font.name = FONT
    return paragraph


def rect(slide, x, y, w, h, fill, *, radius=None):
    from pptx.enum.shapes import MSO_SHAPE
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE, x, y, w, h)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.fill.background()
    shape.shadow.inherit = False
    if radius:
        shape.adjustments[0] = radius
    shape.text_frame.text = ''
    return shape


def panel(slide, x, y, w, h, rule_color):
    """Light grey panel with a coloured left rule, as on slide 6."""
    rect(slide, x, y, w, h, PANEL)
    rect(slide, x, y, Inches(0.05), h, rule_color)


# ------------------------------------------------------------------ the numbers
def dummy_results() -> dict:
    """Illustrative values ONLY. Shape and units are real; magnitudes are invented."""
    return {
        'dummy': True,
        'turns': 120,
        'conversations': 12,
        'cost': {
            # $/user/month at 120 turns. Fargate is analytic (730 h); the rest measured.
            'a': {
                'Bedrock tokens': 2.94,
                'DynamoDB': 0.01,
                'Fargate (1 task, 730 h)': 18.03,
            },
            'b': {
                'Bedrock tokens': 1.71,
                'AgentCore Memory': 0.28,
                'AgentCore Runtime': 0.03,
                'AgentCore Gateway': 0.02,
                'Tool Lambdas': 0.01,
                'DynamoDB': 0.01,
                'Fargate (2 tasks, 730 h)': 36.06,
            },
        },
        'latency': {
            'a': {'p50': 5920, 'p90': 16160, 'p99': 22400, 'max': 24300},
            'b': {'p50': 9060, 'p90': 14710, 'p99': 27800, 'max': 29400},
        },
        'tokens': {
            'a': {'in': 1_607_000, 'out': 96_000, 'calls_per_turn': 2.8},
            'b': {'in': 934_000, 'out': 71_000, 'calls_per_turn': 1.9},
        },
        'corrections': [
            ('Turn latency', '~2.1 s / ~2.4 s', '5.9 s / 9.1 s', False),
            ('Always-on tasks (B)', 'none', '1 Fargate task', False),
            ('Tools indexed', '3', '29', False),
            ('Runtime per turn', '3 s assumed', '182-1,449 s billed', False),
            ('Writes per turn', '9', '11 WCU measured', True),
            ('Gateway overhead', '~300 ms', '47 ms', True),
        ],
    }


def load_results(directory: Path) -> dict:
    payload = json.loads((directory / 'results.json').read_text())
    payload['dummy'] = False
    return payload


# -------------------------------------------------------------------- the slide
def build(results: dict, out: Path) -> None:
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    slide = prs.slides.add_slide(prs.slide_layouts[6])

    total_a = sum(results['cost']['a'].values())
    total_b = sum(results['cost']['b'].values())
    variable_a = total_a - results['cost']['a']['Fargate (1 task, 730 h)']
    variable_b = total_b - results['cost']['b']['Fargate (2 tasks, 730 h)']
    per_turn_a = variable_a / results['turns']
    per_turn_b = variable_b / results['turns']
    rent_gap = total_b - total_a - (variable_b - variable_a)
    saving_per_turn = per_turn_a - per_turn_b
    crossover_turns = rent_gap / saving_per_turn if saving_per_turn > 0 else float('inf')
    crossover_users = crossover_turns / results['turns']

    # ------------------------------------------------------------------ header
    from pptx.enum.shapes import MSO_SHAPE
    badge = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(0.62), Inches(0.42),
                                   Inches(0.62), Inches(0.62))
    badge.fill.solid()
    badge.fill.fore_color.rgb = INK
    badge.line.fill.background()
    badge.shadow.inherit = False
    line(badge.text_frame, '8', size=22, bold=True, color=WHITE, first=True,
         align=PP_ALIGN.CENTER)
    badge.text_frame.vertical_anchor = MSO_ANCHOR.MIDDLE

    line(textbox(slide, Inches(1.45), Inches(0.42), Inches(11), Inches(0.7)),
         'What it actually cost — measured', size=32, bold=True, color=INK, first=True)
    rect(slide, Inches(0.62), Inches(1.20), Inches(1.5), Inches(0.045), AMBER)

    subtitle = (
        'One user, one month, 120 turns each, the same 12 conversations replayed to '
        'both engines. Every number below has a query behind it.'
    )
    if results.get('dummy'):
        subtitle = ('FORMAT PREVIEW — every number on this slide is invented. '
                    'Layout, units and sources are final; magnitudes are not.')
    line(textbox(slide, Inches(0.62), Inches(1.38), Inches(12.1), Inches(0.4)),
         subtitle, size=13, color=RED if results.get('dummy') else BODY,
         bold=bool(results.get('dummy')), first=True)

    # ------------------------------------------------- the one sentence that matters
    band = rect(slide, Inches(0.62), Inches(1.90), Inches(12.1), Inches(0.72), AMBER,
                radius=0.18)
    frame = band.text_frame
    frame.vertical_anchor = MSO_ANCHOR.MIDDLE
    line(frame,
         f'Engine B costs {saving_per_turn / per_turn_a * 100:.0f}% less per turn '
         f'— and {total_b / total_a:.1f}x more per month. '
         f'They cross over at ~{crossover_users:.0f} users.',
         size=19, bold=True, color=INK, first=True, align=PP_ALIGN.CENTER)

    # ------------------------------------------------------------------ cost panel
    panel(slide, Inches(0.62), Inches(2.82), Inches(6.05), Inches(3.05), GREEN)
    frame = textbox(slide, Inches(0.90), Inches(2.98), Inches(5.6), Inches(2.8))
    line(frame, 'COST  ·  $ per user per month', size=11, bold=True, color=GREEN,
         first=True)

    line(frame, '', size=5)
    header = line(frame, f'{"":<30}{"ENGINE A":>11}{"ENGINE B":>11}', size=10,
                  bold=True, color=MUTED)
    header.runs[0].font.name = 'Menlo'

    rows = []
    for label in ['Bedrock tokens', 'AgentCore Memory', 'AgentCore Runtime',
                  'AgentCore Gateway', 'Tool Lambdas', 'DynamoDB']:
        left = results['cost']['a'].get(label)
        right = results['cost']['b'].get(label)
        rows.append((label,
                     f'${left:.2f}' if left is not None else '—',
                     f'${right:.2f}' if right is not None else '—'))
    rows.append(('Fargate rent (730 h)',
                 f'${results["cost"]["a"]["Fargate (1 task, 730 h)"]:.2f}',
                 f'${results["cost"]["b"]["Fargate (2 tasks, 730 h)"]:.2f}'))

    for label, left, right in rows:
        paragraph = line(frame, f'{label:<30}{left:>11}{right:>11}', size=10.5,
                         color=BODY)
        paragraph.runs[0].font.name = 'Menlo'

    line(frame, '', size=4)
    total = line(frame, f'{"TOTAL":<30}{f"${total_a:.2f}":>11}{f"${total_b:.2f}":>11}',
                 size=12, bold=True, color=INK)
    total.runs[0].font.name = 'Menlo'
    variable = line(
        frame,
        f'{"variable, per turn":<30}{f"${per_turn_a:.4f}":>11}{f"${per_turn_b:.4f}":>11}',
        size=10.5, bold=True, color=GREEN)
    variable.runs[0].font.name = 'Menlo'

    line(frame, 'Fargate is analytic — 730 h/month at any turn count. Everything else '
                'is measured at 120 turns, no extrapolation.',
         size=8.5, color=MUTED, italic=True, space_before=6)

    # --------------------------------------------------------------- latency panel
    panel(slide, Inches(6.90), Inches(2.82), Inches(5.82), Inches(3.05), INK)
    frame = textbox(slide, Inches(7.18), Inches(2.98), Inches(5.35), Inches(2.8))
    line(frame, 'LATENCY  ·  what the user waits', size=11, bold=True, color=INK,
         first=True)

    line(frame, '', size=5)
    header = line(frame, f'{"":<22}{"ENGINE A":>11}{"ENGINE B":>11}', size=10,
                  bold=True, color=MUTED)
    header.runs[0].font.name = 'Menlo'

    for key, label in [('p50', 'median'), ('p90', 'p90'), ('p99', 'p99'),
                       ('max', 'worst turn')]:
        left = results['latency']['a'][key] / 1000
        right = results['latency']['b'][key] / 1000
        paragraph = line(frame,
                         f'{label:<22}{f"{left:.2f} s":>11}{f"{right:.2f} s":>11}',
                         size=10.5, bold=(key == 'p50'),
                         color=INK if key == 'p50' else BODY)
        paragraph.runs[0].font.name = 'Menlo'

    line(frame, '', size=4)
    for key, label in [('calls_per_turn', 'model calls / turn'),
                       ('in', 'input tokens (120 turns)'),
                       ('out', 'output tokens (120 turns)')]:
        left = results['tokens']['a'][key]
        right = results['tokens']['b'][key]
        fmt = (lambda v: f'{v:,.0f}') if key != 'calls_per_turn' else (lambda v: f'{v:.1f}')
        paragraph = line(frame, f'{label:<22}{fmt(left):>11}{fmt(right):>11}',
                         size=10.5, color=BODY)
        paragraph.runs[0].font.name = 'Menlo'

    line(frame,
         "Engine A's median excludes the extraction call it defers past the reply — "
         'real for the user, still on the bill. Engine B is slower at the median and '
         'tighter in the tail.',
         size=8.5, color=MUTED, italic=True, space_before=6)

    # -------------------------------------------------- claimed vs measured footer
    rect(slide, Inches(0.62), Inches(6.05), Inches(12.1), Inches(0.86), INK)
    line(textbox(slide, Inches(0.88), Inches(6.14), Inches(11.6), Inches(0.22)),
         'WHAT WE ASSUMED  →  WHAT WE MEASURED', size=9.5, bold=True, color=AMBER,
         first=True)

    cell_w = Inches(11.6 / 6)
    for index, (label, claimed, measured, was_right) in enumerate(results['corrections']):
        frame = textbox(slide, Inches(0.88) + cell_w * index, Inches(6.42),
                        cell_w - Inches(0.12), Inches(0.42))
        line(frame, label, size=8, color=MUTED, first=True)
        paragraph = line(frame, f'{claimed}  →  {measured}', size=9.5, bold=True,
                         color=RGBColor(0x8F, 0xD1, 0x94) if was_right else WHITE)
        paragraph.runs[0].font.name = FONT

    # ------------------------------------------------------------------ footer rule
    footer = textbox(slide, Inches(0.62), Inches(7.06), Inches(12.1), Inches(0.26))
    line(footer, 'VALENTIN  ·  GenAI TFC Capstone Deep-Dive', size=9, bold=True,
         color=MUTED, first=True)

    out.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out))
    print(f'wrote {out}')
    print(f'  engine A  total ${total_a:.2f}/mo   variable ${per_turn_a:.4f}/turn')
    print(f'  engine B  total ${total_b:.2f}/mo   variable ${per_turn_b:.4f}/turn')
    print(f'  crossover ~{crossover_users:.1f} users '
          f'({crossover_turns:,.0f} turns/month)')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dummy', action='store_true',
                        help='illustrative numbers, for approving the format')
    parser.add_argument('--from', dest='source', type=Path,
                        help='directory holding results.json from collect.mjs')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()

    if args.dummy:
        results = dummy_results()
    elif args.source:
        results = load_results(args.source)
    else:
        parser.error('pass --dummy or --from DIR')

    build(results, args.out)


if __name__ == '__main__':
    main()
