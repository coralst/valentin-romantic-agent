"""graph_crop.py — the PR-graph slide: native text around a cropped plot.

The v6 slide was one screenshot, so its lane labels, legend and caption strip
were baked in at 5–7pt. A chart's own plot can stay a picture, but its labels
should not be pixels: this crops the picture down to the plot itself (dropping
the label gutter, the legend and the caption strip) and re-authors all of that
text natively at 10pt or larger.

Pixel measurements are of the embedded 2400×1352 screenshot:
  spine (the 'main' line)        y = 444
  lane band centres              y = 495 + 48.5·n, seven lanes
  bands start / plot content     x = 309 / 416, first node ≈ 475
  bands end (card padding after) x = 2110
  baked caption strip            y = 822–845, card bottom y = 957
"""

import raster_slides as R
from aws_slides import NAVY, GREY, ORANGE, INK, chrome, heading

IMG_W, IMG_H = 2400, 1352

# What to keep: a little above the spine down to just under the last lane, and
# from just right of the label gutter to the card's right edge.
KEEP = dict(x0=452, x1=2110, y0=424, y1=806)
CROP = dict(l=KEEP['x0'] / IMG_W, r=1 - KEEP['x1'] / IMG_W,
            t=KEEP['y0'] / IMG_H, b=1 - KEEP['y1'] / IMG_H)

# Where the cropped plot lands on the slide (aspect preserved).
_PX_W = KEEP['x1'] - KEEP['x0']
_PX_H = KEEP['y1'] - KEEP['y0']
PLOT = dict(x=2.05, y=2.35, w=10.67)   # right edge lands on the 12.72 margin
PLOT['h'] = PLOT['w'] * _PX_H / _PX_W
PLOT['scale'] = _PX_W / PLOT['w']            # px per inch as placed

LANES = ['Master Agent', 'System Architect', 'Frontend Dev', 'Backend Dev',
         'UI Designer', 'QA Agent', 'Infra / Workflow']
LANE_Y0, LANE_STEP = 495, 48.5               # band centres, in source pixels


def lane_label_ops():
    """Seven lane names, each vertically centred on its band in the picture."""
    ops = []
    for i, name in enumerate(LANES):
        cy = PLOT['y'] + (LANE_Y0 + i * LANE_STEP - KEEP['y0']) / PLOT['scale']
        ops.append(('text', 0.62, cy - 0.13, 1.32, 0.26, name, 10, NAVY,
                    True, 'r', 'm'))
    return ops


LEGEND = ('node size = files changed   ·   ring = a genuine multi-agent review '
          'thread   ·   dashed = reviewed, then closed without merging   ·   '
          'left to right = the order the PRs were opened')


def slide_graph_ops(page, total, badge):
    """Everything except the plot picture — the build script adds that."""
    ops = chrome(page, total, badge)
    ops += R.graph_extras()
    ops.append(('text', 0.62, 1.96, 12.10, 0.28, LEGEND, 10.5, GREY, False, 'l', 'm'))
    ops += lane_label_ops()
    return ops


def slide_graph(page, total, badge, plot_path):
    """Preview-only variant: the same slide with the cropped plot as a file."""
    ops = slide_graph_ops(page, total, badge)
    ops.append(('pic', PLOT['x'], PLOT['y'], PLOT['w'], PLOT['h'], plot_path,
                'Contribution graph: 57 pull requests by lane, in PR order'))
    return ops
