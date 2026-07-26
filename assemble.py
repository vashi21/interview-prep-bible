#!/usr/bin/env python3
"""
Assemble a chapter fragment + registry metadata into a final self-contained
HTML file ready for the Artifact tool.

Usage:
  python3 assemble.py <chapter_num> [--out PATH]
  python3 assemble.py --all            # reassemble every chapter (relink pass)

Reads registry.json for metadata (title, part, description, favicon, url of
neighbours). Reads shell/theme.css, shell/components.css, shell/engine.js and
inlines them. Validates the fragment doesn't contain <style>, <script>, or
inline style="" (the "safer approach" from the spec: agents emit semantic
content only, the shell owns all presentation).
"""
import json, re, sys, os

ROOT = os.path.dirname(os.path.abspath(__file__))

def load_registry():
    with open(os.path.join(ROOT, "registry.json")) as f:
        return json.load(f)

def save_registry(reg):
    with open(os.path.join(ROOT, "registry.json"), "w") as f:
        json.dump(reg, f, indent=2)
        f.write("\n")

def read(path):
    with open(os.path.join(ROOT, path)) as f:
        return f.read()

def validate_fragment(html, num):
    problems = []
    if re.search(r"<style[\s>]", html, re.I):
        problems.append("contains a <style> tag — presentation must live in the shared shell only")
    if re.search(r"<script[\s>]", html, re.I):
        problems.append("contains a <script> tag — only data-diagram/data-cards JSON blocks are allowed")
    if re.search(r'style\s*=\s*"', html, re.I):
        problems.append("contains inline style=\"...\" attributes — use shared class names instead")
    if re.search(r"<html|<head|<body", html, re.I):
        problems.append("contains <html>/<head>/<body> — fragment must be content only")
    if problems:
        print(f"[ch{num:02d}] VALIDATION WARNINGS:")
        for p in problems:
            print(f"  - {p}")
    return problems

def find_chapter(reg, num):
    for c in reg["chapters"]:
        if c["num"] == num:
            return c
    raise KeyError(f"no chapter #{num} in registry")

def neighbours(reg, num):
    ordered = sorted([c for c in reg["chapters"] if c["num"] != 0], key=lambda c: c["num"])
    idx = next((i for i, c in enumerate(ordered) if c["num"] == num), None)
    prev_c = ordered[idx - 1] if idx is not None and idx > 0 else None
    next_c = ordered[idx + 1] if idx is not None and idx < len(ordered) - 1 else None
    hub = find_chapter(reg, 0)
    return prev_c, next_c, hub

PRINT_BTN = '<button type="button" class="print-btn" data-print-btn>Print / Save as PDF</button>'

def crumb_html(chapter, hub):
    hub_href = hub.get("url") or "#"
    if chapter["num"] == 0:
        return f'<nav class="crumb"><span>HLD Interview-Prep Bible</span><span class="sep">&rsaquo;</span><span>Index</span>{PRINT_BTN}</nav>'
    return (
        '<nav class="crumb">'
        f'<a href="{esc(hub_href)}">HLD Interview-Prep Bible</a>'
        '<span class="sep">&rsaquo;</span>'
        f'<span>{esc(chapter["part"])}</span>'
        '<span class="sep">&rsaquo;</span>'
        f'<span>Ch.{chapter["num"]}</span>'
        f'{PRINT_BTN}'
        '</nav>'
    )

def hero_html(reg):
    ch1 = find_chapter(reg, 1)
    ch1_href = ch1.get("url") or "#"
    total_chapters = len([c for c in reg["chapters"] if c["num"] != 0])
    return (
        '<header class="hero">'
        '<p class="hero-eyebrow">HLD Interview-Prep Bible</p>'
        '<h1 class="hero-title">From zero to ready for the room.</h1>'
        '<p class="hero-sub">A self-contained series that takes a reader with no system-design '
        'background to holding their own in an EM-level high-level-design interview. Read the '
        'concept chapters once, in order &mdash; then keep the problem bank and the rapid-fire '
        'index open as the reference you come back to before every round.</p>'
        '<div class="hero-actions">'
        f'<a class="hero-cta" href="{esc(ch1_href)}">Start with Chapter 1 &rarr;</a>'
        '<a class="hero-cta secondary" href="#chapters">Browse all chapters</a>'
        '</div>'
        '<div class="hero-stats">'
        f'<div class="stat"><strong>{total_chapters}</strong><span>Chapters</span></div>'
        '<div class="stat"><strong>90</strong><span>Full-depth problems</span></div>'
        '<div class="stat"><strong>199</strong><span>Rapid-fire index rows</span></div>'
        '</div>'
        '</header>'
    )

