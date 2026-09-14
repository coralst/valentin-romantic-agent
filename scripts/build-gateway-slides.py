#!/usr/bin/env python3
"""Build the two Gateway slides: the tools themselves, and what the Gateway costs.

Standalone deck, in the visual language of slide 6 of the main deck and of
scripts/build-memory-slides.py (numbered badge, orange title rule, tinted
panels with a coloured left edge, an orange band for the one thing to remember,
a navy band for the caveats). The helpers are duplicated from that script
rather than shared, which is the convention the other build-*-slides.py files
already follow.

Slide 1 answers "what are the tools" and then the only two things that differ
between the engines: how the agent DISCOVERS them, and how the call TRAVELS.
Slide 2 prices the Gateway.

Every in-tree figure is re-read from source at build time, so a rate change or
a renamed constant fails the build instead of stranding a wrong number on a
slide. The figures that come from the 120-turn run live on a different branch
and are tagged MEASURED-OFF-TREE below; they cannot be asserted here, and the
slide notes say where they came from.

Usage: python3 scripts/build-gateway-slides.py
"""
import json
import re
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

DST = Path("docs/Valentin-Gateway-Slides.pptx")

FONT = "Calibri"
MONO = "Consolas"
NAVY = RGBColor(0x23, 0x2F, 0x3E)
ORANGE = RGBColor(0xFF, 0x99, 0x00)
BAND = RGBColor(0xF0, 0xA3, 0x2C)
GREEN = RGBColor(0x1E, 0x7C, 0x3C)
BODY = RGBColor(0x16, 0x19, 0x1F)
GREY = RGBColor(0x54, 0x5B, 0x64)
CODEBLUE = RGBColor(0x1F, 0x77, 0xA8)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
TINT = RGBColor(0xF7, 0xF8, 0xFA)
LINE = RGBColor(0xE4, 0xE7, 0xEA)

# Raw AgentCore Gateway prices, us-east-1 — must match scripts/cost-one-user.mjs.
AC_GATEWAY_INVOKE = 0.005 / 1000
AC_TOOL_INDEX_MO = 0.02 / 100

# The tool inventory, all of it re-derived in assert_facts_match_sources().
PROFILE_TOOLS = 3
INTEGRATION_SCHEMAS = 20
PROPOSE_TOOLS = 7
READONLY_TOOLS = INTEGRATION_SCHEMAS - PROPOSE_TOOLS
OFFERED_ON_B = INTEGRATION_SCHEMAS - 1  # create_conversation_link is withheld
TOOLS_INDEXED = PROFILE_TOOLS + OFFERED_ON_B + PROPOSE_TOOLS  # confirms are indexed too
MAX_TOOL_ITERATIONS = 5

# MEASURED-OFF-TREE: the controlled 120-turn run, `git show 91c9fe2:runs/report.md`
# on branch worktree-experiment-cost-latency. Not assertable from this tree.
MODELLED_TURNS = 120
GATEWAY_CALLS = 487
CALLS_PER_TURN = 4.06
LIST_CALLS = MODELLED_TURNS  # one tools/list per invocation, agent.py:361
FIXED_OVERHEAD_MS = 47
TOOLS_CALL_MS = 523
SLOWEST_TOOL_MS = 1776  # read_webpage


