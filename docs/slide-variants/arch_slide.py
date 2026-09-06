"""arch_slide.py — the architecture slide, re-authored as native shapes.

It replaces a flattened render of public/agentcore-compare.html. That picture set
its captions at 9.5px and its chips at 8.5px in a 1600px-wide render, and 1600px
maps to a 13.333in slide — so on the slide they were 5.7pt and 5.1pt. No rescale
could fix that, which is why the drawing is re-authored here instead:

- every string is >= 14pt, and nothing is a picture except the service icons,
  so it is all selectable, resizable, screen-reader-readable text;
- the only dashed outlines left are the two engine boundaries. The VPC box, the
  two subnet boxes and their captions are gone, and so are the dotted telemetry
  and mirror-path edges — every connector here is solid;
- the resource names and the hop-by-hop narration live in the speaker notes.

DYNAMODB IS SHARED, AND THE FIRST VERSION OF THIS SLIDE GOT IT WRONG

It drew DynamoDB inside engine A's dashed boundary, which reads as "engine A's
database". It is not. `agentcore-orchestrator.ts` is explicit: DynamoDB "stays
the source of truth for the profile", AgentCore Memory's extracted records are
"mirrored into it after each turn", and the pending-proposal store is "the same
store engine A uses". Engine B writes it two ways — the mirror, and the profile
tools keying its partition from behind the Gateway.

So it sits in the shared column now, and three things say so rather than one:
its position inside SHARED BY BOTH ENGINES, an arrow in from each engine, and a
tinted fill that makes it the one card the eye lands on. It is placed last in
that column on purpose — bottom of the shared stack means it borders engine B,
so engine B's arrow into it is a short hop rather than a trip around CloudWatch.

Cards are 0.68in rather than 0.88in, and each group box now wraps only its own
rows instead of every box sharing one tall band height. Engine A's box ends up
small — it holds one Fargate service — and that asymmetry against engine B's six
components is the argument the slide is making, so it is worth showing.
"""
import os

from aws_slides import (W, H, NAVY, ORANGE, GREEN, INK, GREY, CARD, BORDER,
                        WHITE, FAINT, FONT, FOOTER)

ICON_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
ICON = 0.42          # was ~0.22in in the flattened render
NAME_PT = 15
CAPTION_PT = 14      # the floor: nothing on this slide is smaller
LABEL_PT = 14

PAD = 0.11           # box padding, and the card's left inset


def icon(name):
    return os.path.join(ICON_DIR, name + '.png')


def card(x, y, w, h, glyph, name, caption=None, dim=False, fill=None,
         edge=None):
    """Icon at the left, service name, one caption line. No chips: the chips in
    the old drawing were 5pt, and what they said now lives in the notes."""
    bg = fill or (WHITE if dim else CARD)
    ops = [('rect', x, y, w, h, bg, edge or BORDER, 0.08)]
    ops.append(('pic', x + PAD, y + (h - ICON) / 2, ICON, ICON, icon(glyph),
                f'{name} icon'))
    tx = x + PAD + ICON + PAD
    tw = w - (tx - x) - 0.09
    if caption:
        ops += [
            ('text', tx, y + 0.06, tw, 0.27, name, NAME_PT,
             GREY if dim else NAVY, True, 'l', 't'),
            ('text', tx, y + 0.34, tw, 0.30, caption, CAPTION_PT, GREY,
             False, 'l', 't'),
        ]
    else:
        ops.append(('text', tx, y, tw, h, name, NAME_PT,
                    GREY if dim else NAVY, True, 'l', 'm'))
    return ops


def elbow(pts, color, wpt):
    """Orthogonal run of legs; only the last one carries the arrowhead."""
    ops = []
    for i in range(len(pts) - 1):
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        kind = 'arrow' if i == len(pts) - 2 else 'line'
        ops.append((kind, x1, y1, x2, y2, color, wpt))
    return ops


