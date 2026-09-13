#!/usr/bin/env python3
"""The numbers both team slides quote, read from one place.

Everything here comes out of the snapshot that
``scripts/generate-agent-graph.py --refresh`` writes, so the personas slide, the
PR-graph slide and the graph image itself cannot disagree with each other.

Two figures are not in the snapshot and are passed in from the test runners:
``UNIT_TESTS`` (``npm test``) and ``E2E_SPECS`` (``npx playwright test --list``).
Re-run those two commands when you re-render a slide.

Usage:  python3 scripts/deck_stats.py     # print every figure
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "docs" / "assets" / "graph" / "pr-history.json"

# Measured 2026-09-13. `npm test` → 3756 passed, 110 skipped, 207 files.
UNIT_TESTS = 3756
# `npx playwright test --list` → 32 tests in 6 files, chromium only.
E2E_SPECS = 32


def _graph_module():
    """Import the graph generator for its lane-attribution rules."""
    spec = importlib.util.spec_from_file_location(
        "agent_graph", ROOT / "scripts" / "generate-agent-graph.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load() -> dict:
    graph = _graph_module()
    snap = json.loads(SNAPSHOT.read_text())
    prs = snap["prs"]
    for pr in prs:
        pr["agent"] = graph.agent_of(pr)

    authored = Counter(pr["agent"] for pr in prs)
    reviewed: Counter = Counter()
    for pr in prs:
        for key in (pr.get("by") or {}):
            if key != pr["agent"]:
                reviewed[key] += 1

    return {
        "prs": len(prs),
        "merged": sum(1 for pr in prs if pr["m"]),
        "closed": sum(1 for pr in prs if pr["st"] == "CLOSED"),
        "open": sum(1 for pr in prs if pr["st"] == "OPEN"),
        "commits": snap["commits"],
        "merge_commits": snap["merges"],
        "comments": sum(pr["nc"] for pr in prs),
        "added": sum(pr["add"] for pr in prs),
        "removed": sum(pr["del"] for pr in prs),
        "files": sum(pr["cf"] for pr in prs),
        "peak_open": graph.peak_concurrency(prs),
        "longest_thread": max(len(pr["thread"]) for pr in prs),
        "authored": dict(authored),
        "reviewed": dict(reviewed),
        "unit_tests": UNIT_TESTS,
        "e2e_specs": E2E_SPECS,
    }


if __name__ == "__main__":
    for key, value in load().items():
        print(f"{key:16} {value}")
