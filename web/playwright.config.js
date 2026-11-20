import { defineConfig, devices } from '@playwright/test';

// Browser smoke test for the Coastal WMS viewer.
//
// Default: builds the Vite app and tests it through `vite preview` on localhost
// (the app then talks to the live GeoServer via http://89.47.190.54:8082/geoserver).
// Against a deployed environment instead: SMOKE_URL=http://89.47.190.54:8082/ npm run test:smoke
//
// Run this BEFORE every staging/production deploy. It catches what HTTP 200 checks miss:
// a build that serves fine but does not boot in a real browser (e.g. the Nov 2026
// "GEOSERVER_URL is not defined" regression where layers could not be toggled).

const remoteUrl = process.env.SMOKE_URL;
const localUrl = 'http://127.0.0.1:4174/';

export default defineConfig({
  testDir: './tests',
  // One worker: the tests hit the live GeoServer; do not multiply the load.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: remoteUrl || localUrl,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  // Only start a local server when not testing a remote environment.
  webServer: remoteUrl
    ? undefined
    : {
        command: 'npm run build && npm run preview',
        url: localUrl,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
