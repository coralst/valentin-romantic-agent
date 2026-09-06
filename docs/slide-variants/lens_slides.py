"""lens_slides.py — the v7 lens-major comparison slides.

The v6 comparison walked the four AgentCore components; v7 pivots to the six
questions the audience actually asks (cost, resilience, security, ownership,
debuggability, latency) and carries a persistent strip of four component chips.
The strip sits at the same coordinates on every slide, so flipping slides reads
as toggling chips on and off.

House rules from review: engine A is called DIY (never "glue code"), and no
text anywhere renders below 10pt.
"""

import aws_slides as T
from aws_slides import (W, H, NAVY, ORANGE, GREEN, INK, GREY, CARD, BORDER,
                        WHITE, DARK_GREY, FAINT, chrome, heading, pill)

COMPONENTS = ['Runtime', 'Memory', 'Gateway', 'Observability']

# Which chips light up per lens — the toggle map.
TOGGLES = {
    'cost':      {'Runtime', 'Memory', 'Gateway', 'Observability'},
    'resil':     {'Runtime', 'Gateway'},
    'security':  {'Runtime', 'Gateway'},
    'ownership': {'Memory', 'Gateway'},
    'debug':     {'Observability'},
    'latency':   {'Runtime', 'Gateway'},
}

A_LABEL = 'ENGINE A · DIY'
B_LABEL = 'ENGINE B · AGENTCORE'


def chip_strip(active, y=1.92):
    """Four component chips, fixed position on every lens slide."""
    ops = []
    x, w, h, gap = 0.62, 2.92, 0.42, 0.14
    for i, name in enumerate(COMPONENTS):
        cx = x + i * (w + gap)
        on = name in active
        if on:
            ops.append(('rect', cx, y, w, h, NAVY, None, 0.21))
            ops.append(('oval', cx + 0.22, y + h / 2 - 0.055, 0.11, 0.11, ORANGE, None))
            ops.append(('text', cx + 0.44, y, w - 0.56, h,
                        f'AgentCore {name}', 11.5, WHITE, True, 'l', 'm'))
        else:
            ops.append(('rect', cx, y, w, h, None, BORDER, 0.21))
            ops.append(('text', cx + 0.44, y, w - 0.56, h,
                        f'AgentCore {name}', 11.5, DARK_GREY, False, 'l', 'm'))
    return ops


def engine_card(x, title, fill, points, y=2.62, h=3.30):
    """One engine column: header bar + two lead/body pairs. Kept airy on purpose."""
    w = 5.90
    ops = [
        ('rect', x, y, w, h, CARD, BORDER, 0.06),
        ('rect', x, y, w, 0.46, fill, None, 0),
        ('text', x + 0.22, y, w - 0.44, 0.46, title, 11.5, WHITE, True, 'l', 'm'),
    ]
    py = y + 0.68
    for lead, body in points:
        ops += [
            ('text', x + 0.22, py, w - 0.44, 0.34, lead, 13, NAVY, True, 'l', 't'),
            ('text', x + 0.22, py + 0.36, w - 0.44, 0.86, body, 11.5, INK, False, 'l', 't'),
        ]
        py += 1.32
    return ops


def verdict_band(num, caption, winner, giveup=None):
    """The single number that settles the lens, template-banner style."""
    y, h = 6.14, 0.62
    won_green = winner == 'AGENTCORE'
    ops = [
        ('rect', 0.62, y, 12.10, h, FAINT, None, 0.10),
        ('text', 0.88, y, 2.30, h, num, 24, ORANGE, True, 'l', 'm'),
    ]
    ops += pill(10.90, y + 0.17, 1.56, 0.28, winner,
                GREEN if won_green else NAVY, size=10)
    cap_w = 7.40
    if giveup:
        ops.append(('text', 3.30, y + 0.07, cap_w, 0.26, caption, 12, NAVY, True, 'l', 'm'))
        ops.append(('text', 3.30, y + 0.33, cap_w, 0.26,
                    [('Give up:  ', True, GREY), (giveup, False, GREY)],
                    10, GREY, False, 'l', 'm'))
    else:
        ops.append(('text', 3.30, y, cap_w, h, caption, 12, NAVY, True, 'l', 'm'))
    return ops


