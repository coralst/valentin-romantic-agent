#!/usr/bin/env python3
"""Print the title, lane and file count of every PR a slide cites.

Every `#N` on a deck slide has to survive being read aloud, so check it against
the snapshot before shipping the slide.

Usage:  python3 scripts/check-cited-prs.py 2 41 44 58
"""

import importlib.util
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "docs" / "assets" / "graph" / "pr-history.json"

spec = importlib.util.spec_from_file_location(
    "agent_graph", ROOT / "scripts" / "generate-agent-graph.py")
graph = importlib.util.module_from_spec(spec)
spec.loader.exec_module(graph)

prs = {pr["n"]: pr for pr in json.loads(SNAPSHOT.read_text())["prs"]}

for arg in sys.argv[1:]:
    pr = prs.get(int(arg))
    if pr is None:
        print(f"#{arg}  MISSING from the snapshot")
        continue
    print(f"#{pr['n']:<4} {graph.agent_of(pr):10} {pr['st']:7} "
          f"{pr['cf']:>4} files  {pr['t'][:64]}")
