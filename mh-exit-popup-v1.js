/*!
 * MH Exit Intent Popup — v3
 * Single source of truth for targeting/timing/kill: PostHog Surveys.
 * This JS detects exit triggers, asks PostHog which (if any) survey matches,
 * and renders the corresponding variant from the VARIANTS map below.
 *
 * Architecture + iteration recipes: clients/mh/wip/exit-intent/v3-symptom-map/SURVEYS-SPEC.md
 */
(function () {
  if (window._mhExitInit) return;
  window._mhExitInit = true;

  // Variant copy + visual config, keyed by PostHog Survey name.
  // To add a variant: create a survey in PostHog with this exact name + URL conditions,
  // and add an entry here. To rename a survey, update the key here too.
  var VARIANTS = {
    "MH Exit Intent — Global": {
      family: "global",
      variant: "symptom-map",
      eyebrow: "One thought",
      headline: "Hire by symptom, not by job title.",
      body: "Most don’t. Book a free call with a hiring strategist — we’ll match you to a marketer trained for your bottleneck.",
      cta: "Get Started",
      ctaAction: { type: "navigate", href: "/hire" },
      dismiss: "I know the role",
      rightCol: {
        type: "symptom-map",
        cap: "Symptom → Role",
        rows: [
          { symptom: "CAC creeping up", role: "PAID SOCIAL" },
          { symptom: "List dying",      role: "EMAIL OPS" },
          { symptom: "Brand stagnant",  role: "CONTENT LEAD" },
          { symptom: "Funnel leaking",  role: "CRO LEAD" }
        ]
      }
    },

    "MH Exit Intent — /hire": {
      family: "hire",
      variant: "60s-from-match",
      eyebrow: "Almost there",
      headline: "60 seconds from a match.",
      body: "Finish the form. A hiring strategist calls today. Your single best match in 24 hours.",
      cta: "Finish the form",
      ctaAction: { type: "dismiss" },
      dismiss: "Maybe later",
      rightCol: { type: "none" }
    }
  };

  // Safety-net path exclusion (defense in depth — PostHog Survey URL conditions are primary)
  var path = location.pathname.replace(/\/$/, "") || "/";
  if (/^\/(thank-you|ty-|cb-|hire\/ty-)/.test(path)) return;

  // QA mode
  var search = location.search;
  var QA_MODE = search.indexOf("qa=true") > -1;
  var QA_SURVEY = (function () {
    var m = search.match(/[?&]survey=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  })();

  // Per-family frequency cap (PostHog Survey wait_period is global across all surveys
  // on the project, so it's unsuitable when other PostHog surveys exist — e.g. MH's
  // "Open feedback" survey would suppress ours. JS-side per-family cap instead.)
  var FREQ_CAP_DAYS = 7;
  var freqKey = function (family) { return "mh_exit_popup_lastShown_" + family; };
  function recentlyShown(family) {
    if (QA_MODE) return false;
    try {
      var last = localStorage.getItem(freqKey(family));
      if (!last) return false;
      var daysSince = (Date.now() - parseInt(last, 10)) / (1000 * 60 * 60 * 24);
      return daysSince < FREQ_CAP_DAYS;
    } catch (e) { return false; }
  }
  function markShown(family) {
    if (QA_MODE) return;
    try { localStorage.setItem(freqKey(family), Date.now().toString()); } catch (e) {}
  }

  var state = { fired: false, survey: null, variant: null, openedAt: 0 };

  // ── Render ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function renderRightCol(spec) {
    if (!spec || spec.type === "none") return "";
    if (spec.type === "symptom-map") {
      var rows = (spec.rows || []).map(function (r) {
        return '<div class="mh-exit-map-row">' +
          '<span class="mh-exit-map-symptom">“' + esc(r.symptom) + '”</span>' +
          '<span class="mh-exit-map-arrow">→</span>' +
          '<span class="mh-exit-map-role">' + esc(r.role) + '</span>' +
          '</div>';
      }).join("");
      return '<div class="mh-exit-mockup">' +
        '<div class="mh-exit-mockup-cap">' + esc(spec.cap || "Symptom → Role") + '</div>' +
        '<div class="mh-exit-map">' + rows + '</div>' +
        '</div>';
    }
    return "";
  }

  function renderPopup(v) {
    var rc = renderRightCol(v.rightCol);
    var mod = rc === "" ? " mh-exit-popup--no-rightcol" : "";
    var isLink = v.ctaAction && v.ctaAction.type === "navigate";
    var tag = isLink ? "a" : "button";
    var attrs = isLink ? ' href="' + esc(v.ctaAction.href) + '"' : ' type="button"';
    return '<div class="mh-exit-popup' + mod + '">' +
      '<button class="mh-exit-close" aria-label="Close popup">×</button>' +
      '<div class="mh-exit-content">' +
        '<p class="mh-exit-eyebrow">' + esc(v.eyebrow) + '</p>' +
        '<h2 class="mh-exit-headline">' + esc(v.headline) + '</h2>' +
        '<p class="mh-exit-body">' + esc(v.body) + '</p>' +
        '<div class="mh-exit-spacer"></div>' +
        '<' + tag + ' class="mh-exit-cta"' + attrs + '>' +
          esc(v.cta) + ' <span class="mh-exit-arrow">→</span>' +
        '</' + tag + '>' +
        '<button class="mh-exit-dismiss">' + esc(v.dismiss) + '</button>' +
      '</div>' +
      '<div class="mh-exit-image-col">' + rc + '</div>' +
    '</div>';
  }

  // ── Tracking ──────────────────────────────────────────────────────────────
  // PostHog: native survey events (survey shown/dismissed/sent), carrying our family + variant
  // GA4/GTM: dataLayer push of mh_exit_popup_* events (preserves existing GTM tag contract)
  window.dataLayer = window.dataLayer || [];

  function ph(event, props) {
    if (window.posthog && posthog.capture) {
      try { posthog.capture(event, props); } catch (e) {}
    }
  }

  function survey_meta() {
    var s = state.survey;
    return s ? {
      $survey_id: s.id,
      $survey_name: s.name,
      $survey_iteration: s.current_iteration,
      $survey_iteration_start_date: s.current_iteration_start_date
    } : {};
  }

  function track_shown() {
    var v = state.variant;
    var base = { mh_popup: v.family, mh_popup_variant: v.variant };
    var phProps = {};
    var k;
    var m = survey_meta();
    for (k in m) phProps[k] = m[k];
    for (k in base) phProps[k] = base[k];
    ph("survey shown", phProps);
    dataLayer.push({ event: "mh_exit_popup_shown", mh_popup: v.family, mh_popup_variant: v.variant });
  }

  function track_dismiss(method) {
    var v = state.variant;
    var dur = state.openedAt ? String(Date.now() - state.openedAt) : null;
    var base = { mh_popup: v.family, mh_popup_variant: v.variant, mh_dismiss_method: method, mh_popup_duration_ms: dur };
    var phProps = {};
    var k;
    var m = survey_meta();
    for (k in m) phProps[k] = m[k];
    for (k in base) phProps[k] = base[k];
    ph("survey dismissed", phProps);
    dataLayer.push({ event: "mh_exit_popup_dismiss", mh_popup: v.family, mh_popup_variant: v.variant, mh_dismiss_method: method, mh_popup_duration_ms: dur });
  }

  function track_cta(destination) {
    var v = state.variant;
    var base = { mh_popup: v.family, mh_popup_variant: v.variant, mh_destination: destination };
    var phProps = {};
    var k;
    var m = survey_meta();
    for (k in m) phProps[k] = m[k];
    for (k in base) phProps[k] = base[k];
    var qId = state.survey && state.survey.questions && state.survey.questions[0] && state.survey.questions[0].id;
    if (qId) phProps["$survey_response_" + qId] = destination;
    ph("survey sent", phProps);
    dataLayer.push({ event: "mh_exit_popup_cta_click", mh_popup: v.family, mh_popup_variant: v.variant, mh_destination: destination });
  }

  // ── Show / hide / dismiss / CTA ───────────────────────────────────────────
  function $overlay() { return document.getElementById("mh-exit-popup-overlay"); }
  function isOpen() { var o = $overlay(); return !!o && o.classList.contains("active"); }

  function show() {
    var o = $overlay();
    if (!o || isOpen()) return;
    o.classList.add("active");
    document.body.style.overflow = "hidden";
    state.openedAt = Date.now();
    markShown(state.variant.family);
    track_shown();
  }

  function hide() {
    var o = $overlay();
    if (!o || !isOpen()) return;
    o.classList.remove("active");
    document.body.style.overflow = "";
    state.openedAt = 0;
  }

  function dismiss(method) {
    if (!isOpen()) return;
    track_dismiss(method);
    hide();
  }

  function onCta(e) {
    var v = state.variant;
    var action = v.ctaAction || { type: "navigate", href: "/hire" };
    var dest = "dismiss";
    if (action.type === "navigate") {
      dest = action.href;
      try { var a = document.createElement("a"); a.href = action.href; dest = a.pathname; } catch (err) {}
    }
    track_cta(dest);
    try {
      sessionStorage.setItem("mh_exit_popup_clicker", "true");
      sessionStorage.setItem("mh_exit_popup_clicker_family", v.family);
      sessionStorage.setItem("mh_exit_popup_clicker_variant", v.variant);
    } catch (err) {}
    if (action.type !== "navigate") {
      if (e && e.preventDefault) e.preventDefault();
      hide();
    } else {
      hide();
    }
  }

  function bind() {
    var c = document.querySelector(".mh-exit-close");
    if (c) c.addEventListener("click", function () { dismiss("close_x"); });
    var d = document.querySelector(".mh-exit-dismiss");
    if (d) d.addEventListener("click", function () { dismiss("no_thanks"); });
    var o = $overlay();
    if (o) o.addEventListener("click", function (e) { if (e.target === this) dismiss("backdrop"); });
    var cta = document.querySelector(".mh-exit-cta");
    if (cta) cta.addEventListener("click", onCta);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen()) dismiss("escape"); });
  }

  // ── Activate (survey-matched OR QA-forced) ────────────────────────────────
  function activate(variantConfig, survey) {
    state.variant = variantConfig;
    state.survey = survey || null;
    state.fired = true;
    var o = $overlay();
    if (!o) return;
    o.innerHTML = renderPopup(variantConfig);
    bind();
    show();
  }

  // URL match (mirrors PostHog Survey condition evaluation client-side; needed because
  // posthog.getActiveMatchingSurveys filters OUT type:api surveys — we use getSurveys
  // instead and apply URL match ourselves).
  function urlMatches(pattern, matchType, url) {
    if (!pattern) return true;
    try {
      if (matchType === "regex") return new RegExp(pattern).test(url);
      if (matchType === "exact") return url === pattern || url.replace(/\/$/, "") === pattern.replace(/\/$/, "");
      if (matchType === "not_icontains") return url.toLowerCase().indexOf(pattern.toLowerCase()) === -1;
      // default: icontains
      return url.toLowerCase().indexOf(pattern.toLowerCase()) > -1;
    } catch (e) { return false; }
  }

  function surveyMatches(s, currentUrl) {
    if (s.archived) return false;
    if (s.end_date) return false;
    if (s.start_date && new Date(s.start_date) > new Date()) return false;
    var c = s.conditions || {};
    return urlMatches(c.url, c.urlMatchType, currentUrl);
  }

  function checkAndShow() {
    if (state.fired || isOpen()) return;

    // QA force: bypass PostHog, render the specified family directly
    if (QA_SURVEY) {
      if (QA_SURVEY === "off") return;
      for (var name in VARIANTS) {
        if (VARIANTS[name].family === QA_SURVEY) { activate(VARIANTS[name], null); return; }
      }
      return;
    }

    if (!window.posthog || !posthog.getSurveys) return;

    posthog.getSurveys(function (surveys) {
      if (!surveys || !surveys.length || state.fired) return;
      var currentUrl = location.href;
      // First survey that: matches the current URL, has a mapped variant, and isn't freq-capped
      for (var i = 0; i < surveys.length; i++) {
        var sv = surveys[i];
        if (!surveyMatches(sv, currentUrl)) continue;
        var v = VARIANTS[sv.name];
        if (!v) continue; // unmapped survey (e.g. "Open feedback") — silently skip
        if (recentlyShown(v.family)) continue; // freq cap (per-family)
        activate(v, sv);
        return;
      }
    }, QA_MODE); // forceReload re-fetches survey definitions when in QA mode
  }

  // ── Trigger detection (exit intent + scroll-up) ───────────────────────────
  function armTriggers() {
    // Desktop: mouse exits viewport top
    document.addEventListener("mouseout", function (e) {
      if (e.clientY <= 0 && !(e.relatedTarget || e.toElement)) checkAndShow();
    });

    // Mobile: scroll-up past hero (v1.3 — 35px threshold past one full viewport)
    var lastY = pageYOffset || 0, maxY = 0, upDist = 0;
    var minDown = innerHeight, threshold = 35;
    addEventListener("scroll", function () {
      var y = pageYOffset || 0;
      if (y > maxY) maxY = y;
      if (y < lastY && maxY >= minDown) {
        upDist += lastY - y;
        if (upDist >= threshold) { checkAndShow(); upDist = 0; }
      } else if (y > lastY) {
        upDist = Math.max(0, upDist - (y - lastY));
      }
      lastY = y;
    });
  }

  function init() { setTimeout(armTriggers, 5000); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/*!
 * Attribution snippet — runs on every page (including TY pages).
 * Carries the popup-clicker family + variant forward so downstream events
 * (form completion, etc.) can be attributed to the originating popup.
 */
(function () {
  try {
    if (sessionStorage.getItem("mh_exit_popup_clicker") !== "true") return;
    var fam = sessionStorage.getItem("mh_exit_popup_clicker_family") || null;
    var vrt = sessionStorage.getItem("mh_exit_popup_clicker_variant") || null;
    window.dataLayer = window.dataLayer || [];
    dataLayer.push({
      event: "mh_exit_popup_attribution",
      mh_exit_popup_clicker: "true",
      mh_popup: fam,
      mh_popup_variant: vrt
    });
    if (window.posthog && posthog.capture) {
      try {
        posthog.capture("mh_exit_popup_attribution", {
          mh_exit_popup_clicker: "true",
          mh_popup: fam,
          mh_popup_variant: vrt
        });
      } catch (e) {}
    }
  } catch (e) {}
})();
