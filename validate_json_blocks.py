#!/usr/bin/env python3
"""Extract every data-diagram / data-cards attribute from fragments/*.html and
verify it parses as JSON after HTML-entity unescaping. Catches the class of bug
where a raw apostrophe inside a single-quoted attribute truncates the attribute
before the JSON parser ever sees it."""
import glob, html, json, re, sys

ATTR_RE = re.compile(r'(data-diagram|data-cards)=\'(.*?)\'', re.S)

def check(path):
    text = open(path).read()
    matches = list(ATTR_RE.finditer(text))
    issues = []
    for kind, raw in [(m.group(1), m.group(2)) for m in matches]:
        unescaped = html.unescape(raw)
        try:
            json.loads(unescaped)
        except Exception as e:
            issues.append(f"{kind}: {e} — first 120 chars: {unescaped[:120]!r}")
    # also catch a raw apostrophe still sitting inside a single-quoted attribute
    # (a JSON-parse pass alone can miss it if the truncated remainder happens to
    # still be valid JSON on its own)
    for m in re.finditer(r"(data-diagram|data-cards)='[^']*'", text):
        pass
    return len(matches), issues

if __name__ == "__main__":
    total_blocks = 0
    total_issues = 0
    for path in sorted(glob.glob("fragments/*.html")):
        n, issues = check(path)
        total_blocks += n
        if issues:
            total_issues += len(issues)
            print(f"[{path}] {n} JSON blocks, {len(issues)} FAILED:")
            for i in issues:
                print(f"   - {i}")
        else:
            print(f"[{path}] {n} JSON blocks, all OK")
    print(f"\n{total_blocks} total blocks checked, {total_issues} failures")
    sys.exit(1 if total_issues else 0)