def slide_lens(page, total, badge, title, subtitle, key,
               a_points, b_points, num, caption, winner, giveup=None):
    ops = chrome(page, total, badge)
    ops += heading(title, subtitle)
    ops += chip_strip(TOGGLES[key])
    ops += engine_card(0.62, A_LABEL, GREY, a_points)
    ops += engine_card(6.82, B_LABEL, NAVY, b_points)
    ops += verdict_band(num, caption, winner, giveup)
    return ops


# ─────────────────────────────────────────────────────────────────────────────
# The matrix slide — six lenses, the toggle map, one upside, one trade-off.
# ─────────────────────────────────────────────────────────────────────────────

MATRIX = [
    dict(lens='Cost', key='cost', win='AGENTCORE',
         up='The $18/mo idle floor disappears — pay per second of real agent work.',
         down='Unit price is 2.20× dearer per vCPU-hour; it wins on granularity, not rate.'),
    dict(lens='Resilience', key='resil', win='AGENTCORE',
         up='A microVM per session and a Lambda per tool: one fault loses 1 session, not 40.',
         down='The container stops being yours — no sidecars, no in-process cache.'),
    dict(lens='Security', key='security', win='AGENTCORE',
         up='Auth resolves per tool; a hijacked session reaches only its own tokens.',
         down='The isolation boundary is managed — you trust it, you cannot inspect it.'),
    dict(lens='Ownership & velocity', key='ownership', win='AGENTCORE',
         up='Extraction becomes the service’s prompt; adding a tool stops being a deploy.',
         down='You lose the extraction schema you designed — and the fields only it had.'),
    dict(lens='Debuggability', key='debug', win='DIY',
         up='Hand-wired OTEL emits exactly the fields that decide an incident at 2am.',
         down='You write and maintain the span plumbing, plus a CloudWatch bill.'),
    dict(lens='Latency', key='latency', win='DIY',
         up='In-process tools on a warm task — a turn never waits on a hop.',
         down='Engine B cold-starts an idle session and pays a Gateway hop per tool call.'),
]

MCOLS = dict(lens=(0.62, 1.86), dots=(2.48, 2.08), up=(4.66, 3.94),
             down=(8.70, 2.86), win=(11.66, 1.06))


def slide_matrix(page, total, badge):
    ops = chrome(page, total, badge)
    ops += heading(
        'Two engines, six lenses',
        'Each lens toggles on the components that decide it. One upside, one '
        'trade-off, one winner per row.')

    hy, rh, top = 1.86, 0.70, 2.32
    ops.append(('rect', 0.62, hy, 12.10, 0.40, NAVY, None, 0.06))
    heads = [('lens', 'THE LENS', ORANGE, 'l'), ('up', 'THE UPSIDE', WHITE, 'l'),
             ('down', 'THE TRADE-OFF', WHITE, 'l'), ('win', 'WINNER', WHITE, 'l')]
    for k, lab, col, al in heads:
        cx, cw = MCOLS[k]
        ops.append(('text', cx + 0.10, hy, cw - 0.20, 0.40, lab, 10, col, True, al, 'm'))
    # component initials above the dot columns
    dx, dw = MCOLS['dots']
    step = dw / 4
    initials = ['RUN', 'MEM', 'GTW', 'OBS']
    for i, ini in enumerate(initials):
        ops.append(('text', dx + i * step, hy, step, 0.40,
                    ini, 10, WHITE, True, 'c', 'm'))

    for r, row in enumerate(MATRIX):
        y = top + r * rh
        if r % 2 == 0:
            ops.append(('rect', 0.62, y, 12.10, rh, CARD, None, 0))
        ops.append(('rect', 0.62, y + rh - 0.01, 12.10, 0.01, BORDER, None, 0))

        cx, cw = MCOLS['lens']
        ops.append(('text', cx + 0.10, y, cw - 0.20, rh, row['lens'], 12.5,
                    NAVY, True, 'l', 'm'))
        active = TOGGLES[row['key']]
        for i, name in enumerate(COMPONENTS):
            ccx = dx + i * step + step / 2
            if name in active:
                ops.append(('oval', ccx - 0.085, y + rh / 2 - 0.085, 0.17, 0.17,
                            ORANGE, None))
            else:
                ops.append(('oval', ccx - 0.06, y + rh / 2 - 0.06, 0.12, 0.12,
                            None, BORDER))
        for k, txt in (('up', row['up']), ('down', row['down'])):
            cx, cw = MCOLS[k]
            ops.append(('text', cx + 0.10, y + 0.08, cw - 0.20, rh - 0.16, txt,
                        10, INK, False, 'l', 'm'))
        cx, cw = MCOLS['win']
        won_green = row['win'] == 'AGENTCORE'
        ops += pill(cx, y + rh / 2 - 0.13, cw, 0.26, row['win'],
                    GREEN if won_green else NAVY, size=10)

    banner = ('4–2 to AgentCore — and the two it loses are the honest half. '
              'Latency stays on this slide: it does not change the decision.')
    ops += [
        ('rect', 0.62, 6.58, 12.10, 0.42, ORANGE, None, 0.10),
        ('text', 0.82, 6.58, 11.70, 0.42, banner, 11.5, NAVY, True, 'l', 'm'),
    ]
    return ops


