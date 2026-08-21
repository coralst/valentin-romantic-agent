#!/usr/bin/env python3
"""Persona header format — THE single Python matcher.

===============================================================================
MIRRORED IN JAVASCRIPT: .kiro/skills/shared/persona-format.js
Both implementations are driven by the SAME fixture file,
.kiro/skills/shared/persona-fixtures.json, and both ship a ``--selfcheck`` that
replays every case in it. If you change the pattern here, change it there and run
both self-checks. The fixture is the contract.

    node .kiro/skills/shared/persona-format.js --selfcheck
    python3 scripts/persona_format.py --selfcheck

Read the JS module's header comment for the full rationale and the per-era
justification; it is the primary write-up and is not duplicated here.
===============================================================================

Canonical form -- the only form accepted going forward::

    **<emoji> <Persona>** — <subject>

Two modes:

``strict``
    The live workflow (merge gate, turn routing). Only the canonical form
    attributes an author.

``lenient``
    ``strict`` plus the historical drift eras, for BACKFILL ONLY -- reading
    attribution off comments that already exist and can never be rewritten
    (``scripts/generate-agent-graph.py``). Never used for a gate decision.

Drift eras, summarised (see the JS module for the reasoning):

1. PRs 57-58 ``**Master Agent** --- Code Review`` (no emoji) -- lenient only.
2. PRs 61-62 ``## Review: Architecture Lead`` (heading + role aliases) -- lenient only.
3. PRs 63-66 bare ``APPROVED-BY-MASTER-AGENT``, no header -- REJECTED IN BOTH
   MODES. These four merged through a gate that should have stopped them;
   backfilling them would launder a real bypass.
4. PRs 49-50 no header at all -- REJECTED IN BOTH MODES, no signal to recover.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE_PATH = ROOT / ".kiro" / "skills" / "shared" / "persona-fixtures.json"

_FIXTURES = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

#: Canonical agent table, keyed by the agent handle used throughout the skills.
AGENTS: dict[str, dict] = _FIXTURES["agents"]
AGENT_KEYS: list[str] = list(AGENTS)
CANONICAL_FORM: str = _FIXTURES["canonicalForm"]

#: Persona display name (lowercased) -> agent handle. Canonical names only.
NAME_TO_KEY = {defn["name"].lower(): key for key, defn in AGENTS.items()}

#: Handle -> the short key the contribution graph uses for its lanes.
GRAPH_KEY = {key: defn["graphKey"] for key, defn in AGENTS.items()}

#: Historical role aliases from the ``## Review:`` era (PRs 61-62). Explicit,
#: deliberately not fuzzy: every entry appeared in this repo's real history.
LEGACY_ALIASES = {
    "architecture lead": "system-architect",
    "architect": "system-architect",
    "backend developer": "backend-dev",
    "frontend developer": "frontend-dev",
    "master approval": "master-agent",
    "master": "master-agent",
    "designer": "ui-designer",
    "qa": "qa-agent",
}

# Emoji run: pictographic chars plus the variation selectors / ZWJ that ride
# along (🏗️ is 🏗 + U+FE0F; this repo's history contains both spellings).
# Python's `re` has no \p{Extended_Pictographic}, so the ranges are spelled out.
_EMOJI_RUN = (
    r"(?:[\U0001F000-\U0001FAFF☀-➿⬀-⯿"
    r"︎️‍←-⇿⌀-⏿])+"
)

#: CANONICAL: ``**<emoji> <Persona>** …`` at the start of a line.
CANONICAL_RE = re.compile(
    r"^\*\*\s*" + _EMOJI_RUN + r"\s*([A-Za-z][A-Za-z .'-]*?)\s*\*\*"
)

#: DRIFT 1: ``**<Persona>** …`` -- bold name, no emoji (PRs 57-58).
NO_EMOJI_RE = re.compile(r"^\*\*\s*([A-Za-z][A-Za-z .'-]*?)\s*\*\*")

#: DRIFT 2: ``## Review: <Role>`` -- heading form (PRs 61-62).
REVIEW_HEADING_RE = re.compile(r"^#{1,6}\s*Review:\s*(.+?)\s*$")

#: Fenced code blocks, so a quoted EXAMPLE of the header is not read as a real
#: signature.
_FENCE_RE = re.compile(r"^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[ \t]*$", re.MULTILINE)

_PARENTHETICAL_RE = re.compile(r"\s*\([^)]*\)\s*$")


def _resolve_name(raw: str | None, allow_aliases: bool) -> str | None:
    """Resolve a captured persona/role string to an agent handle."""
    if not isinstance(raw, str):
        return None
    # Drop a trailing parenthetical: "Master (Initial Review)" -> "Master".
    cleaned = " ".join(_PARENTHETICAL_RE.sub("", raw).split()).strip().lower()
    if not cleaned:
        return None
    if cleaned in NAME_TO_KEY:
        return NAME_TO_KEY[cleaned]
    if allow_aliases and cleaned in LEGACY_ALIASES:
        return LEGACY_ALIASES[cleaned]
    return None


def identify_persona(body: str | None, mode: str = "strict") -> str | None:
    """Identify the persona that authored a comment body.

    :param body: the full comment body.
    :param mode: ``"strict"`` for any gate/routing decision, ``"lenient"`` only
        to backfill historical attribution.
    :returns: an agent handle (e.g. ``"master-agent"``), or ``None`` when the
        body carries no recognized persona header.
    """
    if not isinstance(body, str) or not body.strip():
        return None
    lenient = mode == "lenient"

    # Only the first few non-empty lines count: a signature sits at the TOP of a
    # comment. Scanning the whole body is what let a mere mention of a persona
    # satisfy the old gate.
    lines = [ln.strip() for ln in _FENCE_RE.sub("", body).split("\n")]
    lines = [ln for ln in lines if ln][:4]

    for line in lines:
        canonical = CANONICAL_RE.match(line)
        if canonical:
            key = _resolve_name(canonical.group(1), allow_aliases=False)
            if key:
                return key
            # A bold-emoji header naming someone unknown is a protocol error,
            # not a reason to keep scanning further down the comment.
            return None
        if lenient:
            no_emoji = NO_EMOJI_RE.match(line)
            if no_emoji:
                key = _resolve_name(no_emoji.group(1), allow_aliases=False)
                if key:
                    return key
            heading = REVIEW_HEADING_RE.match(line)
            if heading:
                key = _resolve_name(heading.group(1), allow_aliases=True)
                if key:
                    return key
    return None


def graph_key(agent_key: str | None) -> str | None:
    """Map an agent handle to the short key the contribution graph uses."""
    return GRAPH_KEY.get(agent_key) if agent_key else None


def identify_graph_key(body: str | None, mode: str = "lenient") -> str | None:
    """Convenience for the graph: body -> lane key. Lenient by default, because
    the graph's job is backfilling a record that already exists."""
    return graph_key(identify_persona(body, mode=mode))


