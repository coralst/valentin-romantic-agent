"""preview_v7.py — HTML preview of the six new v7 comparison slides."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import emit_html
import lens_slides as L

TOTAL = 17
PAGES = dict(cost=7, resil=9, security=11, ownership=12, debug=13)
BADGES = dict(cost=6, resil=8, security=10, ownership=11, debug=12)

slides = [L.slide_matrix(6, TOTAL, 5)] + L.all_lens_slides(TOTAL, PAGES, BADGES)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'preview-v7.html')
emit_html.emit(slides, out, labels={0: 'matrix', 1: 'cost', 2: 'resilience',
                                    3: 'security', 4: 'ownership', 5: 'debug'})
print(out)
