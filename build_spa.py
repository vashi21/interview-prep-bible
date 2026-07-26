#!/usr/bin/env python3
"""
Build the personal-site single-page app: one self-contained site/index.html
with client-side hash routing (#/hld, #/hld/ch1 ... #/hld/ch22), so it works
on plain static hosting (GitHub Pages, or just opening the file) with zero
server config and no separate page loads per chapter.

Reuses registry.json + fragments/*.html (same source of truth as assemble.py,
the Claude-Artifact publisher) but generates hash-route hrefs instead of
claude.ai artifact URLs, and bundles everything (CSS/JS/content) into one file
instead of one file per chapter. assemble.py itself is untouched — the two
build targets are independent so the live Artifact links never move.

Usage: python3 build_spa.py
"""
import hashlib, json, os, urllib.parse
from assemble import load_registry, find_chapter, read, esc, titleblock_html, PRINT_BTN
from hub_content import build_hub_body

ROOT = os.path.dirname(os.path.abspath(__file__))


def route_for(num):
    return "#/hld" if num == 0 else "#/hld/ch{}".format(num)


def crumb_site(chapter):
    if chapter["num"] == 0:
        return (
            '<nav class="crumb"><a href="#/">Interview-Prep Bible</a>'
            '<span class="sep">&rsaquo;</span><span>HLD</span>'
            f'{PRINT_BTN}</nav>'
        )
    return (
        '<nav class="crumb">'
        '<a href="#/">Interview-Prep Bible</a>'
        '<span class="sep">&rsaquo;</span>'
        '<a href="#/hld">HLD</a>'
        '<span class="sep">&rsaquo;</span>'
        f'<span>{esc(chapter["part"])}</span>'
        '<span class="sep">&rsaquo;</span>'
        f'<span>Ch.{chapter["num"]}</span>'
        f'{PRINT_BTN}'
        '</nav>'
    )


def hero_site(reg):
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
        '<a class="hero-cta" href="#/hld/ch1">Start with Chapter 1 &rarr;</a>'
        '<a class="hero-cta secondary" href="#chapters">Browse all chapters</a>'
        '</div>'
        '<div class="hero-stats">'
        f'<div class="stat"><strong>{total_chapters}</strong><span>Chapters</span></div>'
        '<div class="stat"><strong>90</strong><span>Full-depth problems</span></div>'
        '<div class="stat"><strong>199</strong><span>Rapid-fire index rows</span></div>'
        '</div>'
        '</header>'
    )


def pagenav_site(chapter, prev_c, next_c):
    parts = ['<div class="pagenav">']
    if prev_c:
        parts.append(f'<a href="{route_for(prev_c["num"])}">&larr; Ch.{prev_c["num"]} {esc(prev_c["title"])}</a>')
    else:
        parts.append('<span></span>')
    parts.append('<a class="hub" href="#/hld">Index</a>')
    if next_c:
        parts.append(f'<a href="{route_for(next_c["num"])}">Ch.{next_c["num"]} {esc(next_c["title"])} &rarr;</a>')
    else:
        parts.append('<span></span>')
    parts.append('</div>')
    return "".join(parts)


def footer_site(chapter):
    return (
        '<footer class="colophon"><p>HLD Interview-Prep Bible &middot; '
        f'{esc(chapter["part"])} &middot; Ch.{chapter["num"]}</p></footer>'
    )


VOLUME_SELECTOR_HTML = (
    '<div class="wrap">'
    '<header class="hero">'
    '<p class="hero-eyebrow">Interview-Prep Bible</p>'
    '<h1 class="hero-title">Pick a track.</h1>'
    '<p class="hero-sub">Two self-contained interview-prep tracks living under one roof. '
    'Start with whichever round you are actually facing next.</p>'
    '<div class="volume-grid">'
    '<a class="volume-card" href="#/hld">'
    '<span class="volume-card-tag">Available</span>'
    '<h2>HLD</h2>'
    '<p>High-level design. From zero system-design knowledge to an EM-level interview bar. '
    '22 chapters, 90 full problems, a 199-row rapid-fire index.</p>'
    '</a>'
    '<div class="volume-card disabled">'
    '<span class="volume-card-tag">Coming soon</span>'
    '<h2>LLD</h2>'
    '<p>Low-level / object-oriented design rounds. Not published yet.</p>'
    '</div>'
    '</div>'
    '</header>'
    '<footer class="site-footer">HLD Interview-Prep Bible</footer>'
    '</div>'
)


def favicon_href():
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="90" font-size="90">\U0001F4DA</text></svg>'
    return "data:image/svg+xml," + urllib.parse.quote(svg)


def safe_for_inline_script(json_str):
    # A literal "</script" inside embedded JSON would close the tag early.
    return json_str.replace("</script", "<\\/script")


