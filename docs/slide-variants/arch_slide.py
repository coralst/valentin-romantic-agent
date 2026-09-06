"""arch_slide.py — the architecture slide, re-authored as native shapes.

It replaces a flattened render of public/agentcore-compare.html. That picture set
its captions at 9.5px and its chips at 8.5px in a 1600px-wide render, and 1600px
maps to a 13.333in slide — so on the slide they were 5.7pt and 5.1pt. No rescale
could fix that, which is why the drawing is re-authored here instead:

- every string is >= 14pt, and nothing is a picture except the service icons,
  so it is all selectable, resizable, screen-reader-readable text;
- icons are 0.46in instead of 0.22in;
- the only dashed outlines left are the two engine boundaries. The VPC box, the
  two subnet boxes and their captions are gone, and so are the dotted telemetry
  and mirror-path edges — every connector here is solid;
- the resource names and the hop-by-hop narration live in the speaker notes.
"""
import os

from aws_slides import (W, H, NAVY, ORANGE, GREEN, INK, GREY, CARD, BORDER,
                        WHITE, FONT, FOOTER)

ICON_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
ICON = 0.46          # was ~0.22in in the flattened render
NAME_PT = 15
CAPTION_PT = 14      # the floor: nothing on this slide is smaller
LABEL_PT = 14


def icon(name):
    return os.path.join(ICON_DIR, name + '.png')