# ─────────────────────────────────────────────────────────────────────────────
# Cost — the deep-dive: fixed floor vs. usage meter at 1 / 10 / 1k / 1M users.
# ─────────────────────────────────────────────────────────────────────────────
# Engine A: $18.02/mo per Fargate task (one task per 40 concurrent sessions,
# the deck's own capacity number) + $1.385/user/mo extraction calls.
# Engine B: $0.0006/mo Gateway (the only fixed line) + $0.1027/user/mo
# (compute $0.0047 + Memory $0.098). Identical Bedrock reply call excluded.

COST_ROWS = [
    ('1',         '$18.02', '$1.39',  '$19.41',  '$0.10',  '189×'),
    ('10',        '$18.02', '$13.85', '$31.87',  '$1.03',  '31×'),
    ('1,000',     '$450',   '$1,385', '$1,836',  '$103',   '18×'),
    ('1,000,000', '$450K',  '$1.4M',  '$1.84M',  '$103K',  '18×'),
]

CCOLS = dict(users=(0.62, 1.55), a=(2.27, 5.05), b=(7.42, 3.10), gap=(10.62, 2.10))


def slide_cost_scaling(page, total, badge):
    ops = chrome(page, total, badge)
    ops += heading(
        'Cost — the floor vs. the meter',
        'Fixed versus usage as users grow. Extraction and compute in; the '
        'identical Bedrock reply call excluded from both.')
    ops += chip_strip(TOGGLES['cost'])

    hy, top, rh = 2.52, 2.94, 0.60
    ops.append(('rect', 0.62, hy, 12.10, 0.40, NAVY, None, 0.06))
    for k, lab, col in (('users', 'USERS', ORANGE),
                        ('a', f'{A_LABEL}  —  FLOOR + USAGE = TOTAL', WHITE),
                        ('b', f'{B_LABEL}', WHITE),
                        ('gap', 'GAP', WHITE)):
        cx, cw = CCOLS[k]
        ops.append(('text', cx + 0.12, hy, cw - 0.24, 0.40, lab, 10, col, True, 'l', 'm'))

    for r, (users, floor, usage, total_a, total_b, gap) in enumerate(COST_ROWS):
        y = top + r * rh
        if r % 2 == 0:
            ops.append(('rect', 0.62, y, 12.10, rh, CARD, None, 0))
        ops.append(('rect', 0.62, y + rh - 0.01, 12.10, 0.01, BORDER, None, 0))
        cx, cw = CCOLS['users']
        ops.append(('text', cx + 0.12, y, cw - 0.24, rh, users, 13, NAVY, True, 'l', 'm'))
        cx, cw = CCOLS['a']
        ops.append(('text', cx + 0.12, y, cw - 0.24, rh,
                    [(f'{floor}', True, GREY), ('  floor  +  ', False, GREY),
                     (f'{usage}', True, GREY), ('  usage   =   ', False, GREY),
                     (total_a, True, NAVY)], 12, INK, False, 'l', 'm'))
        cx, cw = CCOLS['b']
        ops.append(('text', cx + 0.12, y, cw - 0.24, rh,
                    [('no floor   =   ', False, GREY), (total_b, True, GREEN)],
                    12, INK, False, 'l', 'm'))
        cx, cw = CCOLS['gap']
        ops.append(('text', cx + 0.12, y, cw - 0.24, rh, gap, 15, ORANGE, True, 'l', 'm'))

    insight = ('The floor decides at one user; the meter decides at a million. '
               'Engine A’s “fixed” cost is not even fixed — it steps up one task '
               'per 40 concurrent sessions — and its $1.39/user extraction meter '
               'never catches B’s $0.10. Engine B has no floor at any scale.')
    ops.append(('text', 0.62, 5.44, 12.10, 0.60, insight, 11, GREY, False, 'l', 't'))

    ops += verdict_band(
        '18×', 'cheaper at scale — 189× at one user, where only B has no floor',
        'AGENTCORE',
        giveup='if Memory retrievals meter per record, not per call, this narrows — confirm before quoting')
    return ops