def assert_facts_match_sources():
    """Fail the build if a figure on a slide no longer matches the tree."""
    cost = Path("scripts/cost-one-user.mjs").read_text()
    for name, expected in (("AC_GATEWAY_INVOKE", AC_GATEWAY_INVOKE),
                           ("AC_TOOL_INDEX_MO", AC_TOOL_INDEX_MO)):
        m = re.search(rf"const {name} = ([0-9.]+)\s*(?:/\s*([0-9]+))?", cost)
        if not m:
            raise SystemExit(f"{name} is gone from cost-one-user.mjs — slide rates unverified")
        value = float(m.group(1)) / float(m.group(2)) if m.group(2) else float(m.group(1))
        if abs(value - expected) > 1e-15:
            raise SystemExit(f"{name} is {value} in cost-one-user.mjs but {expected} on the slide")

    m = re.search(r"const TOOLS_INDEXED = (\d+) \+ (\d+) \+ (\d+);", cost)
    if not m or sum(int(g) for g in m.groups()) != TOOLS_INDEXED:
        raise SystemExit(f"TOOLS_INDEXED no longer sums to {TOOLS_INDEXED} in cost-one-user.mjs")

    schemas = json.loads(Path("infra/lib/generated/integration-tool-schemas.json").read_text())
    tools = schemas if isinstance(schemas, list) else schemas["tools"]
    names = [t["name"] for t in tools]
    if len(names) != INTEGRATION_SCHEMAS:
        raise SystemExit(f"{len(names)} integration schemas generated, slide says {INTEGRATION_SCHEMAS}")
    proposes = [n for n in names if n.startswith("propose_")]
    if len(proposes) != PROPOSE_TOOLS:
        raise SystemExit(f"{len(proposes)} propose_* tools, slide says {PROPOSE_TOOLS}")

    stack = Path("infra/lib/agentcore-stack.ts").read_text()
    if "const WITHHELD = new Set(['create_conversation_link']);" not in stack:
        raise SystemExit("WITHHELD changed — '19 of the 20' on the slide is no longer right")
    for literal in ("protocolType: 'MCP'", "authorizerType: 'CUSTOM_JWT'"):
        if literal not in stack:
            raise SystemExit(f"{literal} is gone from agentcore-stack.ts")

    bridge = Path("src/server/telemetry/span-bridge.ts").read_text()
    if "const GATEWAY_NAME_SEPARATOR = '___';" not in bridge:
        raise SystemExit("GATEWAY_NAME_SEPARATOR is no longer '___' — fix the naming bullet")

    loop = Path("src/server/agent/tool-loop.ts").read_text()
    m = re.search(r"MAX_TOOL_ITERATIONS = (\d+)", loop)
    if not m or int(m.group(1)) != MAX_TOOL_ITERATIONS:
        raise SystemExit(f"MAX_TOOL_ITERATIONS is not {MAX_TOOL_ITERATIONS} any more")
    if "Promise.all" not in loop:
        raise SystemExit("tool-loop.ts no longer uses Promise.all — the parallel bullet is wrong")


def bill(calls, tools):
    """A Gateway bill: per-call traffic plus the standing charge on the catalogue."""
    return calls * AC_GATEWAY_INVOKE + tools * AC_TOOL_INDEX_MO


# ---------------------------------------------------------------- text helpers

def textbox(slide, x, y, w, h, *, anchor=MSO_ANCHOR.TOP):
    tf = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h)).text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = 0
    tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    return tf


def write(tf, runs, *, first=False, align=PP_ALIGN.LEFT, space_before=0, space_after=0):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    if space_before:
        p.space_before = Pt(space_before)
    if space_after:
        p.space_after = Pt(space_after)
    for text, size, bold, color, *rest in runs:
        r = p.add_run()
        r.text = text
        r.font.name = rest[0] if rest else FONT
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = color
    return p


def bullet(tf, runs, *, size=12, accent=ORANGE, space_before=4):
    return write(tf, [("• ", size, False, accent)] + runs, space_before=space_before)


# --------------------------------------------------------------- style helpers

def title_block(slide, number, strong, rest):
    """Numbered badge, two-weight title, and the short orange rule beneath it."""
    badge = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(0.5), Inches(0.30),
                                   Inches(0.54), Inches(0.54))
    badge.fill.solid()
    badge.fill.fore_color.rgb = NAVY
    badge.line.fill.background()
    btf = badge.text_frame
    btf.margin_left = btf.margin_right = btf.margin_top = btf.margin_bottom = 0
    btf.vertical_anchor = MSO_ANCHOR.MIDDLE
    write(btf, [(str(number), 20, True, ORANGE)], first=True, align=PP_ALIGN.CENTER)

    tf = textbox(slide, 1.22, 0.28, 11.6, 0.62)
    write(tf, [(strong, 27, True, NAVY), (rest, 27, False, NAVY)], first=True)

    rule = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1.22), Inches(0.94),
                                  Inches(1.45), Inches(0.055))
    rule.fill.solid()
    rule.fill.fore_color.rgb = ORANGE
    rule.line.fill.background()