# ── geometry ────────────────────────────────────────────────────────────────
# Top zone across the full width: front door | engine A | shared. Bottom zone:
# engine B, full width, so its cards carry real resource names on one line at
# 14pt. Every group box is top-aligned at TOP_Y and as tall as its own rows.
CH = 0.68                              # card height
TOP_Y = 1.52
R1, R2, R3 = 1.66, 2.60, 3.54          # card rows in the top zone
EB_Y = 4.73
B1, B2 = 4.84, 5.70                    # card rows inside engine B

FD = (0.42, TOP_Y, 4.55, R2 + CH + PAD - TOP_Y)   # front door
EA = (5.11, TOP_Y, 3.39, R1 + CH + PAD - TOP_Y)   # engine A  (dashed navy)
SH = (8.90, TOP_Y, 4.04, R3 + CH + PAD - TOP_Y)   # shared
EB = (0.42, EB_Y, 12.52, B2 + CH + PAD - EB_Y)    # engine B  (dashed green)
LG_Y, LG_H = 6.61, 0.36                # legend strip

FD_C1, FD_C2, FD_W = 0.53, 2.765, 2.095
EA_X, EA_W = 5.22, 3.17
SH_X, SH_W = 9.01, 3.82
EB_C = (0.53, 4.677, 8.824); EB_W = 4.007

# Two vertical corridors, each in a gap between boxes so no connector runs
# through a card. CORR_A carries the ALB up into engine A. CORR_B carries engine
# B's climb to the model: it leaves the Runtime's top edge, so it only has to
# clear engine A's box (ends 8.50) and the shared box (starts 8.90).
CORR_A, CORR_B = 5.04, 8.62

REQ, REQ_W = ORANGE, 2.25              # the request path
AUX, AUX_W = GREY, 1.5                 # static assets, session traces

LEGEND = [
    ('arrow', REQ, 'the request path'),
    ('dash', NAVY, 'engine A · my code'),
    ('dash', GREEN, 'engine B · AgentCore'),
    ('solid', BORDER, 'shared · both engines'),
]


