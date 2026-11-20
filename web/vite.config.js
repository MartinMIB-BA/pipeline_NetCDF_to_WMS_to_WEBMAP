import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

// The 7 legacy app files, in the EXACT legacy <script> load order (see web/index.html).
// toast -> share -> wms-metadata -> app -> multi-layer -> ui-interactions -> country-info.
const LEGACY_APP_FILES = [
  'toast.js',
  'share.js',
  'wms-metadata.js',
  'app.js',
  'multi-layer.js',
  'ui-interactions.js',
  'country-info.js',
];

// Phase 2 scope fix.
//
// Under the legacy classic <script> tags, the 7 files share ONE global script scope, so a
// top-level `const`/`let`/`function` declared in one file (e.g. GEOSERVER_URL in app.js) is
// visible to the files that read it (wms-metadata.js, multi-layer.js, country-info.js, and
// back the other way: app.js reads activeLayers/layerDisplayNames from multi-layer.js). Under
// Vite's ES-module bundling, each imported file gets its OWN module scope, so those cross-file
// top-level reads break with `ReferenceError: GEOSERVER_URL is not defined` and the layers can
// no longer be toggled.
//
// This plugin reproduces the legacy shared scope with ZERO edits to the 7 files: it concatenates
// them in the legacy order into a SINGLE classic (non-module) script, content-hashes it, emits it
// as a hashed asset, and injects it into index.html as a plain (deferred) <script>. Because it is
// one classic script, all top-level declarations live in one shared script scope exactly like the
// legacy load. It is injected AFTER main.js's module script so `window.L` (set by main.js) exists
// before app.js evaluates `L.map(...)`. Both the module script and the classic <script defer> are
// deferred, and deferred scripts execute in document order, so main.js runs first.
//
// Self-hosting is unaffected: Leaflet (JS+CSS), FontAwesome and the fonts are still bundled via
// main.js; this plugin only moves the 7 app files out of the module graph into a classic bundle.
function legacyAppBundle() {
  const webDir = resolve(import.meta.dirname);
  let bundleFileName = '';

  let bundleSource = '';

  return {
    name: 'legacy-app-bundle',

    // renderStart runs before transformIndexHtml, so compute the concatenated source and its
    // content hash here. That makes `bundleFileName` available when the HTML tag is injected.
    renderStart() {
      const parts = LEGACY_APP_FILES.map((name) => {
        const code = readFileSync(resolve(webDir, name), 'utf8');
        // A banner per file keeps stack traces/debugging legible without changing semantics.
        return `/* ==== ${name} ==== */\n${code}\n`;
      });
      bundleSource = parts.join('\n');
      const hash = createHash('sha256').update(bundleSource).digest('hex').slice(0, 8);
      bundleFileName = `assets/app-legacy-${hash}.js`;
    },

    // Emit the concatenated classic bundle as a hashed asset so it lands in dist/assets/.
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: bundleFileName, source: bundleSource });
    },

    // Inject the classic <script> into index.html AFTER Vite's own module script tag.
    // order:'post' + injectTo:'head' places it after the generated module <script>, so main.js
    // (which sets window.L) runs first; both are deferred and execute in document order.
    transformIndexHtml: {
      order: 'post',
      handler() {
        return [
          {
            tag: 'script',
            attrs: { defer: true, src: `./${bundleFileName}` },
            injectTo: 'head',
          },
        ];
      },
    },
  };
}

export default defineConfig({
  // The Vite project root is the entry subdirectory. Setting root here makes Vite treat
  // app-src/index.html as THE entry and emit it to the dist root as index.html.
  root: resolve(import.meta.dirname, 'app-src'),

  // Relative base keeps built asset URLs working regardless of the exact mount path nginx
  // uses (served at the same origin as /geoserver). './' resolves /assets/* from the
  // served document's directory, i.e. the root when served at "/".
  base: './',

  plugins: [legacyAppBundle()],

  // Local-only preview settings. Bind the loopback host so `vite preview` is reachable over
  // IPv4 as well, on a fixed port, for deterministic local verification. Does not affect the
  // production build output or what nginx serves.
  preview: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
  },

  build: {
    // outDir is resolved relative to root (app-src/), so climb back to web/dist.
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
});
