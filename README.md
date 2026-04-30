# wand-cdn

Production-built JavaScript libraries for Wand Websites clients. Per-client first-party CDN hosting (e.g. `cdn.allcare-ga.com`) backed by Cloudflare Pages, with jsDelivr as a public-cache fallback.

All files here are final, minified, production artifacts. Source lives in the Wand OS repo (private); this repo hosts the compiled output. Pushes to `main` auto-deploy to Cloudflare Pages via the workflow in `.github/workflows/deploy-pages.yml`.

## Usage

### Primary (per-client first-party CDN)

```html
<script src="https://cdn.allcare-ga.com/acg-personalization-v1.js" defer></script>
```

`cdn.allcare-ga.com` is a CNAME → `acg-cdn.pages.dev` (Cloudflare Pages project `acg-cdn`). Pushes to this repo's `main` branch deploy a fresh version automatically. The Pages CDN purges its own edge cache on each deploy.

### Fallback / iteration (jsDelivr)

```html
<script src="https://cdn.jsdelivr.net/gh/connorvforrest/wand-cdn@v1.3.0/acg-personalization-v1.js"></script>
```

Use a pinned `@vX.Y.Z` tag for production. `@main` for active development (12hr cache).

## Files

| File | Latest | Used by | Source |
|------|--------|---------|--------|
| `acg-personalization-v1.js` | v1.3.0 | AllCare Georgia — site-wide nearest-clinic personalization | `wand-os/clients/acg/wip/site-personalization/` |

## Release process

From the Wand OS repo:

```bash
cd clients/acg/wip/site-personalization
./release.sh v1.4.0
```

Rebuilds the lib, copies into wand-cdn, commits, tags, pushes to `main`. The `Deploy to Cloudflare Pages` workflow then auto-deploys to `cdn.allcare-ga.com` (~2 min).

Verify after release: `curl -I https://cdn.allcare-ga.com/acg-personalization-v1.js` — etag should change.

## Required GitHub secrets

Set under repo Settings → Secrets and variables → Actions:

- `CLOUDFLARE_API_TOKEN` — must have `Pages:Edit` + `Account:Read` scopes (and `Cache:Purge` if doing manual purges)
- `CLOUDFLARE_ACCOUNT_ID`

These mirror the corresponding secrets in Bitwarden Secrets Manager (`Allcare Georgia` project: `Cloudflare_API_KEY_wand_acg_cdn`, `CLOUDFLARE_ACCOUNT_ID`). **If you rotate the BWS-stored token, also update the GH secret** — they don't auto-sync.
