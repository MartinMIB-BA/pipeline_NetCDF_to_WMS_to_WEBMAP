# Web Viewer — web/

Interactive Leaflet-based map viewer for exploring GeoServer WMS layers. CORS is handled by Nginx in production.

---

## Files

| File | Description |
|------|-------------|
| `index.html` | Main HTML page and application shell |
| `app.js` | Core Leaflet map, WMS layer management, basemap switcher |
| `multi-layer.js` | Multi-layer panel, concurrent layer display |
| `ui-interactions.js` | Sidebar, panel, and control event handlers |
| `wms-metadata.js` | WMS GetCapabilities parsing and metadata caching |

---

## Map Viewer

### Features

- **Interactive Leaflet map** with zoom, pan, and fullscreen controls
- **WMS layer browser** — lists all available layers from GeoServer
- **Time slider** — step through TIME dimension of video/time-series layers
- **Elevation selector** — select ELEVATION dimension for point layers
- **Multi-layer mode** — display several layers simultaneously with opacity controls
- **Basemap switcher** — Esri World Imagery, CartoDB Light, OpenStreetMap
- **Server protection** — limits the number of concurrent browser tabs to prevent GeoServer overload (enforced via `localStorage`)
- **WMS metadata panel** — shows layer name, bounding box, available times, and CRS

### Layer Types Displayed

| Type | Dimensions | Controls shown |
|------|------------|----------------|
| Static probability | TIME | Time slider |
| Video (time-series) | TIME (153 steps) | Time slider with step controls |
| Coastal points | TIME + ELEVATION | Time slider + elevation dropdown |

### Served By

Nginx serves `index.html`, `app.js`, `multi-layer.js`, `ui-interactions.js`, and `wms-metadata.js` from the `/opt/geoserver/web` volume mount. See [`nginx/default.conf`](../nginx/default.conf) for the exact location block.

---

## Development Setup

1. Start the Docker stack (see [`docker/README.md`](../docker/README.md))
2. Place your frontend files in `/opt/geoserver/web/` (mapped from `./web/` in compose)
3. Nginx serves the files at `http://localhost:80`

CORS for WMS requests is handled by Nginx — see `nginx/default.conf`.
