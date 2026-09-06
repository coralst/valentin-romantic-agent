"""build_v7.py — assemble docs/Valentin-Presentation-v7.pptx from v6.

v7 pivots the comparison section from component-major (Compute → Memory →
Tool use → Observability) to lens-major (cost, resilience, security,
ownership, debuggability — latency stays on the matrix), each lens slide
carrying a fixed strip of AgentCore component chips that toggle per lens.

Kept from v6: the four front slides (with the slide-3 typos fixed), the
hand-added two-engines architecture diagram, the cost-bill and blast-radius
picture slides, team/graph/lessons/thanks. Dropped: the old comparison table,
the four message-only placeholders, and the accidental duplicate of the cost
picture that was retitled "Compute — resilience".

    python3 docs/slide-variants/build_v7.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pptx import Presentation

import lens_slides as L
import emit_pptx

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
V6 = ('/Users/coralst/Desktop/screenshots/projects/valentin-romantic-agent/'
      '.claude/worktrees/deck-html-deepdive/docs/Valentin-Presentation-v6.pptx')
OUT = os.path.join(REPO, 'docs', 'Valentin-Presentation-v7.pptx')
TOTAL = 17

# ── transcript, rebudgeted to 10:00 exactly ──────────────────────────────────
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
    (25, 'Now the real content. Same product, built twice: engine A is the DIY '
         'build I own on Fargate; engine B is the same model on AgentCore. '
         'Everything from here judges those two engines through six lenses.'),
    (50, 'The whole section in one slide. Six lenses down the side; the four '
         'AgentCore components across the top, lit when they matter to that '
         'lens. Cost lights everything. Security is Runtime plus Gateway. '
         'Debuggability and latency go to DIY — four-two, and the two it '
         'loses are why this is a comparison and not a sales pitch.'),
    (35, 'Cost, at four scales. At one user the story is the floor: engine A '
         'bills eighteen dollars before anyone speaks; B bills a dime. At a '
         'million users the story is the meter: both bills are per-user, and '
         'B settles at eighteen times cheaper because extraction is part of '
         'the service, not a second model call. And A’s floor is not '
         'even fixed — it steps up with every forty concurrent sessions.'),
    (20, 'The bill, itemised — every rate from a pricing page, every quantity '
         'counted out of this repo. The reply call to Bedrock is identical on '
         'both sides, so I excluded it from both.'),
    (30, 'Resilience is Runtime plus Gateway. In-process, forty sessions share '
         'one Node process, one heap, one crash. A microVM per session and a '
         'Lambda per tool means a fault has nowhere to travel: one session '
         'lost, not forty.'),
    (25, 'The same fault, injected on both engines. Engine A loses all forty '
         'sessions — the process is the blast radius. Engine B loses exactly '
         'one: the caller. Three fault classes, same outcome every time.'),
    (30, 'Security — same two components, different question: not what '
         'crashes, but what leaks. Engine A holds every user’s '
         'credentials in one heap behind one shared IAM role; an injection '
         'that pivots reaches everyone’s tokens. Behind Gateway, auth '
         'resolves per tool and a hijacked session reaches only its own.'),
    (25, 'Ownership and velocity — Memory plus Gateway. On engine A the '
         'extraction prompt is mine to maintain forever, and adding a tool is '
         'a deploy. On B, extraction is the service’s problem and the '
         'tool list is data. The give-up is real: I lose the extraction '
         'schema I designed.'),
    (30, 'Debuggability the DIY build wins, and I will not skip it. '
         'Hand-wired OTEL emits exactly the fields that decide an incident at '
         'two in the morning. AgentCore’s traces are free, but on its '
         'schema. Where I landed: its traces as the floor, my spans on top.'),
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
    (10, 'That is Valentin. Happy to go deeper on any of the five lenses, or '
         'on the agent workflow that built it.'),
]

assert sum(n for n, _ in NOTES) == 600, sum(n for n, _ in NOTES)
assert len(NOTES) == TOTAL


NOTES_BODY_XML = """<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:nvSpPr>
    <p:cNvPr id="100" name="Notes Placeholder"/>
    <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
    <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
  </p:nvSpPr>
  <p:spPr/>
  <p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>
