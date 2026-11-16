# Build — web/ (Vite packaging, phase 1)

This directory now has a Vite + ES-module build **in parallel with** the legacy
buildless app. Phase 1 adds the build and self-hosts the former CDN dependencies
**without changing how the app is served**. Nothing here changes what staging or
production serve today.

## Two parallel entry points

| Path | Entry | How it loads | Served by nginx today? |
|------|-------|--------------|------------------------|
| **Legacy (live)** | `index.html` | 8 global `<script>` tags in a hand-tuned order (`leaflet.js` CDN then the 7 app files), manual `?v=NN` cache-busters, CDN `<link>`s for Leaflet CSS / Google Fonts / FontAwesome | **Yes** — this is the file nginx serves |
| **Vite (built artifact)** | `index.vite.html` → `main.js` | one `<script type="module">`; Leaflet (JS+CSS), FontAwesome, Inter + JetBrains Mono fonts and the local `tokens.css`/`styles.css` are imported through the bundler (self-hosted, content-hashed) | **No** — built to `dist/`, not yet wired into any server |

`main.js` imports the seven existing app files **in the exact legacy order** as
side-effecting modules (`toast → share → wms-metadata → app → multi-layer →
ui-interactions → country-info`), preceded by Leaflet + the CSS/font imports.
Module evaluation order equals import order, so every `window.*` symbol is defined
at the same point as today. None of the 7 files were converted to `import/export`
and none of their `window.*` coupling was touched — that is a later phase, out of
scope here.

## Build it

```sh
cd web
npm ci        # clean install from package-lock.json
npm run build # Vite build -> web/dist/
```

`npm run build` emits `web/dist/` containing:

- a content-hashed JS bundle (`dist/assets/index.vite-*.js`),
- a content-hashed CSS bundle (`dist/assets/index-*.css`),
- the self-hosted Leaflet, FontAwesome and Inter/JetBrains Mono font assets
  (`dist/assets/*.woff2`, `*.woff`, `*.ttf`, Leaflet marker images),
- `dist/index.vite.html` wired to the hashed bundles.

The built HTML/JS/CSS contains **no** `unpkg.com`, `cdnjs`, `fonts.googleapis.com`
or `fonts.gstatic.com` URLs — all former CDN deps are same-origin. (The
`arcgisonline.com` / `openstreetmap.org` / `gisco-services` hints remain: those are
runtime **basemap tile** hosts, not bundled deps, and are present on the legacy
path too.)

`web/dist/` and `web/node_modules/` are git-ignored and must not be committed.

## Dependencies (pinned, self-hosted)

| Package | Version | Replaces CDN |
|---------|---------|--------------|
| `leaflet` | `1.9.4` | unpkg `leaflet@1.9.4` JS + CSS (exact version match) |
| `@fortawesome/fontawesome-free` | `6.4.0` | cdnjs FontAwesome `6.4.0` (exact version match) |
| `@fontsource/inter` | `5.3.0` | Google Fonts `Inter` (weights 300/400/500/600/700 + italic 400) |
| `@fontsource/jetbrains-mono` | `5.3.0` | Google Fonts `JetBrains Mono` (weights 400/500/600) |
| `vite` (dev) | `8.3.8` | build tool |

## Phase 2 (separate, LATER task — do NOT do it here)

Phase 2 repoints the server at the build output. It must:

1. Add `npm ci && npm run build` to the deploy scripts (`deploy.sh`,
   `deploy-staging.sh` — both git-ignored local files, not versioned here).
2. Repoint the nginx `root` from `web/` to `web/dist/` (and decide whether the
   served entry is `index.vite.html` or a renamed `index.html`).
3. **Infra caveat (steering):** nginx config is a **bind mount** — changes need
   `docker compose restart web`, **not** `nginx -s reload`. Infra changes ship
   from the **`main`** branch only; a JS change on `develop` reaches staging
   (`:8082`), but an nginx root change does not until it lands on `main`.

Until phase 2 happens, the legacy `index.html` + its CDN tags remain exactly what
nginx serves, so staging and production are unaffected by this build.
