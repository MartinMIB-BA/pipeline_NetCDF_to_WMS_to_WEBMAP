import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Packaging-only Vite config for the Coastal WMS Leaflet viewer.
//
// This builds the NEW module entry (app-src/index.html -> ../main.js) in PARALLEL with
// the legacy buildless app (web/index.html + the 7 global <script> tags). Nothing here
// changes what nginx currently serves.
//
// Why the entry lives in web/app-src/: the standard Vite entry name is index.html, but
// the legacy buildless app already owns web/index.html (and nginx serves it today). Putting
// the Vite entry in its own subdirectory lets it keep the standard name without colliding,
// and lets Vite emit it as dist/index.html at the dist ROOT. That means `vite preview`
// serves the app at "/" (root, no filename) and a future nginx `root dist/` with the default
// `index index.html` + `try_files $uri $uri/ /index.html` works with NO special-casing.
export default defineConfig({
  // The Vite project root is the entry subdirectory. Setting root here makes Vite treat
  // app-src/index.html as THE entry and emit it to the dist root as index.html.
  root: resolve(import.meta.dirname, 'app-src'),

  // Relative base keeps built asset URLs working regardless of the exact mount path nginx
  // uses (served at the same origin as /geoserver). './' resolves /assets/* from the
  // served document's directory, i.e. the root when served at "/".
  base: './',

  build: {
    // outDir is resolved relative to root (app-src/), so climb back to web/dist.
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
});
