"""aws_slides.py — the AWS presentation template as data, with two emitters.

Slides are lists of primitive draw ops in inches on a 13.333x7.5in canvas. The
same ops render to HTML (for eyeballing layout in a browser, since PowerPoint
cannot be scripted to rasterise here) and to native python-pptx shapes (the
actual deliverable — editable text, not a flattened picture).

Template values are lifted from docs/Valentin-Presentation-v4.pptx so new slides
are indistinguishable from the ones already in the deck.

Ops:
  ('rect',  x, y, w, h, fill, line, radius)
  ('oval',  x, y, w, h, fill, line)
  ('text',  x, y, w, h, runs, size, color, bold, align, valign)
        runs: str, or [(text, bold, color_or_None), ...]
  ('arrow', x1, y1, x2, y2, color, width_pt)   straight, arrowhead at (x2,y2)
  ('arc',   x, y, w, h, start_deg, swing_deg, color, width_pt, arrow)
"""

W, H = 13.3333, 7.5

NAVY = '232F3E'
ORANGE = 'FF9900'
GREEN = '1E7C3C'
INK = '16191F'
GREY = '545B64'
CARD = 'F7F8FA'
BORDER = 'E4E7EA'
FAINT = 'FFEFD6'
WHITE = 'FFFFFF'
DARK_GREY = 'A6B0BA'   # footer text on a navy slide

FONT = 'Calibri'       # what the rest of the deck uses; keep it consistent
FOOTER = 'VALENTIN   ·   GenAI TFC Capstone Deep-Dive'


def chrome(page, total, badge=None, dark=False):
    """Background + badge + footer + page number, exactly where v4 puts them."""
    ops = [('rect', 0, 0, W, H, NAVY if dark else WHITE, None, 0)]
    if badge is not None:
        ops += [
            ('oval', 0.55, 0.40, 0.65, 0.65, ORANGE if dark else NAVY, None),
            ('text', 0.55, 0.40, 0.65, 0.65, str(badge), 26,
             NAVY if dark else ORANGE, True, 'c', 'm'),
        ]
    foot = DARK_GREY if dark else GREY
    ops += [
        ('text', 0.55, 7.05, 9.00, 0.35, FOOTER, 10, foot, True, 'l', 'm'),
        ('text', 11.30, 7.05, 1.50, 0.35, f'{page} / {total}', 10, foot, False, 'r', 'm'),
    ]
    return ops


def heading(title, subtitle=None, dark=False):
    """Title + the template's 1.5in orange rule + optional subtitle.

    Long titles drop to 24pt rather than wrapping — a second line lands on the
    orange rule.
    """
    size = 30 if len(title) <= 44 else 24
    ops = [
        ('text', 1.40, 0.40, 11.00, 0.65, title, size, WHITE if dark else NAVY, True, 'l', 'm'),
        ('rect', 0.55, 1.15, 1.50, 0.04, ORANGE, None, 0),
    ]
    if subtitle:
        ops.append(('text', 0.55, 1.40, 12.20, 0.42, subtitle, 14,
                    DARK_GREY if dark else GREY, False, 'l', 't'))
    return ops


def pill(x, y, w, h, label, fill, color=WHITE, size=9):
    return [
        ('rect', x, y, w, h, fill, None, 0.13),
        ('text', x, y, w, h, label, size, color, True, 'c', 'm'),
    ]


