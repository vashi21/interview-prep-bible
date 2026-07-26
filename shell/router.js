/* HLD Interview-Prep Bible — personal-site router (build_spa.py only).
   Hash-based so it works on plain static hosting (GitHub Pages) with zero
   server config: a hash never triggers a real navigation/request, so a
   refresh or a direct deep link both just re-run this same client-side logic. */
(function(){
  var app;

  function parseHash(){
    var h = location.hash.replace(/^#\/?/, '');
    return h.split('/').filter(Boolean);
  }

  function notFoundHtml(){
    return '<div class="wrap"><p class="lede">That page does not exist.</p>' +
      '<p><a href="#/">&larr; Back to start</a></p></div>';
  }

  function render(){
    // A plain in-page anchor (e.g. "#chapters", from "Browse all chapters")
    // is not a route — every real route starts with "#/". Leave anything
    // else alone so the browser's native same-page anchor-scroll still works,
    // instead of hijacking it into a full route re-render (and losing the
    // very section being scrolled to, since it never runs the anchor's
    // default scroll against freshly-injected content).
    if (location.hash && location.hash.indexOf('#/') !== 0) return;

    var routes = window.__ROUTES__ || {};
    var titles = window.__TITLES__ || {};
    var parts = parseHash();
    var html, title;

    if (parts.length === 0){
      html = window.__VOLUME_SELECTOR_HTML__ || notFoundHtml();
      title = 'Interview-Prep Bible';
    } else if (parts[0] === 'hld' && parts.length === 1){
      html = routes.hub || notFoundHtml();
      title = titles.hub || 'HLD Bible';
    } else if (parts[0] === 'hld' && parts[1]){
      var m = parts[1].match(/^ch(\d+)$/);
      var key = m ? 'ch' + m[1] : null;
      if (key && routes[key]){
        html = routes[key];
        title = titles[key] || 'HLD Bible';
      } else {
        html = notFoundHtml();
        title = 'Not found';
      }
    } else {
      html = notFoundHtml();
      title = 'Not found';
    }

    app.innerHTML = html;
    document.title = title;
    window.scrollTo(0, 0);
    if (window.HLDBibleEngine && window.HLDBibleEngine.init) window.HLDBibleEngine.init();
  }

  function boot(){
    app = document.getElementById('app');
    render();
    window.addEventListener('hashchange', render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
