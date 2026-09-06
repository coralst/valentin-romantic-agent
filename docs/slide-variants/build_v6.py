"""build_v6.py — assemble docs/Valentin-Presentation-v6.pptx from v4.

v4 is the live deck. This keeps its first four slides (fixing the arrows on the
agentic-workflow slide), replaces the old architecture + deep-dive block with a
new comparison slide and one message-only placeholder per service, folds in the
four retinted HTML slides as pictures, ends on a designed "What I learned", and
writes a timed transcript into every slide's notes.

    python3 docs/slide-variants/build_v6.py
"""
import os
import re
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn

import aws_slides as T
import emit_pptx
import workflow_arrows

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
V4 = '/Users/coralst/Desktop/screenshots/projects/valentin-romantic-agent/docs/Valentin-Presentation-v4.pptx'
OUT = os.path.join(REPO, 'docs', 'Valentin-Presentation-v6.pptx')
PNGS = '/Users/coralst/.claude/jobs/84959c04/tmp/aws'
EXPLORER = 'https://d26dwovftfq9oe.cloudfront.net/explore.html#work'
TOTAL = 15
EMU_PER_PX = 7620   # 1600px render -> 12192000 EMU

# ── transcript ───────────────────────────────────────────────────────────────
# Budgeted to 10:00 exactly. The stamp is the slide's own length, then the
# cumulative clock, so you can tell mid-talk whether you are ahead or behind.
NOTES = [
    (20, 'Valentin is an agent that helps me be a better partner. Ten minutes: '
         'what it does, why the loop is the interesting part, then the decision '
         'I actually came to present — build the agent platform myself on '
         'Fargate, or buy AgentCore.'),
    (45, 'The problem is not that I forget her birthday. It is that being '
         'thoughtful is a background job: noticing an occasion is coming, '
         'remembering what she liked last time, and doing something about it '
         'before the day arrives. That is three different jobs, and a chat '
         'window only does the middle one.'),
    (65, 'This is the whole system in one picture, and it is the slide I would '
         'defend hardest. An event on the timeline triggers a planning pass — '
         'that is the arrow coming up from the calendar. The agent uses tools, '
         'proposes something, we talk, and it extracts what it learned about '
         'her. Then feedback after the event can set the next event, which is '
         'the arrow going back down to the timeline. Claude is one step in that '
         'ring. EventBridge is what closes it.'),
    (75, 'Short demo. Watch two things: it opens with an occasion I never typed, '
         'and by the end it has written something into her file that changes '
         'what it says next time.'),
    (60, 'Now the real content. Same product, built twice: once as glue code I '
         'own on Fargate, once on AgentCore. Four decisions, one row each, and '
         'the number that settles it in the last column. Three of the four go '
         'to AgentCore. The fourth does not, and I will not skip it — a '
         'comparison that goes four-nil is a sales pitch.'),
    (35, 'Compute first. Engine A never scales to zero: one task, eighteen '
         'dollars a month before anyone says a word. Engine B bills per second '
         'of actual agent work — under a cent. But its unit price is worse, '
         'two point two times dearer per vCPU-hour. It wins on granularity, '
         'not on rate.'),
    (40, 'And this is what I actually care about. In-process, forty sessions '
         'share one Node process, one heap, one crash. A microVM per session '
         'means a fault has nowhere to travel. Same for credentials: one shared '
         'IAM role versus one role per tool.'),
    (35, 'The bill, itemised, with every rate from a pricing page and every '
         'quantity counted out of this repo. The reply call to Bedrock is '
         'identical on both sides, so I excluded it from both — otherwise it '
         'dominates and hides the difference.'),
    (35, 'Memory. Engine A pays a second model call every turn just to extract '
         'preferences, and I own that prompt forever. AgentCore Memory folds '
         'extraction into the service: fourteen times cheaper per user. One '
         'caveat I have not resolved — if retrieval meters per record instead '
         'of per call, that reverses.'),
    (35, 'Tool use, and the worst thing in engine A: a process-wide registry '
         'holding every user’s credentials in the same heap as every '
         'session. Gateway moves the tool surface out of the process and '
         'resolves auth per tool, for six ten-thousandths of a dollar a month.'),
    (30, 'Observability is the one dimension the DIY side wins. Hand-wired OTEL '
         'emits exactly the fields I debug with. AgentCore gives me traces for '
         'free, but on its schema. Where I landed: take its traces as the '
         'floor, keep my own spans for the two or three fields that decide an '
         'incident.'),
    (30, 'A word on how this got built, because it is the part people ask about. '
         'I wrote none of the application code. Six agents did, each with a '
         'prompt file and an explicit do-not-touch list — disjoint ownership is '
         'what stops five agents editing at once from being a merge-conflict '
         'generator.'),
    (25, 'Every node here is a real pull request, in the order it was opened, '
         'connected to where it merged. Fifty-seven of them. The link opens the '
         'interactive version if you want to read any review thread.'),
    (60, 'Five things I would tell the next person. An agent is a loop, not a '
         'chatbot. When you and the agent are both stuck, stop prompting and '
         'pick up a pen. Most of my tokens went to the workflow, not the code — '
         'and that is what made the code safe to merge. The strongest case for '
         'AgentCore is blast radius, not the bill. And it is easy to gate that '
         'the service is up, hard to gate that the model still works — a '
         'missing permission returned a polite fallback with a two hundred.'),
    (10, 'That is Valentin. Happy to go deeper on any of the four deep-dives, '
         'or on the agent workflow that built it.'),
]