def panel(slide, x, y, w, h, *, accent, eyebrow, fill=TINT, edge="left"):
    """Tinted card with a coloured edge and an uppercase eyebrow label."""
    box = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    box.fill.solid()
    box.fill.fore_color.rgb = fill
    box.line.fill.background()
    box.shadow.inherit = False

    if edge == "left":
        bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y),
                                     Inches(0.045), Inches(h))
    else:
        bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y),
                                     Inches(w), Inches(0.045))
    bar.fill.solid()
    bar.fill.fore_color.rgb = accent
    bar.line.fill.background()
    bar.shadow.inherit = False

    pad = 0.20
    etf = textbox(slide, x + pad, y + 0.13, w - 2 * pad, 0.26)
    write(etf, eyebrow, first=True)
    return textbox(slide, x + pad, y + 0.44, w - 2 * pad, h - 0.58)


def eyebrow_runs(label, tail=None, *, color):
    runs = [(label.upper(), 10.5, True, color)]
    if tail:
        runs.append(("   ·   " + tail, 10.5, False, GREY))
    return runs


def stat_card(slide, x, y, w, h, *, eyebrow, value, caption, accent=NAVY):
    """The top-row card of slide 6: rule above, grey label, big value, caption."""
    tf = panel(slide, x, y, w, h, accent=accent,
               eyebrow=eyebrow_runs(eyebrow, None, color=GREY), edge="top")
    write(tf, [(value, 26, True, NAVY)], first=True)
    write(tf, caption, space_before=2)
    return tf


def full_band(slide, x, y, w, h, *, fill, eyebrow, eyebrow_color, center=True):
    box = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    box.fill.solid()
    box.fill.fore_color.rgb = fill
    box.line.fill.background()
    box.shadow.inherit = False

    align = PP_ALIGN.CENTER if center else PP_ALIGN.LEFT
    etf = textbox(slide, x + 0.22, y + 0.11, w - 0.44, 0.24)
    write(etf, [(eyebrow.upper(), 10.5, True, eyebrow_color)], first=True, align=align)
    return textbox(slide, x + 0.22, y + 0.38, w - 0.44, h - 0.52)


def footer(slide):
    tf = textbox(slide, 0.5, 7.02, 8.0, 0.28)
    write(tf, [("VALENTIN", 10, True, NAVY),
               ("   ·   GenAI TFC Capstone Deep-Dive", 10, False, GREY)], first=True)


def notes(slide, paragraphs):
    slide.notes_slide.notes_text_frame.text = "\n\n".join(paragraphs)


# --------------------------------------------------------------- table helpers

def set_cell_border(cell, color="232F3E", weight=12700):
    """Draw all four borders of a table cell — python-pptx has no API for it.

    `a:tcPr`'s schema fixes its children as lnL, lnR, lnT, lnB, … , fill, and
    `cell.fill.solid()` has already put a solidFill in place by the time this
    runs — so the line elements must be inserted at the front, not appended.
    """
    tc_pr = cell._tc.get_or_add_tcPr()
    for i, tag in enumerate(("a:lnL", "a:lnR", "a:lnT", "a:lnB")):
        for old in tc_pr.findall(qn(tag)):
            tc_pr.remove(old)
        ln = tc_pr.makeelement(qn(tag), {"w": str(weight), "cap": "flat",
                                         "cmpd": "sng", "algn": "ctr"})
        fill = ln.makeelement(qn("a:solidFill"), {})
        srgb = ln.makeelement(qn("a:srgbClr"), {"val": color})
        fill.append(srgb)
        ln.append(fill)
        tc_pr.insert(i, ln)


def style_cell(cell, runs, *, align=PP_ALIGN.LEFT, fill=WHITE, size=11):
    cell.fill.solid()
    cell.fill.fore_color.rgb = fill
    cell.vertical_anchor = MSO_ANCHOR.MIDDLE
    cell.margin_left = cell.margin_right = Inches(0.09)
    cell.margin_top = cell.margin_bottom = Inches(0.02)
    set_cell_border(cell)
    tf = cell.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = align
    for text, bold, color in runs:
        r = p.add_run()
        r.text = text
        r.font.name = MONO
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = color


