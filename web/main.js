// Phase 1 Vite module entry for the Coastal WMS Leaflet viewer.
//
// PACKAGING ONLY. This file does NOT refactor the app. It reproduces today's
// load order exactly so every window.* symbol is defined at the same point it is
// in the legacy buildless index.html. The seven app files are imported as
// side-effecting modules in their existing hand-tuned order; none of them are
// converted to import/export and none of their window.* coupling is touched
// (that is a later phase, explicitly out of scope here).
//
// Order rationale (mirrors web/index.html):
//   1. Leaflet JS + CSS first  -> global `L` must exist before app.js evaluates.
//   2. Self-hosted fonts + FontAwesome CSS (replaces the CDN <link> tags on the
//      legacy path; same visual weights as the Google Fonts / cdnjs URLs).
//   3. The 7 app files in the exact legacy order:
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

// --- 3. The 7 app files, in the exact legacy load order ---
import './toast.js';
import './share.js';
import './wms-metadata.js';
import './app.js';
import './multi-layer.js';
import './ui-interactions.js';
import './country-info.js';
