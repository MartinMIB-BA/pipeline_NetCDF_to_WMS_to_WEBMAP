import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Phase 1 packaging-only Vite config for the Coastal WMS Leaflet viewer.
//
// This builds the NEW module entry (index.vite.html -> main.js) in PARALLEL with
// the legacy buildless app (index.html + the 7 global <script> tags). Nothing here
// changes what nginx currently serves; phase 2 (a separate, later task) repoints the
// nginx root at web/dist/ and adds `npm ci && npm run build` to the deploy scripts.
export default defineConfig({
  // Served from the same web root that serves /geoserver (same origin). Relative
  // base keeps built asset URLs working regardless of the exact mount path nginx
  // uses in phase 2.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Single HTML entry. The Vite entry HTML is index.vite.html so the legacy
      // index.html stays byte-for-byte the file nginx serves today.
      input: resolve(import.meta.dirname, 'index.vite.html'),
    },
  },
});
