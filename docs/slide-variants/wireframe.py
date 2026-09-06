"""wireframe.py — draw the real bounding boxes of a deck slide, with new ops on top.

PowerPoint cannot be scripted to rasterise here, so new geometry added to an
existing slide is otherwise unverifiable. This dumps every shape on the slide as
an outlined box with its text, overlays the ops that are about to be added, and
writes an HTML page that can be screenshotted.

    python3 docs/slide-variants/wireframe.py <deck.pptx> <slide-number> <out.html>
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pptx import Presentation
import emit_html
import workflow_arrows

EMU = 914400
GHOST = 'C0392B'


def boxes(slide):
    ops = []
    for sh in slide.shapes:
        x, y = sh.left / EMU, sh.top / EMU
        w, h = sh.width / EMU, sh.height / EMU
        geom = None
        spPr = getattr(sh._element, 'spPr', None)
        if spPr is not None:
            for tag in ('prstGeom', 'custGeom'):
                if spPr.find(
                        '{http://schemas.openxmlformats.org/drawingml/2006/main}' + tag
                ) is not None:
                    geom = tag
        line = GHOST if geom is None else 'BBBBBB'
        ops.append(('rect', x, y, max(w, 0.02), max(h, 0.02), None, line, 0))
        txt = sh.text_frame.text.strip()[:34] if sh.has_text_frame else ''
        if txt:
            ops.append(('text', x + 0.03, y + 0.02, max(w - 0.06, 0.4),
                        max(h - 0.04, 0.18), txt, 8, '777777', False, 'l', 't'))
    return ops


if __name__ == '__main__':
    deck, num, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    prs = Presentation(deck)
    slide = prs.slides[num - 1]
    ops = boxes(slide) + workflow_arrows.ops()
    emit_html.emit([ops], out)
    print('wrote', out, 'shapes:', len(slide.shapes),
          'geometry-less:', sum(1 for o in ops if o[0] == 'rect' and o[6] == 0
                                and o[5] == GHOST))
