// Cloudflare Pages Function — visitor geo lookup.
//
// Endpoint: https://cdn.allcare-ga.com/geo
// Used by:  acg-personalization-v1.js (loaded on go.allcare-ga.com + allcare-ga.com)
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
  'https://go.allcare-ga.com',
  'https://allcare-ga.com',
  'https://www.allcare-ga.com',
]);

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://go.allcare-ga.com';
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
      'Cache-Control': 'private, max-age=300',
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
