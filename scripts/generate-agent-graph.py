#!/usr/bin/env python3
"""Render the agent contribution graph from this repository's real PR history.

Every mark on the graph is derived from GitHub data — no illustrative filler.
One lane per agent persona, one node per pull request, sized by the number of
files it touched, connected up to the ``main`` spine at the point it merged.

The x-axis is **PR sequence**, not wall-clock time: PRs are spaced evenly in
number order, and the real first/last dates are anchored at the two ends. This
is deliberate and it is not a time axis — do not label it as one. Spacing by
date instead would collapse the whole repo into a few vertical stacks, because
the work landed in bursts.

Usage:
    python3 scripts/generate-agent-graph.py            # render from the snapshot
    python3 scripts/generate-agent-graph.py --refresh   # re-query GitHub first
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "assets" / "graph"
SNAPSHOT = OUT_DIR / "pr-history.json"
REPO = "coralst/valentin-romantic-agent"

# ── the cast ────────────────────────────────────────────────────────────────
# Colours match docs/assets/agents/*.svg so a lane reads as the same character.
AGENTS = [
    ("master",    "Master Agent",    "#7B68EE", "orchestrator"),
    ("architect", "System Architect", "#FF8C00", "src/shared/"),
    ("frontend",  "Frontend Dev",    "#1E90FF", "src/client/"),
    ("backend",   "Backend Dev",     "#32CD32", "src/server/"),
    ("design",    "UI Designer",     "#FF69B4", "design-system/"),
    ("qa",        "QA Agent",        "#FF4500", "e2e/"),
    ("infra",     "Infra / Workflow", "#7C7378", ".kiro/ · .github/"),
]
AGENT_INDEX = {key: i for i, (key, *_) in enumerate(AGENTS)}

GHOST_BODY = (
    "M48 8 C26 8 10 25 10 46 V80 Q10 85 15 82.5 L21 79 Q24 77.5 27 79 "
    "L33 82.5 Q36 84 39 82.5 L45 79 Q48 77.5 51 79 L57 82.5 Q60 84 63 82.5 "
    "L69 79 Q72 77.5 75 79 L81 82.5 Q86 85 86 80 V46 C86 25 70 8 48 8 Z"
)

# ── canvas ──────────────────────────────────────────────────────────────────
# Deck palette (deck-v2.html / explore.html / graph.html all share it).
BG, FG, MUTED, SPINE = "#EFE7E1", "#2A2226", "#756A70", "#2A2226"
GOLD = "#A8762B"
GUTTER, SLOT = 250, 41
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


# ── persona attribution ─────────────────────────────────────────────────────
# Every comment comes from the same GitHub account, so the persona signature in
# the body is the only author signal. That signature drifted through four
# formats over the life of the repo, and the three matchers in .kiro/skills/
# each cover a different subset — which is how 19 of 96 comments ended up
# unattributed. Names are checked before emoji: PR 19 has a comment headed
# "**🔧 System Architect**", where the name is right and the emoji is wrong.
PERSONA_NAMES = {
    "master":    ("Master Agent", "Master Approval", "Master (", "Master —", "Master Review"),
    "architect": ("System Architect", "Architecture Lead", "Architect"),
    "frontend":  ("Frontend Dev", "Frontend Developer"),
    "backend":   ("Backend Dev", "Backend Developer"),
    "design":    ("UI Designer", "Designer"),
    "qa":        ("QA Agent", "QA Engineer", "QA "),
}
PERSONA_EMOJI = {
    "master": "👔", "architect": "🏗", "frontend": "⚛",
    "backend": "🔧", "design": "🎨", "qa": "🧪",
}
APPROVAL_TOKEN = "APPROVED-BY-MASTER-AGENT"


def persona_of_comment(body: str) -> str | None:
    """Attribute one comment to a persona, covering all four header formats."""
    if not body:
        return None
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    if not lines:
        return None
    # The header is the first non-empty line; fall back to the opening block
    # only when that line carries no signature.
    for scope in (lines[0], "\n".join(lines[:4])):
        for key, names in PERSONA_NAMES.items():
            if any(n in scope for n in names):
                return key
        for key, emoji in PERSONA_EMOJI.items():
            if emoji in scope:
                return key
    # Era D: a bare approval token with no persona header at all. Only the
    # master ever posts this, and its presence is why PRs 63-66 merged past a
    # gate that would have rejected them.
    if APPROVAL_TOKEN in body:
        return "master"
    return None


# "Interesting" PRs, badged with a star. Curated first — these are the ones with
# a story worth telling out loud — then anything that drew three or more
# distinct personas into one thread.
CURATED_HIGHLIGHTS = {
    16: "Master refused it: too large, demanded a split",
    13: "Closed as obsolete rather than merged",
    39: "One comment invoked two agents at once",
    40: "The longest thread in the repo — six rounds",
    43: "The longest single review comment",
    58: "Frontend pushed back on the review — and won",
}


def fetch_threads() -> dict[str, list[dict]]:
    """Map PR number -> the full review conversation, attributed and ordered."""
    raw = subprocess.check_output(
        ["gh", "api", "--paginate",
         f"repos/{REPO}/issues/comments?per_page=100",
         "--jq", '.[] | {n:(.issue_url|split("/")|last), at:.created_at, b:.body}'],
        cwd=ROOT, text=True)
    out: dict[str, list[dict]] = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        out.setdefault(rec["n"], []).append({
            "by": persona_of_comment(rec["b"]),
            "at": rec["at"],
            "body": rec["b"] or "",
        })
    for thread in out.values():
        thread.sort(key=lambda c: c["at"])
    return out


def fetch() -> list[dict]:
    fields = ("number,title,headRefName,state,createdAt,mergedAt,additions,"
              "deletions,changedFiles,labels,comments")
    jq = ('[.[]|{n:.number,t:.title,ref:.headRefName,st:.state,c:.createdAt,'
          'm:.mergedAt,add:.additions,del:.deletions,cf:.changedFiles,'
          'labels:[.labels[].name],nc:(.comments|length)}]')
    raw = subprocess.check_output(
        ["gh", "pr", "list", "--state", "all", "--limit", "300",
         "--json", fields, "--jq", jq], cwd=ROOT, text=True)
    data = sorted(json.loads(raw), key=lambda p: p["n"])
    threads = fetch_threads()
    unattributed = 0
    for pr in data:
        thread = threads.get(str(pr["n"]), [])
        pr["thread"] = thread
        counts: Counter = Counter()
        for c in thread:
            if c["by"]:
                counts[c["by"]] += 1
            else:
                unattributed += 1
        pr["by"] = dict(counts)
        star = CURATED_HIGHLIGHTS.get(pr["n"])
        if not star and len(counts) >= 3:
            star = f"{len(counts)} personas in one thread"
        if star:
            pr["star"] = star
    total = sum(len(p["thread"]) for p in data)
    print(f"  attributed {total - unattributed}/{total} comments"
          f" ({unattributed} unmatched)")
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


def star_path(x: float, y: float, s: float = 5.4) -> str:
    """A five-pointed star, centred, for the highlight badge."""
    import math
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        r = s if i % 2 == 0 else s * 0.44
        pts.append(f"{round(x + r * math.cos(a), 2)} {round(y + r * math.sin(a), 2)}")
    return "M" + " L".join(pts) + " Z"


def radius(changed_files: int) -> float:
    return round(6.0 + min(9.5, (max(changed_files, 1) ** 0.5) * 1.75), 2)


def build(prs: list[dict], commits: int, merges: int) -> str:
    for pr in prs:
        pr["agent"] = agent_of(pr)

    # x-axis: PR sequence, evenly spaced. Not time — see the module docstring.
    x_of = {pr["n"]: GUTTER + i * SLOT + SLOT / 2 for i, pr in enumerate(prs)}
    width = GUTTER + len(prs) * SLOT + PAD_RIGHT
    lane_y = {k: LANE_TOP + i * LANE_H for k, i in AGENT_INDEX.items()}
    height = LANE_TOP + (len(AGENTS) - 1) * LANE_H + 118

    first_day = min(p["c"] for p in prs)[:10]
    last_day = max(p["c"] for p in prs)[:10]

    per_agent = Counter(p["agent"] for p in prs)
    adds: Counter = Counter()
    for p in prs:
        adds[p["agent"]] += p["add"]
    merged = [p for p in prs if p["st"] == "MERGED"]

    # Review participation: a persona that commented on a PR it did not author.
    reviewed: Counter = Counter()
    for p in prs:
        for key in (p.get("by") or {}):
            if key != p["agent"]:
                reviewed[key] += 1

    o: list[str] = []
    o.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
             f'height="{height}" viewBox="0 0 {width} {height}" '
             f'font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" '
             f'role="img" aria-labelledby="gtitle gdesc">')
    o.append('<title id="gtitle">Agent contribution graph</title>')
    o.append(f'<desc id="gdesc">{len(prs)} pull requests across {len(AGENTS)} agent '
             f'lanes, in PR-number order between {first_day} and {last_day}. Each node is '
             f'one pull request, sized by files changed, connected to the main branch '
             f'where it merged.</desc>')
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
    o.append(f'<path d="M{lx + 1} {ly - 7} L{lx + 6.2} {ly - 1.2} L{lx + 11.4} {ly - 7}" '
             f'fill="none" stroke="{MUTED}" stroke-width="2.1" stroke-linecap="round" '
             f'stroke-linejoin="round"/>')
    o.append(f'<text x="{lx + 20}" y="{ly}" fill="{MUTED}" font-size="11">'
             f'reviewed this PR without authoring it</text>')
    lx += 252
    o.append(f'<path d="{star_path(lx + 6, ly - 4)}" fill="{GOLD}"/>')
    o.append(f'<text x="{lx + 18}" y="{ly}" fill="{MUTED}" font-size="11">'
             f'worth reading — click for the thread</text>')

    # ── the sequence axis ───────────────────────────────────────────────
    # Real dates at the ends only. The spacing is ordinal, so the axis is
    # labelled as PR order rather than as a timeline.
    axis_y = SPINE_Y - 42
    o.append(f'<line x1="{GUTTER}" y1="{axis_y}" x2="{width - 24}" y2="{axis_y}" '
             f'stroke="#30363d" stroke-width="1"/>')
    for x_pos, anchor, label in (
        (GUTTER, "start", first_day),
        (width - 24, "end", last_day),
    ):
        o.append(f'<line x1="{x_pos}" y1="{axis_y - 5}" x2="{x_pos}" y2="{axis_y + 5}" '
                 f'stroke="{MUTED}" stroke-width="1.4"/>')
        o.append(f'<text x="{x_pos}" y="{axis_y - 11}" fill="{MUTED}" font-size="11" '
                 f'text-anchor="{anchor}">{label}</text>')
    o.append(f'<text x="{(GUTTER + width - 24) / 2}" y="{axis_y - 11}" fill="{MUTED}" '
             f'font-size="10.5" text-anchor="middle" opacity="0.75">'
             f'pull requests in the order they were opened</text>')

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
                 f'{per_agent.get(key, 0)} authored · {reviewed.get(key, 0)} reviewed'
                 f'{f" · +{adds[key]:,}" if adds.get(key) else ""}</text>')

    # ── per-agent thread: connect that agent's own PRs in order ──────────
    for key, _, colour, _ in AGENTS:
        xs = sorted(x_of[p["n"]] for p in prs if p["agent"] == key)
        if len(xs) > 1:
            y = lane_y[key]
            o.append(f'<path d="M{xs[0]} {y} L{xs[-1]} {y}" stroke="{colour}" '
                     f'stroke-width="1.6" opacity="0.28" stroke-dasharray="1 5" '
                     f'stroke-linecap="round"/>')

    # ── review participation ────────────────────────────────────────────
    # A chevron in an agent's lane means that agent reviewed this PR without
    # authoring it. This is what makes the orchestrator visible: the Master
    # Agent authors almost nothing but shows up on nearly every column.
    colour_of = {k: c for k, _, c, _ in AGENTS}
    for pr in prs:
        x = x_of[pr["n"]]
        for key, n in sorted((pr.get("by") or {}).items()):
            if key == pr["agent"] or key not in lane_y:
                continue
            y = lane_y[key]
            colour = colour_of[key]
            o.append(f'<g><title>#{pr["n"]} — reviewed by {key} '
                     f'({n} comment{"s" if n != 1 else ""})</title>')
            o.append(f'<path d="M{x - 5.2} {y - 4.4} L{x} {y + 1.4} L{x + 5.2} {y - 4.4}" '
                     f'fill="none" stroke="{colour}" stroke-width="2.1" '
                     f'stroke-linecap="round" stroke-linejoin="round" opacity="0.88"/>')
            # A hair line up toward main: the turn was handed back here.
            o.append(f'<line x1="{x}" y1="{y - 8}" x2="{x}" y2="{y - 15}" '
                     f'stroke="{colour}" stroke-width="1.1" opacity="0.30"/>')
            o.append('</g>')

    # ── the PRs ─────────────────────────────────────────────────────────
    for pr in prs:
        key = pr["agent"]
        colour = colour_of[key]
        x, y = x_of[pr["n"]], lane_y[key]
        r = radius(pr["cf"])
        merged_pr = pr["st"] == "MERGED"
        tip = (f'#{pr["n"]} {esc(pr["t"])} — {key}, {pr["cf"]} files, '
               f'+{pr["add"]}/-{pr["del"]}, {pr["nc"]} review comments'
               f'{"" if merged_pr else " (closed unmerged)"}')
        if pr.get("star"):
            tip += f' ★ {esc(pr["star"])}'
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
        label_fill = "#2A2226" if merged_pr else colour
        o.append(f'<text x="{x}" y="{y + 3.3}" fill="{label_fill}" font-size="8.6" '
                 f'font-weight="700" text-anchor="middle" '
                 f'font-family="ui-monospace,SFMono-Regular,Menlo,monospace">'
                 f'{pr["n"]}</text>')
        if pr.get("star"):
            sy = y - r - (11 if pr["nc"] >= 3 else 7)
            o.append(f'<path d="{star_path(x, sy)}" fill="{GOLD}" '
                     f'stroke="{BG}" stroke-width="0.8"/>')
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
        ("peak PRs open at once", f"{peak_concurrency(prs)}"),
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


def peak_concurrency(prs: list[dict]) -> int:
    """Most PRs open simultaneously — the parallelism claim, as one number.

    The session bands used to carry this visually; the sequence axis can't, so
    it survives as a statistic instead of being quietly dropped.
    """
    events = []
    for p in prs:
        end = p.get("m") or p.get("closed") or p["c"]
        events.append((p["c"], 1))
        events.append((end, -1))
    events.sort()
    cur = peak = 0
    for _, delta in events:
        cur += delta
        peak = max(peak, cur)
    return peak


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
    starred = sum(1 for p in prs if p.get("star"))
    print(f"wrote {target.relative_to(ROOT)}  ({len(svg) // 1024} KB, "
          f"{len(prs)} PRs, {starred} starred)")


if __name__ == "__main__":
    main()