def stamp(i):
    secs = sum(n[0] for n in NOTES[:i + 1])
    return f'{NOTES[i][0] // 60}:{NOTES[i][0] % 60:02d}', f'{secs // 60}:{secs % 60:02d}'


def set_notes(slide, i):
    dur, cum = stamp(i)
    slide.notes_slide.notes_text_frame.text = (
        f'[{dur} · cumulative {cum} of 10:00]\n\n{NOTES[i][1]}')


# ── slide-3 arrows ───────────────────────────────────────────────────────────

def fix_workflow_arrows(slide):
    """Drop the nine geometry-less arrow shapes; draw real ones."""
    dropped = 0
    for sh in list(slide.shapes):
        el = sh._element
        if not el.tag.endswith('}sp'):
            continue
        spPr = el.find(qn('p:spPr'))
        if spPr is None:
            continue
        if spPr.find(qn('a:prstGeom')) is None and spPr.find(qn('a:custGeom')) is None:
            el.getparent().remove(el)
            dropped += 1
    emit_pptx.render(slide, workflow_arrows.ops())
    return dropped


# ── picture slides ───────────────────────────────────────────────────────────

def add_picture_slide(prs, layout, png, page, badge, dark, alt, links=()):
    s = prs.slides.add_slide(layout)
    for sh in list(s.shapes):
        sh._element.getparent().remove(sh._element)
    emit_pptx.render(s, [('rect', 0, 0, T.W, T.H, T.NAVY if dark else T.WHITE, None, 0)])
    pic = s.shapes.add_picture(png, 0, 0, width=prs.slide_width, height=prs.slide_height)
    pic._element.nvPicPr.cNvPr.set('descr', alt)
    emit_pptx.render(s, T.chrome(page, TOTAL, badge, dark=dark)[1:])
    for lk in links:
        hot = s.shapes.add_shape(
            MSO_SHAPE.RECTANGLE, Emu(lk['x'] * EMU_PER_PX), Emu(lk['y'] * EMU_PER_PX),
            Emu(lk['w'] * EMU_PER_PX), Emu(lk['h'] * EMU_PER_PX))
        hot.fill.solid()
        hot.fill.fore_color.rgb = RGBColor.from_string('FFFFFF')
        srgb = hot.fill.fore_color._xFill.find(qn('a:srgbClr'))
        srgb.append(srgb.makeelement(qn('a:alpha'), {'val': '0'}))
        hot.line.fill.background()
        hot.shadow.inherit = False
        hot.click_action.hyperlink.address = EXPLORER
    return s


def add_ops_slide(prs, layout, ops):
    s = prs.slides.add_slide(layout)
    for sh in list(s.shapes):
        sh._element.getparent().remove(sh._element)
    emit_pptx.render(s, ops)
    return s


