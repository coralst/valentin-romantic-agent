#!/usr/bin/env python3
"""
Build Valentin-Presentation-v9.pptx from v8.

Replaces the two cost slides (positions 7 and 8) with three redrawn ones:

  7 · Cost vs users, log-log            (the only form that carries 7 orders of magnitude)
  8 · Cost per user - the floor amortises
  9 · Cost - the bill, itemised          (hero + KPI row + table)

Everything is drawn as native PowerPoint shapes, not a screenshot, because a
raster slide's text is pixels: a later rename or font pass silently misses it.

All figures come from scripts/cost-model.mjs, recomputed here from the same
formula so ratios are exact rather than derived from rounded display values.

Engine hues are claret/olive, not the deck's orange/green: #FF9900 scores 2.14:1
against a white surface, so a 2px orange line is effectively invisible, and every
orange/green pair we tried fails CVD separation (worst adjacent dE 4-6). Claret +
olive passes all six checks (CVD dE 15.4 deutan, 25.2 normal). The AWS chrome -
ink #232F3E, accent #FF9900 on the numeral and rule - is untouched, so the deck
still reads as AWS.
"""
import copy
import math
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

SRC = '/Users/coralst/Desktop/screenshots/projects/valentin-romantic-agent/.claude/worktrees/deck-v7-lens-comparison/docs/Valentin-Presentation-v8.pptx'
OUT = '/Users/coralst/Desktop/screenshots/projects/valentin-romantic-agent/.claude/worktrees/diy-toggle-label/docs/Valentin-Presentation-v9.pptx'

# ── palette ────────────────────────────────────────────────────────────────
INK      = RGBColor(0x23, 0x2F, 0x3E)
INK2     = RGBColor(0x54, 0x5B, 0x64)
INK3     = RGBColor(0x8B, 0x94, 0x9E)
ACCENT   = RGBColor(0xFF, 0x99, 0x00)   # AWS orange - chrome only, never a data mark
CLARET   = RGBColor(0x8C, 0x2F, 0x45)   # engine A · DIY
OLIVE    = RGBColor(0x6E, 0x8B, 0x3D)   # engine B · AgentCore
GRID     = RGBColor(0xE4, 0xE7, 0xEA)
RULE     = RGBColor(0xD5, 0xDB, 0xE0)
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
BAND     = RGBColor(0xF8, 0xF0, 0xF2)   # claret at ~6% over white
TILE     = RGBColor(0xF7, 0xF8, 0xFA)
FONT     = 'Calibri'

# ── the cost model (mirrors scripts/cost-model.mjs) ────────────────────────
A_FIX, A_VAR = 18.02, 1.386
B_FIX, B_VAR = 0.0006, 0.1029
PEAK_PER_USER = 0.015167                # peak concurrent sessions per user


def tasks_at(u):
    return max(1, math.ceil(u * PEAK_PER_USER / 500))


def cost_a(u):
    return A_FIX * tasks_at(u) + A_VAR * u


def cost_b(u):
    return B_FIX + B_VAR * u


DECADES = [1, 10, 100, 1000, 10_000, 100_000, 1_000_000]
ROWS = [{'users': u, 'tasks': tasks_at(u), 'a': cost_a(u), 'b': cost_b(u)} for u in DECADES]


def money(v):
    if v >= 1e6:
        return '$%.3f M' % (v / 1e6)
    if v >= 1000:
        return '$' + format(round(v), ',d')
    if v >= 0.01:
        return '$%.2f' % v
    return '$%.4f' % v


def ax_money(v):
    """Decade ticks read as round money, not $1.000 M / $0.1."""
    if v >= 1e6:
        return '$%gM' % (v / 1e6)
    if v >= 1000:
        return '$%gk' % (v / 1000)
    if v >= 1:
        return '$%g' % v
    return '$%.2f' % v


def users_label(n):
    if n >= 1e6:
        return '%gM' % (n / 1e6)
    if n >= 1000:
        return '%gk' % (n / 1000)
    return str(n)


# ── shape helpers ──────────────────────────────────────────────────────────
def box(slide, l, t, w, h, text, size=11, bold=False, color=INK, align=PP_ALIGN.LEFT,
        anchor=MSO_ANCHOR.TOP, italic=False, font=FONT, spacing=None):
    """A textbox with no autofit, no margins - so a point is a point."""
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    p = tf.paragraphs[0]
    p.alignment = align
    r = p.add_run()
    r.text = text
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.italic = italic
    r.font.name = font
    r.font.color.rgb = color
    if spacing is not None:
        from pptx.oxml.ns import qn
        p._pPr = p._p.get_or_add_pPr()
        r.font._rPr.set('spc', str(int(spacing * 100)))
    return tb