def format_header(agent_key: str, subject: str | None = None) -> str:
    """Build a canonical header line -- the single place the format is WRITTEN."""
    defn = AGENTS.get(agent_key)
    if defn is None:
        raise KeyError(f"Unknown agent key: {agent_key}")
    head = f"**{defn['emoji']} {defn['name']}**"
    return f"{head} — {subject}" if subject else head


def self_check() -> tuple[int, list[str]]:
    """Replay every fixture case in both modes. Shared with the JS mirror."""
    failures: list[str] = []
    passed = 0
    for case in _FIXTURES["cases"]:
        for mode in ("strict", "lenient"):
            expected = case.get(mode)
            actual = identify_persona(case["header"], mode=mode)
            if actual != expected:
                failures.append(
                    f"[{mode}] {case['name']}: expected {expected!r}, got {actual!r}"
                )
            else:
                passed += 1
    return passed, failures


def main() -> None:
    if "--selfcheck" in sys.argv:
        passed, failures = self_check()
        if failures:
            print(f"persona_format selfcheck FAILED ({len(failures)}):", file=sys.stderr)
            for f in failures:
                print("  " + f, file=sys.stderr)
            raise SystemExit(1)
        print(f"persona_format selfcheck OK — {passed} assertions")
        raise SystemExit(0)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(
            'Usage: python3 scripts/persona_format.py [--selfcheck] "<comment body>"',
            file=sys.stderr,
        )
        raise SystemExit(1)
    body = args[0]
    print(
        json.dumps(
            {
                "strict": identify_persona(body, mode="strict"),
                "lenient": identify_persona(body, mode="lenient"),
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
