# Interview-Prep Bible

A self-contained, single-page interview-prep site — currently the **HLD
(High-Level Design) Interview-Prep Bible**: 22 chapters, 90 full worked
problems, and a 199-row rapid-fire pattern index, taking a reader from zero
system-design knowledge to an EM-level HLD interview bar.

**Live:** https://vashi21.github.io/interview-prep-bible/

## What this is

`index.html` is the deployed app: client-side hash routing (`#/hld`,
`#/hld/ch1` ... `#/hld/ch22`), no build step at runtime, no framework, no
server-side routing needed — every chapter's fully-rendered content is
embedded directly in its `<script>` block. Works as an installable web app on
iOS/Android (manifest + service worker + offline caching of the whole book).

## Repo layout

- **`index.html`, `manifest.json`, `sw.js`, `icon-*.png`** — the deployed site.
  This is the only part GitHub Pages actually serves.
- **`fragments/`** — the readable source: one plain HTML file per chapter
  (`ch01.html` ... `ch22.html`, plus `ch00-hub.html` for the index page). This
  is what to open/diff/edit if you're changing a chapter — not `index.html`
  directly, which is generated.
- **`shell/`** — the shared design system all chapters render through:
  `theme.css` (light/dark tokens), `components.css` (callouts, diagrams,
  flashcards, tables, accordions), `site.css` (volume-selector styling),
  `engine.js` (renders the JSON-described diagrams/flashcards, persists the
  progress checklist), `router.js` (the hash router).
- **`registry.json`** — chapter metadata (title, part, one-line description,
  ordering). Drives both the chapter checklist on the index page and the
  prev/next navigation on each chapter.
- **`build_spa.py`** — regenerates `index.html` + `manifest.json` + `sw.js`
  from `fragments/` + `registry.json` + `shell/`. Run this after editing any
  fragment: `python3 build_spa.py`.
- **`assemble.py`, `hub_content.py`** — helper modules `build_spa.py` imports
  (chrome generation, hub-body generation). `assemble.py` also has its own
  CLI mode for a separate, unrelated publishing target (individual pages as
  Claude Artifacts) — not used by this repo; only its importable functions
  are.
- **`generate_hub.py`** — regenerates `fragments/ch00-hub.html` for that other
  target; the SPA build calls the same underlying logic directly with its own
  links, so you don't need to run this for the site itself.
- **`validate_json_blocks.py`** — sanity-checks every `data-diagram`/
  `data-cards` JSON blob across all fragments still parses (catches a bad
  escape before it ships).

## Making a change

1. Edit the relevant file in `fragments/`.
2. `python3 build_spa.py` to regenerate `index.html`.
3. Open `index.html` locally (or serve the folder with e.g.
   `python3 -m http.server`) to check it.
4. `git add -A && git commit -m "..." && git push` — GitHub Pages rebuilds
   automatically in well under a minute.