def ops(page=None, total=None, badge=None):
    o = [('rect', 0, 0, W, H, WHITE, None, 0)]
    if badge is not None:
        o += [('oval', 0.55, 0.40, 0.65, 0.65, NAVY, None),
              ('text', 0.55, 0.40, 0.65, 0.65, str(badge), 26, ORANGE, True,
               'c', 'm')]
    o += [
        ('text', 1.40 if badge is not None else 0.55, 0.40, 11.00, 0.65,
         'Architecture — one product, two engines', 30, NAVY, True, 'l', 'm'),
        ('rect', 0.55, 1.15, 1.50, 0.04, ORANGE, None, 0),
        # The template sets the footer and page number at 10pt on every other
        # slide. Here they are at the 14pt floor too — a floor with an exception
        # in it is not a floor, and both strings have room to grow.
        ('text', 0.55, 7.02, 9.00, 0.38, FOOTER, CAPTION_PT, GREY, True, 'l', 'm'),
    ]
    if page is not None:
        o.append(('text', 11.00, 7.02, 1.80, 0.38, f'{page} / {total}',
                  CAPTION_PT, GREY, False, 'r', 'm'))

    # Group labels sit above their boxes so no card gives up room for one.
    o += [
        ('text', FD[0], 1.24, 4.55, 0.26, 'SHARED FRONT DOOR', LABEL_PT, GREY,
         True, 'l', 'm'),
        ('text', EA[0], 1.24, 3.39, 0.26, 'ENGINE A · GLUE CODE', LABEL_PT,
         NAVY, True, 'l', 'm'),
        ('text', SH[0], 1.24, 4.04, 0.26, 'SHARED BY BOTH ENGINES', LABEL_PT,
         GREY, True, 'l', 'm'),
        # Left-aligned, and kept clear of x3.81 where the request drops in.
        ('text', EB[0], 4.45, 3.20, 0.26, 'ENGINE B · AGENTCORE', LABEL_PT,
         GREEN, True, 'l', 'm'),
    ]

    # Boxes first, cards on top of them.
    o += [
        ('rect', *FD, None, BORDER, 0.08, 1.25, None),
        ('rect', *EA, None, NAVY, 0.08, 1.75, 'dash'),
        ('rect', *SH, None, BORDER, 0.08, 1.25, None),
        ('rect', *EB, None, GREEN, 0.08, 1.75, 'dash'),
    ]

    o += card(FD_C1, R1, FD_W, CH, 'browser', 'Browser', 'the chat UI')
    o += card(FD_C2, R1, FD_W, CH, 'cloudfront', 'CloudFront', 'one origin')
    o += card(FD_C1, R2, FD_W, CH, 's3', 'S3', 'app bundle', dim=True)
    o += card(FD_C2, R2, FD_W, CH, 'alb', 'ALB', '/api/* · /ws')

    o += card(EA_X, R1, EA_W, CH, 'fargate', 'Fargate', 'valentin-service-dev')

    o += card(SH_X, R1, SH_W, CH, 'bedrock', 'Bedrock', 'Claude Sonnet 4.5')
    o += card(SH_X, R2, SH_W, CH, 'cloudwatch', 'CloudWatch',
              'one dashboard, both engines')
    # Tinted, because "the database is engine A's" is the wrong conclusion this
    # slide used to invite. An arrow arrives from each engine, below.
    o += card(SH_X, R3, SH_W, CH, 'dynamodb', 'DynamoDB',
              'ValentinTable-dev · shared', fill=FAINT, edge=ORANGE)

    o += card(EB_C[0], B1, EB_W, CH, 'fargate', 'Fargate', 'valentin-ac-proxy-dev')
    o += card(EB_C[1], B1, EB_W, CH, 'runtime', 'Runtime', 'valentin_agent_dev')
    o += card(EB_C[2], B1, EB_W, CH, 'memory', 'Memory', 'valentin_memory_dev')
    o += card(EB_C[0], B2, EB_W, CH, 'observability', 'Observability',
              'session traces')
    o += card(EB_C[1], B2, EB_W, CH, 'gateway', 'Gateway', 'MCP · CUSTOM_JWT')
    o += card(EB_C[2], B2, EB_W, CH, 'lambda', 'Lambda',
              'valentin-profile-tools-dev')

    o += legend()
    o += edges()
    return o


def legend():
    """A strip, not a panel: it reads left to right like the diagram does."""
    o = []
    for i, (kind, color, label) in enumerate(LEGEND):
        x = 0.55 + i * 3.07
        if kind == 'arrow':
            o.append(('arrow', x, LG_Y + LG_H / 2, x + 0.55, LG_Y + LG_H / 2,
                      color, REQ_W))
        else:
            o.append(('rect', x, LG_Y + 0.05, 0.55, LG_H - 0.10, CARD, color,
                      0.04, 1.75, 'dash' if kind == 'dash' else None))
        o.append(('text', x + 0.68, LG_Y, 2.35, LG_H, label, CAPTION_PT, INK,
                  False, 'l', 'm'))
    return o