def rich(slide, l, t, w, h, parts, size=11, anchor=MSO_ANCHOR.TOP, align=PP_ALIGN.LEFT):
    """One paragraph, several runs - for a sentence with one bold coloured number."""
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    p = tf.paragraphs[0]
    p.alignment = align
    for text, bold, color, sz in parts:
        r = p.add_run()
        r.text = text
        r.font.size = Pt(sz or size)
        r.font.bold = bold
        r.font.name = FONT
        r.font.color.rgb = color
    return tb


def rect(slide, l, t, w, h, fill, shape=MSO_SHAPE.RECTANGLE, line=None, lw=0.75):
    s = slide.shapes.add_shape(shape, Inches(l), Inches(t), Inches(w), Inches(h))
    if fill is None:
        s.fill.background()
    else:
        s.fill.solid()
        s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(lw)
    s.shadow.inherit = False
    return s


def dot(slide, cx, cy, r, fill, ring=WHITE, ring_w=1.5):
    s = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - r), Inches(cy - r),
                               Inches(r * 2), Inches(r * 2))
    s.fill.solid()
    s.fill.fore_color.rgb = fill
    if ring is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = ring
        s.line.width = Pt(ring_w)
    s.shadow.inherit = False
    return s


def line(slide, x1, y1, x2, y2, color, width=0.75, dash=None):
    from pptx.enum.shapes import MSO_CONNECTOR
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT,
                                   Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = color
    c.line.width = Pt(width)
    if dash:
        from pptx.oxml.ns import qn
        ln = c.line._get_or_add_ln()
        d = ln.makeelement(qn('a:prstDash'), {'val': dash})
        ln.append(d)
    c.shadow.inherit = False
    return c