def titleblock_html(chapter):
    if chapter["num"] == 0:
        rows = [
            ("Volume", "HLD Interview-Prep Bible", True),
            ("Purpose", "Zero system-design knowledge &rarr; ready for an EM-level HLD interview loop.", False),
        ]
    else:
        rows = [
            ("Chapter", f'Ch.{chapter["num"]} &mdash; {esc(chapter["title"])}', True),
            ("Part", esc(chapter["part"]), False),
            ("Scope", esc(chapter["description"]), False),
        ]
    out = ['<div class="titleblock">']
    for key, val, big in rows:
        cls = "val big" if big else "val"
        out.append(f'<div class="row"><div class="key">{esc(key)}</div><div class="{cls}">{val}</div></div>')
    out.append('</div>')
    return "".join(out)

def pagenav_html(chapter, prev_c, next_c, hub):
    hub_href = hub.get("url") or "#"
    parts = ['<div class="pagenav">']
    if prev_c:
        href = prev_c.get("url") or "#"
        parts.append(f'<a href="{esc(href)}">&larr; Ch.{prev_c["num"]} {esc(prev_c["title"])}</a>')
    else:
        parts.append('<span></span>')
    parts.append(f'<a class="hub" href="{esc(hub_href)}">Index</a>')
    if next_c:
        href = next_c.get("url") or "#"
        parts.append(f'<a href="{esc(href)}">Ch.{next_c["num"]} {esc(next_c["title"])} &rarr;</a>')
    else:
        parts.append('<span></span>')
    parts.append('</div>')
    return "".join(parts)

def esc(s):
    return str(s)

def assemble(num, out_path=None):
    reg = load_registry()
    chapter = find_chapter(reg, num)
    frag_path = chapter["fragment"]
    if not os.path.exists(os.path.join(ROOT, frag_path)):
        print(f"[ch{num:02d}] SKIP — fragment not found at {frag_path}")
        return None
    fragment = read(frag_path)
    validate_fragment(fragment, num)

    prev_c, next_c, hub = neighbours(reg, num)
    theme_css = read("shell/theme.css")
    comp_css = read("shell/components.css")
    engine_js = read("shell/engine.js")

    if num == 0:
        title_tag = "HLD Bible — Index"
    else:
        title_tag = f'HLD Bible — Ch.{num} {chapter["title"]}'

    html = []
    html.append('<meta charset="utf-8">')
    html.append('<meta name="viewport" content="width=device-width, initial-scale=1">')
    html.append(f'<title>{title_tag}</title>')
    html.append("<style>")
    html.append(theme_css)
    html.append(comp_css)
    html.append("</style>")
    html.append('<div class="wrap">')
    html.append(crumb_html(chapter, hub))
    if num == 0:
        html.append(hero_html(reg))
    else:
        html.append(titleblock_html(chapter))
    html.append(fragment)
    if num != 0:
        html.append(pagenav_html(chapter, prev_c, next_c, hub))
    html.append(
        '<footer class="colophon"><p>HLD Interview-Prep Bible &middot; '
        f'{esc(chapter["part"])} &middot; Ch.{chapter["num"]}</p></footer>'
    )
    html.append("</div>")
    html.append("<script>")
    html.append(engine_js)
    html.append("</script>")

    out_path = out_path or f"published/ch{num:02d}.html"
    full_out = os.path.join(ROOT, out_path)
    with open(full_out, "w") as f:
        f.write("\n".join(html))
    print(f"[ch{num:02d}] assembled -> {out_path}")
    return full_out

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--all":
        reg = load_registry()
        for c in sorted(reg["chapters"], key=lambda c: c["num"]):
            assemble(c["num"])
    else:
        n = int(sys.argv[1])
        assemble(n)
