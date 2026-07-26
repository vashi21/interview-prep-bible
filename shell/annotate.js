/* HLD Interview-Prep Bible — Apple Pencil annotation layer (personal-site SPA
   only). Draws only on pointerType "pen" so a finger keeps scrolling/tapping
   links normally — no mode toggle needed. Strokes are stored as fractions of
   the content box (0-1), not pixels, so a rotation/reflow rescales the whole
   drawing along with the text instead of leaving it behind. Native pinch-zoom
   needs no special handling: the browser scales the canvas and the content
   together as one unit. Persisted in IndexedDB, one record per route — real
   on-device storage, durable across closing the app/rebooting, no backend
   needed for this MVP (a later phase adds one for cross-device sync). */
(function(){
  var DB_NAME = 'hld-bible-ink';
  var DB_VERSION = 1;
  var STORE = 'routes';

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

  // ---- active canvas state (only one route is ever showing at a time) ----
  var wrap = null;
  var canvas = null;
  var ctx = null;
  var currentRoute = null;
  var strokes = [];       // committed, RELATIVE coords: [[{x,y,p}, ...], ...]
  var liveStroke = null;  // the stroke being drawn right now, PIXEL coords
  var dpr = window.devicePixelRatio || 1;

  function inkColor(){
    var v = getComputedStyle(document.documentElement).getPropertyValue('--accent');
    return (v || '#C97A2B').trim();
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

  function drawSegment(p0, p1){
    ctx.strokeStyle = inkColor();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.2 + (p1.p || 0.5) * 2.6;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  function paintStroke(pixelPoints){
    for (var i = 1; i < pixelPoints.length; i++) drawSegment(pixelPoints[i - 1], pixelPoints[i]);
  }

  function redraw(){
    if (!ctx || !wrap) return;
    var w = wrap.scrollWidth, h = wrap.scrollHeight;
    ctx.clearRect(0, 0, w, h);
    strokes.forEach(function(stroke){
      paintStroke(stroke.map(function(p){ return { x: p.x * w, y: p.y * h, p: p.p }; }));
    });
  }

  function persist(){
    if (currentRoute) saveRoute(currentRoute, strokes);
  }

  function onPointerDown(e){
    if (e.pointerType !== 'pen' || !wrap || !canvas) return;
    e.preventDefault();
    var rect = wrap.getBoundingClientRect();
    liveStroke = [{ x: e.clientX - rect.left, y: e.clientY - rect.top, p: e.pressure || 0.5 }];
  }

  function onPointerMove(e){
    if (e.pointerType !== 'pen' || !liveStroke) return;
    e.preventDefault();
    var rect = wrap.getBoundingClientRect();
    var newPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top, p: e.pressure || 0.5 };
    var prevPoint = liveStroke[liveStroke.length - 1];
    liveStroke.push(newPoint);
    drawSegment(prevPoint, newPoint);
  }

  function onPointerUp(e){
    if (e.pointerType !== 'pen' || !liveStroke) return;
    e.preventDefault();
    if (liveStroke.length > 1 && wrap){
      var w = wrap.scrollWidth, h = wrap.scrollHeight;
      strokes.push(liveStroke.map(function(p){ return { x: p.x / w, y: p.y / h, p: p.p }; }));
      persist();
    }
    liveStroke = null;
  }

  function mount(routeKey){
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null; ctx = null; wrap = null; strokes = []; liveStroke = null; currentRoute = null;
    updateToolbarVisibility(!!routeKey);
    if (!routeKey) return;

    wrap = document.querySelector('#app > .wrap');
    if (!wrap) return;
    currentRoute = routeKey;

    canvas = document.createElement('canvas');
    canvas.className = 'ink-canvas';
    wrap.appendChild(canvas);

    loadRoute(routeKey).then(function(record){
      strokes = (record && record.strokes) || [];
      sizeCanvas();
    });
  }

  function clearCurrent(){
    if (!currentRoute) return;
    strokes = [];
    persist();
    redraw();
  }

  function undoLast(){
    if (!currentRoute || !strokes.length) return;
    strokes.pop();
    persist();
    redraw();
  }

  function exportAll(){
    allRoutes().then(function(records){
      var payload = { version: 1, exportedAt: new Date().toISOString(), routes: records };
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

  function updateToolbarVisibility(show){
    var bar = document.getElementById('ink-toolbar');
    if (bar) bar.style.display = show ? 'flex' : 'none';
  }

  function buildToolbar(){
    var bar = document.createElement('div');
    bar.id = 'ink-toolbar';
    bar.className = 'ink-toolbar';
    bar.innerHTML =
      '<button type="button" data-ink-action="undo">Undo</button>' +
      '<button type="button" data-ink-action="clear">Clear page</button>' +
      '<button type="button" data-ink-action="export">Export notes</button>' +
      '<button type="button" data-ink-action="import">Import notes</button>' +
      '<input type="file" accept="application/json" style="display:none" id="ink-import-input">';
    document.body.appendChild(bar);
    bar.addEventListener('click', function(e){
      var action = e.target.getAttribute('data-ink-action');
      if (action === 'undo') undoLast();
      else if (action === 'clear'){ if (confirm('Clear all ink on this page?')) clearCurrent(); }
      else if (action === 'export') exportAll();
      else if (action === 'import') document.getElementById('ink-import-input').click();
    });
    document.getElementById('ink-import-input').addEventListener('change', function(e){
      if (e.target.files && e.target.files[0]) importFile(e.target.files[0]);
      e.target.value = '';
    });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sizeCanvas, 150);
  });

  document.addEventListener('pointerdown', onPointerDown, { passive: false });
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp, { passive: false });
  document.addEventListener('pointercancel', onPointerUp, { passive: false });

  function init(){ buildToolbar(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.HLDBibleAnnotate = { mount: mount };
})();