def mono_table(slide, x, y, w, row_h, col_fracs, rows, *, size=11):
    n_rows, n_cols = len(rows), len(rows[0])
    shape = slide.shapes.add_table(n_rows, n_cols, Inches(x), Inches(y),
                                   Inches(w), Inches(row_h * n_rows))
    table = shape.table
    table.first_row = False
    table.horz_banding = False
    for i, frac in enumerate(col_fracs):
        table.columns[i].width = Emu(int(Inches(w) * frac))
    for row in table.rows:
        row.height = Inches(row_h)
    for ri, spec in enumerate(rows):
        head = ri == 0
        for ci, (runs, align) in enumerate(spec):
            style_cell(table.cell(ri, ci), runs, align=align,
                       fill=TINT if head else WHITE, size=size)
    return shape


assert_facts_match_sources()

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
blank = prs.slide_layouts[6]

W = 12.33   # full content width
CW = 6.03   # one column
RX = 0.5 + CW + 0.27
CARD_W = 3.93
CARD_GAP = 0.27

# ============================================================================
# Slide 1 — the tools, how they are discovered, how the call travels
# ============================================================================
s = prs.slides.add_slide(blank)
title_block(s, 1, "Tools in Valentin — ", "one codebase, two ways to reach it")

CARD_H = 1.30

stat_card(s, 0.5, 1.12, CARD_W, CARD_H,
          eyebrow="The tool code",
          value="One folder",
          caption=[("src/server/integrations/", 11, False, CODEBLUE, MONO)])

stat_card(s, 0.5 + CARD_W + CARD_GAP, 1.12, CARD_W, CARD_H,
          eyebrow="Integration schemas",
          value=str(INTEGRATION_SCHEMAS),
          caption=[(f"{READONLY_TOOLS} read-only  ·  {PROPOSE_TOOLS} ", 11.5, False, BODY),
                   ("propose_*", 11, False, CODEBLUE, MONO)])

stat_card(s, 0.5 + 2 * (CARD_W + CARD_GAP), 1.12, CARD_W, CARD_H,
          eyebrow="Indexed in the Gateway",
          value=str(TOOLS_INDEXED),
          caption=[(f"{PROFILE_TOOLS} profile  ·  {OFFERED_ON_B} offered  ·  {PROPOSE_TOOLS} ",
                    11.5, False, BODY),
                   ("confirm_*", 11, False, CODEBLUE, MONO)])

tf = full_band(s, 0.5, 2.52, W, 0.84, fill=BAND,
               eyebrow="The whole comparison, in one line", eyebrow_color=NAVY)
write(tf, [("The tools are identical on both engines. Only two things differ — how the agent ",
            15, False, NAVY),
           ("discovers", 15, True, NAVY),
           (" them, and how the call ", 15, False, NAVY),
           ("travels", 15, True, NAVY),
           (".", 15, False, NAVY)], first=True, align=PP_ALIGN.CENTER)

PANEL_Y, PANEL_H = 3.48, 2.10

tf = panel(s, 0.5, PANEL_Y, CW, PANEL_H, accent=GREEN,
           eyebrow=eyebrow_runs("How they are discovered", "does the agent know the tool exists?",
                                color=GREEN))
bullet(tf, [("Engine A — compiled in.", 12, True, BODY),
            (" Each set gated on its own credential flag, so a half-configured deployment offers the half that works",
             12, False, BODY)], space_before=0)
bullet(tf, [("Engine B — asked at runtime.", 12, True, BODY),
            (" ", 12, False, BODY),
            ("agent.py", 11, False, CODEBLUE, MONO),
            (" cannot import TypeScript, so it calls ", 12, False, BODY),
            ("tools/list", 11, False, CODEBLUE, MONO),
            (" over MCP every invocation", 12, False, BODY)])
bullet(tf, [("The trade.", 12, True, BODY),
            (" A new tool never touches ", 12, False, BODY),
            ("agent.py", 11, False, CODEBLUE, MONO),
            (f" — but the handshake never amortises: {MODELLED_TURNS} invocations, {LIST_CALLS} ",
             12, False, BODY),
            ("tools/list", 11, False, CODEBLUE, MONO),
            (" calls", 12, False, BODY)])

tf = panel(s, RX, PANEL_Y, CW, PANEL_H, accent=CODEBLUE,
           eyebrow=eyebrow_runs("How the call travels", "what happens when it is invoked",
                                color=CODEBLUE))
bullet(tf, [("Engine A — a function call, same process.", 12, True, BODY),
            (" No hop, no JWT. Parallel tools go out via ", 12, False, BODY),
            ("Promise.all", 11, False, CODEBLUE, MONO),
            (", so a two-tool turn costs one tool’s latency", 12, False, BODY)], space_before=0)
