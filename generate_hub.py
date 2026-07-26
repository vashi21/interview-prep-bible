#!/usr/bin/env python3
"""Generate the Ch.0 hub fragment (claude.ai-artifact-URL links) from
registry.json, for assemble.py's standalone-page pipeline. Deterministic,
re-runnable if registry.json changes. The personal-site SPA build
(build_spa.py) calls hub_content.build_hub_body() directly with hash-route
links instead of reading this generated file."""
import json, os
from hub_content import build_hub_body

ROOT = os.path.dirname(os.path.abspath(__file__))
reg = json.load(open(ROOT + "/registry.json"))

fragment = build_hub_body(reg, href_for=lambda c: c.get("url") or "#")
open(ROOT + "/fragments/ch00-hub.html", "w").write(fragment)
chapters_count = len([c for c in reg["chapters"] if c["num"] != 0])
print(f"Wrote fragments/ch00-hub.html ({chapters_count} chapters listed)")