def kicker(slide, n, title, sub, page, total):
    """The chrome every deep-dive slide wears, copied from v8's own geometry."""
    rect(slide, 0, 0, 13.333, 7.5, WHITE)
    rect(slide, 0.55, 0.40, 0.65, 0.65, INK, MSO_SHAPE.OVAL)
    tb = box(slide, 0.55, 0.40, 0.65, 0.65, str(n), 26, True, ACCENT,
             PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
    box(slide, 1.40, 0.40, 11.0, 0.65, title, 30, True, INK, anchor=MSO_ANCHOR.MIDDLE)
    rect(slide, 0.55, 1.15, 1.50, 0.04, ACCENT)
    box(slide, 0.55, 1.40, 12.20, 0.52, sub, 14, False, INK2)
    box(slide, 0.55, 7.05, 9.00, 0.35, 'VALENTIN   ·   GenAI TFC Capstone Deep-Dive',
        10, True, INK2)
    box(slide, 11.30, 7.05, 1.50, 0.35, '%d / %d' % (page, total), 10, False, INK2,
        PP_ALIGN.RIGHT)


def legend(slide, l, t, items):
    x = l
    for label, color in items:
        rect(slide, x, t + 0.055, 0.115, 0.115, color, MSO_SHAPE.ROUNDED_RECTANGLE)
        box(slide, x + 0.20, t, 2.4, 0.24, label, 11.5, False, INK2)
        x += 0.24 + 0.017 * len(label) * 6.4
    return x


# ── slide 7 · log-log ──────────────────────────────────────────────────────
def slide_loglog(slide, total):
    kicker(slide, 6, 'Cost — the floor vs. the meter',
           'Both axes are logarithmic — the bill spans seven orders of magnitude. Below ~13 '
           'users engine A\'s $18 floor is the bill; above it the lines run parallel at 13.5×.',
           7, total)
    legend(slide, 0.57, 2.02, [('Engine A · DIY', CLARET), ('Engine B · AgentCore', OLIVE)])

    L, R, T, B = 1.62, 11.05, 2.62, 6.30
    ux = lambda u: L + (math.log10(u) / 6) * (R - L)
    ylo, yhi = -1.3, 6.3
    vy = lambda d: T + (1 - (math.log10(d) - ylo) / (yhi - ylo)) * (B - T)

    # the floor-dominated zone, painted first so the grid reads over it
    rect(slide, L, T, ux(13) - L, B - T, BAND)

    for e in range(-1, 7):
        y = vy(10 ** e)
        line(slide, L, y, R, y, GRID, 0.75)
        box(slide, L - 1.05, y - 0.09, 0.95, 0.18, ax_money(10 ** e), 10.5, False, INK3,
            PP_ALIGN.RIGHT, MSO_ANCHOR.MIDDLE)
    for e in range(0, 7):
        x = ux(10 ** e)
        line(slide, x, T, x, B, GRID, 0.75)
        box(slide, x - 0.45, B + 0.10, 0.90, 0.20, users_label(10 ** e), 10.5, False, INK3,
            PP_ALIGN.CENTER)
    box(slide, L, B + 0.36, 5.0, 0.22, 'USERS  →  EACH GRIDLINE IS 10×', 9.5, True, INK3)
    box(slide, L - 1.05, T - 0.34, 1.6, 0.22, '$ / MONTH', 9.5, True, INK3)

    # Parked in the band's own empty upper area. Anything nearer the A line lands on a
    # decade gridline, which reads as a strikethrough.
    box(slide, ux(1) + 0.14, vy(3e4) - 0.11, 2.6, 0.22,
        "in here, engine A's", 10.5, False, INK2)
    box(slide, ux(1) + 0.14, vy(3e4) + 0.09, 2.6, 0.22,
        "$18 floor is most of the bill  ↓", 10.5, False, INK2)

    for key, color, name in (('a', CLARET, 'A  DIY'), ('b', OLIVE, 'B  AgentCore')):
        pts = [(ux(r['users']), vy(r[key])) for r in ROWS]
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            line(slide, x1, y1, x2, y2, color, 2.25)
        for x, y in pts:
            dot(slide, x, y, 0.058, color)
        last = ROWS[-1]
        dot(slide, R + 0.20, vy(last[key]), 0.052, color, ring=None)
        box(slide, R + 0.32, vy(last[key]) - 0.115, 1.9, 0.22, money(last[key]), 12.5, True, INK)
        box(slide, R + 0.32, vy(last[key]) + 0.10, 1.9, 0.20, name, 11, False, INK2)

    # ratio callouts at the two ends
    r0, rN = ROWS[0], ROWS[-1]
    line(slide, ux(1), vy(r0['b']), ux(1), vy(r0['a']), INK3, 1.0, 'dash')
    box(slide, ux(1) + 0.10, (vy(r0['a']) + vy(r0['b'])) / 2 - 0.11, 1.0, 0.22,
        '187.5×', 12.5, True, INK)
    line(slide, ux(1e6), vy(rN['b']), ux(1e6), vy(rN['a']), INK3, 1.0, 'dash')
    box(slide, ux(1e6) - 1.40, (vy(rN['a']) + vy(rN['b'])) / 2 - 0.11, 1.2, 0.22,
        '13.5×', 12.5, True, INK, PP_ALIGN.RIGHT)


# ── slide 8 · cost per user ────────────────────────────────────────────────
def slide_per_user(slide, total):
    kicker(slide, 7, 'Cost per user — the floor amortises',
           'The same two bills divided by the user count. Engine A falls from $19.41 toward a '
           '$1.386 asymptote as its fixed floor spreads out; engine B is flat at $0.1029 from '
           'the first user, having no floor to spread.',
           8, total)
    legend(slide, 0.57, 2.16, [('Engine A · DIY', CLARET), ('Engine B · AgentCore', OLIVE)])

    L, R, T, B = 1.62, 10.55, 2.74, 6.30
    ux = lambda u: L + (math.log10(u) / 6) * (R - L)
    ylo, yhi = math.log10(0.06), math.log10(40)
    vy = lambda d: T + (1 - (math.log10(d) - ylo) / (yhi - ylo)) * (B - T)

    for v in (0.1, 0.3, 1, 3, 10, 30):
        y = vy(v)
        line(slide, L, y, R, y, GRID, 0.75)
        lab = '$%.2f' % v if v < 1 else '$%d' % v
        box(slide, L - 1.05, y - 0.09, 0.95, 0.18, lab, 10.5, False, INK3,
            PP_ALIGN.RIGHT, MSO_ANCHOR.MIDDLE)
    for e in range(0, 7):
        x = ux(10 ** e)
        line(slide, x, T, x, B, GRID, 0.75)
        box(slide, x - 0.45, B + 0.10, 0.90, 0.20, users_label(10 ** e), 10.5, False, INK3,
            PP_ALIGN.CENTER)
    box(slide, L, B + 0.36, 4.0, 0.22, 'USERS  →', 9.5, True, INK3)
    box(slide, L - 1.05, T - 0.34, 2.2, 0.22, '$ / USER / MONTH', 9.5, True, INK3)

    # the asymptote engine A is falling toward
    line(slide, L, vy(A_VAR), R, vy(A_VAR), CLARET, 1.25, 'dash')
    box(slide, R + 0.14, vy(A_VAR) - 0.10, 2.3, 0.20,
        '$1.386 — the floor melts to this', 11, False, INK2)

    steps = 90
    prev = None
    for i in range(steps + 1):
        u = 10 ** ((i / steps) * 6)
        v = (A_FIX * tasks_at(u)) / u + A_VAR
        cur = (ux(u), vy(v))
        if prev:
            line(slide, prev[0], prev[1], cur[0], cur[1], CLARET, 2.25)
        prev = cur
    line(slide, ux(1), vy(B_VAR + B_FIX), ux(1e6), vy(B_VAR + B_FIX), OLIVE, 2.25)

    for r in ROWS:
        for key, color in (('a', CLARET), ('b', OLIVE)):
            dot(slide, ux(r['users']), vy(r[key] / r['users']), 0.058, color)

    box(slide, ux(1) + 0.16, vy(19.41) - 0.30, 2.4, 0.22, '$19.41 at one user', 12, True, INK)
    dot(slide, R + 0.06, vy(B_VAR), 0.052, OLIVE, ring=None)
    box(slide, R + 0.16, vy(B_VAR) - 0.115, 2.5, 0.22, '$0.1029 — flat from user one',
        12, True, INK)
    box(slide, R + 0.16, vy(B_VAR) + 0.11, 2.5, 0.20, 'no floor to amortise', 11, False, INK2)
    box(slide, ux(2500), vy(2.7), 3.0, 0.22, 'the gap stops closing at 13.5×', 11, False, INK2)


# ── slide 9 · the bill, itemised ───────────────────────────────────────────
def slide_bill(slide, total):
    kicker(slide, 8, 'Cost — the bill, itemised',
           'Every rate from a vendor pricing page, every quantity counted out of this repo. '
           'The reply call to Bedrock is identical on both sides and excluded from both.',
           9, total)

    box(slide, 0.55, 1.94, 4.0, 0.74, '13.5×', 44, True, CLARET, anchor=MSO_ANCHOR.MIDDLE)
    rich(slide, 0.60, 2.72, 9.5, 0.26, [
        ('cheaper at scale — and ', False, INK2, 13),
        ('187.5×', True, CLARET, 13),
        (' at one user, where only engine B has no floor', False, INK2, 13),
    ])

    tiles = [
        ('1 USER',         ROWS[0]),
        ('10,000 USERS',   ROWS[4]),
        ('1,000,000 USERS', ROWS[6]),
    ]
    tw, gap = 3.93, 0.20
    for i, (cap, r) in enumerate(tiles):
        l = 0.55 + i * (tw + gap)
        rect(slide, l, 3.02, tw, 1.22, TILE, MSO_SHAPE.ROUNDED_RECTANGLE, RULE, 0.75)
        box(slide, l + 0.20, 3.14, tw - 0.4, 0.20, cap, 10, True, INK3)
        for j, (key, color, name) in enumerate((('a', CLARET, 'DIY'), ('b', OLIVE, 'AgentCore'))):
            y = 3.38 + j * 0.29
            rect(slide, l + 0.20, y + 0.075, 0.10, 0.10, color, MSO_SHAPE.ROUNDED_RECTANGLE)
            box(slide, l + 0.38, y, 1.55, 0.25, money(r[key]), 16, True, INK,
                anchor=MSO_ANCHOR.MIDDLE)
            box(slide, l + 1.95, y, 1.6, 0.25, name, 10.5, False, INK3,
                anchor=MSO_ANCHOR.MIDDLE)
        saved = r['a'] - r['b']
        note = 'saves %s / mo · %.1f×' % (money(saved), r['a'] / r['b'])
        if r['users'] == 1_000_000:
            note = 'saves %s / mo · $%.1f M / yr' % (money(saved), saved * 12 / 1e6)
        box(slide, l + 0.20, 3.98, tw - 0.4, 0.20, note, 11, False, INK2)

    # the table, drawn as shapes so every number stays editable text
    cols = [(0.60, 4.20, PP_ALIGN.LEFT), (4.90, 1.90, PP_ALIGN.LEFT),
            (6.60, 1.70, PP_ALIGN.RIGHT), (8.50, 1.80, PP_ALIGN.RIGHT),
            (10.60, 2.15, PP_ALIGN.RIGHT)]
    heads = ['LINE ITEM', 'ENGINE', 'FIXED', 'PER USER', 'AT 1 USER']
    hy = 4.52
    for (l, w, al), h in zip(cols, heads):
        box(slide, l, hy, w, 0.20, h, 9.5, True, INK3, al)
    line(slide, 0.60, hy + 0.26, 12.75, hy + 0.26, RULE, 0.75)

    body = [
        ('AWS Fargate',                   'A · DIY',       '$18.02',  '—',        '$18.02',  CLARET),
        ('2nd Bedrock call · extraction', 'A · DIY',       '—',       '$1.386',   '$1.385',  CLARET),
        ('Amazon DynamoDB',               'A · DIY',       '—',       '$0.0006',  '$0.0006', CLARET),
        ('AgentCore Gateway',             'B · AgentCore', '$0.0006', '—',        '$0.0006', OLIVE),
        ('AgentCore Memory',              'B · AgentCore', '—',       '$0.098',   '$0.098',  OLIVE),
        ('AgentCore Runtime',             'B · AgentCore', '—',       '$0.0047',  '$0.0047', OLIVE),
    ]
    totals = [
        ('Engine A total, one user', 'A · DIY',       '$18.02',  '$1.386',  '$19.41'),
        ('Engine B total, one user', 'B · AgentCore', '$0.0006', '$0.1029', '$0.10'),
    ]

    y = hy + 0.34
    rh = 0.255
    for name, eng, fx, pu, one, color in body:
        rect(slide, 0.62, y + 0.075, 0.10, 0.10, color, MSO_SHAPE.OVAL)
        box(slide, 0.82, y, 3.98, 0.24, name, 12, False, INK2, anchor=MSO_ANCHOR.MIDDLE)
        for (l, w, al), v in zip(cols[1:], (eng, fx, pu, one)):
            box(slide, l, y, w, 0.24, v, 11.5, False, INK2, al, MSO_ANCHOR.MIDDLE)
        line(slide, 0.60, y + rh - 0.02, 12.75, y + rh - 0.02, GRID, 0.75)
        y += rh

    for name, eng, fx, pu, one in totals:
        box(slide, 0.62, y, 4.18, 0.24, name, 12, True, INK, anchor=MSO_ANCHOR.MIDDLE)
        for (l, w, al), v in zip(cols[1:], (eng, fx, pu, one)):
            box(slide, l, y, w, 0.24, v, 11.5, True, INK, al, MSO_ANCHOR.MIDDLE)
        line(slide, 0.60, y + rh - 0.02, 12.75, y + rh - 0.02, INK, 1.25)
        y += rh


# ── deck surgery ───────────────────────────────────────────────────────────
def blank_layout(prs):
    for lay in prs.slide_masters[0].slide_layouts:
        if lay.name == 'Blank':
            return lay
    return prs.slide_masters[0].slide_layouts[-1]


def drop_slide(prs, index):
    """Remove a slide by 0-based position, dropping its relationship too."""
    sldIdLst = prs.slides._sldIdLst
    ids = list(sldIdLst)
    rId = ids[index].get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
    sldIdLst.remove(ids[index])
    prs.part.drop_rel(rId)


def move_slide(prs, from_index, to_index):
    sldIdLst = prs.slides._sldIdLst
    ids = list(sldIdLst)
    el = ids[from_index]
    sldIdLst.remove(el)
    sldIdLst.insert(to_index, el)


def main():
    prs = Presentation(SRC)
    lay = blank_layout(prs)

    total = len(prs.slides) + 1            # 17 - 2 + 3 = 18

    # Add first, delete after. python-pptx names a new slide part from the current
    # slide count, so deleting first frees positions but not partnames - and the new
    # slides would collide with the surviving slide16/slide17.
    builders = [slide_loglog, slide_per_user, slide_bill]
    for build in builders:
        build(prs.slides.add_slide(lay), total)

    # out with the two cost slides (positions 7 and 8, i.e. indices 6 and 7)
    drop_slide(prs, 7)
    drop_slide(prs, 6)

    for offset in range(3):
        move_slide(prs, len(prs.slides._sldIdLst) - 3 + offset, 6 + offset)

    # renumber: the circle numeral is position-1, the footer is position/total
    for pos, slide in enumerate(prs.slides, start=1):
        for sh in slide.shapes:
            if not sh.has_text_frame:
                continue
            t = sh.text_frame.text.strip()
            if '/ 1' in t and len(t) <= 8 and t.split('/')[0].strip().isdigit():
                sh.text_frame.paragraphs[0].runs[0].text = '%d / %d' % (pos, total)
            elif (t.isdigit() and abs(Emu(sh.left).inches - 0.55) < 0.02
                  and abs(Emu(sh.top).inches - 0.40) < 0.02):
                sh.text_frame.paragraphs[0].runs[0].text = str(pos - 1)

    prs.save(OUT)
    print('wrote', OUT, '·', len(prs.slides), 'slides')


if __name__ == '__main__':
    main()
