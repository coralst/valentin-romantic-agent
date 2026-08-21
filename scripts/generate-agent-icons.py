#!/usr/bin/env python3
"""Generate the Kiro-ghost agent persona icons.

Each agent is the same friendly ghost silhouette in its own signature colour,
carrying one prop that says what it does — the UI Designer holds a paintbrush
(מכחול), the Backend Dev a wrench, and so on.

Run:  python3 scripts/generate-agent-icons.py
Out:  docs/assets/agents/<agent>.svg  +  docs/assets/agents/team.svg
"""

import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "assets", "agents")

# The shared ghost silhouette: domed head, four scalloped tails.
GHOST_BODY = (
    "M48 8 C26 8 10 25 10 46 V80 Q10 85 15 82.5 L21 79 Q24 77.5 27 79 "
    "L33 82.5 Q36 84 39 82.5 L45 79 Q48 77.5 51 79 L57 82.5 Q60 84 63 82.5 "
    "L69 79 Q72 77.5 75 79 L81 82.5 Q86 85 86 80 V46 C86 25 70 8 48 8 Z"
)


def ghost(colour, dark, eye_y=42, blush=True):
    """The base ghost: body, soft inner shading, eyes, cheeks."""
    parts = [
        f'<path d="{GHOST_BODY}" fill="url(#g-{colour[1:]})" '
        f'stroke="{dark}" stroke-width="2.5" stroke-linejoin="round"/>',
        # soft highlight down the left cheek
        f'<ellipse cx="30" cy="38" rx="11" ry="15" fill="#fff" opacity="0.13"/>',
        # eyes
        f'<ellipse cx="37" cy="{eye_y}" rx="7" ry="8.6" fill="#FFFDFB"/>',
        f'<ellipse cx="59" cy="{eye_y}" rx="7" ry="8.6" fill="#FFFDFB"/>',
        f'<ellipse cx="37.6" cy="{eye_y + 1.6}" rx="3.7" ry="4.2" fill="{dark}"/>',
        f'<ellipse cx="59.6" cy="{eye_y + 1.6}" rx="3.7" ry="4.2" fill="{dark}"/>',
        # eye glints
        f'<circle cx="35.4" cy="{eye_y - 1.4}" r="1.5" fill="#fff"/>',
        f'<circle cx="57.4" cy="{eye_y - 1.4}" r="1.5" fill="#fff"/>',
    ]
    if blush:
        parts += [
            f'<ellipse cx="26" cy="{eye_y + 12}" rx="5" ry="3" fill="#fff" opacity="0.3"/>',
            f'<ellipse cx="70" cy="{eye_y + 12}" rx="5" ry="3" fill="#fff" opacity="0.3"/>',
        ]
    return "\n  ".join(parts)


def wrap(name, colour, dark, body, defs_extra="", title=""):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-labelledby="t-{name}">
  <title id="t-{name}">{title}</title>
  <defs>
    <linearGradient id="g-{colour[1:]}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{colour}" stop-opacity="0.95"/>
      <stop offset="1" stop-color="{dark}"/>
    </linearGradient>{defs_extra}
  </defs>
  {body}