def card(x, y, w, h, glyph, name, caption=None, dim=False):
    """Icon at the left, service name, one caption line. No chips: the chips in
    the old drawing were 5pt, and what they said now lives in the notes."""
    ops = [('rect', x, y, w, h, WHITE if dim else CARD, BORDER, 0.08)]
    ops.append(('pic', x + 0.13, y + (h - ICON) / 2, ICON, ICON, icon(glyph),
                f'{name} icon'))
    tx = x + 0.13 + ICON + 0.12
    tw = w - (tx - x) - 0.10
    if caption:
        ops += [
            ('text', tx, y + 0.13, tw, 0.28, name, NAME_PT,
             GREY if dim else NAVY, True, 'l', 't'),
            ('text', tx, y + 0.43, tw, 0.34, caption, CAPTION_PT, GREY,
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
# engine B, also full width, so its cards are wide enough to carry the real
# resource names on one line at 14pt. Legend is a strip under both.
TOP_Y, TOP_H = 1.52, 2.34
R1, R2, CH = 1.68, 2.86, 0.88          # card rows in the top zone
BOT_Y, BOT_H = 4.24, 2.28
B1, B2 = 4.38, 5.50                    # card rows inside engine B

FD = (0.42, TOP_Y, 5.00, TOP_H)        # front door box
EA = (5.56, TOP_Y, 3.29, TOP_H)        # engine A box   (dashed navy)
SH = (8.99, TOP_Y, 3.95, TOP_H)        # shared box
EB = (0.42, BOT_Y, 12.52, BOT_H)       # engine B box   (dashed green)
LG_Y, LG_H = 6.60, 0.38                # legend strip

FD_C1, FD_C2, FD_W = 0.58, 3.12, 2.10
EA_X, EA_W = 5.72, 2.97
SH_X, SH_W = 9.15, 3.63
EB_C = (0.58, 4.79, 9.00)
EB_W = 3.77

# Two vertical corridors, each in a gap between boxes so no connector ever runs
# through a card or through the other engine's boundary.
CORR_A, CORR_B = 5.49, 8.92

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

    # Group labels sit above their boxes so no card has to give up room for one.
    # Engine B's is right-aligned: the request drops into the band on the left,
    # and a left-aligned label there would sit under that arrow.
    o += [
        ('text', FD[0], 1.24, 4.60, 0.26, 'SHARED FRONT DOOR', LABEL_PT, GREY,
         True, 'l', 'm'),
        ('text', EA[0], 1.24, 3.29, 0.26, 'ENGINE A · GLUE CODE', LABEL_PT,
         NAVY, True, 'l', 'm'),
        ('text', SH[0], 1.24, 3.95, 0.26, 'SHARED BY BOTH ENGINES', LABEL_PT,
         GREY, True, 'l', 'm'),
        # Short, because engine B's arrow up to Bedrock crosses this row in the
        # only corridor available to it.
        ('text', 9.60, 3.96, 3.34, 0.26, 'ENGINE B · AGENTCORE',
         LABEL_PT, GREEN, True, 'r', 'm'),
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
    o += card(FD_C1, R2, FD_W, CH, 's3', 'S3', 'static assets', dim=True)
    o += card(FD_C2, R2, FD_W, CH, 'alb', 'ALB', '/api/* · /ws')

    o += card(EA_X, R1, EA_W, CH, 'fargate', 'Fargate', 'valentin-service-dev')
    o += card(EA_X, R2, EA_W, CH, 'dynamodb', 'DynamoDB', 'ValentinTable-dev')

    o += card(SH_X, R1, SH_W, CH, 'bedrock', 'Bedrock', 'Claude Sonnet 4.5')
    o += card(SH_X, R2, SH_W, CH, 'cloudwatch', 'CloudWatch',
              'one dashboard, both engines')

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
    mid1, mid2 = R1 + CH / 2, R2 + CH / 2          # 2.12, 3.30
    bmid1, bmid2 = B1 + CH / 2, B2 + CH / 2        # 4.82, 5.94
    fd_r, ea_r = FD_C2 + FD_W, EA_X + EA_W         # 5.22, 8.69
    alb_c, rt_r = FD_C2 + FD_W / 2, EB_C[1] + EB_W  # 4.17, 8.56
    o = []
    # Front door: the api path runs straight down through the ALB, and the
    # static path peels off left to S3.
    o += elbow([(FD_C1 + FD_W, mid1), (FD_C2, mid1)], REQ, REQ_W)
    o += elbow([(alb_c, R1 + CH), (alb_c, R2)], REQ, REQ_W)
    o += elbow([(FD_C2 + 0.28, R1 + CH), (FD_C2 + 0.28, 2.71),
                (FD_C1 + FD_W / 2, 2.71), (FD_C1 + FD_W / 2, R2)], AUX, AUX_W)
    # The ALB is the fork: up into engine A, straight down into engine B.
    o += elbow([(fd_r, mid2), (CORR_A, mid2), (CORR_A, mid1), (EA_X, mid1)],
               REQ, REQ_W)
    o += elbow([(alb_c, R2 + CH), (alb_c, B1)], REQ, REQ_W)
    # Engine A.
    o += elbow([(EA_X + EA_W / 2, R1 + CH), (EA_X + EA_W / 2, R2)], REQ, REQ_W)
    o += elbow([(ea_r, mid1), (SH_X, mid1)], REQ, REQ_W)
    # Engine B, and its own arrow up to the same Bedrock card engine A uses.
    o += elbow([(EB_C[0] + EB_W, bmid1), (EB_C[1], bmid1)], REQ, REQ_W)
    o += elbow([(rt_r, bmid1), (EB_C[2], bmid1)], REQ, REQ_W)
    o += elbow([(rt_r, B1 + 0.17), (CORR_B, B1 + 0.17), (CORR_B, mid2 - 0.95),
                (SH_X, mid2 - 0.95)], REQ, REQ_W)
    o += elbow([(EB_C[1] + EB_W / 2, B1 + CH), (EB_C[1] + EB_W / 2, B2)],
               REQ, REQ_W)
    o += elbow([(rt_r, bmid2), (EB_C[2], bmid2)], REQ, REQ_W)
    o += elbow([(EB_C[1], B1 + 0.72), (EB_C[1] - 0.22, B1 + 0.72),
                (EB_C[1] - 0.22, bmid2), (EB_C[0] + EB_W, bmid2)], AUX, AUX_W)
    return o


NOTES = (
    '[1:00 · Architecture] One product, two engines. Everything on the left is '
    'held fixed: the browser talks to CloudFront, which serves the React app out '
    'of S3 and sends /api/* and /ws to the ALB. The ALB is the fork.\n\n'
    'Up and to the right is engine A — the glue code I wrote. One Fargate '
    'service, valentin-service-dev, calls Bedrock directly and keeps preferences '
    'in DynamoDB.\n\n'
    'Down and to the right is engine B — the same product on Amazon Bedrock '
    'AgentCore. A thin Fargate proxy, valentin-ac-proxy-dev, hands the turn to '
    'the AgentCore Runtime valentin_agent_dev, which uses AgentCore Memory for '
    'preferences, Gateway to reach the profile-tools Lambda over MCP with '
    'CUSTOM_JWT, and Observability for session traces.\n\n'
    'Both engines call the same model, Claude Sonnet 4.5, and both report into '
    'one CloudWatch dashboard. Only the two dashed regions differ — and the four '
    'decisions inside them are the next four slides.'
)