# ─────────────────────────────────────────────────────────────────────────────
# Resilience — the experiment, rebuilt native (replaces the off-template
# dark raster): the same fault injected on each engine, 40 dots per side.
# ─────────────────────────────────────────────────────────────────────────────

FAULTS = [
    ('Unhandled rejection', 'one turn throws; the shared process exits.'),
    ('Out of memory', 'one runaway conversation exhausts the one heap.'),
    ('Injection that pivots', 'reaches the registry and every user’s tokens.'),
]


def _dot_grid(x, y, lost, safe_color=GREEN, lost_color=ORANGE, lost_first=40):
    """40 sessions as a 10×4 grid; `lost` of them marked."""
    ops = []
    d, sx, sy = 0.17, 0.315, 0.30
    for i in range(40):
        col, row = i % 10, i // 10
        c = lost_color if i < lost else safe_color
        ops.append(('oval', x + col * sx, y + row * sy, d, d, c, None))
    return ops


def slide_blast(page, total, badge):
    ops = chrome(page, total, badge)
    ops += heading(
        'One fault, forty sessions',
        'The same process-level fault, injected into one live session on each engine.')
    ops += chip_strip(TOGGLES['resil'])

    y, h, w = 2.62, 2.70, 5.90
    for x, title, fill, lost, cap in (
            (0.62, A_LABEL, GREY, 40,
             '40 / 40 sessions lost — every user, every partner profile in flight.'),
            (6.82, B_LABEL, NAVY, 1,
             '1 / 40 sessions lost — the caller. Thirty-nine never notice.')):
        ops += [
            ('rect', x, y, w, h, CARD, BORDER, 0.06),
            ('rect', x, y, w, 0.46, fill, None, 0),
            ('text', x + 0.22, y, w - 0.44, 0.46, title, 11.5, WHITE, True, 'l', 'm'),
        ]
        ops += _dot_grid(x + 1.35, y + 0.78, lost)
        ops += [('text', x + 0.22, y + 2.08, w - 0.44, 0.52, cap, 11.5, NAVY,
                 True, 'l', 'm')]

    fy, fw, gap = 5.50, 3.92, 0.17
    for i, (lead, body) in enumerate(FAULTS):
        fx = 0.62 + i * (fw + gap)
        ops += [
            ('rect', fx, fy, fw, 0.52, CARD, BORDER, 0.06),
            ('text', fx + 0.16, fy, fw - 0.32, 0.52,
             [(lead + ' — ', True, NAVY), (body, False, INK)], 10, INK,
             False, 'l', 'm'),
        ]

    ops += verdict_band(
        '40 → 1', 'sessions lost to the same fault, on the same code — '
        'the whole argument in one number', 'AGENTCORE')
    return ops


