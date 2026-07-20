/**
 * ACG Vox booking split — v1.0.1 (2026-07-14): TARGET moved to /p/33029 — the root 307 strips query params (verified live); deep path echoes all handoff params.
 *
 * Routes PostHog experiment test-arm visitors from Yosi booking (www) to
 * Voxology on schedule.allcare-ga.com. Two layers, same flag:
 *   1. Link rewrite: booking CTA hrefs -> schedule. + handoff params.
 *   2. Choke-point: on /book-an-appointment + /book/start, redirect test-arm
 *      direct entries / stale links.
 *
 * Flag: vox-booking-rollout (project 502127). Variants control(80)/test(20).
 * Inert while release condition = 0% (getFeatureFlag returns undefined).
 * Rollback = release condition to 0%; script self-neutralizes.
 *
 * QA override: ?vox=1 forces test arm, ?vox=0 forces control (sessionStorage
 * persist, no experiment exposure registered). Forced-test URL: ?vox=1&qa=1.
 *
 * Ordering: loads in footer, after personalization lib v1.17 (head, defer) and
 * acg_posthog_init_v2 (header). Lib re-applies its own bookHref() on every
 * acg:resolved and on DOM inserts, so we re-run after each of those and win;
 * rewrite is idempotent.
 *
 * Never rewritten: provider ?w links (Yosi both arms), embedded Yosi widgets
 * (iframes), /book-virtual-care-visit (until Vox confirms virtual in v1 — flip
 * VIRTUAL_ENABLED).
 */
(function () {
  'use strict';
  if (window.__acgVoxSplit) return;
  window.__acgVoxSplit = { version: '1.0.1', arm: null };

  var FLAG = 'vox-booking-rollout';
  var TARGET = 'https://schedule.allcare-ga.com/p/33029';
  var VIRTUAL_ENABLED = false; // R7: flip only if Vox confirms virtual bookable in v1
  var OVERRIDE_KEY = 'acg_vox_override';
  var ATTR_KEY = 'acg_vox_attr';
  var ATTRIBUTION = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid'];
  var BOOK_PATHS = ['/book-an-appointment', '/book/start', '/book'];
  var CHOKE_PATHS = ['/book-an-appointment', '/book/start'];

  function ss(get, key, val) {
    try { return get ? sessionStorage.getItem(key) : sessionStorage.setItem(key, val); } catch (e) { return null; }
  }

  // --- capture override + attribution + qa from the landing URL, persist for the session
  var pageParams = new URLSearchParams(location.search);
  if (pageParams.get('vox') === '1' || pageParams.get('vox') === '0') ss(false, OVERRIDE_KEY, pageParams.get('vox'));
  (function persistAttr() {
    var stored = {};
    try { stored = JSON.parse(ss(true, ATTR_KEY) || '{}'); } catch (e) { stored = {}; }
    var found = false;
    ATTRIBUTION.concat(['qa']).forEach(function (k) {
      var v = pageParams.get(k);
      if (v) { stored[k] = v; found = true; }
    });
    if (found) ss(false, ATTR_KEY, JSON.stringify(stored));
  })();

  function storedAttr() {
    try { return JSON.parse(ss(true, ATTR_KEY) || '{}'); } catch (e) { return {}; }
  }

  function isQa() {
    return pageParams.get('qa') === '1' || storedAttr().qa === '1';
  }

  // --- arm resolution
  function overrideArm() {
    var o = ss(true, OVERRIDE_KEY);
    if (o === '1') return 'test';
    if (o === '0') return 'control';
    return null;
  }

  function flagArm() {
    // getFeatureFlag (not payload read) so $feature_flag_called registers — the
    // experiment denominator (integrity decision 4).
    if (!(window.posthog && window.posthog.getFeatureFlag)) return null;
    var v = window.posthog.getFeatureFlag(FLAG);
    return v === 'test' || v === 'control' ? v : null;
  }

  // --- handoff URL builder
  function buildHandoff(srcParams) {
    var out = new URLSearchParams();
    var intent = (srcParams.get('intent') || '').toLowerCase();
    out.set('visit_type', intent === 'urgent' || intent === 'primary' ? intent : 'default');
    out.set('modality', srcParams.get('modality') === 'virtual' ? 'virtual' : 'default');
    var loc = srcParams.get('location');
    if (loc) out.set('location', loc.toLowerCase().replace(/_/g, '-'));
    var attr = storedAttr();
    ATTRIBUTION.forEach(function (k) {
      var v = pageParams.get(k) || attr[k];
      if (v) out.set(k, v);
    });
    try {
      if (window.posthog && window.posthog.get_distinct_id) out.set('ph_did', window.posthog.get_distinct_id());
    } catch (e) { /* handoff still valid without ph_did; cookie carries identity */ }
    if (isQa()) out.set('qa', '1');
    return TARGET + '?' + out.toString();
  }

  function bookingLink(a) {
    var href = a.getAttribute('href');
    if (!href || href.indexOf(TARGET) === 0) return null; // already rewritten
    var url;
    try { url = new URL(href, location.origin); } catch (e) { return null; }
    if (url.origin !== location.origin) return null;
    if (BOOK_PATHS.indexOf(url.pathname.replace(/\/$/, '')) === -1) {
      if (!(VIRTUAL_ENABLED && url.pathname.replace(/\/$/, '') === '/book-virtual-care-visit')) return null;
      url.searchParams.set('modality', 'virtual');
    }
    if (url.searchParams.get('w')) return null; // provider widget link: Yosi both arms
    return url;
  }

  function rewriteAll() {
    if (window.__acgVoxSplit.arm !== 'test') return;
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var url = bookingLink(links[i]);
      if (url) links[i].setAttribute('href', buildHandoff(url.searchParams));
    }
  }

  function chokePoint() {
    if (window.__acgVoxSplit.arm !== 'test') return;
    var path = location.pathname.replace(/\/$/, '');
    if (CHOKE_PATHS.indexOf(path) === -1) return;
    if (pageParams.get('w')) return; // provider form stays on Yosi
    location.replace(buildHandoff(pageParams));
  }

  // --- activation
  var observing = false;
  function activate(arm) {
    window.__acgVoxSplit.arm = arm;
    if (isQa() && window.posthog) {
      try { (window.posthog.register_for_session || window.posthog.register).call(window.posthog, { qa: true }); } catch (e) { /* qa exclusion falls back to URL param */ }
    }
    if (arm !== 'test') return;
    chokePoint();
    rewriteAll();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rewriteAll);
    // lib v1.17 re-applies bookHref() on every acg:resolved — re-run after it
    document.documentElement.addEventListener('acg:resolved', function () { setTimeout(rewriteAll, 0); });
    if (!observing && window.MutationObserver) {
      observing = true;
      new MutationObserver(function () { rewriteAll(); }).observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['href']
      });
    }
  }

  var forced = overrideArm();
  if (forced) {
    activate(forced); // QA path: no flag call, no exposure pollution
    return;
  }

  var tries = 0;
  (function waitForPosthog() {
    if (window.posthog && window.posthog.onFeatureFlags) {
      window.posthog.onFeatureFlags(function () {
        var arm = flagArm();
        if (arm && !window.__acgVoxSplit.arm) activate(arm);
      });
    } else if (++tries < 40) {
      setTimeout(waitForPosthog, 250); // header init should beat us; belt-and-suspenders
    }
  })();
})();
