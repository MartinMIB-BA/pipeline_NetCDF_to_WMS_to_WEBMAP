# Implementation Plan — Fix oversized VIDEO WMS legend when clicking the 'i' button

## Context / root cause (verified against code)

User (SK): clicking the `i` (`fa-circle-info`) button to show a layer's legend renders the
VIDEO WMS legends (`twl75`, `epis_wl75`) exaggeratedly large and overflowing the panel.

Markup (`web/multi-layer.js` ~L225): `div.layer-legend-panel#legend-${layerId}` >
`div.layer-legend-title-row` (title + `.layer-legend-scale` with three `.legend-scale-btn`
shrink `−` / reset `↺` / grow `+`) and `div.layer-legend-content` holding
`img#legend-img-${layerId}` and `div#legend-empty-${layerId}.layer-legend-empty`.

Existing CSS (`web/index.html`):
- `.layer-legend-content` (L608): `max-height:220px; overflow:auto;` — **no `width`/`max-width`**.
- `.layer-legend-content img` (L615): `width:100%; height:auto; display:block; transition:width 0.15s ease;` — **no `max-width`**.

Panel is MOVED between containers at runtime (`multi-layer.js`):
- Default: lives inside `#layer-item-${layerId}` in the left layers list (bounded width).
- When layer is active: `legendHost.appendChild(legendEl)` moves it into
  `#active-layer-legend-host-${layerId}` inside the active-layer card (`~L1161`). That host
  (`<div id="active-layer-legend-host-*">`) has **no width rule** — grep in `index.html`
  shows no `.active-layer-legend-host` style, only `.active-layer-controls-body .layer-controls`.

Scale handler (`multi-layer.js` ~L676): on button click sets
`img.style.width = '${next}%'` AND `img.style.maxWidth = 'none'` (next default 100, range 20–200).
So width is container-relative; any plain `max-width` on the img is wiped the moment a scale
button is used. Reset (`↺`) sets `next=100` → fitted ONLY IF the container is width-bounded.

GLOFAS legends use `meta.legendHtml` injected into `#legend-empty` innerHTML (`loadLegendForLayer`
~L644), NOT the `<img>` → unaffected by any `.layer-legend-content img` rule.

**Root cause:** `width:100%` on the img is only effective when its container box is width-bounded.
In the layers-list it is; after the panel moves into the active-layer host (which has no bounded
width), `width:100%` resolves against a shrink-to-fit/overflowing box, so the intrinsically large
video legend PNG drives the box to natural size and overflows. The fix must make the legend
**content container reliably width-bounded in BOTH host locations** so that `width:100%` (base)
and reset (`100%`) both equal "fitted", while leaving the percentage scale buttons working.

---

## Plan

