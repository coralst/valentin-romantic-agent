"""raster_slides.py — native replacements for the flattened picture slides.

Three slides in v6 were screenshots of HTML: the itemised cost bill, the team
tree, and the PR contribution graph. Because they are pixels, two house rules
could not reach them — "engine A is DIY, never glue code" and "no text below
10pt" — so the text-only two are re-authored here as ops. The graph keeps its
plot (it is a chart, not prose) and gets native text around it.

Source of the numbers: the same HTML the screenshots were taken from, whose
figures come from scripts/cost-model.mjs and the live PR history.
"""

import aws_slides as T
from aws_slides import (NAVY, ORANGE, GREEN, INK, GREY, CARD, BORDER, WHITE,
                        FAINT, chrome, heading)
from lens_slides import A_LABEL, B_LABEL, chip_strip, TOGGLES

# ─────────────────────────────────────────────────────────────────────────────
# The itemised bill — every line of both monthly bills at one user.
# ─────────────────────────────────────────────────────────────────────────────

BILL_A = [
    ('AWS Fargate', '0.5 vCPU · 730 h · never scales below one task', '$18.02'),
    ('2nd Bedrock call — extraction', '104 turns × $0.01332', '$1.385'),
    ('Amazon DynamoDB', 'on-demand reads, writes and storage', '$0.0006'),
]
BILL_B = [
    ('AgentCore Gateway', '3 tools indexed — the only fixed line', '$0.0006'),
    ('AgentCore Memory', '1 event + 1 retrieval per turn, extraction included', '$0.098'),
    ('AgentCore Runtime', '3 s × 104 turns, billed per second', '$0.0047'),
]


def _bill_card(x, label, fill, headline, items, total, money):
    """One monthly bill: header, the split, three priced lines, the total."""
    y, w, h = 2.52, 5.90, 3.34
    ops = [
        ('rect', x, y, w, h, CARD, BORDER, 0.06),
        ('rect', x, y, w, 0.46, fill, None, 0),
        ('text', x + 0.22, y, w - 0.44, 0.46, label, 11.5, WHITE, True, 'l', 'm'),
        ('text', x + 0.22, y + 0.60, w - 0.44, 0.36, headline, 16, NAVY, True, 'l', 'm'),
    ]
    iy = y + 1.06
    for name, detail, amount in items:
        ops += [
            ('text', x + 0.22, iy, w - 1.90, 0.26, name, 12, NAVY, True, 'l', 'm'),
            ('text', x + 0.22, iy + 0.26, w - 1.90, 0.24, detail, 10, GREY, False, 'l', 'm'),
            ('text', x + 0.22, iy, w - 0.44, 0.26, amount, 13, money, True, 'r', 'm'),
            ('rect', x + 0.22, iy + 0.56, w - 0.44, 0.01, BORDER, None, 0),
        ]
        iy += 0.62
    ops += [
        ('text', x + 0.22, iy + 0.04, w - 1.90, 0.30, 'At one user, per month',
         12.5, NAVY, True, 'l', 'm'),
        ('text', x + 0.22, iy + 0.04, w - 0.44, 0.30, total, 15, money, True, 'r', 'm'),
    ]
    return ops


def slide_bill(page, total, badge):
    ops = chrome(page, total, badge)
    ops += heading(
        'Cost — the bill, itemised',
        'Every rate from a vendor pricing page, every quantity counted out of '
        'this repo. The identical Bedrock reply call is excluded from both.')
    ops += chip_strip(TOGGLES['cost'])
    ops += _bill_card(0.62, A_LABEL, GREY, '$18.02 fixed  +  $1.39 per user',
                      BILL_A, '$19.41', NAVY)
    ops += _bill_card(6.82, B_LABEL, NAVY, '$0.0006 fixed  +  $0.10 per user',
                      BILL_B, '$0.10', GREEN)

    note = ('Unit price favours engine A — Runtime is 2.20× dearer per vCPU-hour '
            'and one Memory event costs ~124× a DynamoDB write. B wins the bill '
            'anyway: it charges per second of real work, and folds extraction into '
            'the service instead of a second model call.')
    ops.append(('text', 0.62, 5.96, 12.10, 0.42, note, 11, GREY, False, 'l', 't'))

    ops += [
        ('rect', 0.62, 6.44, 12.10, 0.44, FAINT, None, 0.10),
        ('text', 0.84, 6.44, 11.66, 0.44,
         [('Reproducible: ', True, NAVY),
          ('scripts/cost-model.mjs', True, ORANGE),
          ('  regenerates every figure. Caveat — if Memory meters retrievals per '
           'record rather than per call, engine B lands 3.8× worse.', False, NAVY)],
         11, NAVY, False, 'l', 'm'),
    ]
    return ops


# ─────────────────────────────────────────────────────────────────────────────
# The team — one human, one orchestrator, five specialists with disjoint files.
# ─────────────────────────────────────────────────────────────────────────────