bullet(tf, [("Engine B — a network hop.", 12, True, BODY),
            (" MCP → Gateway → Lambda → partner, on ", 12, False, BODY),
            ("CUSTOM_JWT", 11, False, CODEBLUE, MONO),
            (" — its only inbound mode", 12, False, BODY)])
bullet(tf, [("Names return prefixed", 12, True, BODY),
            (" — ", 12, False, BODY),
            ("valentin-integrations___propose_reservation", 10.5, False, CODEBLUE, MONO),
            (". Rename the target without the constant and every confirm 404s", 12, False, BODY)])

tf = full_band(s, 0.5, 5.70, W, 1.22, fill=NAVY,
               eyebrow="Additional considerations", eyebrow_color=ORANGE, center=False)
write(tf, [("Identity — ", 12, True, ORANGE),
           ("the JWT is a machine’s, so ", 12, False, WHITE),
           ("user_id", 11, False, BAND, MONO),
           (" / ", 12, False, WHITE),
           ("session_id", 11, False, BAND, MONO),
           (" are stripped from the model’s schema and injected in code at call time.", 12, False, WHITE)],
      first=True)
write(tf, [("Security — ", 12, True, ORANGE),
           ("confirm_*", 11, False, BAND, MONO),
           (" is hidden from the model and called by the proxy: no language model in the authority path for spending money.",
            12, False, WHITE)], space_before=3)
write(tf, [("Latency — ", 12, True, ORANGE),
           (f"~{FIXED_OVERHEAD_MS} ms per turn of Gateway overhead; the {TOOLS_CALL_MS} ms ",
            12, False, WHITE),
           ("tools/call", 11, False, BAND, MONO),
           (" average is the tool’s own work, not the hop.", 12, False, WHITE)], space_before=3)

footer(s)
notes(s, [
    "One subfolder per service — Ontopo, Amadeus, Google Calendar/Gmail, Spotify, Wolt, "
    "Google Places, Hebcal, WhatsApp, web search — plus reminders and sharing, which sit just "
    "outside the folder. buildToolRegistry() does not define the tools, it assembles them, and "
    "it is the one function both engines ultimately consume.",

    "DISCOVERY. Engine A gates each tool set on its own credential flag, so the model is never "
    "shown a tool it cannot call — no Spotify refresh token means no music tools, rather than a "
    "tool that fails. Engine B cannot do that: agent.py is Python and the tools are TypeScript, "
    "so it has to ask. The 29 indexed are 3 profile tools, 19 of the 20 integration tools "
    "(create_conversation_link is withheld), and 7 confirm_* generated from the propose_* list — "
    "so a gated tool cannot ship without its confirm.",

    "TRAVERSAL. On A the tool is a function in the same process — no gateway, no Lambda cold "
    f"start, no JWT — and parallel requests are dispatched with Promise.all, so a two-tool turn "
    f"costs one tool's latency; the loop caps at {MAX_TOOL_ITERATIONS} model round trips. On B "
    "every call is a network hop and CUSTOM_JWT is the Gateway's only inbound auth mode. Tool "
    "names are snake_case and the separator is three underscores, so splitting is unambiguous — "
    "but GATEWAY_NAME_SEPARATOR in span-bridge.ts and INTEGRATIONS_TARGET in "
    "agentcore-orchestrator.ts must match the CDK target name, or every confirm comes back "
    "'tool not found'.",

    "IDENTITY, if asked. Two mechanisms, both needed: the identity args are removed from the "
    "inputSchema before the tools reach Strands, and _inject_identity pops the model's value "
    "before merging ours in — dict.update would already win, but popping first states the rule "
    "that a model must not be able to name a different user. A tool that cannot be bound is "
    "dropped rather than exposed unbound. One subtlety that caused a real fault: AgentCore Memory "
    "rejects '#', so actorId is sanitised, while user_id travels raw because the profile tools key "
    "DynamoDB where a demo visitor's id genuinely is <sub>#<visitorId>.",

    "PROVENANCE. The tool counts, rates, separator and iteration cap are re-read from the tree at "
    "build time by assert_facts_match_sources(). The 47 ms / 523 ms / 120-invocation figures are "
    "from the controlled 120-turn run: git show 91c9fe2:runs/report.md on branch "
    "worktree-experiment-cost-latency. The ~1.1 s cold start sometimes quoted alongside these "
    "belongs to the AgentCore Runtime, not the Gateway — attribute it correctly if pressed.",
])