</p:sp>"""


def notes_frame(slide):
    """Some hand-edited v6 notes slides lost their body placeholder; restore it."""
    ns = slide.notes_slide
    if ns.notes_text_frame is None:
        import lxml.etree as etree
        ns.shapes._spTree.append(etree.fromstring(NOTES_BODY_XML))
    return ns.notes_text_frame


def set_notes(slide, i):
    dur = f'{NOTES[i][0] // 60}:{NOTES[i][0] % 60:02d}'
    secs = sum(n[0] for n in NOTES[:i + 1])
    cum = f'{secs // 60}:{secs % 60:02d}'
    notes_frame(slide).text = (
        f'[{dur} · cumulative {cum} of 10:00]\n\n{NOTES[i][1]}')


PAGENUM = re.compile(r'^\s*\d+\s*/\s*\d+\s*$')


def fix_chrome(slide, page, badge=None):
    """Update the baked page number and (optionally) the badge digit."""
    for sh in slide.shapes:
        if not sh.has_text_frame:
            continue
        txt = sh.text_frame.text
        if PAGENUM.match(txt):
            runs = sh.text_frame.paragraphs[0].runs
            runs[0].text = f'{page} / {TOTAL}'
            for extra in runs[1:]:
                extra.text = ''
        elif (badge is not None and txt.strip().isdigit()
              and sh.width < 914400 and sh.top < 1200000):
            # the badge digit: a small text box near the top-left corner
            runs = sh.text_frame.paragraphs[0].runs
            runs[0].text = str(badge)
            for extra in runs[1:]:
                extra.text = ''


def fix_typos(slide):
    fixes = {'what make it agentic': 'what makes it agentic',
             'Triger': 'Trigger'}
    n = 0
    for sh in slide.shapes:
        if not sh.has_text_frame:
            continue
        for p in sh.text_frame.paragraphs:
            for r in p.runs:
                for bad, good in fixes.items():
                    if bad in r.text:
                        r.text = r.text.replace(bad, good)
                        n += 1
    return n


def retitle(slide, old, new):
    for sh in slide.shapes:
        if sh.has_text_frame and sh.text_frame.text.strip() == old:
            runs = sh.text_frame.paragraphs[0].runs
            runs[0].text = new
            for extra in runs[1:]:
                extra.text = ''
            return True
    return False


def add_ops_slide(prs, layout, ops):
    s = prs.slides.add_slide(layout)
    for sh in list(s.shapes):
        sh._element.getparent().remove(sh._element)
    emit_pptx.render(s, ops)
    return s


def main():
    prs = Presentation(V6)
    slides = list(prs.slides)
    layout = min(prs.slide_layouts, key=lambda l: len(l.placeholders))

    typo_fixes = fix_typos(slides[2])

    # v6 order (1-based): 1 title · 2 problem · 3 workflow · 4 demo ·
    # 5 architecture diagram · 6 old compare table · 7 cost.png ·
    # 8 MSG_COMPUTE · 9 duplicate cost.png ("Compute — resilience") ·
    # 10 blast.png · 11 MSG_MEMORY · 12 MSG_GATEWAY · 13 MSG_OBS ·
    # 14 team.png · 15 graph.png · 16 lessons · 17 thanks
    retitle(slides[6], 'Compute — cost', 'Cost — the bill, itemised')

    PAGES = dict(cost=7, resil=9, security=11, ownership=12, debug=13)
    BADGES = dict(cost=6, resil=8, security=10, ownership=11, debug=12)
    new = [add_ops_slide(prs, layout, L.slide_matrix(6, TOTAL, 5))]
    new += [add_ops_slide(prs, layout, ops)
            for ops in L.all_lens_slides(TOTAL, PAGES, BADGES)]
    blast = add_ops_slide(prs, layout, L.slide_blast(10, TOTAL, 9))

    sld_lst = prs.slides._sldIdLst
    ids = list(sld_lst)
    keep = {i: ids[i] for i in range(17)}
    matrix, cost, resil, sec, own, debug, blast_id = ids[17:]

    order = [keep[0], keep[1], keep[2], keep[3], keep[4],   # 1-5
             matrix,                                        # 6
             cost, keep[6],                                 # 7, 8 (bill pic)
             resil, blast_id,                               # 9, 10 (native blast)
             sec, own, debug,                               # 11-13
             keep[13], keep[14], keep[15], keep[16]]        # 14-17

    for i in (5, 7, 8, 9, 10, 11, 12):                      # drop old block
        prs.part.drop_rel(keep[i].rId)
        sld_lst.remove(keep[i])

    for el in order:
        sld_lst.remove(el)
        sld_lst.append(el)

    # renumber the kept slides' baked chrome (badge, page number)
    final = list(prs.slides)
    fix_chrome(final[1], 2)                 # problem       badge 1 ok
    fix_chrome(final[2], 3)                 # workflow      badge 2 ok
    fix_chrome(final[3], 4)                 # demo          badge 3 ok
    fix_chrome(final[4], 5)                 # architecture  badge 4 ok
    # the hand-added architecture slide never had footer chrome; give it a
    # page number so the deck counts continuously
    import aws_slides as A
    emit_pptx.render(final[4], [('text', 11.30, 7.05, 1.50, 0.35,
                                 f'5 / {TOTAL}', 10, A.GREY, False, 'r', 'm')])
    fix_chrome(final[7], 8, badge=7)        # cost.png
    fix_chrome(final[13], 14, badge=13)     # team.png
    fix_chrome(final[14], 15, badge=14)     # graph.png
    fix_chrome(final[15], 16, badge=15)     # lessons

    # house rule: nothing below 10pt anywhere in the deck
    from pptx.util import Pt
    bumped = 0
    for s in final:
        for sh in s.shapes:
            if not sh.has_text_frame:
                continue
            for p in sh.text_frame.paragraphs:
                for r in p.runs:
                    if r.font.size is not None and r.font.size < Pt(10):
                        r.font.size = Pt(10)
                        bumped += 1

    for i, s in enumerate(final):
        set_notes(s, i)

    prs.save(OUT)
    print(f'fixed {typo_fixes} typo runs on the workflow slide')
    print(f'bumped {bumped} sub-10pt runs to 10pt')
    print(f'wrote {OUT}: {len(prs.slides._sldIdLst)} slides')


if __name__ == '__main__':
    main()
