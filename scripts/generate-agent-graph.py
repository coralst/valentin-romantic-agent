#!/usr/bin/env python3
"""Render the agent contribution graph from this repository's real PR history.

Every mark on the graph is derived from GitHub data — no illustrative filler.
One lane per agent persona, one node per pull request, sized by the number of
files it touched, connected up to the ``main`` spine at the point it merged.

The x-axis is *PR sequence grouped by working session*, not wall-clock time.
All 56 PRs landed across four sessions, so a linear time axis collapses into
four vertical stacks and hides the fan-out entirely. Sessions are labelled with
their real dates.

Usage:
    python3 scripts/generate-agent-graph.py            # render from the snapshot
    python3 scripts/generate-agent-graph.py --refresh   # re-query GitHub first
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
from collections import Counter, defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "assets" / "graph"
SNAPSHOT = OUT_DIR / "pr-history.json"

# ── the cast ────────────────────────────────────────────────────────────────
# Colours match docs/assets/agents/*.svg so a lane reads as the same character.
AGENTS = [
    ("master",    "Master Agent",    "#7B68EE", "orchestrator"),
    ("architect", "System Architect", "#FF8C00", "src/shared/"),
    ("frontend",  "Frontend Dev",    "#1E90FF", "src/client/"),
    ("backend",   "Backend Dev",     "#32CD32", "src/server/"),
    ("design",    "UI Designer",     "#FF69B4", "design-system/"),
    ("qa",        "QA Agent",        "#FF4500", "e2e/"),
    ("infra",     "Infra / Workflow", "#8B949E", ".kiro/ · .github/"),
]
AGENT_INDEX = {key: i for i, (key, *_) in enumerate(AGENTS)}

GHOST_BODY = (
    "M48 8 C26 8 10 25 10 46 V80 Q10 85 15 82.5 L21 79 Q24 77.5 27 79 "
    "L33 82.5 Q36 84 39 82.5 L45 79 Q48 77.5 51 79 L57 82.5 Q60 84 63 82.5 "
    "L69 79 Q72 77.5 75 79 L81 82.5 Q86 85 86 80 V46 C86 25 70 8 48 8 Z"
)

# ── canvas ──────────────────────────────────────────────────────────────────
BG, FG, MUTED, SPINE = "#0d1117", "#e6edf3", "#8b949e", "#f0f6fc"
GUTTER, SLOT, SESSION_GAP = 250, 41, 38
SPINE_Y, LANE_TOP, LANE_H = 150, 224, 70
PAD_RIGHT = 40


def agent_of(pr: dict) -> str:
    """Resolve a PR to an agent: the `agent: *` label first, branch prefix after."""
    for label in pr["labels"]:
        if label.startswith("agent: "):
            key = label[len("agent: "):].strip()
            if key in AGENT_INDEX:
                return key
    ref = pr["ref"]
    tail = ref.split("/", 1)[1] if "/" in ref else ref
    stem = tail.split("-")[0].split("/")[0]
    return {
        "arch": "architect", "shared": "architect",
        "front": "frontend", "frontend": "frontend",
        "backend": "backend", "back": "backend",
        "design": "design", "qa": "qa", "master": "master",
    }.get(stem, "infra")


def fetch() -> list[dict]:
    fields = "number,title,headRefName,state,createdAt,mergedAt,additions,deletions,changedFiles,labels,comments"
    jq = ('[.[]|{n:.number,t:.title,ref:.headRefName,st:.state,c:.createdAt,'
          'm:.mergedAt,add:.additions,del:.deletions,cf:.changedFiles,'
          'labels:[.labels[].name],nc:(.comments|length)}]')
    raw = subprocess.check_output(
        ["gh", "pr", "list", "--state", "all", "--limit", "300",
         "--json", fields, "--jq", jq], cwd=ROOT, text=True)
    data = sorted(json.loads(raw), key=lambda p: p["n"])
    commits = subprocess.check_output(
        ["git", "rev-list", "--count", "origin/main"], cwd=ROOT, text=True).strip()
    merges = subprocess.check_output(
        ["git", "rev-list", "--count", "--merges", "origin/main"], cwd=ROOT, text=True).strip()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    SNAPSHOT.write_text(json.dumps(
        {"commits": int(commits), "merges": int(merges), "prs": data}, indent=1) + "\n")
    return data


def esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def mini_ghost(x: float, y: float, colour: str, scale: float = 0.30) -> str:
    """The persona ghost, small, for the lane gutter."""
    return f'''<g transform="translate({x},{y}) scale({scale})">
    <path d="{GHOST_BODY}" fill="{colour}" opacity="0.95"/>
    <ellipse cx="37" cy="44" rx="8.5" ry="10" fill="#fff"/>
    <ellipse cx="59" cy="44" rx="8.5" ry="10" fill="#fff"/>
    <circle cx="38.5" cy="46" r="4.4" fill="#1b1b2b"/>
    <circle cx="60.5" cy="46" r="4.4" fill="#1b1b2b"/>
    <circle cx="40.5" cy="44" r="1.5" fill="#fff"/>
    <circle cx="62.5" cy="44" r="1.5" fill="#fff"/>
    <ellipse cx="24" cy="57" rx="5" ry="3.2" fill="#fff" opacity="0.30"/>
    <ellipse cx="72" cy="57" rx="5" ry="3.2" fill="#fff" opacity="0.30"/>
  </g>'''


def radius(changed_files: int) -> float:
    return round(6.0 + min(9.5, (max(changed_files, 1) ** 0.5) * 1.75), 2)


def build(prs: list[dict], commits: int, merges: int) -> str:
    for pr in prs:
        pr["agent"] = agent_of(pr)

    # Group into working sessions by the day the PR was opened.
    sessions: dict[str, list[dict]] = defaultdict(list)
    for pr in prs:
        sessions[pr["c"][:10]].append(pr)
    days = sorted(sessions)

    # Assign an x slot to every PR; sessions are separated by a visible gap.
    x_of: dict[int, float] = {}
    bands: list[tuple[str, float, float, int]] = []
    cursor = GUTTER
    for day in days:
        group = sorted(sessions[day], key=lambda p: p["n"])
        start = cursor
        for pr in group:
            x_of[pr["n"]] = cursor + SLOT / 2
            cursor += SLOT
        bands.append((day, start, cursor, len(group)))
        cursor += SESSION_GAP
    width = cursor - SESSION_GAP + PAD_RIGHT
    lane_y = {k: LANE_TOP + i * LANE_H for k, i in AGENT_INDEX.items()}
    height = LANE_TOP + (len(AGENTS) - 1) * LANE_H + 118

    per_agent = Counter(p["agent"] for p in prs)
    adds = Counter()
    for p in prs:
        adds[p["agent"]] += p["add"]
    merged = [p for p in prs if p["st"] == "MERGED"]

    o: list[str] = []
    o.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
             f'height="{height}" viewBox="0 0 {width} {height}" '
             f'font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" '
             f'role="img" aria-labelledby="gtitle gdesc">')
    o.append('<title id="gtitle">Agent contribution graph</title>')
    o.append(f'<desc id="gdesc">{len(prs)} pull requests across {len(AGENTS)} agent '
             f'personas and {len(days)} working sessions. Each node is one pull request, '
             f'sized by files changed, connected to the main branch where it merged.</desc>')
    o.append('<defs>')
    for key, _, colour, _ in AGENTS:
        o.append(f'<linearGradient id="lane-{key}" x1="0" y1="0" x2="1" y2="0">'
                 f'<stop offset="0" stop-color="{colour}" stop-opacity="0.20"/>'
                 f'<stop offset="1" stop-color="{colour}" stop-opacity="0.03"/></linearGradient>')
    o.append('<filter id="glow" x="-60%" y="-60%" width="220%" height="220%">'
             '<feGaussianBlur stdDeviation="3.2" result="b"/>'
             '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>')
    o.append('</defs>')
    o.append(f'<rect width="{width}" height="{height}" fill="{BG}"/>')

    # ── heading ─────────────────────────────────────────────────────────
    o.append(f'<text x="34" y="46" fill="{FG}" font-size="25" font-weight="700">'
             f'Who built Valentin</text>')
    o.append(f'<text x="34" y="72" fill="{MUTED}" font-size="13.5">'
             f'{len(prs)} pull requests · {len(merged)} merged · {commits} commits · '
             f'{merges} merge commits · six agent personas, disjoint ownership</text>')
    # ── legend ──────────────────────────────────────────────────────────
    lx, ly = 34, 92
    o.append(f'<circle cx="{lx + 7}" cy="{ly - 4}" r="7" fill="{MUTED}"/>')
    o.append(f'<text x="{lx + 20}" y="{ly}" fill="{MUTED}" font-size="11">'
             f'one PR · size = files changed</text>')
    lx += 196
    o.append(f'<circle cx="{lx + 7}" cy="{ly - 4}" r="6" fill="{MUTED}"/>')
    o.append(f'<circle cx="{lx + 7}" cy="{ly - 4}" r="10.5" fill="none" '
             f'stroke="{MUTED}" stroke-width="1.4"/>')
    o.append(f'<text x="{lx + 24}" y="{ly}" fill="{MUTED}" font-size="11">'
             f'drew a multi-agent review thread (3+ comments)</text>')
    lx += 306
    o.append(f'<circle cx="{lx + 7}" cy="{ly - 4}" r="6.5" fill="{BG}" stroke="{MUTED}" '
             f'stroke-width="2.2" stroke-dasharray="3 2.4"/>')
    o.append(f'<text x="{lx + 20}" y="{ly}" fill="{MUTED}" font-size="11">'
             f'reviewed, then closed without merging</text>')
    lx += 258
    o.append(f'<line x1="{lx}" y1="{ly - 11}" x2="{lx}" y2="{ly + 3}" stroke="{MUTED}" '
             f'stroke-width="2"/>')
    o.append(f'<text x="{lx + 13}" y="{ly}" fill="{MUTED}" font-size="11">'
             f'merged into main</text>')

    # ── session bands ───────────────────────────────────────────────────
    for i, (day, start, end, count) in enumerate(bands):
        o.append(f'<rect x="{start - 6}" y="108" width="{end - start + 12}" '
                 f'height="{height - 176}" fill="#ffffff" opacity="0.022" rx="9"/>')
        mid = (start + end) / 2
        o.append(f'<text x="{mid}" y="124" fill="{FG}" font-size="12" font-weight="650" '
                 f'text-anchor="middle">Session {i + 1} · {day}</text>')
        o.append(f'<text x="{mid}" y="138" fill="{MUTED}" font-size="10.5" '
                 f'text-anchor="middle">{count} PRs opened</text>')

    # ── main spine ──────────────────────────────────────────────────────
    o.append(f'<line x1="{GUTTER - 30}" y1="{SPINE_Y}" x2="{width - 20}" y2="{SPINE_Y}" '
             f'stroke="{SPINE}" stroke-width="3.4" stroke-linecap="round"/>')
    o.append(f'<text x="{GUTTER - 40}" y="{SPINE_Y + 4.5}" fill="{SPINE}" font-size="13" '
             f'font-weight="700" text-anchor="end">main</text>')

    # ── lanes ───────────────────────────────────────────────────────────
    for key, name, colour, owns in AGENTS:
        y = lane_y[key]
        o.append(f'<rect x="{GUTTER - 24}" y="{y - 26}" width="{width - GUTTER - 4}" '
                 f'height="52" fill="url(#lane-{key})" rx="8"/>')
        o.append(mini_ghost(24, y - 17, colour, 0.33))
        o.append(f'<text x="62" y="{y - 9}" fill="{FG}" font-size="13" font-weight="650">'
                 f'{esc(name)}</text>')
        o.append(f'<text x="62" y="{y + 5}" fill="{colour}" font-size="9.5" opacity="0.9" '
                 f'font-family="ui-monospace,SFMono-Regular,Menlo,monospace">'
                 f'{esc(owns)}</text>')
        o.append(f'<text x="62" y="{y + 19}" fill="{MUTED}" font-size="10.5">'
                 f'{per_agent.get(key, 0)} PRs · +{adds.get(key, 0):,} lines</text>')

    # ── per-agent thread: connect that agent's own PRs in order ──────────
    for key, _, colour, _ in AGENTS:
        xs = sorted(x_of[p["n"]] for p in prs if p["agent"] == key)
        if len(xs) > 1:
            y = lane_y[key]
            o.append(f'<path d="M{xs[0]} {y} L{xs[-1]} {y}" stroke="{colour}" '
                     f'stroke-width="1.6" opacity="0.28" stroke-dasharray="1 5" '
                     f'stroke-linecap="round"/>')

    # ── the PRs ─────────────────────────────────────────────────────────
    for pr in prs:
        key = pr["agent"]
        colour = dict((k, c) for k, _, c, _ in AGENTS)[key]
        x, y = x_of[pr["n"]], lane_y[key]
        r = radius(pr["cf"])
        merged_pr = pr["st"] == "MERGED"
        tip = (f'#{pr["n"]} {esc(pr["t"])} — {key}, {pr["cf"]} files, '
               f'+{pr["add"]}/-{pr["del"]}, {pr["nc"]} review comments'
               f'{"" if merged_pr else " (closed unmerged)"}')
        o.append(f'<g><title>{tip}</title>')
        if merged_pr:
            # Curve up to the spine: leave the lane, arc, land on main.
            ctrl = y - (y - SPINE_Y) * 0.55
            o.append(f'<path d="M{x} {y - r} C{x} {ctrl} {x} {ctrl} {x} {SPINE_Y}" '
                     f'stroke="{colour}" stroke-width="2" fill="none" opacity="0.62"/>')
            o.append(f'<circle cx="{x}" cy="{SPINE_Y}" r="4.2" fill="{colour}" '
                     f'stroke="{BG}" stroke-width="1.6"/>')
            o.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{colour}" '
                     f'stroke="{BG}" stroke-width="2" filter="url(#glow)"/>')
        else:
            stop = y - (y - SPINE_Y) * 0.34
            o.append(f'<path d="M{x} {y - r} L{x} {stop}" stroke="{colour}" '
                     f'stroke-width="1.8" fill="none" opacity="0.40" stroke-dasharray="3 3"/>')
            o.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{BG}" '
                     f'stroke="{colour}" stroke-width="2.4" stroke-dasharray="3 2.4"/>')
        # Concentric rings mark a PR that drew a real back-and-forth review
        # conversation — the multi-agent dialogue, made visible.
        if pr["nc"] >= 3:
            o.append(f'<circle cx="{x}" cy="{y}" r="{r + 4.5}" fill="none" '
                     f'stroke="{colour}" stroke-width="1.5" opacity="0.85"/>')
            o.append(f'<circle cx="{x}" cy="{y}" r="{r + 8}" fill="none" '
                     f'stroke="{colour}" stroke-width="1" opacity="0.32"/>')
        label_fill = "#0d1117" if merged_pr else colour
        o.append(f'<text x="{x}" y="{y + 3.3}" fill="{label_fill}" font-size="8.6" '
                 f'font-weight="700" text-anchor="middle" '
                 f'font-family="ui-monospace,SFMono-Regular,Menlo,monospace">'
                 f'{pr["n"]}</text>')
        o.append('</g>')

    # ── footer ──────────────────────────────────────────────────────────
    fy = height - 40
    total_add = sum(p["add"] for p in prs)
    total_del = sum(p["del"] for p in prs)
    total_nc = sum(p["nc"] for p in prs)
    o.append(f'<line x1="30" y1="{fy - 26}" x2="{width - 30}" y2="{fy - 26}" '
             f'stroke="#30363d" stroke-width="1"/>')
    stats = [
        ("pull requests", f"{len(prs)}"),
        ("merged", f"{len(merged)}"),
        ("review comments", f"{total_nc}"),
        ("lines added", f"+{total_add:,}"),
        ("lines removed", f"−{total_del:,}"),
        ("files touched", f"{sum(p['cf'] for p in prs)}"),
        ("working sessions", f"{len(days)}"),
    ]
    x = 34
    for label, value in stats:
        o.append(f'<text x="{x}" y="{fy}" fill="{FG}" font-size="17" '
                 f'font-weight="700">{value}</text>')
        o.append(f'<text x="{x}" y="{fy + 15}" fill="{MUTED}" font-size="10">{label}</text>')
        x += max(len(label) * 6.4, len(value) * 11) + 34
    o.append(f'<text x="{width - 32}" y="{fy + 8}" fill="{MUTED}" font-size="10" '
             f'text-anchor="end" opacity="0.7">generated by '
             f'scripts/generate-agent-graph.py from the live PR history</text>')
    o.append('</svg>')
    return "\n".join(o)


def main() -> None:
    if "--refresh" in sys.argv or not SNAPSHOT.exists():
        print("querying GitHub…")
        fetch()
    snap = json.loads(SNAPSHOT.read_text())
    prs = sorted(snap["prs"], key=lambda p: p["n"])
    svg = build(prs, snap["commits"], snap["merges"])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    target = OUT_DIR / "agent-contribution-graph.svg"
    target.write_text(svg + "\n")
    print(f"wrote {target.relative_to(ROOT)}  ({len(svg) // 1024} KB, {len(prs)} PRs)")


if __name__ == "__main__":
    main()
