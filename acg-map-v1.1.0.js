/*
  acg-map v1.1.0 (CDN file acg-map-v1.1.0.js; v1.0.0 stays frozen at acg-map-v1.js). The
  AllCare Georgia clinic map on the Google Maps JavaScript API. Replaces the Leaflet + CARTO
  map that ran on /locations, both landing pages and the Map Section component.

  Loader line: <script src="https://cdn.allcare-ga.com/acg-map-v1.1.0.js"
    data-key="{{ACG_GOOGLE_MAPS_BROWSER_KEY}}" data-map-id="66bce3cb07aebf92cbe23dd0" defer></script>

  The module reads its own tag for the key and the optional Map ID, then targets the first
  [data-acg-map] element. No such element and it does nothing; an element another copy of
  the module already claimed is left to it (v1.1.0), so a page that carries the loader line
  twice draws one map. Clinic data comes from window.ACG (acg-personalization).

  Cards (v1.1.0): every card lookup stays inside the map's own <section> (or the document
  when the map sits in none), so the clinic bar's panel rows and a hero card on the same
  page are never mistaken for the map's cards: pin numbers follow the section's list, a pin
  click scrolls the section's card, the Book href comes from it, and card taps and hovers
  are wired on the section's list. See site-map/README.md for the deploy and page edits.

  Referrer: the site sets <meta name="referrer" content="no-referrer"> and the browser key is
  referrer-restricted, so the bootstrap script carries
  referrerpolicy="strict-origin-when-cross-origin" and the origin still reaches Google.
*/
(function () {
  'use strict';

  var TAG = document.currentScript;
  var KEY = TAG ? TAG.getAttribute('data-key') : '';
  var MAP_ID = TAG ? TAG.getAttribute('data-map-id') : '';
  var CALLBACK = '__acgMapsReady';
  var BLUE = '#225ba7', HOVER = '#1d4d8f', AMBER = '#f59e0b';
  var CENTER = { lat: 33.79, lng: -84.39 };

  var CSS = '[data-acg-map]{position:relative;width:100%;height:100%;min-height:480px;border-radius:12px;background:#eef2f6;overflow:hidden}'
    + '.acg-pin{display:flex;align-items:center;justify-content:center;width:30px;height:30px;background:' + BLUE + ';color:#fff;border:2px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.25);font:700 13px/1 var(--font-family-body,system-ui);transition:transform 120ms ease,background 120ms ease}'
    + '.acg-pin.is-hover{background:' + HOVER + ';transform:scale(1.12)}.acg-pin.is-nearest{background:' + AMBER + ';transform:scale(1.18)}'
    + '.acg-pop{min-width:210px;line-height:1.4;font-family:var(--font-family-body,system-ui)}'
    + '.acg-pop-name{color:#111827;font-size:15px;font-weight:700;margin-bottom:4px}'
    + '.acg-pop-addr{color:#6b7280;font-size:13px;white-space:pre-line;margin-bottom:8px}'
    + '.acg-pop-meta{color:#374151;font-size:12px;margin-bottom:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}'
    + '.acg-pop-status{color:#15803d;font-weight:600}.acg-pop-status.is-closed{color:#b91c1c}'
    + '.acg-pop-actions{display:flex;gap:6px;flex-wrap:wrap}.acg-pop-btn{flex:1;min-width:64px;padding:8px 10px;font-size:12px;font-weight:600;text-align:center;text-decoration:none;border-radius:6px}'
    + '.acg-pop-btn.is-primary{background:#1D4987;color:#fff}.acg-pop-btn.is-secondary{background:#f3f4f6;color:#111827}'
    + '[data-clinic-slug].acg-flash{animation:acg-flash 1.1s ease}'
    + '@keyframes acg-flash{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,0)}25%{box-shadow:0 0 0 4px rgba(245,158,11,.45)}}';

  // Inline, so the fallback still renders if the stylesheet never got in.
  var FALLBACK_STYLE = 'display:flex;align-items:center;justify-content:center;height:100%;'
    + 'min-height:240px;padding:16px;color:' + BLUE + ';font-weight:600;text-decoration:none';

  var mapEl = null, root = null, map = null, info = null, clinics = null;
  var AdvMarker = null, Classic = null, useAdvanced = false, started = false;
  var markers = {}, meta = {};

  function injectStyle() {
    if (document.getElementById('acg-map-css')) return;
    var s = document.createElement('style');
    s.id = 'acg-map-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function showFallback() {
    if (!mapEl || mapEl.getAttribute('data-acg-map-state') === 'fallback') return;
    mapEl.setAttribute('data-acg-map-state', 'fallback');
    mapEl.innerHTML = '<a target="_blank" rel="noopener" style="' + FALLBACK_STYLE + '"'
      + ' href="https://www.google.com/maps/search/AllCare+Georgia">View locations on Google Maps</a>';
  }

  // Same wait the Leaflet code used: poll for the library for two seconds.
  function waitForAcg(cb) {
    if (window.ACG && window.ACG.version) { cb(); return; }
    var n = 0;
    var id = setInterval(function () {
      if (window.ACG && window.ACG.version) { clearInterval(id); cb(); }
      else if (++n > 50) { clearInterval(id); showFallback(); }
    }, 40);
  }

  // Google's dynamic library import bootstrap. The callback hands back a google.maps that
  // carries importLibrary, which is how the maps and marker libraries are pulled in.
  function loadApi() {
    return new Promise(function (resolve, reject) {
      var g = window.google;
      if (g && g.maps && g.maps.importLibrary) { resolve(); return; }
      window[CALLBACK] = function () { resolve(); };
      var s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(KEY)
        + '&v=weekly&loading=async&callback=' + CALLBACK;
      s.async = true;
      s.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      s.onerror = function () { reject(new Error('Maps JS API failed to load')); };
      document.head.appendChild(s);
    });
  }

  function cardFor(slug) { return root.querySelector('[data-clinic-slug="' + slug + '"]'); }

  // The booking URL is whatever the card's own CTA carries, so the map never invents a path.
  function bookHref(slug) {
    var card = cardFor(slug);
    var a = card ? card.querySelector('[data-clinic="book-href"]') : null;
    return a ? (a.getAttribute('href') || '') : '';
  }

  // A bare lat,lng destination makes Google label the drop pin with the nearest street
  // address, which is a different building for several clinics. The name plus the full
  // address routes to the clinic itself. Apostrophes are escaped because the href is
  // concatenated into a double-quoted attribute.
  function directionsHref(loc) {
    var name = String(loc.display || '');
    if (name.indexOf('AllCare') !== 0) name = 'AllCare ' + name;
    var dest = name + ', ' + loc.address + ', ' + loc.city + ', ' + loc.state + ' ' + loc.zip;
    return 'https://www.google.com/maps/dir/?api=1&destination='
      + encodeURIComponent(dest).replace(/'/g, '%27');
  }

  function distanceLabel(loc, state) {
    var geo = state && state.geo ? state.geo : null;
    if (!geo) return '';
    var u = window.ACG.utils;
    return u.formatDistance(u.haversine(geo.lat, geo.lng, loc.lat, loc.lng), 'short', state.precision) || '';
  }

  function infoHtml(slug, loc, state) {
    var st = window.ACG.utils.calculateStatus(loc);
    var dist = distanceLabel(loc, state);
    var book = bookHref(slug);
    var dir = directionsHref(loc);
    var tel = 'tel:' + String(loc.phone || '').replace(/[^0-9+]/g, '');
    return [
      '<div class="acg-pop">',
      '<div class="acg-pop-name">', loc.display, '</div>',
      '<div class="acg-pop-addr">', loc.address, '\n', loc.city, ', ', loc.state, ' ', loc.zip, '</div>',
      '<div class="acg-pop-meta">',
      '<span class="acg-pop-status', st.isOpen ? '' : ' is-closed', '">', st.isOpen ? 'Open' : 'Closed', '</span>',
      // No bullet dividers (Connor, REVIEW-1): the row's own gap spaces the items.
      '<span>', st.hours, '</span>',
      dist ? '<span>' + dist + '</span>' : '',
      '</div><div class="acg-pop-actions" data-acg-placement="map-pin">',
      '<a class="acg-pop-btn is-secondary" href="', dir, '" target="_blank" rel="noopener"',
      ' data-track="directions" data-track-location="map-pin-', slug, '">Directions</a>',
      '<a class="acg-pop-btn is-secondary" href="', tel, '"',
      ' data-track="click_to_call" data-track-location="map-pin-', slug, '">Call</a>',
      // data-clinic="book-href" + data-location: the library's observer keeps the href current
      // (visit_type, modality, the ad tags) and its click event reports the tap (v1.1.0).
      book ? ('<a class="acg-pop-btn is-primary" href="' + book + '" data-clinic="book-href"'
        + ' data-location="' + slug + '" data-track="book_appointment"'
        + ' data-track-location="map-pin-' + slug + '">Book</a>') : '',
      '</div></div>'
    ].join('');
  }

  function svgIcon(num, fill) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">'
      + '<circle cx="15" cy="15" r="13" fill="' + fill + '" stroke="#fff" stroke-width="2"/>'
      + '<text x="15" y="19.5" text-anchor="middle" font-family="system-ui,sans-serif"'
      + ' font-size="13" font-weight="700" fill="#fff">' + num + '</text></svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new window.google.maps.Size(30, 30),
      anchor: new window.google.maps.Point(15, 15)
    };
  }

  function applyPin(slug) {
    var m = markers[slug], st = meta[slug];
    if (!m || !st) return;
    if (useAdvanced) {
      if (!m.content) return;
      m.content.className = 'acg-pin' + (st.nearest ? ' is-nearest' : '') + (st.hover ? ' is-hover' : '');
      m.content.textContent = st.num || '';
      m.zIndex = st.nearest ? 1000 : 1;
      return;
    }
    m.setIcon(svgIcon(st.num || '', st.nearest ? AMBER : (st.hover ? HOVER : BLUE)));
    m.setZIndex(st.nearest ? 1000 : 1);
  }

  // Card order drives pin numbers. The list sorts nearest-first, so the numbers match the
  // list top to bottom. A clinic with no card falls to the end.
  function slugsInCardOrder() {
    var order = [];
    Array.prototype.forEach.call(root.querySelectorAll('[data-clinic-slug]'), function (c) {
      var s = c.getAttribute('data-clinic-slug');
      if (clinics[s] && order.indexOf(s) < 0) order.push(s);
    });
    Object.keys(clinics).forEach(function (s) { if (order.indexOf(s) < 0) order.push(s); });
    return order;
  }

  function render(state) {
    var nearest = (state && state.paired && state.clinicKey) ? state.clinicKey : null;
    slugsInCardOrder().forEach(function (slug, i) {
      if (!meta[slug]) meta[slug] = { hover: false };
      meta[slug].num = i + 1;
      meta[slug].nearest = (slug === nearest);
      applyPin(slug);
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-clinic-slug]'), function (c) {
      c.classList.toggle('acg-nearest', !!nearest && c.getAttribute('data-clinic-slug') === nearest);
    });
  }

  function openInfo(slug) {
    if (!info) return;
    info.setContent(infoHtml(slug, clinics[slug], window.ACG.getLocation()));
    info.open({ map: map, anchor: markers[slug] });
  }

  function focusCard(slug) {
    var card = cardFor(slug);
    if (!card) return;
    if (card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('acg-flash');
    setTimeout(function () { card.classList.remove('acg-flash'); }, 1100);
  }

  function addMarker(slug, loc) {
    var opts = { map: map, position: { lat: loc.lat, lng: loc.lng }, title: loc.display };
    var m;
    if (useAdvanced) {
      var el = document.createElement('div');
      el.className = 'acg-pin';
      opts.content = el;
      m = new AdvMarker(opts);
    } else {
      opts.icon = svgIcon('', BLUE);
      m = new Classic(opts);
    }
    markers[slug] = m;
    meta[slug] = { num: '', nearest: false, hover: false };
    m.addListener('click', function () { openInfo(slug); focusCard(slug); });
  }

  function slugFromEvent(e) {
    var c = e.target && e.target.closest ? e.target.closest('[data-clinic-slug]') : null;
    return c ? c.getAttribute('data-clinic-slug') : null;
  }

  function setHover(e, on) {
    var slug = slugFromEvent(e);
    if (!slug || !meta[slug]) return;
    meta[slug].hover = on;
    applyPin(slug);
  }

  // A card click pans the map to that clinic and opens its window. Links and buttons inside
  // the card still navigate.
  function onCardClick(e) {
    if (e.target.closest && e.target.closest('a, button')) return;
    var slug = slugFromEvent(e);
    if (!slug || !markers[slug] || !map) return;
    if (mapEl.scrollIntoView) mapEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    map.panTo({ lat: clinics[slug].lat, lng: clinics[slug].lng });
    openInfo(slug);
    setHover({ target: cardFor(slug) }, true);
    setTimeout(function () { setHover({ target: cardFor(slug) }, false); }, 1500);
  }

  // Delegation on the section's list, so re-sorted CMS cards keep their wiring.
  function wireCards() {
    var list = root.querySelector('[data-clinic-list]') || root;
    list.addEventListener('mouseover', function (e) { setHover(e, true); });
    list.addEventListener('mouseout', function (e) { setHover(e, false); });
    list.addEventListener('click', onCardClick);
  }

  function initMap(mapsLib, markerLib) {
    clinics = window.ACG.clinics;
    AdvMarker = markerLib ? markerLib.AdvancedMarkerElement : null;
    Classic = (markerLib && markerLib.Marker) || window.google.maps.Marker;
    useAdvanced = !!(MAP_ID && AdvMarker);
    var opts = {
      center: CENTER, zoom: 10, scrollwheel: false, gestureHandling: 'cooperative',
      mapTypeControl: false, streetViewControl: false
    };
    if (MAP_ID) opts.mapId = MAP_ID;
    map = new mapsLib.Map(mapEl, opts);
    info = new mapsLib.InfoWindow();
    var bounds = new window.google.maps.LatLngBounds();
    Object.keys(clinics).forEach(function (slug) {
      addMarker(slug, clinics[slug]);
      bounds.extend({ lat: clinics[slug].lat, lng: clinics[slug].lng });
    });
    map.fitBounds(bounds, 40);
    render(window.ACG.getLocation());
    document.documentElement.addEventListener('acg:resolved', function (e) {
      render(e.detail || window.ACG.getLocation());
    });
    wireCards();
  }

  function start() {
    if (started) return;
    started = true;
    waitForAcg(function () {
      loadApi().then(function () {
        return Promise.all([
          window.google.maps.importLibrary('maps'),
          window.google.maps.importLibrary('marker')
        ]);
      }).then(function (libs) { initMap(libs[0], libs[1]); })
        .catch(function () { showFallback(); });
    });
  }

  mapEl = document.querySelector('[data-acg-map]');
  if (!mapEl) return;
  // One module per map element: a second copy of the loader on the same page does nothing.
  if (mapEl.getAttribute('data-acg-map-claimed')) return;
  mapEl.setAttribute('data-acg-map-claimed', '1');
  root = (mapEl.closest && mapEl.closest('section')) || document;
  injectStyle();
  window.gm_authFailure = showFallback;
  if (!KEY) { showFallback(); return; }
  // Load on scroll-near, so the map costs nothing on first paint.
  if (window.IntersectionObserver) {
    var io = new window.IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { start(); io.disconnect(); } });
    }, { rootMargin: '200px' });
    io.observe(mapEl);
  } else {
    start();
  }
})();
