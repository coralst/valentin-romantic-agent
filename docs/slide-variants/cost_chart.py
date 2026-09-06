"""cost_chart.py — the cost deep-dive, drawn as two charts rather than a table.

The review asked for the scaling story as a picture: what is fixed and what is
usage at 1 / 10 / 1,000 / 1,000,000 users. A table of the same numbers reads as
a price list, so this slide answers it with two panels:

  left   100%-stacked bars — engine A's bill split floor vs. usage, per scale.
         The floor is 93% of the bill at one user and never falls below a
         quarter, because a Fargate task is added per 40 concurrent sessions.
  right  cost per user per month, A against B, on one linear scale. A falls
         19.41 → 1.84 and flat-lines; B's dime never moves and never is caught.

Every quantity comes from scripts/cost-model.mjs, the same source as the
itemised bill on the next slide. The identical Bedrock reply call is excluded
from both engines.
"""

from aws_slides import (NAVY, ORANGE, GREEN, INK, GREY, CARD, BORDER, WHITE,
                        FAINT, chrome, heading)
from lens_slides import A_LABEL, B_LABEL, chip_strip, TOGGLES, verdict_band

# label, engine A fixed $/mo, engine A usage $/mo, A total, B total, A $/user
SCALES = [
    ('1 user',           18.02,    1.385,     '$19.41', '$0.10',  19.41),
    ('10 users',         18.02,   13.85,      '$31.87', '$1.03',   3.19),
    ('1,000 users',     450.50, 1385.0,       '$1,836', '$103',    1.84),
    ('1,000,000 users', 450500.0, 1385000.0,  '$1.84M', '$103K',   1.84),
]
B_PER_USER = 0.1027          # Runtime $0.0047 + Memory $0.098, per user per month

ROW_Y, ROW_STEP = 3.14, 0.62
PER_USER_MAX = 20.0          # the right panel's linear scale, in dollars


def _swatch(x, y, color, label, w=0.20):
    return [('rect', x, y + 0.05, w, 0.14, color, None, 0),
            ('text', x + w + 0.10, y, 2.60, 0.24, label, 10, GREY, False, 'l', 'm')]


def _floor_panel():
    """Engine A's bill as four 100%-stacked bars: fixed floor vs. usage."""
    x0, bar_x, bar_w = 0.62, 1.90, 4.30
    ops = [
        ('text', x0, 2.52, 7.24, 0.26,
         f'{A_LABEL} — WHAT THE BILL IS MADE OF', 10.5, NAVY, True, 'l', 'm'),
    ]
    ops += _swatch(x0, 2.80, GREY, 'fixed floor — Fargate tasks')
    ops += _swatch(x0 + 3.00, 2.80, ORANGE, 'usage — extraction calls')

    for i, (label, fixed, usage, total_a, total_b, _) in enumerate(SCALES):
        y = ROW_Y + i * ROW_STEP
        share = fixed / (fixed + usage)
        fw = bar_w * share
        ops += [
            ('text', x0, y, 1.16, 0.30, label, 11, NAVY, True, 'r', 'm'),
            ('rect', bar_x, y, fw, 0.30, GREY, None, 0),
            ('rect', bar_x + fw, y, bar_w - fw, 0.30, ORANGE, None, 0),
            ('text', 6.82, y - 0.02, 1.04, 0.18, total_a, 11.5, NAVY, True, 'r', 'm'),
            ('text', 6.82, y + 0.16, 1.04, 0.16,
             f'engine B  {total_b}', 10, GREEN, True, 'r', 'm'),
        ]
        # a segment narrower than its own label gets the label outside, in ink
        for seg_x, seg_w, pct, on_dark in ((bar_x, fw, share, True),
                                           (bar_x + fw, bar_w - fw, 1 - share, True)):
            txt = f'{pct:.0%}'
            if seg_w >= 0.62:
                align = 'l' if on_dark and seg_x == bar_x else 'r'
                pad = 0.10
                ops.append(('text', seg_x + pad, y, seg_w - 2 * pad, 0.30,
                            txt, 10, WHITE, True, align, 'm'))
            else:
                ops.append(('text', seg_x + seg_w + 0.06, y, 0.50, 0.30,
                            txt, 10, GREY, True, 'l', 'm'))
    return ops


def _per_user_panel():
    """Cost per user per month, both engines, one linear scale."""
    x0, bar_x, bar_w = 8.02, 9.00, 2.60
    ops = [
        ('text', x0, 2.52, 4.70, 0.26, 'COST PER USER, PER MONTH',
         10.5, NAVY, True, 'l', 'm'),
    ]
    ops += _swatch(x0, 2.80, NAVY, 'engine A', w=0.16)
    ops += _swatch(x0 + 1.60, 2.80, GREEN, 'engine B', w=0.16)

    for i, (label, _f, _u, _ta, _tb, a_per_user) in enumerate(SCALES):
        y = ROW_Y + i * ROW_STEP
        aw = bar_w * min(1.0, a_per_user / PER_USER_MAX)
        bw = max(0.05, bar_w * B_PER_USER / PER_USER_MAX)   # a dime is a sliver
        ops += [
            ('text', x0, y, 0.88, 0.35, label.split()[0], 11, NAVY, True, 'r', 'm'),
            ('rect', bar_x, y, aw, 0.15, NAVY, None, 0),
            ('text', bar_x + aw + 0.08, y - 0.02, 1.04, 0.19,
             f'${a_per_user:,.2f}', 10, NAVY, True, 'l', 'm'),
            ('rect', bar_x, y + 0.20, bw, 0.15, GREEN, None, 0),
            ('text', bar_x + bw + 0.08, y + 0.18, 1.04, 0.19,
             f'${B_PER_USER:.2f}', 10, GREEN, True, 'l', 'm'),
        ]

    ops.append(('text', x0, 5.42, 4.70, 0.22,
                f'one linear scale, $0–${PER_USER_MAX:.0f} — engine B’s dime is '
                'the sliver', 10, GREY, False, 'l', 'm'))
    return ops


def slide_cost_graph(page, total, badge):
    ops = chrome(page, total, badge)
    ops += heading(
        'Cost — the floor vs. the meter',
        'The same two bills at four scales. Left: what engine A is paying for. '
        'Right: what each user costs on each engine.')
    ops += chip_strip(TOGGLES['cost'])
    ops += _floor_panel()
    ops.append(('rect', 7.90, 2.52, 0.01, 2.98, BORDER, None, 0))   # panel divider
    ops += _per_user_panel()

    insight = ('Engine A’s floor is not fixed: a Fargate task is added every 40 '
               'concurrent sessions, so the grey block never shrinks past a '
               'quarter of the bill. Its cost per user falls 19.41 → 1.84 and '
               'then stops — 18× above a dime that never moves.')
    ops.append(('text', 0.62, 5.66, 12.10, 0.40, insight, 11, GREY, False, 'l', 't'))

    ops += verdict_band(
        '18×', 'cheaper at scale — 189× at one user, where only B has no floor',
        'AGENTCORE',
        giveup='if Memory retrievals meter per record, not per call, this narrows '
               '— confirm before quoting')
    return ops
