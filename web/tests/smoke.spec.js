import { test, expect } from '@playwright/test';

// Smoke checks for the viewer's critical startup behavior. Each check maps to a real
// regression seen in Nov 2026; keep them when refactoring.

const DEFAULT_LAYERS = ['country_twl_summary', 'reportingPoints', 'twl75'];

// Collect page errors, console errors and every GWC tile request for the page's lifetime.
function instrument(page) {
  const pageErrors = [];
  const consoleErrors = [];
  const gwcRequests = [];

  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('request', (req) => {
    const url = req.url();
    if (!url.includes('/geoserver/gwc/')) return;
    const params = new URL(url).searchParams;
    gwcRequests.push({
      layer: (params.get('layers') || '').replace('E_and_T:', ''),
      elevation: Number(params.get('elevation') ?? 0),
    });
  });

  return { pageErrors, consoleErrors, gwcRequests };
}

// Wait until metadata is loaded and all three default layers are active.
async function waitForBoot(page) {
  await page.goto('/');
  await page.waitForFunction(
    (ids) =>
      window.wmsMetadata?.loaded === true &&
      window.activeLayers instanceof Map &&
      ids.every((id) => window.activeLayers.has(id)),
    DEFAULT_LAYERS,
    { timeout: 45_000 },
  );
}

const framesBeyondZero = (requests, layer) =>
  requests.filter((r) => r.layer === layer && r.elevation > 0).length;

test('boots without JavaScript errors and loads metadata', async ({ page }) => {
  const { pageErrors, consoleErrors } = instrument(page);
  await waitForBoot(page);
  await page.waitForTimeout(3_000); // let late startup code run

  expect(pageErrors, 'uncaught page errors').toEqual([]);
  // ReferenceErrors and CORS blocks are the failure modes that broke the app before.
  const fatal = consoleErrors.filter((t) =>
    /is not defined|ReferenceError|TypeError|CORS policy|Failed to fetch WMS Capabilities/.test(t),
  );
  expect(fatal, 'fatal console errors').toEqual([]);
});

test('opens with the three default layers and twl75 active', async ({ page }) => {
  await waitForBoot(page);

  for (const id of DEFAULT_LAYERS) {
    await expect(page.locator(`#checkbox-${id}`), `${id} checkbox`).toBeChecked();
  }
  const activeLayer = await page.evaluate(() => window.currentParams?.layer);
  expect(activeLayer, 'active layer').toBe('twl75');
});

test('opens on the latest twl75 date, not the lagging choropleth week', async ({ page }) => {
  await waitForBoot(page);

  const { selected, latest } = await page.evaluate(() => ({
    selected: document.getElementById('time-select')?.value || '',
    latest: window.wmsMetadata.getLatestTimeForLayer('twl75') || '',
  }));
  expect(latest, 'twl75 latest time from Capabilities').not.toBe('');
  expect(selected.slice(0, 10), 'date shown at startup').toBe(latest.slice(0, 10));
});

test('renders twl75 map tiles from GeoServer', async ({ page }) => {
  const tileResponse = page.waitForResponse(
    (res) =>
      res.url().includes('/geoserver/gwc/') &&
      res.url().includes('E_and_T%3Atwl75') &&
      res.status() === 200,
    { timeout: 45_000 },
  );
  await waitForBoot(page);
  const res = await tileResponse;
  expect(res.headers()['content-type'] || '', 'tile content type').toMatch(/^image\//);
});

test('does not preload animation frames at startup', async ({ page }) => {
  const { gwcRequests } = instrument(page);
  await waitForBoot(page);
  await page.waitForTimeout(6_000); // past the 300 ms auto-preload delay and frame 0

  expect(gwcRequests.some((r) => r.layer === 'twl75'), 'twl75 frame 0 requested').toBe(true);
  expect(framesBeyondZero(gwcRequests, 'twl75'), 'twl75 frames 1..15 at startup').toBe(0);
});

test('switching on Episode WL after a Play does not preload its animation frames', async ({ page }) => {
  const { gwcRequests } = instrument(page);
  await waitForBoot(page);

  // Play twl75 first. The original regression only appeared AFTER a Play: the startup
  // preload gate was cleared by Play, so every later video-layer switch fired the full burst.
  await page.locator('#play-btn-twl75').click();
  await page.waitForFunction(() => window.isAnimating === true, null, { timeout: 45_000 });
  await page.evaluate(() => window.stopAnimation());
  await page.waitForFunction(() => window.isAnimating === false);

  // Same path a user click takes: checkbox click -> addLayer -> autoPreloadVideoLayer.
  await page.evaluate(() => document.getElementById('checkbox-epis_wl75').click());
  await page.waitForFunction(() => window.activeLayers.has('epis_wl75'));
  await page.waitForTimeout(6_000);

  expect(gwcRequests.some((r) => r.layer === 'epis_wl75'), 'epis_wl75 frame 0 requested').toBe(true);
  expect(framesBeyondZero(gwcRequests, 'epis_wl75'), 'epis_wl75 frames 1..15').toBe(0);
});

test('layers can be toggled off and on', async ({ page }) => {
  await waitForBoot(page);

  const toggle = () =>
    page.evaluate(() => document.getElementById('checkbox-country_twl_summary').click());

  await toggle();
  await page.waitForFunction(() => !window.activeLayers.has('country_twl_summary'));
  await expect(page.locator('#checkbox-country_twl_summary')).not.toBeChecked();

  await toggle();
  await page.waitForFunction(() => window.activeLayers.has('country_twl_summary'));
  await expect(page.locator('#checkbox-country_twl_summary')).toBeChecked();
});

test('allows a 4th layer on top of the 3 defaults and refuses a 5th', async ({ page }) => {
  await waitForBoot(page);

  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  // 4th layer: accepted without switching a default off.
  await page.evaluate(() => document.getElementById('checkbox-epis_wl75').click());
  await page.waitForFunction(() => window.activeLayers.has('epis_wl75'));
  expect(await page.evaluate(() => window.activeLayers.size), 'active layers').toBe(4);
  expect(dialogs, 'no limit dialog for the 4th layer').toEqual([]);

  // 5th layer: refused with the limit dialog, checkbox stays unchecked.
  const fifth = await page.evaluate(() => {
    const free = [...document.querySelectorAll('[id^="checkbox-"]')].find(
      (cb) => !cb.checked && !window.activeLayers.has(cb.value),
    );
    free.click();
    return free.id;
  });
  await expect(page.locator(`#${fifth}`), '5th layer checkbox').not.toBeChecked();
  expect(await page.evaluate(() => window.activeLayers.size), 'active layers after 5th').toBe(4);
  expect(dialogs.join(' '), 'limit dialog').toContain('Maximum 4 layers allowed');
});
