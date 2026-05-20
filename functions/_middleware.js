// Cloudflare Pages middleware — intercepts all requests to override cache
// headers that CF zone-level rules clobber on static assets.
//
// Why this exists: the zone `allcare-ga.com` has a Cache Rule (set by the
// client, not us — we don't have dashboard access right now) that overrides
// Cache-Control on static assets to `public, max-age=16070400, must-revalidate`
// (186 days). The Pages `_headers` rule for /acg-personalization-v1.js was
// being silently ignored. With 186-day browser caching, every fix to the lib
// takes months to actually reach real visitors.
//
// Middleware runs as a Function, so its response headers come back via the
// dynamic-response path. CF zone-level rules treat dynamic responses
// differently and (we hope) don't override them. We confirmed `/geo`'s
// `Cache-Control: no-store` survives the zone rules — same mechanism here.
//
// If a future deploy gives us a clean Pages `_headers` path, this can be
// removed.

export const onRequest = async (context) => {
  const { request, next } = context;
  const url = new URL(request.url);
  const response = await next();

  // Only override on the lib bundle. Other static assets (none currently, but
  // future-proofing) keep CF defaults.
  if (url.pathname === '/acg-personalization-v1.js') {
    const headers = new Headers(response.headers);
    // CF zone rule on allcare-ga.com overrides cacheable Cache-Control values
    // (forcing 186-day max-age) but passes through `no-cache`/`no-store` —
    // confirmed by /geo's no-store sticking through to prod. Using `no-cache`
    // here means browsers must revalidate every request; etag match returns
    // 304 (cheap) so perf cost is minimal, but every fix reaches every visitor
    // immediately on next page load instead of taking 186 days to propagate.
    headers.set('Cache-Control', 'no-cache, must-revalidate');
    headers.set('CDN-Cache-Control', 'public, max-age=300');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return response;
};