</svg>
"""


# ── 👔 Master Agent — crown + bow tie (the one who conducts and closes) ───────
def master():
    c, d = "#7B68EE", "#4B3BA8"
    extra = """
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFE082"/><stop offset="1" stop-color="#F0A726"/>
    </linearGradient>"""
    body = ghost(c, d) + f"""
  <!-- crown -->
  <path d="M31 17 L35.5 6.5 L42 13.5 L48 3 L54 13.5 L60.5 6.5 L65 17 Z"
        fill="url(#gold)" stroke="#B87A12" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="35.5" cy="6.5" r="2.4" fill="#FFF3C4" stroke="#B87A12" stroke-width="1.2"/>
  <circle cx="48" cy="3" r="2.6" fill="#FFF3C4" stroke="#B87A12" stroke-width="1.2"/>
  <circle cx="60.5" cy="6.5" r="2.4" fill="#FFF3C4" stroke="#B87A12" stroke-width="1.2"/>
  <!-- bow tie -->
  <path d="M48 66 L38 60.5 L38 71.5 Z" fill="#2D2024"/>
  <path d="M48 66 L58 60.5 L58 71.5 Z" fill="#2D2024"/>
  <circle cx="48" cy="66" r="3.2" fill="#F0A726" stroke="#2D2024" stroke-width="1.4"/>"""
    return wrap("master", c, d, body, extra, "Master Agent — Kiro ghost wearing a crown and bow tie")


# ── 🏗️ System Architect — hard hat + set square ───────────────────────────────
def architect():
    c, d = "#FF8C00", "#B35F00"
    body = ghost(c, d, eye_y=46) + """
  <!-- hard hat -->
  <path d="M17 30 Q17 9 48 9 Q79 9 79 30 Z" fill="#FFD54F" stroke="#C79000" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M44 9.6 Q48 8.6 52 9.6 L52 30 L44 30 Z" fill="#FFC107" stroke="#C79000" stroke-width="1.6"/>
  <rect x="13" y="28.5" width="70" height="6.5" rx="3.2" fill="#FFD54F" stroke="#C79000" stroke-width="2.5"/>
  <!-- set square -->
  <path d="M57 59 L78 59 L57 80 Z" fill="none" stroke="#FFF3E0" stroke-width="3.4" stroke-linejoin="round"/>
  <path d="M61.5 63.5 L61.5 67.5 M66 63.5 L66 65.5" stroke="#FFF3E0" stroke-width="2" stroke-linecap="round"/>"""
    return wrap("architect", c, d, body, "", "System Architect — Kiro ghost in a hard hat with a set square")


# ── ⚛️ Frontend Dev — React atom orbits ───────────────────────────────────────
def frontend():
    c, d = "#1E90FF", "#0B5AA8"
    body = ghost(c, d) + """
  <!-- react atom, held low so it never crowds the eyes -->
  <g stroke="#E3F2FD" stroke-width="2.4" fill="none" opacity="0.95">
    <ellipse cx="48" cy="68" rx="16" ry="6"/>
    <ellipse cx="48" cy="68" rx="16" ry="6" transform="rotate(60 48 68)"/>
    <ellipse cx="48" cy="68" rx="16" ry="6" transform="rotate(120 48 68)"/>
  </g>
  <circle cx="48" cy="68" r="3.2" fill="#FFFDFB"/>"""
    return wrap("frontend", c, d, body, "", "Frontend Dev — Kiro ghost orbited by a React atom")


# ── 🔧 Backend Dev — wrench + server stack ────────────────────────────────────
def backend():
    c, d = "#32CD32", "#1B7F1B"
    body = ghost(c, d) + """
  <!-- server stack -->
  <g fill="#E8F5E9" stroke="#1B5E20" stroke-width="1.6">
    <rect x="16" y="58" width="20" height="6" rx="2"/>
    <rect x="16" y="66" width="20" height="6" rx="2"/>
  </g>
  <circle cx="20" cy="61" r="1.4" fill="#66BB6A"/>
  <circle cx="20" cy="69" r="1.4" fill="#66BB6A"/>
  <!-- wrench -->
  <g transform="rotate(38 66 64)">
    <path d="M62 48 a7 7 0 1 0 8 0 l0 6 -8 0 Z" fill="#F1F8E9" stroke="#1B5E20" stroke-width="2"/>
    <rect x="62.6" y="53" width="6.8" height="26" rx="3.2" fill="#F1F8E9" stroke="#1B5E20" stroke-width="2"/>
  </g>"""
    return wrap("backend", c, d, body, "", "Backend Dev — Kiro ghost holding a wrench beside a server stack")


# ── 🎨 UI Designer — paintbrush (מכחול) + palette ─────────────────────────────
def design():
    c, d = "#FF69B4", "#C2185B"
    body = ghost(c, d) + """
  <!-- palette -->
  <path d="M14 62 a13 11 0 1 1 13 11 a3.4 3.4 0 0 0 0 -6.8 a4.6 4.6 0 0 1 -4.6 -4.6 Z"
        fill="#FFF1F6" stroke="#C2185B" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="17.5" cy="58" r="2.2" fill="#FFD166"/>
  <circle cx="24" cy="54.5" r="2.2" fill="#06D6A0"/>
  <circle cx="30.5" cy="58" r="2.2" fill="#118AB2"/>
  <circle cx="20" cy="66" r="2.2" fill="#EF476F"/>
  <!-- paintbrush -->
  <g transform="rotate(34 66 60)">
    <rect x="62.4" y="42" width="7.2" height="24" rx="3.4" fill="#FFE0B2" stroke="#A1662F" stroke-width="1.8"/>
    <rect x="61.4" y="65" width="9.2" height="6" rx="1.6" fill="#CFD8DC" stroke="#607D8B" stroke-width="1.6"/>
    <path d="M62.2 71 L69.8 71 L67.6 82 Q66 85.5 64.4 82 Z" fill="#FF4081" stroke="#C2185B" stroke-width="1.8" stroke-linejoin="round"/>
  </g>
  <!-- a little dab of paint -->
  <circle cx="78" cy="86" r="3.4" fill="#FF4081" opacity="0.85"/>
  <circle cx="84" cy="80" r="1.8" fill="#FF80AB" opacity="0.85"/>"""
    return wrap("design", c, d, body, "", "UI Designer — Kiro ghost holding a paintbrush and palette")


# ── 🧪 QA Agent — magnifying glass + bug + check ──────────────────────────────
def qa():
    c, d = "#FF4500", "#B03000"
    body = ghost(c, d) + """
  <!-- the bug it caught, sitting low on the body -->
  <g fill="#4A2C10">
    <ellipse cx="60" cy="68" rx="4" ry="5"/>
    <circle cx="60" cy="63" r="2.4"/>
    <path d="M55.4 64.5 L52 61.5 M55.4 68 L51.6 68 M55.4 71.5 L52 74.5
             M64.6 64.5 L68 61.5 M64.6 68 L68.4 68 M64.6 71.5 L68 74.5"
          stroke="#4A2C10" stroke-width="1.5" stroke-linecap="round" fill="none"/>
  </g>
  <!-- magnifying glass over it -->
  <circle cx="60" cy="68" r="12.5" fill="#FFF3E0" fill-opacity="0.28" stroke="#FFF3E0" stroke-width="3.2"/>
  <path d="M69 77 L79.5 87.5" stroke="#FFF3E0" stroke-width="5.2" stroke-linecap="round"/>
  <!-- green pass tick, clear of the handle -->
  <circle cx="24" cy="72" r="8.6" fill="#4A9B6A" stroke="#FFFDFB" stroke-width="2.2"/>
  <path d="M19.8 72.2 L23 75.2 L28.2 68.8" fill="none" stroke="#fff" stroke-width="2.6"
        stroke-linecap="round" stroke-linejoin="round"/>"""
    return wrap("qa", c, d, body, "", "QA Agent — Kiro ghost with a magnifying glass inspecting a bug")


AGENTS = [
    ("master", "👔 Master Agent", master),
    ("architect", "🏗️ System Architect", architect),
    ("frontend", "⚛️ Frontend Dev", frontend),
    ("backend", "🔧 Backend Dev", backend),
    ("design", "🎨 UI Designer", design),
    ("qa", "🧪 QA Agent", qa),
]


def contact_sheet():
    """All six ghosts in a row, for the README hero."""
    cells = []
    for i, (slug, label, fn) in enumerate(AGENTS):
        svg = fn()
        inner = svg.split("</defs>", 1)[1].rsplit("</svg>", 1)[0]
        defs = svg.split("<defs>", 1)[1].split("</defs>", 1)[0]
        # namespace the gradient ids per cell so they don't collide
        for gid in ("gold",):
            defs = defs.replace(f'id="{gid}"', f'id="{gid}-{slug}"')
            inner = inner.replace(f"url(#{gid})", f"url(#{gid}-{slug})")
        cells.append(
            f'  <g transform="translate({i * 108} 0)">\n'
            f"    <defs>{defs}</defs>\n{inner}\n  </g>"
        )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 636 100" '
        'width="636" height="100" role="img" aria-label="The six Kiro-ghost agent personas">\n'
        + "\n".join(cells)
        + "\n</svg>\n"
    )


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for slug, label, fn in AGENTS:
        path = os.path.join(OUT_DIR, f"{slug}.svg")
        with open(path, "w", encoding="utf-8") as f:
            f.write(fn())
        print(f"  wrote {os.path.relpath(path)}  ({label})")
    sheet = os.path.join(OUT_DIR, "team.svg")
    with open(sheet, "w", encoding="utf-8") as f:
        f.write(contact_sheet())
    print(f"  wrote {os.path.relpath(sheet)}  (contact sheet)")


if __name__ == "__main__":
    main()