# ============================================================================
# Slide 2 — what the Gateway costs
# ============================================================================
s = prs.slides.add_slide(blank)
title_block(s, 2, "What AgentCore Gateway costs — ", "two meters, not one price")

hdr = lambda t: ([(t, False, GREY)], PP_ALIGN.CENTER)
L, C = PP_ALIGN.LEFT, PP_ALIGN.CENTER

tf = textbox(s, 0.5, 1.14, W, 0.26)
write(tf, eyebrow_runs("The two meters", "what AWS charges", color=NAVY), first=True)

meter_rows = [
    [hdr("Meter"), hdr("Rate"), hdr("Billed when"), hdr("Recurring?")],
    [([("Invocation", True, BODY), ("  (traffic)", False, BODY)], L),
     ([("$0.005 per 1,000 calls", True, BODY)], L),
     ([("every ", False, BODY), ("tools/list", False, CODEBLUE), (" and ", False, BODY),
       ("tools/call", False, CODEBLUE)], L),
     ([("No — one-off", False, BODY)], L)],
    [([("Tool indexed", True, BODY), ("  (catalogue)", False, BODY)], L),
     ([("$0.02 per 100 tools per month", True, BODY)], L),
     ([("for every tool the Gateway holds", False, BODY)], L),
     ([("Yes — every month", True, NAVY)], L)],
]
mono_table(s, 0.5, 1.42, W, 0.32, [0.23, 0.26, 0.33, 0.18], meter_rows)

# Same conversation count in every row — only the catalogue and the calls move.
big_cat = bill(MODELLED_TURNS * 2, 200)
lean_cat = bill(MODELLED_TURNS * 10, 10)
modelled = bill(GATEWAY_CALLS, TOOLS_INDEXED)
modelled_index = TOOLS_INDEXED * AC_TOOL_INDEX_MO
modelled_calls = GATEWAY_CALLS * AC_GATEWAY_INVOKE
big_index_pct = round(200 * AC_TOOL_INDEX_MO / big_cat * 100)
lean_calls_pct = round(MODELLED_TURNS * 10 * AC_GATEWAY_INVOKE / lean_cat * 100)
modelled_index_pct = round(modelled_index / modelled * 100)
spread = max(big_cat, lean_cat, modelled) / min(big_cat, lean_cat, modelled)
list_share_pct = round(LIST_CALLS / GATEWAY_CALLS * 100)

tf = textbox(s, 0.5, 2.50, W, 0.26)
write(tf, eyebrow_runs("Use-case profiles",
                       f"all three at the same {MODELLED_TURNS} turns a month — per user, per month",
                       color=NAVY), first=True)

profile_rows = [
    [hdr("Profile"), hdr("Tools indexed"), hdr("Calls/turn"), hdr("Calls/mo"),
     hdr("Bill/mo"), hdr("What dominates")],
    [([("Big catalogue, light use", True, BODY), ("  — rarely called", False, GREY)], L),
     ([("200", False, BODY)], C), ([("2", False, BODY)], C),
     ([(f"{MODELLED_TURNS * 2:,}", False, BODY)], C),
     ([(f"${big_cat:.4f}", True, BODY)], C),
     ([(f"catalogue — {big_index_pct}%, recurring", False, BODY)], L)],
    [([("Lean catalogue, heavy use", True, BODY), ("  — called constantly", False, GREY)], L),
     ([("10", False, BODY)], C), ([("10", False, BODY)], C),
     ([(f"{MODELLED_TURNS * 10:,}", False, BODY)], C),
     ([(f"${lean_cat:.4f}", True, BODY)], C),
     ([(f"traffic — {lean_calls_pct}%", False, BODY)], L)],
    [([("Valentin, modelled", True, NAVY), ("  — the 120-turn run", False, GREY)], L),
     ([(f"{TOOLS_INDEXED}", False, BODY)], C), ([(f"{CALLS_PER_TURN}", False, BODY)], C),
     ([(f"{GATEWAY_CALLS}", False, BODY)], C),
     ([(f"${modelled:.4f}", True, NAVY)], C),
     ([(f"catalogue — {modelled_index_pct}%", False, BODY)], L)],
]
mono_table(s, 0.5, 2.78, W, 0.36, [0.34, 0.12, 0.11, 0.11, 0.10, 0.22], profile_rows)

