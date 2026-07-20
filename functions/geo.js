// Cloudflare Pages Function — visitor geo lookup.
//
// Endpoint: https://cdn.allcare-ga.com/geo
// Used by:  acg-personalization-v1.js, loaded on every ACG surface (see ALLOWED_ORIGINS):
//           apex + www + Webflow staging + legacy `go` LP + the Voxology booking subdomains.
//
// Returns the visitor's coarse location from Cloudflare's edge request metadata
// (MaxMind data, ~85-90% city-accurate in US for residential IPs). Replaces the
// previous third-party ipinfo.io call: same data quality, sub-50ms latency,
// served from the client's own CDN subdomain — no third-party IP lookup, no BAA
// gap, no referrer leakage concern.
//
// `request.cf.*` fields documented at:
//   https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties

const ALLOWED_ORIGINS = new Set([
  'https://allcare-ga.com',             // primary apex (production)
  'https://www.allcare-ga.com',         // www
  'https://allcare-3214b1.webflow.io',  // Webflow staging (new full site)
  'https://go.allcare-ga.com',          // legacy Phase-1 LP subdomain (may retire post-launch)
  'https://schedule.allcare-ga.com',    // Voxology booking subdomain (prod; not yet integrated)
  'https://dev.schedule.voxology.ai',   // Voxology booking dev subdomain (forward-looking)
]);

function corsHeaders(origin) {
  // Reflect the request Origin when allowlisted; otherwise return the apex (a
  // disallowed origin then fails CORS by design). Fallback is the apex, not `go`,
  // since `go` may be retired after launch.
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://allcare-ga.com';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // `no-store` is the only directive CF Pages reliably honors at the edge.
      // Without it, the function response gets cached globally and every visitor
      // sees the same coords (and the same paired clinic). `private` alone is
      // not enough — observed in prod 2026-05-20 returning Westminster CO to
      // every visitor regardless of IP. Adding `_headers` rule for /geo as well.
      'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'CDN-Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

export function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin')) });
}

export function onRequestGet({ request }) {
  const origin = request.headers.get('Origin');
  const cf = request.cf || {};

  const lat = cf.latitude ? parseFloat(cf.latitude) : null;
  const lng = cf.longitude ? parseFloat(cf.longitude) : null;

  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
    return jsonResponse({ ok: false, reason: 'no_geo' }, 200, origin);
  }

  return jsonResponse({
    ok: true,
    lat: lat,
    lng: lng,
    city: cf.city || null,
    region: cf.region || null,
    regionCode: cf.regionCode || null,
    country: cf.country || null,
    postalCode: cf.postalCode || null,
    timezone: cf.timezone || null,
    colo: cf.colo || null,
  }, 200, origin);
}