def edges():
    mid1, mid2, mid3 = R1 + CH / 2, R2 + CH / 2, R3 + CH / 2   # 2.00 2.94 3.88
    fd_c2_r = FD_C2 + FD_W                       # 4.86, front door right column
    alb_c = FD_C2 + FD_W / 2                     # 3.81
    ea_r = EA_X + EA_W                           # 8.39
    rt_r = EB_C[1] + EB_W                        # 8.68, engine B middle column
    o = []
    # Front door: the api path runs down through the ALB, the static path peels
    # off left to S3.
    o += elbow([(FD_C1 + FD_W, mid1), (FD_C2, mid1)], REQ, REQ_W)
    o += elbow([(alb_c, R1 + CH), (alb_c, R2)], REQ, REQ_W)
    o += elbow([(FD_C2 + 0.28, R1 + CH), (FD_C2 + 0.28, R1 + CH + 0.13),
                (FD_C1 + FD_W / 2, R1 + CH + 0.13),
                (FD_C1 + FD_W / 2, R2)], AUX, AUX_W)
    # The ALB is the fork: up into engine A, straight down into engine B.
    o += elbow([(fd_c2_r, mid2), (CORR_A, mid2), (CORR_A, mid1), (EA_X, mid1)],
               REQ, REQ_W)
    o += elbow([(alb_c, R2 + CH), (alb_c, EB_Y)], REQ, REQ_W)
    # Engine A reaches the model, and writes the profile to the shared table.
    # The table leg drops out of engine A's box rather than running right and
    # then down: a right-then-down route would run parallel to engine B's climb
    # in the same 0.4in gap, and two orange lines that close together read as one
    # doubled line. Dropping first crosses that climb once, at a right angle.
    o += elbow([(ea_r, mid1 - 0.10), (SH_X, mid1 - 0.10)], REQ, REQ_W)
    o += elbow([(ea_r - 0.19, R1 + CH), (ea_r - 0.19, mid3), (SH_X, mid3)],
               REQ, REQ_W)
    # Engine B, left to right, then up to the same model engine A uses.
    o += elbow([(EB_C[0] + EB_W, B1 + CH / 2), (EB_C[1], B1 + CH / 2)], REQ, REQ_W)
    o += elbow([(rt_r, B1 + CH / 2), (EB_C[2], B1 + CH / 2)], REQ, REQ_W)
    o += elbow([(CORR_B, B1), (CORR_B, mid1 + 0.15),
                (SH_X, mid1 + 0.15)], REQ, REQ_W)
    o += elbow([(EB_C[1] + EB_W / 2, B1 + CH), (EB_C[1] + EB_W / 2, B2)],
               REQ, REQ_W)
    o += elbow([(rt_r, B2 + CH / 2), (EB_C[2], B2 + CH / 2)], REQ, REQ_W)
    # Memory's extracted records are mirrored into the shared table. Short hop,
    # because the table is the bottom card of the shared column.
    o += elbow([(EB_C[2] + EB_W / 2, B1), (EB_C[2] + EB_W / 2, R3 + CH)],
               REQ, REQ_W)
    # Session traces come back off the Runtime.
    o += elbow([(EB_C[1], B1 + 0.52), (EB_C[1] - 0.14, B1 + 0.52),
                (EB_C[1] - 0.14, B2 + CH / 2),
                (EB_C[0] + EB_W, B2 + CH / 2)], AUX, AUX_W)
    return o


NOTES = (
    '[1:20 · Architecture] One product, two engines. The left is held fixed: the '
    'browser talks to CloudFront, which serves the React app out of S3 and sends '
    '/api/* and /ws to the ALB. The ALB is the fork.\n\n'
    'Up and to the right is engine A — the glue code I wrote. One Fargate '
    'service calls Bedrock directly and runs a hand-written extractor.\n\n'
    'Along the bottom is engine B — the same product on Amazon Bedrock '
    'AgentCore. A thin Fargate proxy hands the turn to the AgentCore Runtime, '
    'which uses Memory for extraction, Gateway to reach the profile-tools Lambda '
    'over MCP, and Observability for session traces.\n\n'
    'The column on the right is what neither engine owns. Both call the same '
    'model. Both report into one CloudWatch dashboard. And both write the same '
    'table — the tinted card, because people assume the database belongs to '
    'engine A. It does not. It stays the source of truth for the profile either '
    'way: engine A writes it directly, and on engine B whatever Memory extracts '
    'is mirrored into it after every turn. So the profile UI works unchanged on '
    'both.\n\n'
    'Only the two dashed regions differ — and the four decisions inside them '
    'are the next four slides.'
)
