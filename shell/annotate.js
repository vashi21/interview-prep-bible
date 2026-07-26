/* HLD Interview-Prep Bible — Apple Pencil annotation layer (personal-site SPA
   only). Strokes are stored as fractions of the content box (0-1), not
   pixels, so a rotation/reflow rescales the whole drawing along with the
   text instead of leaving it behind. Persisted in IndexedDB, one record per
   route — real on-device storage, durable across closing the app/rebooting,
   no backend needed for this MVP (a later phase adds one for cross-device
   sync).

   Scroll-lock model: the toolbar starts COLLAPSED, and while it's collapsed
   the Pencil is fully inert — it does not draw, does not preventDefault, and
   touch-action is left at its default, so both a finger and the Pencil
   scroll the page normally. Expanding the toolbar (tapping the FAB) is the
   explicit "start annotating" action: at that point touch-action is set to
   "pinch-zoom" on <html> for as long as the toolbar stays expanded — chosen
   over "none" specifically because "pinch-zoom" disables one-finger native
   panning while *keeping native pinch-zoom working*. Setting it this way —
   statically, the moment the toolbar opens, not reactively inside a
   pointerdown handler — matters: on iOS Safari, toggling touch-action only
   once a touch has already begun can be too late for the native scroll
   gesture recognizer, which decides based on the CSS in effect when the
   touch starts.

   touch-action can only distinguish *gesture type* (pan vs. pinch), not
   *pointer type* — it can't single out the Pencil and leave a finger
   unaffected. So disabling native one-finger panning necessarily disables
   it for a finger too. To keep finger-scrolling fully working regardless of
   annotation state (the actual requirement), a finger's one-finger drag is
   re-implemented here as a plain 1:1 `window.scrollTo` follow (see
   fingerScroll below), applied once per animation frame via
   requestAnimationFrame rather than once per raw pointermove — calling
   scrollTo synchronously on every event is what made it feel glitchy,
   since touchmove can fire faster than layout/paint can keep up; batching
   to one call per frame is the standard fix. Deliberately still no
   momentum/fling after lift — replicating that physics exactly is out of
   scope, a direct drag-to-scroll is what matters. The moment a second
   finger joins, this manual tracking backs off and the browser's own
   native pinch-zoom (still permitted by touch-action) takes over.

   Strokes are drawn as a sequence of small quadratic curves through the
   midpoints of consecutive points (a standard freehand-smoothing trick),
   not straight lineTo segments — straight segments only looked smooth at
   slow, densely-sampled speeds; at normal writing speed the sparser points
   made fast strokes and eraser drags look faceted/jagged. The same helper
   draws both the live in-progress stroke and the full replay in
   `paintEntry`, so nothing changes appearance the moment a stroke commits.

   Eraser size is a RADIUS throughout (matches the size slider and the
   circular cursor preview drawn at the Pencil's position while erasing);
   the destination-out stroke used for precision/standard erasing uses
   double that as its line width (a line's width is its diameter). */
