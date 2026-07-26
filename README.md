# Interview-Prep Bible

A self-contained, single-page interview-prep site — currently the **HLD
(High-Level Design) Interview-Prep Bible**: 22 chapters, 90 full worked
problems, and a 199-row rapid-fire pattern index, taking a reader from zero
system-design knowledge to an EM-level HLD interview bar.

**Live:** https://vashi21.github.io/interview-prep-bible/

## What this is

One `index.html` with client-side hash routing (`#/hld`, `#/hld/ch1` ...
`#/hld/ch22`) — no build step, no framework, no server-side routing needed.
Works as a installable web app on iOS/Android (manifest + service worker +
offline caching of the whole book).

## Structure

- `index.html` — the entire app: theme, layout, router, and every chapter's
  content, all inlined into one file.
- `manifest.json`, `sw.js`, `icon-*.png` — PWA install/offline support.

## Regenerating

This site is generated from a separate source project (fragments per chapter +
a build script). If you have that source tree, `python3 build_spa.py`
regenerates everything in this folder from scratch.