- [ ] 1. Bound the legend content container width so `width:100%` is always relative to a
      fitted box, in both the layers-list host and the active-layer host.
      In `web/index.html` CSS, change `.layer-legend-content` (currently `max-height:220px;
      overflow:auto; scrollbar-...`) to also constrain horizontal size: add `width:100%;`,
      `max-width:100%;`, and `overflow:auto hidden` is NOT desired (keep `overflow:auto` for
      vertical scroll) — instead add `box-sizing:border-box;` so padding/border never push it
      past the parent. Also add a bounded width to the active-layer legend host so the moved
      panel cannot grow: add a new rule
      `#active-layer-controls-body [id^="active-layer-legend-host-"], .active-layer-controls-body > div { width:100%; max-width:100%; box-sizing:border-box; min-width:0; }`
      (the `min-width:0` is the key — flex/auto parents otherwise let content set the min width
      and overflow). Confirm the active-layer card body / `.active-layer-panel` has a fixed or
      bounded width by reading those rules first; if the body is a flex child, the `min-width:0`
      on the host is what prevents the legend from stretching it.
      Files: `web/index.html`
      Verify: load `web/index.html` locally (file:// or existing static serve), add a video
      layer (`twl75`/`epis_wl75`), click its `i` in BOTH the left list and the active-layer
      card — legend fits the panel width in both, no horizontal overflow, no scrollbar wider
      than the sidebar.

- [ ] 2. Add a base `max-width` guard on the legend img that cooperates with the percentage
      scale, so even before any container fix edge case the natural PNG size cannot drive
      overflow in the base (pre-scale) state.
      In `web/index.html`, update `.layer-legend-content img` (L615) to add `max-width:100%;`
      alongside the existing `width:100%; height:auto;`. Keep `height:auto` and the
      `transition:width 0.15s ease`. Note: this `max-width:100%` only governs the BASE state;
      once a scale button is pressed the handler sets inline `maxWidth:'none'`, which is correct
      because width is then an explicit container-relative `%` (bounded by step 1's container).
      Files: `web/index.html`
      Verify: with a video layer legend open at base state, the img width equals the content
      box width; pressing `+` grows past 100% and the content box scrolls (does not resize the
      sidebar) because the container from step 1 is bounded; pressing `↺` returns to fitted.

- [ ] 3. Make the scale `reset` return to the fitted base by clearing the inline overrides
      instead of forcing `width:100%` + `maxWidth:'none'`, so reset == pure CSS base state.
      In `web/multi-layer.js` scale handler (~L676), when `btn.dataset.action === 'reset'`:
      instead of leaving `img.style.width='100%'` and `img.style.maxWidth='none'`, clear the
      inline styles so the CSS from steps 1–2 governs: set `img.dataset.scale = '100'`,
      `img.style.width = ''`, `img.style.maxWidth = ''` and `return` before the generic
      `img.style.width='${next}%'; img.style.maxWidth='none'` lines. For `grow`/`shrink`, keep
      the existing behavior (`img.style.width='${next}%'; img.style.maxWidth='none'`), which is
      correct now that the container is bounded. This guarantees reset reproduces the exact
      fitted base (the `max-width:100%` CSS applies again) rather than an inline 100% with
      `maxWidth:none`.
      Files: `web/multi-layer.js`
      Verify: open a video legend, press `+` twice then `↺` — img returns to the fitted base
      size identical to first-open; `img.style.width` and `img.style.maxWidth` are empty strings
      in devtools after reset; `−`/`+` still step 20% within 20–200.

- [ ] 4. Confirm no regression for GLOFAS and static-layer legends.
      No code change expected — verification only. GLOFAS legends render via
      `empty.innerHTML = meta.legendHtml` into `#legend-empty-*` (not the `<img>`), so the
      `.layer-legend-content img` rules in steps 1–2 do not touch them; the container width
      rules in step 1 are safe (they only bound, not shrink arbitrary HTML). Static-layer
      legends use the same `<img>` path and already relied on `width:100%`; adding
      `max-width:100%` and bounding the container does not shrink below fit.
      Files: none
      Verify: open an `i` legend for (a) a GLOFAS layer (one with `meta.wmsUrl`/`legendHtml`) —
      the HTML legend renders unchanged, not clipped; (b) a static raster layer — legend still
      fits and is not smaller/distorted vs. before; (c) a video layer — now fitted. Compare
      against `git stash` baseline if a before/after is needed.

---

## Verification note (iteration 1 — implemented)

Changes made:

1. `web/index.html` `.layer-legend-content` (~L608): added `width:100%; max-width:100%;
   box-sizing:border-box;` so the content box is width-bounded in both host locations and
   padding/border never push it past the parent. Vertical `overflow:auto` kept.
2. `web/index.html` `.layer-legend-content img` (~L617): added `max-width:100%;` alongside
   existing `width:100%; height:auto;` so the natural (large) video PNG cannot overflow in
   the base/reset state. `transition:width` and `height:auto` kept (aspect ratio preserved).
3. `web/index.html` NEW rules (~L627): `.active-layer-controls-body
   [id^="active-layer-legend-host-"]` and its `.layer-legend-panel` get
   `width:100%; max-width:100%; min-width:0; box-sizing:border-box`. The `min-width:0` is the
   load-bearing fix: `#active-layers-panel` is a CSS grid (`grid-template-columns:1fr`), and a
   grid/flex child otherwise lets large intrinsic content set its own min width and overflow
   the sidebar. `overflow:hidden` on the host clamps it.
4. `web/multi-layer.js` scale handler (~L676): `reset` now clears inline overrides
   (`img.style.width=''; img.style.maxWidth=''; img.dataset.scale='100'; return`) so the CSS
   base governs again — reset == first-open fitted state. `grow`/`shrink` unchanged
   (`width:${next}%; maxWidth:none`, STEP 20, range 20–200).

Verified statically:
- Legend img has container-relative width constraint (`width:100%; max-width:100%`) and
  `height:auto` → aspect ratio preserved. Container `.layer-legend-content` and the moved host
  are now width-bounded in both the layers-list (`#layer-item-*`, already bounded) and the
  active-layer card (grid child + `min-width:0`).
- Handler trace: first-open → no inline width, CSS fits img to bounded box. `+` → `width:120%`,
  `maxWidth:none` (overflows within bounded, scrollable container, does not resize sidebar).
  `↺` → inline cleared, back to fitted. `−`/`+` step 20% within 20–200.
- GLOFAS path unaffected: `loadLegendForLayer` (multi-layer.js ~L628) sets
  `img.style.display='none'` and injects `meta.legendHtml` into `#legend-empty` innerHTML, so
  the `.layer-legend-content img` rules never apply to GLOFAS; container width rules only bound
  (don't shrink arbitrary HTML).
- `node --check web/multi-layer.js` → OK.

Could NOT verify at runtime: no live GeoServer locally, so actual GetLegendGraphic images were
not fetched/rendered; visual fit in a real browser against real video legend PNGs is unverified.

## Notes / assumptions

- No build step for `web/` (plain JS + inline CSS in `index.html`); edits are the deployed
  source. Frontend-only — no pipeline/GeoServer/nginx/docker changes, no deploy scripts.
- The GetLegendGraphic request itself (`buildLegendUrl`, ~L607) is left unchanged. Resizing is
  handled purely client-side via container bounding + CSS so the shared GWC/WMS request shape
  and the existing scale UX are untouched. (A server-side `LEGEND_OPTIONS`/`WIDTH` tweak was
  considered and rejected as out of scope and riskier than the CSS fix.)
- Load-bearing fix is step 1 (`min-width:0` + bounded host). Steps 2–3 harden base/reset so the
  percentage scale and the fitted default stay consistent. If step 1's active-layer host already
  turns out bounded on inspection, keep the `min-width:0` rule anyway — it is the common cause of
  flex-child content overflow and is harmless otherwise.
- Verification is manual in-browser (no web test harness exists in this repo). Clean up nothing —
  no temp files created.