(function(){
  var DB_NAME = 'hld-bible-ink';
  var DB_VERSION = 1;
  var STORE = 'routes';
  var PREFS_KEY = 'hld-bible-ink-prefs';
  var UNDO_LIMIT = 20;

  var PALETTE = ['#1a1a1a', '#e5484d', '#2f6fed', '#2fa84f', '#e8871e', '#8a3ffc'];
  var PEN_WIDTHS = { thin: 1.5, medium: 3, thick: 6 };
  var HL_WIDTHS = { thin: 12, medium: 20, thick: 30 };
  var DEFAULT_PEN_COLOR = '#1a1a1a';
  var DEFAULT_HL_COLOR = '#ffd400';
  var HL_ALPHA = 0.35;

  function defaultPrefs(){
    return {
      tool: 'pen',
      collapsed: true,
      pen: { color: DEFAULT_PEN_COLOR, widthKey: 'medium' },
      highlighter: { color: DEFAULT_HL_COLOR, widthKey: 'medium' },
      eraser: { mode: 'standard', precisionSize: 6, standardSize: 20, strokeSize: 16 }
    };
  }

  function loadPrefs(){
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return defaultPrefs();
      var parsed = JSON.parse(raw);
      var d = defaultPrefs();
      return {
        tool: parsed.tool || d.tool,
        collapsed: !!parsed.collapsed,
        pen: Object.assign({}, d.pen, parsed.pen),
        highlighter: Object.assign({}, d.highlighter, parsed.highlighter),
        eraser: Object.assign({}, d.eraser, parsed.eraser)
      };
    } catch(e) { return defaultPrefs(); }
  }

  function savePrefs(){
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch(e) {}
  }

  var prefs = loadPrefs();

  // ---- IndexedDB ----
  var dbPromise = null;
  function openDb(){
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject){
      if (!('indexedDB' in window)) { reject(new Error('no indexedDB')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(){
        req.result.createObjectStore(STORE, { keyPath: 'route' });
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
    return dbPromise;
  }

  function loadRoute(route){
    return openDb().then(function(db){
      return new Promise(function(resolve){
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(route);
        req.onsuccess = function(){ resolve(req.result || null); };
        req.onerror = function(){ resolve(null); };
      });
    }).catch(function(){ return null; });
  }

  function saveRoute(route, strokesToSave){
    return openDb().then(function(db){
      return new Promise(function(resolve){
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ route: route, strokes: strokesToSave, updatedAt: new Date().toISOString() });
        tx.oncomplete = function(){ resolve(true); };
        tx.onerror = function(){ resolve(false); };
      });
    }).catch(function(){ return false; });
  }

  function allRoutes(){
    return openDb().then(function(db){
      return new Promise(function(resolve){
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function(){ resolve(req.result || []); };
        req.onerror = function(){ resolve([]); };
      });
    }).catch(function(){ return []; });
  }

  function putRoute(record){
    return openDb().then(function(db){
      return new Promise(function(resolve){
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = function(){ resolve(true); };
        tx.onerror = function(){ resolve(false); };
      });
    }).catch(function(){ return false; });
  }

  // A stroke entry is either:
  //   { type:'draw', color, alpha, width, points:[{x,y,p}] }   — pen or highlighter
  //   { type:'erase', width, points:[{x,y,p}] }                — precision/standard eraser
  // Older saved pages stored a bare array of points (always an opaque pen
  // stroke) — normalize those into the current shape on load so nothing is
  // silently dropped.
  function normalizeEntry(s){
    if (Array.isArray(s)) {
      return { type: 'draw', color: DEFAULT_PEN_COLOR, alpha: 1, width: PEN_WIDTHS.medium, points: s };
    }
    return s;
  }

  // ---- active canvas state (only one route is ever showing at a time) ----
  var wrap = null;
  var canvas = null;
  var ctx = null;
  var currentRoute = null;
  var strokes = [];        // committed entries, RELATIVE coords
  var undoStack = [];      // snapshots of `strokes` taken before each mutating gesture
  var liveStroke = null;   // points of the in-progress draw/erase gesture, PIXEL coords
  var dpr = window.devicePixelRatio || 1;

  function currentDrawStyle(){
    if (prefs.tool === 'highlighter') {
      // Flat caps + constant width (no pressure modulation): a highlighter
      // is a wide flat-tip marker in real life, not pressure-sensitive like
      // a pen — modulating its width per point is what made it look like a
      // lumpy chain of blobs instead of a clean flat highlight band.
      return { color: prefs.highlighter.color, alpha: HL_ALPHA, width: HL_WIDTHS[prefs.highlighter.widthKey] || HL_WIDTHS.medium, cap: 'butt', pressureSensitive: false };
    }
    return { color: prefs.pen.color, alpha: 1, width: PEN_WIDTHS[prefs.pen.widthKey] || PEN_WIDTHS.medium, cap: 'round', pressureSensitive: true };
  }

  function currentEraserSize(){
    var e = prefs.eraser;
    if (e.mode === 'precision') return e.precisionSize;
    if (e.mode === 'stroke') return e.strokeSize;
    return e.standardSize;
  }

  function sizeCanvas(){
    if (!wrap || !canvas) return;
    // Shrink first: the canvas is an absolutely-positioned child of .wrap, so
    // its own previous size otherwise feeds into wrap.scrollWidth/Height and
    // any transient overshoot (e.g. a layout shift during font swap) becomes
    // permanent and compounds on every later resize — a one-way ratchet that
    // can inflate the page to tens of thousands of pixels of empty scroll.
    canvas.style.width = '0px';
    canvas.style.height = '0px';
    var w = wrap.scrollWidth, h = wrap.scrollHeight;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    redraw();
  }

  function lineWidthFor(baseWidth, pressure){
    return baseWidth * (0.45 + 0.9 * (pressure == null ? 0.5 : pressure));
  }

  function midpoint(a, b){
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function applyStrokeStyle(style, pressure){
    if (style.erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = style.width; // already a diameter — see file header
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = style.alpha == null ? 1 : style.alpha;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.pressureSensitive ? lineWidthFor(style.width, pressure) : style.width;
    }
    ctx.lineCap = style.cap || 'round';
    ctx.lineJoin = 'round';
  }

  // Draws the segment ending at points[i] as a small quadratic curve through
  // the midpoints on either side of points[i-1], using points[i-1] itself as
  // the control point — the standard freehand-smoothing technique. Each call
  // strokes only the new increment (no re-stroking of earlier segments), so
  // it's safe to call once per new point during live drawing as well as
  // once per point during a full replay.
  function drawSmoothSegment(style, points, i){
    var p1 = points[i - 1], p2 = points[i];
    var start = i >= 2 ? midpoint(points[i - 2], p1) : p1;
    var end = midpoint(p1, p2);
    ctx.save();
    applyStrokeStyle(style, p2.p);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(p1.x, p1.y, end.x, end.y);
    ctx.stroke();
    ctx.restore();
  }

  function entryToPixelPoints(entry, w, h){
    return entry.points.map(function(p){ return { x: p.x * w, y: p.y * h, p: p.p }; });
  }

  function paintEntry(entry, w, h){
    var pts = entryToPixelPoints(entry, w, h);
    if (pts.length < 2) return;
    var style;
    if (entry.type === 'erase') {
      style = { erase: true, width: entry.width };
    } else {
      // cap/pressureSensitive aren't persisted — derived from alpha so old
      // saved entries (before this distinction existed) still replay right.
      var isHighlighter = entry.alpha != null && entry.alpha < 1;
      style = { color: entry.color, alpha: entry.alpha, width: entry.width, cap: isHighlighter ? 'butt' : 'round', pressureSensitive: !isHighlighter };
    }
    for (var i = 1; i < pts.length; i++) drawSmoothSegment(style, pts, i);
  }

  function redraw(){
    if (!ctx || !wrap) return;
    var w = wrap.scrollWidth, h = wrap.scrollHeight;
    ctx.clearRect(0, 0, w, h);
    strokes.forEach(function(entry){ paintEntry(entry, w, h); });
  }

  function persist(){
    if (currentRoute) saveRoute(currentRoute, strokes);
  }

  function snapshotForUndo(){
    undoStack.push(JSON.parse(JSON.stringify(strokes)));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }

  function distToSegment(px, py, x1, y1, x2, y2){
    var dx = x2 - x1, dy = y2 - y1;
    var lenSq = dx * dx + dy * dy;
    var t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  function eraseStrokesNear(px, py, radius, w, h){
    var changed = false;
    for (var i = strokes.length - 1; i >= 0; i--){
      var entry = strokes[i];
      if (entry.type !== 'draw') continue;
      var pts = entryToPixelPoints(entry, w, h);
      var hit = false;
      if (pts.length === 1) {
        hit = Math.hypot(px - pts[0].x, py - pts[0].y) <= radius;
      } else {
        for (var j = 1; j < pts.length; j++){
          if (distToSegment(px, py, pts[j - 1].x, pts[j - 1].y, pts[j].x, pts[j].y) <= radius + (entry.width || 3) / 2) {
            hit = true; break;
          }
        }
      }
      if (hit) { strokes.splice(i, 1); changed = true; }
    }
    return changed;
  }

  // ---- eraser cursor preview ----
  // A ring at the Pencil's current position, diameter = 2x the radius the
  // slider controls, so it's obvious before/while erasing exactly how much
  // is about to be removed, and it visibly grows/shrinks with the slider.
  function updateEraserCursor(clientX, clientY){
    var cursor = document.getElementById('ink-eraser-cursor');
    if (!cursor) return;
    var d = currentEraserSize() * 2;
    cursor.style.width = d + 'px';
    cursor.style.height = d + 'px';
    cursor.style.left = (clientX - d / 2) + 'px';
    cursor.style.top = (clientY - d / 2) + 'px';
    cursor.style.display = 'block';
  }

  function hideEraserCursor(){
    var cursor = document.getElementById('ink-eraser-cursor');
    if (cursor) cursor.style.display = 'none';
  }

  // ---- finger drag-to-scroll passthrough ----
  // touch-action:'pinch-zoom' (set while annotating) disables native
  // one-finger panning for EVERY pointer type, since touch-action can't
  // distinguish Pencil from finger. This replicates plain 1:1 finger
  // scrolling by hand so it keeps working regardless of annotation state.
  // Applied once per animation frame (not once per raw event — that's what
  // made it feel glitchy) via requestAnimationFrame. Deliberately still no
  // momentum after lift, see file header. Bails out the moment a second
  // finger joins (touchPointerIds.size > 1) so the browser's own native
  // pinch-zoom, still permitted by touch-action, takes over.
  var touchPointerIds = new Set();
  var fingerScroll = null;
  var scrollRafPending = false;

  function applyPendingScroll(){
    scrollRafPending = false;
    if (fingerScroll && touchPointerIds.size === 1) {
      window.scrollTo(window.scrollX, fingerScroll.scrollY - (fingerScroll.lastY - fingerScroll.y));
    }
  }

  function onPointerDown(e){
    if (e.pointerType === 'touch') {
      touchPointerIds.add(e.pointerId);
      if (touchPointerIds.size > 1) { fingerScroll = null; return; }
      if (!prefs.collapsed && currentRoute && !e.target.closest('#ink-toolbar, #ink-fab')) {
        fingerScroll = { pointerId: e.pointerId, y: e.clientY, lastY: e.clientY, scrollY: window.scrollY };
      }
      return;
    }
    if (e.pointerType !== 'pen') return;
    if (prefs.tool === 'eraser' && !prefs.collapsed && currentRoute) updateEraserCursor(e.clientX, e.clientY);
    if (!wrap || !canvas || prefs.collapsed) return;
    e.preventDefault();
    snapshotForUndo();
    var rect = wrap.getBoundingClientRect();
    var point = { x: e.clientX - rect.left, y: e.clientY - rect.top, p: e.pressure || 0.5 };

    if (prefs.tool === 'eraser' && prefs.eraser.mode === 'stroke') {
      liveStroke = 'stroke-erase';
      var w = wrap.scrollWidth, h = wrap.scrollHeight;
      if (eraseStrokesNear(point.x, point.y, currentEraserSize(), w, h)) redraw();
      return;
    }
    liveStroke = [point];
  }

  function onPointerMove(e){
    if (e.pointerType === 'touch') {
      if (fingerScroll && e.pointerId === fingerScroll.pointerId) {
        fingerScroll.lastY = e.clientY;
        if (!scrollRafPending) { scrollRafPending = true; requestAnimationFrame(applyPendingScroll); }
      }
      return;
    }
    if (e.pointerType !== 'pen') return;
    if (prefs.tool === 'eraser' && !prefs.collapsed && currentRoute) updateEraserCursor(e.clientX, e.clientY);
    if (!liveStroke) return;
    e.preventDefault();
    var rect = wrap.getBoundingClientRect();
    var newPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top, p: e.pressure || 0.5 };

    if (liveStroke === 'stroke-erase') {
      var w = wrap.scrollWidth, h = wrap.scrollHeight;
      if (eraseStrokesNear(newPoint.x, newPoint.y, currentEraserSize(), w, h)) redraw();
      return;
    }

    liveStroke.push(newPoint);
    var style = prefs.tool === 'eraser' ? { erase: true, width: currentEraserSize() * 2 } : currentDrawStyle();
    drawSmoothSegment(style, liveStroke, liveStroke.length - 1);
  }

  function onPointerUp(e){
    if (e.pointerType === 'touch') {
      touchPointerIds.delete(e.pointerId);
      if (fingerScroll && e.pointerId === fingerScroll.pointerId) fingerScroll = null;
      return;
    }
    if (e.pointerType !== 'pen') return;
    hideEraserCursor();
    if (!liveStroke) return;
    e.preventDefault();

    if (liveStroke === 'stroke-erase') {
      liveStroke = null;
      persist();
      return;
    }

    if (liveStroke.length > 1 && wrap) {
      var w = wrap.scrollWidth, h = wrap.scrollHeight;
      var relPoints = liveStroke.map(function(p){ return { x: p.x / w, y: p.y / h, p: p.p }; });
      if (prefs.tool === 'eraser') {
        strokes.push({ type: 'erase', width: currentEraserSize() * 2, points: relPoints });
      } else {
        var style = currentDrawStyle();
        strokes.push({ type: 'draw', color: style.color, alpha: style.alpha, width: style.width, points: relPoints });
      }
      persist();
    } else {
      // A tap (no drag) never got its own entry — pop the unused undo snapshot.
      undoStack.pop();
    }
    liveStroke = null;
  }

  function mount(routeKey){
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null; ctx = null; wrap = null; strokes = []; liveStroke = null; currentRoute = null; undoStack = [];
    hideEraserCursor();
    updateToolbarVisibility(!!routeKey);
    if (!routeKey) return;

    wrap = document.querySelector('#app > .wrap');
    if (!wrap) return;
    currentRoute = routeKey;

    canvas = document.createElement('canvas');
    canvas.className = 'ink-canvas';
    wrap.appendChild(canvas);

    loadRoute(routeKey).then(function(record){
      strokes = ((record && record.strokes) || []).map(normalizeEntry);
      sizeCanvas();
    });
  }

  function clearCurrent(){
    if (!currentRoute) return;
    snapshotForUndo();
    strokes = [];
    persist();
    redraw();
  }

  function undoLast(){
    if (!currentRoute || !undoStack.length) return;
    strokes = undoStack.pop();
    persist();
    redraw();
  }

  function exportAll(){
    allRoutes().then(function(records){
      var payload = { version: 2, exportedAt: new Date().toISOString(), routes: records };
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'hld-bible-notes-export.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
    });
  }

  function importFile(file){
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var payload = JSON.parse(reader.result);
        var records = (payload && payload.routes) || [];
        Promise.all(records.map(function(r){ return putRoute(r); })).then(function(){
          if (currentRoute) mount(currentRoute);
          alert('Imported ' + records.length + ' page(s) of notes.');
        });
      }catch(e){ alert('That file did not look like a notes export.'); }
    };
    reader.readAsText(file);
  }

  // ---- toolbar ----
  // Single place that decides both toolbar visibility AND scroll-lock, so
  // the two can never drift apart: touch-action is "pinch-zoom" exactly when
  // the toolbar is open on a real route, set here — well before any stroke
  // begins — rather than inside a pointer handler (see the file header for
  // why that timing matters on iOS Safari).
  function updateToolbarVisibility(show){
    var bar = document.getElementById('ink-toolbar');
    var fab = document.getElementById('ink-fab');
    var annotating = show && !prefs.collapsed;
    document.documentElement.style.touchAction = annotating ? 'pinch-zoom' : '';
    if (!show) {
      if (bar) bar.style.display = 'none';
      if (fab) fab.style.display = 'none';
      return;
    }
    if (annotating) {
      if (bar) bar.style.display = 'flex';
      if (fab) fab.style.display = 'none';
    } else {
      if (bar) bar.style.display = 'none';
      if (fab) fab.style.display = 'flex';
    }
  }

  var WIDTH_ICON_SIZE = { thin: 5, medium: 9, thick: 14 };
  function widthDotHtml(widthKey){
    var size = WIDTH_ICON_SIZE[widthKey] || WIDTH_ICON_SIZE.medium;
    return '<span class="ink-width-dot" style="width:' + size + 'px;height:' + size + 'px;"></span>';
  }

  function swatchesHtml(activeColor){
    return PALETTE.map(function(c){
      var active = c.toLowerCase() === (activeColor || '').toLowerCase() ? ' active' : '';
      return '<button type="button" class="ink-swatch' + active + '" data-color="' + c + '" style="background:' + c + '" title="' + c + '"></button>';
    }).join('');
  }

  function renderOptionsRow(){
    var row = document.getElementById('ink-options-row');
    if (!row) return;

    if (prefs.tool === 'eraser') {
      var e = prefs.eraser;
      row.innerHTML =
        '<button type="button" class="ink-mode-btn' + (e.mode === 'precision' ? ' active' : '') + '" data-eraser-mode="precision">Precision</button>' +
        '<button type="button" class="ink-mode-btn' + (e.mode === 'standard' ? ' active' : '') + '" data-eraser-mode="standard">Standard</button>' +
        '<button type="button" class="ink-mode-btn' + (e.mode === 'stroke' ? ' active' : '') + '" data-eraser-mode="stroke">Stroke</button>' +
        '<span class="ink-sep"></span>' +
        '<input type="range" class="ink-eraser-size" id="ink-eraser-size" min="3" max="60" step="1" value="' + currentEraserSize() + '">';
      return;
    }

    var t = prefs[prefs.tool]; // pen or highlighter
    row.innerHTML =
      swatchesHtml(t.color) +
      '<input type="color" id="ink-color-custom" class="ink-color-custom" value="' + t.color + '" title="Custom color">' +
      '<span class="ink-sep"></span>' +
      '<button type="button" class="ink-width-btn' + (t.widthKey === 'thin' ? ' active' : '') + '" data-width="thin">' + widthDotHtml('thin') + '</button>' +
      '<button type="button" class="ink-width-btn' + (t.widthKey === 'medium' ? ' active' : '') + '" data-width="medium">' + widthDotHtml('medium') + '</button>' +
      '<button type="button" class="ink-width-btn' + (t.widthKey === 'thick' ? ' active' : '') + '" data-width="thick">' + widthDotHtml('thick') + '</button>';
  }

  function renderToolButtons(){
    ['pen', 'highlighter', 'eraser'].forEach(function(tool){
      var btn = document.querySelector('[data-ink-tool="' + tool + '"]');
      if (btn) btn.classList.toggle('active', prefs.tool === tool);
    });
  }

  function refreshToolbar(){
    renderToolButtons();
    renderOptionsRow();
  }

  function setTool(tool){
    prefs.tool = tool;
    savePrefs();
    refreshToolbar();
    if (tool !== 'eraser') hideEraserCursor();
  }

  function buildToolbar(){
    var bar = document.createElement('div');
    bar.id = 'ink-toolbar';
    bar.className = 'ink-toolbar';
    bar.innerHTML =
      '<div class="ink-row ink-row-tools">' +
        '<button type="button" class="ink-tool-btn" data-ink-tool="pen" title="Pen">Pen</button>' +
        '<button type="button" class="ink-tool-btn" data-ink-tool="highlighter" title="Highlighter">Highlight</button>' +
        '<button type="button" class="ink-tool-btn" data-ink-tool="eraser" title="Eraser">Erase</button>' +
        '<span class="ink-sep"></span>' +
        '<button type="button" data-ink-action="undo" title="Undo">Undo</button>' +
        '<button type="button" data-ink-action="clear" title="Clear page">Clear</button>' +
        '<button type="button" data-ink-action="export" title="Export notes">Export</button>' +
        '<button type="button" data-ink-action="import" title="Import notes">Import</button>' +
        '<button type="button" class="ink-collapse-btn" data-ink-action="collapse" title="Hide toolbar">&times;</button>' +
        '<input type="file" accept="application/json" style="display:none" id="ink-import-input">' +
      '</div>' +
      '<div class="ink-row ink-row-options" id="ink-options-row"></div>';
    document.body.appendChild(bar);

    var eraserCursor = document.createElement('div');
    eraserCursor.id = 'ink-eraser-cursor';
    eraserCursor.className = 'ink-eraser-cursor';
    document.body.appendChild(eraserCursor);

    var fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'ink-fab';
    fab.className = 'ink-fab';
    fab.title = 'Show annotation tools';
    fab.textContent = '✎';
    document.body.appendChild(fab);
    fab.addEventListener('click', function(){
      prefs.collapsed = false;
      savePrefs();
      updateToolbarVisibility(!!currentRoute);
    });

    bar.addEventListener('click', function(e){
      var toolBtn = e.target.closest('[data-ink-tool]');
      if (toolBtn) { setTool(toolBtn.getAttribute('data-ink-tool')); return; }

      var action = e.target.closest('[data-ink-action]');
      if (action) {
        var a = action.getAttribute('data-ink-action');
        if (a === 'undo') undoLast();
        else if (a === 'clear') { if (confirm('Clear all ink on this page?')) clearCurrent(); }
        else if (a === 'export') exportAll();
        else if (a === 'import') document.getElementById('ink-import-input').click();
        else if (a === 'collapse') { prefs.collapsed = true; savePrefs(); updateToolbarVisibility(!!currentRoute); hideEraserCursor(); }
        return;
      }

      var swatch = e.target.closest('[data-color]');
      if (swatch && (prefs.tool === 'pen' || prefs.tool === 'highlighter')) {
        prefs[prefs.tool].color = swatch.getAttribute('data-color');
        savePrefs();
        renderOptionsRow();
        return;
      }

      var widthBtn = e.target.closest('[data-width]');
      if (widthBtn && (prefs.tool === 'pen' || prefs.tool === 'highlighter')) {
        prefs[prefs.tool].widthKey = widthBtn.getAttribute('data-width');
        savePrefs();
        renderOptionsRow();
        return;
      }

      var eraserModeBtn = e.target.closest('[data-eraser-mode]');
      if (eraserModeBtn) {
        prefs.eraser.mode = eraserModeBtn.getAttribute('data-eraser-mode');
        savePrefs();
        renderOptionsRow();
        return;
      }
    });

    bar.addEventListener('input', function(e){
      if (e.target.id === 'ink-color-custom' && (prefs.tool === 'pen' || prefs.tool === 'highlighter')) {
        prefs[prefs.tool].color = e.target.value;
        savePrefs();
        renderOptionsRow();
      } else if (e.target.id === 'ink-eraser-size') {
        var key = prefs.eraser.mode === 'precision' ? 'precisionSize' : prefs.eraser.mode === 'stroke' ? 'strokeSize' : 'standardSize';
        prefs.eraser[key] = Number(e.target.value);
        savePrefs();
      }
    });

    document.getElementById('ink-import-input').addEventListener('change', function(e){
      if (e.target.files && e.target.files[0]) importFile(e.target.files[0]);
      e.target.value = '';
    });

    refreshToolbar();
  }

  var resizeTimer = null;
  window.addEventListener('resize', function(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sizeCanvas, 150);
  });

  // capture:true so preventDefault() runs as early in the dispatch as
  // possible — belt-and-suspenders alongside the static touch-action lock.
  document.addEventListener('pointerdown', onPointerDown, { passive: false, capture: true });
  document.addEventListener('pointermove', onPointerMove, { passive: false, capture: true });
  document.addEventListener('pointerup', onPointerUp, { passive: false, capture: true });
  document.addEventListener('pointercancel', onPointerUp, { passive: false, capture: true });

  function init(){ buildToolbar(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.HLDBibleAnnotate = { mount: mount };
})();