# ── page numbers on the kept slides ──────────────────────────────────────────

PAGENUM = re.compile(r'^\s*\d+\s*/\s*\d+\s*$')


def set_page_number(slide, page):
    for sh in slide.shapes:
        if sh.has_text_frame and PAGENUM.match(sh.text_frame.text):
            runs = sh.text_frame.paragraphs[0].runs
            if runs:
                runs[0].text = f'{page} / {TOTAL}'
                for extra in runs[1:]:
                    extra.text = ''
            return True
    return False


def main():
    prs = Presentation(V4)
    meta = json.load(open(os.path.join(PNGS, 'meta.json')))

    dropped = fix_workflow_arrows(prs.slides[2])

    for i, page in ((1, 2), (2, 3), (3, 4)):
        set_page_number(prs.slides[i], page)

    layout = min(prs.slide_layouts, key=lambda l: len(l.placeholders))

    # New slides are appended BEFORE the old ones are dropped: adding after a
    # delete reuses freed partnames and produces a corrupt package.
    new = [
        add_ops_slide(prs, layout, T.slide_compare(5, TOTAL, 4)),
        add_ops_slide(prs, layout, T.slide_messages(
            6, TOTAL, 5, 'Compute — Fargate vs. AgentCore Runtime',
            'Where the agent actually runs, and what that costs you in dollars '
            'and in blast radius.', T.MSG_COMPUTE)),
        add_picture_slide(prs, layout, f'{PNGS}/blast.png', 7, 6, True,
                          'Deep-dive: AgentCore Runtime — reliability and security. '
                          'Blast radius of an in-process tool registry versus one '
                          'microVM and one IAM role per session.'),
        add_picture_slide(prs, layout, f'{PNGS}/cost.png', 8, 7, False,
                          'Deep-dive: AgentCore Runtime — cost. Two bills split into '
                          'what is fixed and what grows with usage.'),
        add_ops_slide(prs, layout, T.slide_messages(
            9, TOTAL, 8, 'Memory — DynamoDB + a second call vs. AgentCore Memory',
            'How the agent remembers her, and who owns the extraction prompt.',
            T.MSG_MEMORY)),
        add_ops_slide(prs, layout, T.slide_messages(
            10, TOTAL, 9, 'Tool use — in-process registry vs. AgentCore Gateway',
            'How the agent reaches Spotify, Gmail and the calendar — and who '
            'holds the credentials.', T.MSG_GATEWAY)),
        add_ops_slide(prs, layout, T.slide_messages(
            11, TOTAL, 10, 'Observability — hand-wired OTEL vs. AgentCore Observability',
            'What you can actually see when a turn goes wrong at two in the '
            'morning.', T.MSG_OBS)),
        add_picture_slide(prs, layout, f'{PNGS}/team.png', 12, 11, False,
                          'How I built it: the team. One human and six agents, each '
                          'with its own prompt file and an explicit ownership boundary.'),
        add_picture_slide(prs, layout, f'{PNGS}/graph.png', 13, 12, False,
                          'How I built it: the work. Every node is a real pull request, '
                          'in the order it was opened, joined to where it merged.',
                          links=meta['graph']['links']),
        add_ops_slide(prs, layout, T.slide_lessons(14, TOTAL, 13)),
    ]

    sld_lst = prs.slides._sldIdLst
    ids = list(sld_lst)
    keep_front = ids[0:4]           # title, problem, workflow, demo
    thanks = ids[12]                # "Thank you. Questions?"
    drop = ids[4:12]                # old architecture pair + five deep-dives + summary
    new_ids = ids[13:]

    for el in drop:
        prs.part.drop_rel(el.rId)
        sld_lst.remove(el)

    for el in keep_front + new_ids + [thanks]:
        sld_lst.remove(el)
        sld_lst.append(el)

    for i, s in enumerate(prs.slides):
        set_notes(s, i)

    prs.save(OUT)
    print(f'dropped {dropped} geometry-less arrow shapes from the workflow slide')
    print(f'wrote {OUT}: {len(sld_lst)} slides')


if __name__ == '__main__':
    main()