AGENTS = [
    ('System Architect', 'src/shared/',
     'Contracts and shared types. Writes the spec before anyone branches.',
     '#2 shared types · #41 category lookups · #44 preferenceCategoryCount'),
    ('Frontend Dev', 'src/client/',
     'Components, hooks, state. Cannot touch shared types.',
     '#3 chat UI · #58 Partner Profile Panel, 27 files · #65 live architecture view'),
    ('Backend Dev', 'src/server/',
     'API, Bedrock extraction, persistence. Cannot touch the client.',
     '#4 API and orchestrator · #15 real Bedrock SDK · #64 demo seeding and reset'),
    ('UI Designer', 'design-system/',
     'Tokens, accessibility, eight real mockups to choose from.',
     '#16 refined palette · #22 component pass · 8 mockups, one shipped'),
    ('QA Agent', 'e2e/',
     'Playwright E2E and regression coverage. Cannot touch src at all.',
     '#8 onboarding and responsive · 5 PRs purely for coverage · 376 tests green'),
]


def slide_team(page, total, badge):
    ops = chrome(page, total, badge)
    ops += heading(
        'I didn’t write it. They did.',
        'Six agent personas with disjoint file ownership, and one human who '
        'holds the veto.')

    for x, name, role in (
            (0.62, 'Coral · human',
             'Product intent, final say, veto. Wrote none of the application code.'),
            (6.82, 'Master Agent  ·  .kiro/  ·  .github/',
             'Decomposes, delegates, reviews, merges — and posts the last word.')):
        ops += [
            ('rect', x, 1.98, 5.90, 0.92, CARD, BORDER, 0.06),
            ('rect', x, 1.98, 0.06, 0.92, NAVY if x < 1 else ORANGE, None, 0),
            ('text', x + 0.28, 2.08, 5.40, 0.30, name, 13, NAVY, True, 'l', 'm'),
            ('text', x + 0.28, 2.40, 5.40, 0.40, role, 11, INK, False, 'l', 't'),
        ]

    y, h, gap = 3.14, 2.42, 0.16
    w = (12.10 - gap * 4) / 5
    for i, (name, path, role, prs) in enumerate(AGENTS):
        x = 0.62 + i * (w + gap)
        ops += [
            ('rect', x, y, w, h, CARD, BORDER, 0.06),
            ('rect', x, y, w, 0.05, ORANGE, None, 0),
            ('text', x + 0.16, y + 0.14, w - 0.32, 0.28, name, 12.5, NAVY, True, 'l', 'm'),
            ('rect', x + 0.16, y + 0.46, w - 0.32, 0.26, FAINT, None, 0.08),
            ('text', x + 0.16, y + 0.46, w - 0.32, 0.26, path, 10, GREY, True, 'c', 'm'),
            ('text', x + 0.16, y + 0.82, w - 0.32, 0.74, role, 10.5, INK, False, 'l', 't'),
            ('rect', x + 0.16, y + 1.60, w - 0.32, 0.01, BORDER, None, 0),
            ('text', x + 0.16, y + 1.68, w - 0.32, 0.66, prs, 10, GREY, False, 'l', 't'),
        ]

    foot = ('Each is a prompt file in .kiro/agents/ with a voice exemplar and an '
            'explicit do-not-modify list. Disjoint ownership is what keeps five '
            'agents editing at once from being a merge-conflict generator.')
    ops.append(('text', 0.62, 5.78, 12.10, 0.56, foot, 11, GREY, False, 'l', 't'))

    ops += [
        ('rect', 0.62, 6.42, 12.10, 0.42, FAINT, None, 0.10),
        ('text', 0.84, 6.42, 11.66, 0.42,
         [('57 pull requests  ·  49 merged  ·  93 review comments  ·  ', True, NAVY),
          ('I wrote none of the application code.', False, NAVY)],
         11, NAVY, False, 'l', 'm'),
    ]
    return ops


# ─────────────────────────────────────────────────────────────────────────────
# The PR graph — the plot stays a picture; everything around it becomes text.
# ─────────────────────────────────────────────────────────────────────────────

GRAPH_STATS = [
    ('57', 'pull requests', '49 merged · 7 closed · 1 open'),
    ('176', 'commits', '+34,549 lines, 436 files'),
    ('93', 'review comments', 'longest threads run dozens deep'),
    ('32', 'workflow PRs', 'the methodology is the biggest lane'),
]


def graph_extras():
    """Native text for the kept graph slide: heading, stat cards, footnote.

    The picture already on the slide is re-cropped by the build script so its
    own sub-10pt caption strip is cut off and replaced by these cards.
    """
    ops = heading(
        'Every node is a real pull request',
        'Fifty-seven of them, in the order they were opened, connected to where '
        'they merged.')

    y, h, gap = 5.42, 0.86, 0.16
    w = (12.10 - gap * 3) / 4
    for i, (num, label, detail) in enumerate(GRAPH_STATS):
        x = 0.62 + i * (w + gap)
        ops += [
            ('rect', x, y, w, h, CARD, BORDER, 0.06),
            ('text', x + 0.18, y + 0.06, 1.00, 0.40, num, 20, NAVY, True, 'l', 'm'),
            ('text', x + 1.16, y + 0.06, w - 1.34, 0.40, label, 12, NAVY, True, 'l', 'm'),
            ('text', x + 0.18, y + 0.48, w - 0.36, 0.32, detail, 10, GREY, False, 'l', 'm'),
        ]

    foot = ('Generated from the repo’s PR history by a script, so it cannot '
            'drift. Node size is files changed; a ring means a genuine '
            'multi-agent review thread; the axis is PR order, not a calendar. '
            'At the peak, five PRs were open at once.')
    ops.append(('text', 0.62, 6.44, 12.10, 0.52, foot, 10.5, GREY, False, 'l', 't'))
    return ops
