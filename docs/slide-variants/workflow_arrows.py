"""workflow_arrows.py — the arrows for the "what makes it agentic?" slide.

The deck ships nine arrow shapes on that slide that carry no <a:prstGeom>, so
PowerPoint draws nothing at all: the loop has no direction and the timeline is
not visibly wired to it. These ops replace them.

Coordinates are measured off the slide's real shapes (see wireframe.py, which
draws these on top of the actual bounding boxes so the placement can be checked
without rasterising the pptx).

  ring        Oval 6            (1.75, 1.82) 4.01 x 3.85
  step 1      Triger and planning   (2.92, 5.29) 1.98 x 0.81
  step 5      Feedback after ...    (4.94, 3.87) 1.98 x 0.81  right edge x 6.92
  timeline    bar at y 6.55; nodes 0.19 sq at y 6.47, left x = 1.45 4.28 7.09 ...
"""
from aws_slides import ORANGE

RING = (1.75, 1.82, 4.01, 3.85)

# Step centres sit at these angles on the ring (0deg = 3 o'clock, clockwise+):
#   1 Triger/planning 90, 2 Use tools 166, 3 Propose 227,
#   4 Discussion/extraction 315, 5 Feedback 13.8
# so the cycle runs clockwise. One arc per hop, in the gap between two steps.
ARC_SPANS = [(110, 38), (185, 25), (246, 50), (333, 22), (32, 40)]

TL_NODE_X = {'anniversary': 4.28 + 0.095, 'birthday': 7.09 + 0.095}
TL_TOP = 6.44          # top of the node ovals
STEP1_BOTTOM = 6.10    # 5.29 + 0.81
STEP5_RIGHT = 6.92
STEP5_MID_Y = 4.28


def ops(color=ORANGE, w=3.0):
    x, y, cw, ch = RING
    out = [('arc', x, y, cw, ch, s, sw, color, w, True) for s, sw in ARC_SPANS]

    # The timeline drives the loop: an event on the calendar starts a planning pass.
    out.append(('arrow', TL_NODE_X['anniversary'], TL_TOP,
                TL_NODE_X['anniversary'], STEP1_BOTTOM + 0.06, color, w))

    # ...and the loop drives the timeline back: feedback can set the next event.
    # Routed down the clear corridor at x 6.92-7.29, left of the MEMORY card.
    bx = TL_NODE_X['birthday']
    out += [
        ('line', STEP5_RIGHT, STEP5_MID_Y, bx, STEP5_MID_Y, color, w),
        ('arrow', bx, STEP5_MID_Y, bx, TL_TOP - 0.02, color, w),
        ('text', 5.10, 5.42, 1.90, 0.24, 'sets a new event', 9, color, True, 'r', 'm'),
    ]
    return out
