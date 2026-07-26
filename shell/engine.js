/* HLD Interview-Prep Bible — shared engine. Renders the two data-driven
   components (diagrams, flashcards) that agents author as plain JSON,
   and persists the hub's progress checklist to localStorage. */
(function(){
  function escapeText(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escapeAttr(s){ return escapeText(s).replace(/"/g,'&quot;'); }

  // Distance from a rect's center to its own boundary along a given ray direction.
  function rectRayExtent(halfW, halfH, dirX, dirY){
    var tx = dirX !== 0 ? halfW/Math.abs(dirX) : Infinity;
    var ty = dirY !== 0 ? halfH/Math.abs(dirY) : Infinity;
    return Math.min(tx, ty);
  }

  function renderDiagram(container, data, uid){
    var W = data.w || 1000, H = data.h || 560;
    var nodesById = {};
    (data.nodes||[]).forEach(function(n){ nodesById[n.id] = n; });
    var parts = [];
    parts.push('<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+escapeAttr(data.title||'architecture diagram')+'">');
    parts.push('<defs><marker id="arrow-'+uid+'" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="darrowhead" d="M0,0 L10,5 L0,10 Z"></path></marker></defs>');

    (data.groups||[]).forEach(function(g){
      parts.push('<rect class="dgroup" x="'+g.x+'" y="'+g.y+'" width="'+g.w+'" height="'+g.h+'" rx="3"></rect>');
      if (g.label) parts.push('<text class="dgroup-label" x="'+(g.x+10)+'" y="'+(g.y+18)+'">'+escapeText(g.label)+'</text>');
    });

    // Edge lines are clipped to the actual box EDGES, not box centers. A line
    // drawn center-to-center only looks right when the target box has an opaque
    // fill to hide the overlap — "external" nodes are dashed/transparent, so the
    // line and its arrowhead would otherwise run straight through into the box,
    // on top of its own text. Edge LABELS are collected here but rendered in a
    // separate pass after the nodes, so a long label is never hidden under a box.
    //
    // Edges connecting the SAME two boxes (e.g. a request and its response) are
    // grouped and fanned out perpendicular to the line — otherwise a second edge
    // between an identical pair of centers draws exactly on top of the first,
    // hiding one arrow (and stacking both labels on the same spot) entirely.
    var pairGroups = {};
    (data.edges||[]).forEach(function(e){
      var key = [e.from, e.to].slice().sort().join('|');
      (pairGroups[key] = pairGroups[key] || []).push(e);
    });

    var labelJobs = [];
    (data.edges||[]).forEach(function(e, ei){
      var a = nodesById[e.from], b = nodesById[e.to];
      if (!a || !b) return;
      var cx1 = a.x + a.w/2, cy1 = a.y + a.h/2, cx2 = b.x + b.w/2, cy2 = b.y + b.h/2;
      var dx = cx2 - cx1, dy = cy2 - cy1;
      var dist = Math.sqrt(dx*dx + dy*dy) || 1;
      var ux = dx / dist, uy = dy / dist;
      var extentA = rectRayExtent(a.w/2, a.h/2, ux, uy) + 2;
      var extentB = rectRayExtent(b.w/2, b.h/2, ux, uy) + 2;
      var edgeAx = cx1 + ux * extentA, edgeAy = cy1 + uy * extentA;
      var edgeBx = cx2 - ux * extentB, edgeBy = cy2 - uy * extentB;

      var pairKeyParts = [e.from, e.to].slice().sort();
      var group = pairGroups[pairKeyParts.join('|')];
      if (group.length > 1){
        var idx = group.indexOf(e);
        var offset = (idx - (group.length - 1) / 2) * 14;
        // Offset relative to a canonical direction (which node sorts first),
        // not this edge's own from/to — otherwise the perpendicular vector
        // flips sign right along with a reversed edge and the two offsets
        // cancel out instead of landing on opposite sides.
        var reversed = e.from !== pairKeyParts[0];
        var signedOffset = reversed ? -offset : offset;
        var perpX = -uy * signedOffset, perpY = ux * signedOffset;
        edgeAx += perpX; edgeAy += perpY;
        edgeBx += perpX; edgeBy += perpY;
      }

      var cls = 'dedge' + (e.dashed ? ' dashed' : '');
      parts.push('<line class="'+cls+'" x1="'+edgeAx+'" y1="'+edgeAy+'" x2="'+edgeBx+'" y2="'+edgeBy+'" marker-end="url(#arrow-'+uid+')"></line>');
      if (e.label){
        var gap = dist - extentA - extentB;
        labelJobs.push({
          id: 'elabel-' + uid + '-' + ei,
          text: e.label,
          mx: (edgeAx + edgeBx) / 2,
          my: (edgeAy + edgeBy) / 2 - 6,
          maxWidth: Math.max(gap * 0.88, 26)
        });
      }
    });

    var nodeTextJobs = [];
    (data.nodes||[]).forEach(function(n, ni){
      var kind = n.kind || 'compute';
      parts.push('<g class="dnode '+kind+'"><rect x="'+n.x+'" y="'+n.y+'" width="'+n.w+'" height="'+n.h+'" rx="3"></rect>');
      var cx = n.x + n.w/2;
      var labelY = n.sub ? (n.y + n.h/2 - 6) : (n.y + n.h/2 + 4);
      var titleId = 'ntitle-' + uid + '-' + ni;
      parts.push('<text id="'+titleId+'" x="'+cx+'" y="'+labelY+'">'+escapeText(n.label||'')+'</text>');
      nodeTextJobs.push({ id: titleId, text: n.label || '', maxWidth: n.w - 10 });
      if (n.sub){
        var subId = 'nsub-' + uid + '-' + ni;
        parts.push('<text class="sub" id="'+subId+'" x="'+cx+'" y="'+(labelY+18)+'">'+escapeText(n.sub)+'</text>');
        nodeTextJobs.push({ id: subId, text: n.sub, maxWidth: n.w - 10 });
      }
      parts.push('</g>');
    });

    // Labels last, so they always paint on top of every node.
    labelJobs.forEach(function(job){
      parts.push(
        '<g class="dedge-label-group" id="'+job.id+'">' +
          '<rect class="dedge-label-bg"></rect>' +
          '<text class="dedge-label">'+escapeText(job.text)+'</text>' +
        '</g>'
      );
    });

    parts.push('</svg>');
    container.innerHTML = parts.join('');

    // Fitting pass: shrink a text element's font-size, then as a last resort
    // truncate it with an ellipsis, until its rendered width fits maxWidth.
    // Runs after the SVG is in the DOM so getComputedTextLength() is real.
    function fitText(textEl, maxWidth, startFontSize, minFontSize){
      var full = textEl.textContent;
      var fontSize = startFontSize;
      function fits(){ return textEl.getComputedTextLength() <= maxWidth; }
      while (!fits() && fontSize > minFontSize){
        fontSize -= 0.5;
        textEl.style.fontSize = fontSize + 'px';
      }
      if (!fits()){
        var lo = 1, hi = full.length, best = '…';
        while (lo <= hi){
          var mid = Math.floor((lo + hi) / 2);
          textEl.textContent = full.slice(0, mid) + '…';
          if (textEl.getComputedTextLength() <= maxWidth){ best = textEl.textContent; lo = mid + 1; }
          else { hi = mid - 1; }
        }
        textEl.textContent = best;
      }
    }

    // Node titles/subtitles: shrink/truncate to stay inside their own box —
    // otherwise a long label silently overflows the rect on both sides.
    nodeTextJobs.forEach(function(job){
      var el = container.querySelector('#' + job.id);
      if (!el) return;
      var startSize = el.classList.contains('sub') ? 10.5 : 13;
      fitText(el, job.maxWidth, startSize, 7.5);
    });

    // Edge labels: fit to the real gap between the two connected boxes, then
    // size a background chip behind the final text so it reads cleanly no
    // matter what it ends up sitting near.
    labelJobs.forEach(function(job){
      var g = container.querySelector('#' + job.id);
      if (!g) return;
      var textEl = g.querySelector('text.dedge-label');
      var bgEl = g.querySelector('rect.dedge-label-bg');
      textEl.setAttribute('x', job.mx);
      textEl.setAttribute('y', job.my);
      fitText(textEl, job.maxWidth, 10, 7);
      var bbox = textEl.getBBox();
      bgEl.setAttribute('x', bbox.x - 3);
      bgEl.setAttribute('y', bbox.y - 2);
      bgEl.setAttribute('width', bbox.width + 6);
      bgEl.setAttribute('height', bbox.height + 4);
      bgEl.setAttribute('rx', 2);
    });
  }

  function renderFlashcards(container, cards){
    var html = '';
    cards.forEach(function(c){
      html += '<button type="button" class="card" aria-pressed="false">' +
        '<div class="card-inner">' +
          '<div class="face front"><div class="tag-row">Q</div><p>'+escapeText(c.q)+'</p><div class="hint">tap to reveal</div></div>' +
          '<div class="face back"><div class="tag-row">A</div><p>'+escapeText(c.a)+'</p><div class="hint">tap to flip back</div></div>' +
        '</div></button>';
    });
    container.innerHTML = html;
    container.querySelectorAll('.card').forEach(function(btn){
      btn.addEventListener('click', function(){
        var flipped = btn.classList.toggle('flipped');
        btn.setAttribute('aria-pressed', flipped ? 'true' : 'false');
      });
    });
  }

  function initProgressList(){
    document.querySelectorAll('.progress-list input[type="checkbox"][data-persist-key]').forEach(function(cb){
      var key = 'hld-bible-progress:' + cb.dataset.persistKey;
      try{
        if (localStorage.getItem(key) === '1'){ cb.checked = true; cb.closest('li').classList.add('done'); }
      }catch(e){}
      cb.addEventListener('change', function(){
        try{ localStorage.setItem(key, cb.checked ? '1' : '0'); }catch(e){}
        cb.closest('li').classList.toggle('done', cb.checked);
      });
    });
  }

  function initPrintButton(){
    var btn = document.querySelector('[data-print-btn]');
    if (!btn) return;
    btn.addEventListener('click', function(){
      document.querySelectorAll('details').forEach(function(d){ d.open = true; });
      window.print();
    });
  }

  function init(){
    var uid = 0;
    document.querySelectorAll('[data-diagram]').forEach(function(el){
      uid++;
      try{ renderDiagram(el, JSON.parse(el.getAttribute('data-diagram')), uid); }
      catch(e){ el.textContent = 'Diagram failed to render.'; }
    });
    document.querySelectorAll('[data-cards]').forEach(function(el){
      try{ renderFlashcards(el, JSON.parse(el.getAttribute('data-cards'))); }
      catch(e){ el.textContent = 'Flashcards failed to render.'; }
    });
    initProgressList();
    initPrintButton();
  }

  // Exposed so a client-side router (the personal-site SPA build) can re-run
  // this after swapping in a new route's HTML — standalone artifact pages
  // never call this directly, they just get the auto-run below.
  window.HLDBibleEngine = { init: init };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
