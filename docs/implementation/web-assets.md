# Web assets (apps/web)

Working note for the frontend (not a decision). Status: describes what exists on 2026-10-05.

## Where the official assets live

| File | Use | Location | Notes |
|---|---|---|---|
| `plac-logo.png` (2665x840, horizontal PLAC logo) | Brand logo (header, login) via `brand.logoUrl` | `apps/web/public/brand/` | Same file as `apps/mobile/assets/brand/plac-logo.png` (identical hash) |
| `plac-mark.png` (173x148, "P" symbol) | Default favicon (`index.html`), `brand.markUrl` target | `apps/web/public/brand/` | Copy of `.claude/references/vidya/vidya-force-references/16-simbolo-plac-p.png` (reference stays where it is) |
| `login-hero.png` (1374x1145, ~2.9 MB) | Login left column | `apps/web/src/assets/login/` | Imported in `routes/login.tsx`; Vite emits `dist/assets/login-hero-<hash>.png` |

Reference-only material, never shipped: `.claude/references/vidya/**` (Vidya Force screenshots; `15-logo-plac-recorte.png`, `17-logo-plac-completo.png` are alternative PLAC logo crops, 232x126 and 2048x645).

## Rules of thumb

- `public/` = stable URLs, copied as is (brand files, `config.json`). Not hashed.
- `src/assets/` = imported from code (`import url from "../assets/x.png"`), hashed by Vite, served from `/assets/` with a one-year immutable cache. Never put an un-hashed file under `/assets/` (a replaced file would stay stale for a year).
- No external URLs for essential visuals (CSP: `img-src 'self' data:`). No absolute local paths. Use lowercase, kebab-case, semantic names (Linux is case-sensitive).

## Favicon, title, theme

`apps/web/index.html`: `<link rel="icon" type="image/png" href="/brand/plac-mark.png">`, `apple-touch-icon`, `manifest`, `theme-color` `#1e2b8f` (same as `brand.accent` in `public/config.json`), `description`. At runtime `applyBrand` (`src/lib/brand.ts`) replaces the icon with `brand.markUrl` from `/config.json` (env `BRAND_MARK_URL`, files in `/brand/`).

Title: the official fallback for this installation is **"Force PLAC"**, in three places that must stay equal: the static `<title>` in `index.html` (shown before JS runs), `defaultRuntimeConfig.installationName` in `src/lib/runtime-config.ts` (used when `/config.json` is missing or invalid), and the default of `INSTALLATION_NAME` in `deploy/nginx/40-runtime-config.sh`. When `INSTALLATION_NAME` is set it overrides all of them at runtime (`document.title` = `<page> — <installationName>`). Note: `deploy/docker-compose.dev.yml` / `docker-compose.staging.yml` still pass `INSTALLATION_NAME: ${INSTALLATION_NAME:-Sales Force}`, and `deploy/staging/compose.env.example` sets `Sales Force Staging`; those override the script default until changed.

### Touch icon and manifest

Files in `apps/web/public/brand/`: `apple-touch-icon.png` (180x180), `icon-192.png`, `icon-512.png`; `apps/web/public/manifest.webmanifest` (name/short_name "Force PLAC", `display: "browser"` because the app is not a PWA, `theme_color` `#1e2b8f`, `background_color` `#ffffff`).

Generation (no dependencies, not a build step; re-run only if the source mark changes): Windows PowerShell + `System.Drawing`, `HighQualityBicubic`, from `plac-mark.png` only, proportion preserved (no stretch), centred on a square canvas. `apple-touch-icon.png`: solid white background (iOS flattens transparency on black), mark at 70% of the width. `icon-192.png`: transparent canvas, 70%. `icon-512.png`: transparent canvas, 60%. The mark is the red rectangle with the navy "P" exactly as supplied (it is opaque, not a transparent glyph).

**Visual debt (owner-accepted for staging, 2026-10-06; not a blocker):** replace with a larger source before production. Limitation: the source is 173x148 px, so the 512 icon is an upscale of about 2x of the mark and is visibly soft; 192 and 180 are acceptable. Replace all three when a vector/high-resolution square mark is supplied. The icons are not "maskable"; the manifest does not claim it.

## How assets reach the VPS

repo -> `pnpm --filter @salesforce/web... run build` (inside `deploy/Dockerfile.web`, build stage) -> `apps/web/dist` -> `COPY` into `/usr/share/nginx/html` of the image `sales-force-web:<SHA>` -> container (nginx unprivileged, `deploy/nginx/default.conf`) -> host Nginx/edge. Cache: `/assets/` immutable 1 year; `/brand/` 1 hour; `/config.json` no-store; everything else (index.html) `no-cache`. Note: `/brand/` may be overridden by an installation mount (see header of `40-runtime-config.sh`); a mount replaces the image's brand files.

Product photos are NOT static assets: they come from Sankhya through backend sync and a persistent cache, and must never be put in `public/brand`, Git or the Docker image (future `docs/implementation/product-media.md`).

## Adding a new image

1. Used from code: put it in `src/assets/<area>/<semantic-name>.<ext>` and import it. Do not reference it by a string path.
2. Needed at a fixed URL (favicon, manifest icons, per-installation brand): put it in `public/brand/` and, for per-installation values, reference it from `config.json`/env (`/brand/<file>`).
3. Reuse the official file; do not duplicate. Set `width`/`height` and `object-fit`/`max-width` so it cannot overflow.
4. Run `pnpm --filter @salesforce/web build`, check `dist/`, then the post-deploy checklist.

## Post-deploy verification checklist

- `curl -sI https://<host>/brand/plac-mark.png` and `/brand/plac-logo.png`: 200, `content-type: image/png`.
- Open `/login`; read the hero URL from the DOM and `curl -sI` it: 200, `cache-control: public, max-age=31536000, immutable`.
- `curl -s https://<host>/ | grep -E 'rel="icon"|apple-touch-icon|manifest|theme-color|<title'`; the tab shows the PLAC mark and the title "Force PLAC" (or the configured `INSTALLATION_NAME`).
- `curl -sI https://<host>/brand/apple-touch-icon.png`, `/brand/icon-192.png`, `/brand/icon-512.png`: 200, `image/png`.
- `curl -sI https://<host>/manifest.webmanifest`: 200, `content-type: application/manifest+json` (or `application/json`); body parses as JSON; no CSP console errors.
- Browser console/network on `/login` and after sign-in: no 404, no request to another origin, none to `localhost` or `C:\`.
- `curl -s https://<host>/config.json`: `brand.logoUrl` points to an existing file.
- In the container: `docker exec <web> ls -R /usr/share/nginx/html/brand /usr/share/nginx/html/assets | grep -E 'png|svg'` shows the files; `docker exec <web> grep -c localhost /usr/share/nginx/html/index.html` is 0.

## Missing / open

- Touch/manifest icons are derived from the 173x148 mark (see above); a proper square SVG/512 px source is wanted to replace them.
- `plac-mark.png` is a small crop (173x148, not square): acceptable as a favicon, soft on high-density displays.
- `login-hero.png` weighs ~2.9 MB. No lossless/lossy optimizer is available in this environment; a visually equivalent WebP/optimized PNG should be produced with a proper tool and compared before replacing it.
- Default favicon bakes the PLAC mark into the image for every installation (PROD-1 reusable product); other installations override it with `BRAND_MARK_URL`. Owner call whether the neutral default should be product-neutral.