tf = full_band(s, 0.5, 4.36, W, 1.02, fill=BAND,
               eyebrow="The one thing to remember", eyebrow_color=NAVY)
write(tf, [("Cost tracks your catalogue and your calls — not your conversations.", 15, True, NAVY)],
      first=True, align=PP_ALIGN.CENTER)
write(tf, [(f"Same {MODELLED_TURNS} turns, {spread:.0f}× the bill — and what dominates flips. "
            f"Ours: ${modelled_index:.4f} catalogue + ${modelled_calls:.4f} calls.",
            12, False, NAVY)], space_before=3, align=PP_ALIGN.CENTER)

tf = full_band(s, 0.5, 5.50, W, 1.34, fill=NAVY,
               eyebrow="Worth owning  ·  and the networking it does save",
               eyebrow_color=ORANGE, center=False)
write(tf, [(f"{LIST_CALLS} of our {GATEWAY_CALLS} calls — {list_share_pct}% of all traffic — were ",
            11.5, False, WHITE),
           ("tools/list", 11, False, BAND, MONO),
           (" re-reading a catalogue that changed zero times.", 11.5, False, WHITE)], first=True)
write(tf, [("Against that, the hub does save networking: consumers integrate once, not once per tool owner — ",
            11.5, False, WHITE),
           ("n", 11.5, True, WHITE),
           (" relationships instead of ", 11.5, False, WHITE),
           ("n(n-1)/2", 11, False, BAND, MONO),
           (", which only wins above n = 3.", 11.5, False, WHITE)], space_before=3)
write(tf, [("Rates and tool counts are re-read from the tree at build time; the first two profiles are illustrative.",
            10, False, LINE)], space_before=3)

footer(s)
notes(s, [
    "WHY THIS IS COMPLEX. Indexing charges the SIZE of your catalogue; invocations charge your "
    "TRAFFIC. Nothing links them. So two apps with the same number of conversations diverge on "
    "three independent things: how many tools they index, how many the model actually calls per "
    "turn, and whether they re-discover the catalogue every invocation. The app with a big "
    "catalogue pays whether anyone calls anything or not — that line recurs monthly. The app with "
    "ten tools called constantly pays the opposite way.",

    "OUR SPLIT IS 70/30 TOWARD THE CATALOGUE. 29 tools at $0.02 per 100 per month is $0.0058; "
    "487 calls at $0.005 per 1,000 is $0.0024. Total $0.0082 — which is exactly the figure in the "
    "run report, so the arithmetic self-checks.",

    "THE GATEWAY WAS NEVER THE COST PROBLEM. Eight tenths of a cent per user per month, 100% "
    "inbound auth success, zero Lambda errors (profile 59 invocations, integration 68). Tokens "
    "($12.43) and the second always-on Fargate task ($18.02) drove the whole engine-A-vs-B gap.",

    "IF PRESSED ON THE $0.0082. It prices the 120-turn run AS one user-month, which is how "
    "cost-one-user.mjs scales it — so it is a rate at that activity level, not an independently "
    "counted calendar month. Say 'at this activity level' and the figure holds.",

    "THE NETWORKING NOTE. The hub-vs-point-to-point argument is topological and real: n "
    "relationships instead of n(n-1)/2, crossover at n > 3, so at two teams point-to-point wins "
    "outright. Partner egress also leaves from Lambda rather than the Fargate task's NAT Gateway "
    "— but ALB and NAT Gateway are excluded from cost-one-user.mjs as shared infrastructure, so "
    "do not quote a number for that saving.",
])

DST.parent.mkdir(exist_ok=True)
prs.save(DST)
print(f"wrote {DST}")
print(f"big_catalogue=${big_cat:.4f} (index {big_index_pct}%)  "
      f"lean_catalogue=${lean_cat:.4f} (calls {lean_calls_pct}%)  "
      f"modelled=${modelled:.4f} (index {modelled_index_pct}%)  spread={spread:.1f}x")
print(f"modelled split: index ${modelled_index:.4f} + calls ${modelled_calls:.4f} "
      f"= ${modelled_index + modelled_calls:.4f}")
