# wand-cdn

Public CDN-hosted JavaScript libraries for Wand Websites clients. Served via [jsDelivr](https://www.jsdelivr.com/?docs=gh).

All files here are final, minified, production artifacts. Source lives in the Wand OS repo (private); this repo hosts the compiled output so Webflow sites can load it over HTTPS with CDN caching.

## Usage

Load any file via jsDelivr with a pinned tag for immutable caching:

```html
<script src="https://cdn.jsdelivr.net/gh/connorvforrest/wand-cdn@v1.0.0/<filename>.js"></script>
```

During rapid iteration use `@main` (12hr cache) or `@<sha>` (exact commit). For production pages, always use a `@vX.Y.Z` tag.

## Files

| File | Version | Used by | Source |
|------|---------|---------|--------|
| `acg-personalization-v1.js` | v1.0.0 | AllCare Georgia — site-wide nearest-clinic personalization | `wand-os/clients/acg/wip/site-personalization/` |

## Release process

From the Wand OS repo, run the release script for the library you want to publish:

```bash
cd clients/acg/wip/site-personalization
./release.sh v1.1.0
```

That rebuilds, copies the output here, commits, tags, and pushes.