def outline_pill(x, y, w, h, label, color=ORANGE, size=10):
    return [
        ('rect', x, y, w, h, None, color, 0.13),
        ('text', x, y, w, h, label, size, color, True, 'c', 'm'),
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Slide 5 — the first comparison: one row per decision, per deep-dive.
# ─────────────────────────────────────────────────────────────────────────────

COLS = [(0.62, 2.22), (2.92, 3.48), (6.47, 3.48), (10.02, 2.70)]
COL_LABELS = ['THE DECISION', 'ENGINE A · GLUE CODE', 'ENGINE B · AGENTCORE',
              'WHAT SETTLES IT']

ROWS = [
    dict(dim='Compute', svc='AgentCore Runtime',
         a='One Fargate task, 0.5 vCPU, billed 730 h a month whether anyone '
           'talks to Valentin or not. Forty live sessions share one Node '
           'process and one heap.',
         b='One microVM per session, billed per second of actual agent work. '
           'A process-level fault has nowhere to travel.',
         win='AGENTCORE', num='40 → 1', cap='sessions lost to one process fault'),
    dict(dim='Memory', svc='AgentCore Memory',
         a='DynamoDB, plus a second Bedrock call every turn to extract '
           'preferences — an extraction prompt I own and maintain.',
         b='One event in, one retrieval out. Extraction is part of the '
           'service, not a second model call.',
         win='AGENTCORE', num='14×', cap='cheaper per user, per month'),
    dict(dim='Tool use', svc='AgentCore Gateway',
         a='An in-process tool registry — a process-wide singleton holding '
           'every user’s credentials in the same heap as every session.',
         b='Three tools indexed outside the process, auth resolved per tool. '
           'Adding a tool stops being a deploy.',
         win='AGENTCORE', num='$0.0006', cap='the only fixed line on the bill'),
    dict(dim='Observability', svc='AgentCore Observability',
         a='Hand-wired OTEL spans emit exactly the fields I debug with: turn '
           'id, tool name, extraction latency, which reminder fired.',
         b='Session traces for free, but on AgentCore’s schema — not the '
           'fields I actually reach for.',
         win='GLUE CODE', num='the one', cap='dimension the DIY side wins'),
]


def slide_compare(page, total, badge):
    ops = chrome(page, total, badge)
    ops += heading(
        'Architecture — four decisions, four deep-dives',
        'Same product, two engines. Each row is one decision, the deep-dive '
        'that follows it, and the single number that settles it.')

    hy, rh, top = 1.95, 1.06, 2.41
    ops.append(('rect', 0.62, hy, 12.10, 0.42, NAVY, None, 0.06))
    for (cx, cw), lab in zip(COLS, COL_LABELS):
        ops.append(('text', cx + 0.18, hy, cw - 0.36, 0.42, lab, 10.5, ORANGE
                    if lab == 'THE DECISION' else WHITE, True, 'l', 'm'))

    for i, r in enumerate(ROWS):
        y = top + i * rh
        if i % 2 == 0:
            ops.append(('rect', 0.62, y, 12.10, rh, CARD, None, 0))
        ops.append(('rect', 0.62, y + rh - 0.01, 12.10, 0.01, BORDER, None, 0))

        c0, c1, c2, c3 = COLS
        ops += [
            ('text', c0[0] + 0.18, y + 0.14, c0[1] - 0.30, 0.30, r['dim'], 15,
             NAVY, True, 'l', 't'),
            ('text', c0[0] + 0.18, y + 0.46, c0[1] - 0.30, 0.26, r['svc'], 10,
             GREY, False, 'l', 't'),
            ('text', c1[0] + 0.06, y + 0.13, c1[1] - 0.24, rh - 0.26, r['a'],
             11.5, INK, False, 'l', 't'),
            ('text', c2[0] + 0.06, y + 0.13, c2[1] - 0.24, rh - 0.26, r['b'],
             11.5, INK, False, 'l', 't'),
        ]
        won_green = r['win'] == 'AGENTCORE'
        ops += pill(c3[0] + 0.06, y + 0.14, 1.36, 0.24, r['win'],
                    GREEN if won_green else NAVY)
        ops += [
            ('text', c3[0] + 0.06, y + 0.42, c3[1] - 0.18, 0.34, r['num'], 17,
             ORANGE, True, 'l', 't'),
            ('text', c3[0] + 0.06, y + 0.76, c3[1] - 0.18, 0.24, r['cap'], 9.5,
             GREY, False, 'l', 't'),
        ]

    # One line at 12.5pt, or it spills into the footer.
    banner = ('Three of four go to AgentCore. The fourth is the honest half: '
              'observability is where hand-wired spans still win.')
    ops += [
        ('rect', 0.62, 6.58, 12.10, 0.42, ORANGE, None, 0.10),
        ('text', 0.82, 6.58, 11.70, 0.42, banner, 12.5, NAVY, True, 'l', 'm'),
    ]
    return ops


# ─────────────────────────────────────────────────────────────────────────────
# Message-only deep-dive placeholders.
# ─────────────────────────────────────────────────────────────────────────────

def slide_messages(page, total, badge, title, subtitle, messages, note=None):
    """One placeholder: the מסרים only, no designed layout yet."""
    ops = chrome(page, total, badge)
    ops += heading(title, subtitle)
    # On the subtitle line, not beside the title — titles here run long enough to
    # collide with anything parked at the top right.
    ops += outline_pill(9.90, 1.36, 2.85, 0.30,
                        'PLACEHOLDER · MESSAGES ONLY', ORANGE, 9.5)

    top, rh = 2.00, 0.90
    for i, (lead, rest) in enumerate(messages):
        y = top + i * rh
        ops += [
            ('rect', 0.62, y + 0.02, 0.34, 0.30, NAVY, None, 0.06),
            ('text', 0.62, y + 0.02, 0.34, 0.30, str(i + 1), 12, ORANGE, True, 'c', 'm'),
            ('text', 1.10, y, 11.62, rh - 0.06,
             [(lead + ' ', True, NAVY), (rest, False, INK)], 14.5, INK, False, 'l', 't'),
        ]
    if note:
        ops.append(('text', 0.62, 6.60, 12.10, 0.40, note, 10.5, GREY, False, 'l', 't'))
    return ops


MSG_COMPUTE = [
    ('Engine A never scales to zero.',
     'One Fargate task at 0.5 vCPU bills 730 hours a month whether anyone talks '
     'to Valentin or not — $18.02 before the first turn.'),
    ('Engine B bills per second of real work.',
     '3 s × 104 turns is $0.0047 a month. The floor disappears entirely; '
     'that is the whole of the cost difference at one user.'),
    ('AgentCore’s unit price is worse, not better.',
     'Runtime is 2.20× dearer per vCPU-hour. It wins on billing '
     'granularity, and only on billing granularity — say this before '
     'anyone checks.'),
    ('The real difference is isolation, not money.',
     'One microVM per session, versus forty sessions sharing one Node process, '
     'one heap and one event loop. The next slide is that experiment.'),
    ('What you give up.',
     'Control of the container: no sidecars, no long-lived in-process cache, '
     'and a cold start on the first turn of an idle session.'),
]

MSG_MEMORY = [
    ('Engine A pays a second model call per turn.',
     'Extracting preferences needs its own Bedrock invocation — $1.385 per '
     'user per month, and an extraction prompt that is mine to maintain forever.'),
    ('AgentCore Memory folds extraction into the service.',
     'One event written, one retrieval read per turn: $0.098 per user per month, '
     '14× cheaper, and one fewer prompt to own.'),
    ('It is not cheap storage — it is a replaced call.',
     'Per turn, Memory is roughly 124× DynamoDB’s price. It only wins '
     'because it removes the extraction call, and that is the argument to make.'),
    ('One unresolved risk, worth flagging out loud.',
     'If retrievals meter per record rather than per call, engine B becomes '
     '3.8× worse. Confirm with the service team before quoting any figure.'),
    ('What you give up.',
     'The extraction schema. DynamoDB let me define exactly what counts as a '
     'preference — including preferenceCategoryCount, which nothing managed '
     'would have given me.'),
]

MSG_GATEWAY = [
    ('The in-process registry is the worst thing in engine A.',
     'A process-wide singleton holds every user’s credentials in the same '
     'heap as every live session.'),
    ('That is the highest-severity finding in the comparison.',
     'An injection that pivots to the registry reaches the shared Bedrock client '
     'and everyone’s tokens — not just the attacker’s own session.'),
    ('Gateway moves the tool surface out of the process.',
     'Three tools indexed, auth resolved per tool, $0.0006 a month — the '
     'only fixed line on the entire AgentCore bill.'),
    ('It also turns the tool list into data.',
     'Adding or revoking a tool stops being a deploy, which is what actually '
     'changes how fast the agent can grow.'),
    ('What you give up.',
     'In-process latency, and the freedom to hand a tool an arbitrary Node '
     'object instead of a serialisable contract.'),
]

# ─────────────────────────────────────────────────────────────────────────────
# What I learned — the five takeaways, designed (not a placeholder).
# ─────────────────────────────────────────────────────────────────────────────

LESSONS = [
    ('An agent is a loop, not a chatbot.',
     'The agentic part of Valentin isn’t Claude — it’s trigger → tools → propose '
     '→ extract → re-schedule, and every pass rewrites the timeline that feeds '
     'the next one. EventBridge closes the loop, not the model.'),
    ('When you and the agent are both stuck, the next prompt is not the answer.',
     'Stop and spend five minutes with pen and paper. Every long débâcle in this '
     'project ended the moment I stopped prompting and drew the thing.'),
    ('Most of the tokens went to the workflow, not the code.',
     '31 of 56 PRs built the factory — specs, review loops, merge gates, '
     'regression tests for the automation itself. That is what made the other '
     '25 safe to merge.'),
    ('The strongest case for AgentCore isn’t the bill, it’s the blast radius.',
     'In-process, one crashed tool takes down all 40 sessions and one shared IAM '
     'role means a prompt injection can touch everything. Behind Gateway each '
     'tool is its own Lambda with its own role — a failure or a hijack is '
     'contained to 1-of-40.'),
    ('It’s easy to gate “the service is up,” hard to gate “the LLM works.”',
     'A missing Bedrock permission returned a polite fallback with HTTP 200; a '
     '# in the actorId made Memory silently store nothing while chat kept '
     'chatting. The only gate that caught either was a live conversation '
     'asserting on what the agent remembered.'),
]


def slide_lessons(page, total, badge):
    ops = chrome(page, total, badge)
    ops += heading(
        'What I learned',
        'Five things I would tell the next person building one of these — three '
        'about the agent, two about building it.')

    y, ch, gap = 1.86, 0.88, 0.06
    for i, (lead, body) in enumerate(LESSONS):
        t = y + i * (ch + gap)
        ops += [
            ('rect', 0.62, t, 12.10, ch, CARD, BORDER, 0.06),
            ('rect', 0.62, t, 0.07, ch, ORANGE, None, 0),
            ('text', 0.78, t, 0.46, ch, str(i + 1), 20, ORANGE, True, 'c', 'm'),
            ('text', 1.32, t + 0.07, 11.24, ch - 0.14,
             [(lead + '  ', True, NAVY), (body, False, INK)],
             12.5, INK, False, 'l', 'm'),
        ]
    return ops


MSG_OBS = [
    ('This is the one dimension the DIY side wins.',
     'Say it plainly — a comparison that goes 4–0 is a sales pitch, and '
     'this one does not.'),
    ('Hand-wired OTEL emits exactly the fields I debug with.',
     'Turn id, tool name, extraction latency, which reminder fired, which '
     'partner profile was in flight.'),
    ('AgentCore Observability gives traces for free — on its schema.',
     'Session-level traces arrive with no work at all, but the fields I actually '
     'reach for at 2am are not the ones it emits.'),
    ('The DIY cost here is real, not rhetorical.',
     'I wrote the span plumbing and now maintain it, and CloudWatch is another '
     'bill and another place to go looking.'),
    ('Where I actually landed.',
     'Take AgentCore’s traces as the floor, and keep hand-wired spans for '
     'the two or three fields that decide an incident.'),
]
