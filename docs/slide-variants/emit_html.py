"""emit_html.py — renders aws_slides ops to an HTML preview.

Purpose is verification, not delivery: PowerPoint cannot be scripted to rasterise
slides in this environment, so this is how new slide layouts get looked at before
they are written into the pptx. Positions are in inches, so a 1600x900 viewport at
120 dpi is pixel-comparable to the real 13.333x7.5in slide.
"""
import html as _html

W, H = 13.3333, 7.5
DPI = 120  # 13.3333in * 120 = 1600px


def _runs_html(runs):
    if isinstance(runs, str):
        return _html.escape(runs)
    out = []
    for text, bold, color in runs:
        style = []
        if bold:
            style.append('font-weight:700')
        if color:
            style.append(f'color:#{color}')
        out.append(f'<span style="{";".join(style)}">{_html.escape(text)}</span>')
    return ''.join(out)


ALIGN = {'l': 'left', 'c': 'center', 'r': 'right'}
VALIGN = {'t': 'flex-start', 'm': 'center', 'b': 'flex-end'}


def op_html(op):
    kind = op[0]
    if kind in ('rect', 'oval'):
        if kind == 'rect':
            _, x, y, w, h, fill, line, radius = op
        else:
            _, x, y, w, h, fill, line = op
            radius = min(w, h) / 2
        st = [f'left:{x}in', f'top:{y}in', f'width:{w}in', f'height:{h}in']
        st.append(f'background:#{fill}' if fill else 'background:transparent')
        st.append(f'border:1.25px solid #{line}' if line else '')
        if radius:
            st.append(f'border-radius:{radius}in')
        return f'<div class="s" style="{";".join(s for s in st if s)}"></div>'
    if kind == 'text':
        _, x, y, w, h, runs, size, color, bold, align, valign = op
        st = [f'left:{x}in', f'top:{y}in', f'width:{w}in', f'height:{h}in',
              f'font-size:{size}pt', f'color:#{color}',
              f'font-weight:{"700" if bold else "400"}',
              f'text-align:{ALIGN[align]}', f'align-items:{VALIGN[valign]}']
        return (f'<div class="t" style="{";".join(st)}">'
                f'<div>{_runs_html(runs)}</div></div>')
    if kind in ('arrow', 'line'):
        _, x1, y1, x2, y2, color, wpt = op
        head = f'marker-end="url(#ah{color})"' if kind == 'arrow' else ''
        return (f'<svg class="s" style="left:0;top:0;width:{W}in;height:{H}in">'
                f'<line x1="{x1}in" y1="{y1}in" x2="{x2}in" y2="{y2}in" '
                f'stroke="#{color}" stroke-width="{wpt}pt" {head}/></svg>')
    if kind == 'arc':
        _, x, y, w, h, start, swing, color, wpt, arrow = op
        import math
        cx, cy, rx, ry = x + w / 2, y + h / 2, w / 2, h / 2
        a0, a1 = math.radians(start), math.radians(start + swing)
        p0 = (cx + rx * math.cos(a0), cy + ry * math.sin(a0))
        p1 = (cx + rx * math.cos(a1), cy + ry * math.sin(a1))
        large = 1 if abs(swing) > 180 else 0
        sweep = 1 if swing > 0 else 0
        # Path data takes no units — CSS in maps to 96 user units.
        u = 96
        return (f'<svg class="s" style="left:0;top:0;width:{W}in;height:{H}in">'
                f'<path d="M {p0[0]*u} {p0[1]*u} A {rx*u} {ry*u} 0 {large} {sweep} '
                f'{p1[0]*u} {p1[1]*u}" fill="none" stroke="#{color}" '
                f'stroke-width="{wpt}pt"'
                + (f' marker-end="url(#ah{color})"' if arrow else '') + '/></svg>')
    raise ValueError(kind)


def markers(slides):
    cols = set()
    for ops in slides:
        for op in ops:
            if op[0] == 'arrow':
                cols.add(op[5])
            elif op[0] == 'arc' and op[9]:
                cols.add(op[7])
    defs = ''.join(
        f'<marker id="ah{c}" viewBox="0 0 10 10" refX="8" refY="5" '
        f'markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">'
        f'<path d="M 0 0 L 10 5 L 0 10 z" fill="#{c}"/></marker>' for c in cols)
    return f'<svg style="position:absolute;width:0;height:0"><defs>{defs}</defs></svg>'


def emit(slides, path, labels=None):
    body = [markers(slides)]
    for i, ops in enumerate(slides):
        lab = (labels or {}).get(i, '')
        body.append(f'<section id="s{i}" data-label="{_html.escape(lab)}">'
                    + ''.join(op_html(o) for o in ops) + '</section>')
    doc = f"""<!doctype html><meta charset="utf-8">
<title>AWS template slide preview</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin:0; background:#8a8f96; font-family: Calibri,"Helvetica Neue",Arial,sans-serif; }}
  section {{ position:relative; width:{W}in; height:{H}in; overflow:hidden;
             background:#fff; margin:0 auto 18px; }}
  .s {{ position:absolute; }}
  .t {{ position:absolute; display:flex; line-height:1.22; }}
  .t > div {{ width:100%; }}
</style>
{''.join(body)}
"""
    with open(path, 'w') as f:
        f.write(doc)
    return path