def manifest_json():
    return json.dumps({
        "name": "HLD Interview-Prep Bible",
        "short_name": "HLD Bible",
        "description": "From zero to ready for the room — a self-contained HLD interview-prep series.",
        "start_url": "./",
        "scope": "./",
        "id": "./",
        "display": "standalone",
        "background_color": "#F3F6F8",
        "theme_color": "#0D2542",
        "icons": [
            {"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
    }, indent=2)


def service_worker_js(version):
    # Cache-first for the app shell, versioned by a hash of the actual content
    # (routes + titles) — every rebuild that changes a chapter gets a fresh
    # cache name automatically, so installed/offline copies pick up the update
    # on next launch instead of being stuck on stale content forever.
    return (
        "var CACHE = 'hld-bible-" + version + "';\n"
        "var SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];\n"
        "self.addEventListener('install', function(e){\n"
        "  self.skipWaiting();\n"
        "  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL); }));\n"
        "});\n"
        "self.addEventListener('activate', function(e){\n"
        "  e.waitUntil(caches.keys().then(function(keys){\n"
        "    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));\n"
        "  }).then(function(){ return self.clients.claim(); }));\n"
        "});\n"
        "self.addEventListener('fetch', function(e){\n"
        "  if (e.request.method !== 'GET') return;\n"
        "  e.respondWith(caches.match(e.request).then(function(hit){\n"
        "    return hit || fetch(e.request).then(function(res){\n"
        "      var copy = res.clone();\n"
        "      caches.open(CACHE).then(function(c){ c.put(e.request, copy); });\n"
        "      return res;\n"
        "    }).catch(function(){ return caches.match('./index.html'); });\n"
        "  }));\n"
        "});\n"
    )


def build():
    reg = load_registry()
    chapters = sorted([c for c in reg["chapters"] if c["num"] != 0], key=lambda c: c["num"])
    hub = find_chapter(reg, 0)

    theme_css = read("shell/theme.css")
    comp_css = read("shell/components.css")
    site_css = read("shell/site.css")
    engine_js = read("shell/engine.js")
    # annotate_js before router_js: both defer their DOM setup to
    # DOMContentLoaded, and router's boot() calls HLDBibleAnnotate.mount()
    # immediately — mount() needs the toolbar annotate.js builds to already
    # exist, so annotate's listener must be registered (and fire) first.
    annotate_js = read("shell/annotate.js")
    router_js = read("shell/router.js")

    routes = {}
    titles = {}

    hub_body = build_hub_body(reg, href_for=lambda c: route_for(c["num"]))
    routes["hub"] = (
        '<div class="wrap">' + crumb_site(hub) + hero_site(reg) + hub_body +
        '<footer class="site-footer">HLD Interview-Prep Bible</footer></div>'
    )
    titles["hub"] = "HLD Bible — Index"

    for i, c in enumerate(chapters):
        frag = read(c["fragment"])
        prev_c = chapters[i - 1] if i > 0 else None
        next_c = chapters[i + 1] if i < len(chapters) - 1 else None
        page = (
            '<div class="wrap">'
            + crumb_site(c)
            + titleblock_html(c)
            + frag
            + pagenav_site(c, prev_c, next_c)
            + footer_site(c)
            + '</div>'
        )
        key = f"ch{c['num']}"
        routes[key] = page
        titles[key] = f'HLD Bible — Ch.{c["num"]} {c["title"]}'

    # Hash covers the shell code too (not just chapter content) — a fix to
    # engine.js/router.js/annotate.js/*.css must bump this, or the service
    # worker's cache name stays byte-identical and installed/offline copies
    # never see the update (see service_worker_js: cache-first by name).
    version = hashlib.sha1((
        json.dumps(routes) + json.dumps(titles) +
        theme_css + comp_css + site_css + engine_js + router_js + annotate_js
    ).encode()).hexdigest()[:10]

    html = []
    html.append('<meta charset="utf-8">')
    html.append('<meta name="viewport" content="width=device-width, initial-scale=1">')
    html.append(f'<link rel="icon" href="{favicon_href()}">')
    html.append('<link rel="manifest" href="manifest.json">')
    html.append('<link rel="apple-touch-icon" href="apple-touch-icon.png">')
    html.append('<meta name="theme-color" content="#0D2542">')
    html.append('<meta name="apple-mobile-web-app-capable" content="yes">')
    html.append('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">')
    html.append('<meta name="apple-mobile-web-app-title" content="HLD Bible">')
    html.append('<title>Interview-Prep Bible</title>')
    html.append('<style>')
    html.append(theme_css)
    html.append(comp_css)
    html.append(site_css)
    html.append('</style>')
    html.append('<div id="app"></div>')
    html.append('<script>')
    html.append('window.__ROUTES__ = ' + safe_for_inline_script(json.dumps(routes)) + ';')
    html.append('window.__TITLES__ = ' + safe_for_inline_script(json.dumps(titles)) + ';')
    html.append('window.__VOLUME_SELECTOR_HTML__ = ' + safe_for_inline_script(json.dumps(VOLUME_SELECTOR_HTML)) + ';')
    html.append(engine_js)
    html.append(annotate_js)
    html.append(router_js)
    # register() alone can leave an iOS home-screen PWA stuck on stale content
    # for a long time — iOS doesn't reliably re-check sw.js on its own timeline.
    # reg.update() asks right away instead of waiting on that; skipWaiting +
    # clients.claim() (in service_worker_js) mean a new SW takes over almost
    # immediately once found, firing 'controllerchange' — a one-time reload
    # then picks up the fresh HTML/JS without the user re-adding the icon.
    html.append(
        "if ('serviceWorker' in navigator) {"
        " navigator.serviceWorker.register('sw.js').then(function(reg){ reg.update(); }).catch(function(){});"
        " var swReloadedForUpdate = false;"
        " navigator.serviceWorker.addEventListener('controllerchange', function(){"
        " if (swReloadedForUpdate) return; swReloadedForUpdate = true; window.location.reload();"
        " });"
        " }"
    )
    html.append('</script>')

    out_dir = os.path.join(ROOT, "site")
    os.makedirs(out_dir, exist_ok=True)

    out_path = os.path.join(out_dir, "index.html")
    with open(out_path, "w") as f:
        f.write("\n".join(html))

    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        f.write(manifest_json())

    with open(os.path.join(out_dir, "sw.js"), "w") as f:
        f.write(service_worker_js(version))

    kb = os.path.getsize(out_path) / 1024
    print(f"Wrote site/index.html ({kb:.0f} KB, {len(chapters)} chapters + hub), manifest.json, sw.js (v{version})")


if __name__ == "__main__":
    build()
