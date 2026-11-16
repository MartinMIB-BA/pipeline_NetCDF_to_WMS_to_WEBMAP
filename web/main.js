// Phase 1/2 Vite module entry for the Coastal WMS Leaflet viewer.
//
// PACKAGING ONLY. This file does NOT refactor the app. It owns the self-hosted
// dependencies only: Leaflet (JS + CSS), the Inter / JetBrains Mono fonts,
// FontAwesome, and the local design-system CSS. It exposes the global `L` the
// app relies on.
//
// The 7 app files are NOT imported here. Phase 2 note: under ES-module bundling
// each imported file gets its OWN module scope, so top-level const/let/function
// in one file (e.g. GEOSERVER_URL in app.js) are no longer visible to the files
// that read them (wms-metadata.js, multi-layer.js, country-info.js) the way they
// were under the legacy classic <script> tags that shared one global script
// scope. To preserve that exact shared-scope behaviour with ZERO edits to the 7
// files, they are concatenated — in the legacy order — into a single CLASSIC
// (non-module) hashed bundle by the `legacyAppBundle` plugin in vite.config.js,
// and injected into index.html AFTER this module so `window.L` is set first.
//
// Order rationale (mirrors web/index.html):
//   1. Leaflet JS + CSS first  -> global `L` must exist before app.js evaluates.
//   2. Self-hosted fonts + FontAwesome CSS (replaces the CDN <link> tags on the
//      legacy path; same visual weights as the Google Fonts / cdnjs URLs).
//   3. The local design-system CSS (tokens + styles).
// The app logic (the 7 files) then runs from the classic bundle, in the exact
// legacy order:
//      toast -> share -> wms-metadata -> app -> multi-layer -> ui-interactions -> country-info

// --- 1. Leaflet (self-hosted, replaces unpkg CDN JS + CSS) ---
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Leaflet's CDN UMD build attaches `L` to window globally; the ESM import does
// not, so expose it explicitly to preserve the global `L` the 7 files rely on.
window.L = L;

// --- 2. Self-hosted fonts + icons (replace Google Fonts + cdnjs FontAwesome) ---
// Inter weights match the Google Fonts request (300/400/500/600/700 + italic 400).
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/400-italic.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
// JetBrains Mono weights match the Google Fonts request (400/500/600).
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
// FontAwesome 6.4.0 free (same version as the cdnjs CDN link on the legacy path).
import '@fortawesome/fontawesome-free/css/all.min.css';

// --- Local design-system CSS (same files the legacy path loads) ---
import './tokens.css';
import './styles.css';

// --- 3. The 7 app files ---
// NOT imported here. They are concatenated into a single classic (non-module)
// hashed bundle by the `legacyAppBundle` plugin (see vite.config.js) so their
// top-level declarations share ONE script scope exactly like the legacy
// classic <script> tags. The plugin injects that bundle into index.html right
// after this module, so `window.L` above is defined before the app runs.