# ─────────────────────────────────────────────────────────────────────────────
# The remaining deep-dive lens slides (latency deliberately has none).
# ─────────────────────────────────────────────────────────────────────────────

def all_lens_slides(total, pages, badges):
    """pages/badges: dicts keyed by lens key."""
    S = []
    S.append(slide_cost_scaling(pages['cost'], total, badges['cost']))

    S.append(slide_lens(
        pages['resil'], total, badges['resil'],
        'Resilience — what one fault takes down',
        'The blast radius of a crash, in each engine.',
        'resil',
        a_points=[
            ('Forty sessions, one Node process.',
             'One heap, one event loop, one crash — a fault anywhere travels '
             'everywhere.'),
            ('Tools crash in-process too.',
             'A misbehaving integration takes the whole agent with it, '
             'mid-conversation.'),
        ],
        b_points=[
            ('One microVM per session.',
             'A process-level fault has nowhere to travel; thirty-nine '
             'conversations never notice.'),
            ('One Lambda per tool behind Gateway.',
             'A crashed tool is a failed call, not a dead agent.'),
        ],
        num='40 → 1', caption='sessions lost to one process fault — measured, next slide',
        winner='AGENTCORE',
        giveup='container control: no sidecars, no long-lived in-process cache'))

    S.append(slide_lens(
        pages['security'], total, badges['security'],
        'Security — what one breach reaches',
        'Same two components as resilience; the question is what leaks, not what crashes.',
        'security',
        a_points=[
            ('Every credential in one heap.',
             'A process-wide registry holds every user’s tokens next to '
             'every live session.'),
            ('One shared IAM role.',
             'An injection that pivots to the registry reaches the shared '
             'Bedrock client and everyone’s tokens.'),
        ],
        b_points=[
            ('Auth resolves per tool.',
             'Each tool is its own Lambda with its own role; credentials never '
             'share a heap with sessions.'),
            ('Isolation is the boundary, twice.',
             'A hijacked session is walled into its own microVM — it reaches '
             'its own tokens and nothing else.'),
        ],
        num='all → one', caption='users’ tokens reachable from a single compromised session',
        winner='AGENTCORE',
        giveup='the boundary is managed — you trust it rather than inspect it'))

    S.append(slide_lens(
        pages['ownership'], total, badges['ownership'],
        'Ownership & velocity — what you maintain forever',
        'The code you keep owning after launch, and how fast the agent can grow.',
        'ownership',
        a_points=[
            ('The extraction prompt is mine forever.',
             'A second prompt to version, test and babysit — on top of the '
             'agent’s own.'),
            ('Adding a tool is a deploy.',
             'Registry change, build, rolling ECS deploy — growth at the speed '
             'of the pipeline.'),
        ],
        b_points=[
            ('Extraction is the service’s problem.',
             'One event in, one retrieval out. One fewer prompt to own.'),
            ('The tool list is data.',
             'Adding or revoking a tool via Gateway is a config change, not a '
             'release.'),
        ],
        num='−1 prompt', caption='to own, version and regression-test — and tool changes stop being releases',
        winner='AGENTCORE',
        giveup='the extraction schema you designed — preferenceCategoryCount is gone'))

    S.append(slide_lens(
        pages['debug'], total, badges['debug'],
        'Debuggability — the lens DIY wins',
        'What you can actually see when a turn goes wrong at two in the morning.',
        'debug',
        a_points=[
            ('Exactly the fields that decide an incident.',
             'Hand-wired OTEL spans: turn id, tool name, extraction latency, '
             'which reminder fired.'),
            ('The cost is real, not rhetorical.',
             'I wrote the span plumbing and now maintain it — and CloudWatch is '
             'another bill.'),
        ],
        b_points=[
            ('Traces for free — on its schema.',
             'Session-level traces arrive with zero work, but the 2am fields '
             'are not the ones it emits.'),
            ('Where I actually landed.',
             'AgentCore’s traces as the floor, my spans kept for the two '
             'or three fields that decide an incident.'),
        ],
        num='1 of 6', caption='the lens DIY keeps — a 6–0 comparison would be a sales pitch',
        winner='DIY'))
    return S
