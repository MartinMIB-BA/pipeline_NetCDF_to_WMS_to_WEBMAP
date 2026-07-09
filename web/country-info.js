// ═══════════════════════════════════════════════════════════════
// COUNTRY INFO MODULE — click → draggable info panel + buffer + highlight
// ═══════════════════════════════════════════════════════════════
// On land click: queries country_info SQL View, shows a draggable
// floating panel with forecast data, highlights the country boundary
// with a glow effect, and shows the 400 km buffer in the sea.
// ═══════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── Config ─────────────────────────────────────────────────
    const COUNTRY_INFO_LAYER = 'E_and_T:country_info';
    const BUFFER_LAYER = 'E_and_T:country_buffers_400km';

    // ── Panes ──────────────────────────────────────────────────
    function ensureBufferPane() {
        if (!map.getPane('countryBufferPane')) {
            map.createPane('countryBufferPane');
            map.getPane('countryBufferPane').style.zIndex = 500;
            map.getPane('countryBufferPane').style.pointerEvents = 'none';
        }
    }

    function ensureHighlightPane() {
        if (!map.getPane('countryHighlightPane')) {
            map.createPane('countryHighlightPane');
            map.getPane('countryHighlightPane').style.zIndex = 510;
            map.getPane('countryHighlightPane').style.pointerEvents = 'none';
        }
    }

    // ── Buffer overlay WMS ─────────────────────────────────────
    let bufferWmsLayer = null;

    function showBuffer(gid0) {
        ensureBufferPane();
        const cql = `gid_0='${gid0}'`;
        if (bufferWmsLayer) {
            bufferWmsLayer.setParams({ CQL_FILTER: cql });
            if (!map.hasLayer(bufferWmsLayer)) bufferWmsLayer.addTo(map);
        } else {
            bufferWmsLayer = L.tileLayer.wms(GEOSERVER_URL + '/wms', {
                layers: BUFFER_LAYER,
                format: 'image/png',
                transparent: true,
                version: '1.1.1',
                CQL_FILTER: cql,
                styles: 'E_and_T:buffer_hatched',
                pane: 'countryBufferPane',
                opacity: 0.7,
                tileSize: 512
            }).addTo(map);
        }
    }

    function hideBuffer() {
        if (bufferWmsLayer && map.hasLayer(bufferWmsLayer)) {
            map.removeLayer(bufferWmsLayer);
        }
    }

    // ── Country highlight (GeoJSON boundary with glow) ─────────
    let highlightLayer = null;

    async function showHighlight(gid0) {
        ensureHighlightPane();
        hideHighlight();

        // Fetch country geometry via WFS
        const params = new URLSearchParams({
            service: 'WFS',
            version: '2.0.0',
            request: 'GetFeature',
            typeNames: COUNTRY_INFO_LAYER,
            CQL_FILTER: `gid_0='${gid0}'`,
            outputFormat: 'application/json',
            srsName: 'EPSG:4326',
            propertyName: 'geom,gid_0'
        });
        try {
            const resp = await fetch(`${GEOSERVER_URL}/wfs?${params.toString()}`);
            if (!resp.ok) return;
            const geojson = await resp.json();
            if (!geojson.features || geojson.features.length === 0) return;

            highlightLayer = L.geoJSON(geojson, {
                pane: 'countryHighlightPane',
                style: {
                    color: '#60a5fa',
                    weight: 2.5,
                    opacity: 0.9,
                    fillColor: '#60a5fa',
                    fillOpacity: 0.12,
                    dashArray: null,
                    className: 'country-highlight-path'
                }
            }).addTo(map);
        } catch (e) {
            console.warn('Country highlight WFS failed:', e);
        }
    }

    function hideHighlight() {
        if (highlightLayer) {
            map.removeLayer(highlightLayer);
            highlightLayer = null;
        }
    }

    // ── Draggable floating panel ───────────────────────────────
    let panelEl = null;

    function createPanel() {
        if (panelEl) return;

        panelEl = document.createElement('div');
        panelEl.id = 'country-info-panel';
        panelEl.innerHTML = `
            <div class="cip-header" id="cip-drag-handle">
                <span class="cip-title"><i class="fa-solid fa-flag"></i> Country Info</span>
                <button class="cip-close" id="cip-close-btn"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="cip-body" id="cip-body"></div>
        `;
        document.body.appendChild(panelEl);

        // Close button
        document.getElementById('cip-close-btn').addEventListener('click', () => {
            closePanel();
        });

        // Make draggable
        makePanelDraggable(panelEl, document.getElementById('cip-drag-handle'));
    }

    function openPanel(html, latlng) {
        createPanel();
        document.getElementById('cip-body').innerHTML = html;
        panelEl.style.display = 'flex';

        // Position near click point (converted to screen coords), offset to the right
        const pt = map.latLngToContainerPoint(latlng);
        const mapRect = map.getContainer().getBoundingClientRect();
        let left = mapRect.left + pt.x + 20;
        let top = mapRect.top + pt.y - 60;

        // Clamp to viewport
        const pw = 300, ph = 320;
        if (left + pw > window.innerWidth) left = window.innerWidth - pw - 12;
        if (top + ph > window.innerHeight) top = window.innerHeight - ph - 12;
        if (left < 8) left = 8;
        if (top < 8) top = 8;

        panelEl.style.left = left + 'px';
        panelEl.style.top = top + 'px';
    }

    function closePanel() {
        if (panelEl) panelEl.style.display = 'none';
        hideBuffer();
        hideHighlight();
    }

    function makePanelDraggable(panel, handle) {
        let isDragging = false, startX, startY, initLeft, initTop;

        handle.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            initLeft = rect.left;
            initTop = rect.top;
            handle.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        handle.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            let newLeft = initLeft + dx;
            let newTop = initTop + dy;
            // Clamp
            const rect = panel.getBoundingClientRect();
            if (newLeft < 0) newLeft = 0;
            if (newTop < 0) newTop = 0;
            if (newLeft + rect.width > window.innerWidth) newLeft = window.innerWidth - rect.width;
            if (newTop + rect.height > window.innerHeight) newTop = window.innerHeight - rect.height;
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
        });

        handle.addEventListener('pointerup', (e) => {
            isDragging = false;
            handle.releasePointerCapture(e.pointerId);
        });
    }

    // ── GetFeatureInfo for country_info layer ───────────────────
    async function queryCountryInfo(latlng) {
        const wrappedLatlng = latlng.wrap();
        const microBbox = `${wrappedLatlng.lat - 0.001},${wrappedLatlng.lng - 0.001},${wrappedLatlng.lat + 0.001},${wrappedLatlng.lng + 0.001}`;

        const params = new URLSearchParams({
            SERVICE: 'WMS',
            VERSION: '1.3.0',
            REQUEST: 'GetFeatureInfo',
            LAYERS: COUNTRY_INFO_LAYER,
            QUERY_LAYERS: COUNTRY_INFO_LAYER,
            INFO_FORMAT: 'application/json',
            FEATURE_COUNT: 1,
            CRS: 'EPSG:4326',
            BBOX: microBbox,
            WIDTH: 10,
            HEIGHT: 10,
            I: 5,
            J: 5
        });

        // Add TIME from active choropleth layer (so popup shows correct week)
        if (typeof activeLayers !== 'undefined') {
            for (const [lid, ld] of activeLayers.entries()) {
                if (ld.metadata && ld.metadata.type === 'choropleth' && ld.metadata.hasTime) {
                    // Best source: the actual WMS param currently being sent to GeoServer
                    const wmsTime = ld.wmsLayer && ld.wmsLayer.wmsParams && ld.wmsLayer.wmsParams.time;
                    if (wmsTime) {
                        params.set('TIME', wmsTime);
                        break;
                    }
                    // Fallback: layerData.time
                    if (ld.time) {
                        params.set('TIME', ld.time);
                        break;
                    }
                }
            }
        }

        const url = `${GEOSERVER_URL}/wms?${params.toString()}`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        if (!data.features || data.features.length === 0) return null;
        return data.features[0].properties;
    }

    // ── Build panel HTML ────────────────────────────────────────
    function buildPanelContent(props) {
        const name = props.name_0 || 'Unknown';
        const gid = props.gid_0 || '—';

        const fmt = (val) => {
            if (val === null || val === undefined) return '<span style="color:var(--text-faint);">—</span>';
            return `<span style="color:#fff; font-weight:700;">${Number(val).toFixed(1)} %</span>`;
        };

        // Check which hazard layers are active
        const showTwl = typeof activeLayers !== 'undefined' && activeLayers.has('country_twl_summary');
        const showEpis = typeof activeLayers !== 'undefined' && activeLayers.has('country_epis_summary');

        const hasTwl = props.twl_rp10 !== null && props.twl_rp10 !== undefined;
        const hasEpis = props.epis_rp10 !== null && props.epis_rp10 !== undefined;
        const isCoastal = hasTwl || hasEpis;

        let html = '';
        html += `<div class="cip-country-name">${name}</div>`;
        html += `<div class="cip-country-code">${gid}</div>`;

        if (!isCoastal) {
            html += `<div class="cip-no-data">
                        <i class="fa-solid fa-mountain"></i> No coastal forecast data
                     </div>`;
        } else {
            if (showTwl && hasTwl) {
                html += `<div class="cip-section-title" style="color:var(--accent);">
                            <i class="fa-solid fa-water"></i> Total Water Level (TWL)
                         </div>`;
                html += `<div class="cip-row"><span>RP 10yr</span>${fmt(props.twl_rp10)}</div>`;
                html += `<div class="cip-row"><span>RP 100yr</span>${fmt(props.twl_rp100)}</div>`;
                html += `<div class="cip-row"><span>RP 500yr</span>${fmt(props.twl_rp500)}</div>`;
            }
            if (showEpis && hasEpis) {
                html += `<div class="cip-section-title" style="color:#f472b6;">
                            <i class="fa-solid fa-bolt"></i> Episodic Water Level (Epis)
                         </div>`;
                html += `<div class="cip-row"><span>RP 10yr</span>${fmt(props.epis_rp10)}</div>`;
                html += `<div class="cip-row"><span>RP 100yr</span>${fmt(props.epis_rp100)}</div>`;
                html += `<div class="cip-row"><span>RP 500yr</span>${fmt(props.epis_rp500)}</div>`;
            }
            if (props.n_grid_points) {
                html += `<div class="cip-footer">
                            <i class="fa-solid fa-border-all"></i> ${props.n_grid_points} grid points in buffer
                         </div>`;
            }
        }
        return html;
    }

    // Register click handler — MUST run before app.js handler processes.
    // We set the promise synchronously so app.js (which runs in same tick) can see it.
    map.on('click', function (e) {
        // Only show country panel if a risk layer is active
        const riskLayerActive = typeof activeLayers !== 'undefined' && 
            (activeLayers.has('country_epis_summary') || activeLayers.has('country_twl_summary'));
        if (!riskLayerActive) {
            window._countryCheckPromise = Promise.resolve(false);
            window._countryClickHandled = false;
            return;
        }

        // Synchronously set promise BEFORE any await — app.js will see it in same tick
        let resolveCountryCheck;
        window._countryCheckPromise = new Promise(r => { resolveCountryCheck = r; });
        window._countryClickHandled = false;

        // Now do the async work
        handleCountryClick(e, resolveCountryCheck);
    });

    async function handleCountryClick(e, resolveCountryCheck) {
        try {
            const props = await queryCountryInfo(e.latlng);
            if (!props) {
                closePanel();
                resolveCountryCheck(false);
                return;
            }

            // Mark that this click hit land
            window._countryClickHandled = true;
            resolveCountryCheck(true);

            // Show buffer + highlight
            if (props.gid_0) {
                showBuffer(props.gid_0);
                showHighlight(props.gid_0);
            }

            // Open draggable panel
            const content = buildPanelContent(props);
            openPanel(content, e.latlng);

        } catch (err) {
            console.warn('Country info query failed:', err);
            resolveCountryCheck(false);
            closePanel();
        }
    }

    // ── Inject CSS ──────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
        #country-info-panel {
            display: none;
            position: fixed;
            z-index: 2000;
            width: 280px;
            flex-direction: column;
            background: rgba(8, 20, 45, 0.92);
            backdrop-filter: blur(24px) saturate(150%);
            -webkit-backdrop-filter: blur(24px) saturate(150%);
            border: 1px solid rgba(96, 165, 250, 0.25);
            border-radius: 16px;
            box-shadow: 0 12px 48px rgba(0,0,0,0.6), 0 0 20px rgba(96,165,250,0.15);
            overflow: hidden;
            font-family: 'Inter', 'Segoe UI', sans-serif;
            animation: cipFadeIn 0.2s ease;
        }
        @keyframes cipFadeIn {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
        }
        .cip-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            background: rgba(96, 165, 250, 0.08);
            border-bottom: 1px solid rgba(96, 165, 250, 0.15);
            cursor: grab;
            user-select: none;
        }
        .cip-header:active { cursor: grabbing; }
        .cip-title {
            font-size: 12px;
            font-weight: 700;
            color: #93c5fd;
            letter-spacing: 0.3px;
        }
        .cip-title i { margin-right: 6px; color: #60a5fa; }
        .cip-close {
            width: 24px;
            height: 24px;
            border: none;
            background: rgba(255,255,255,0.06);
            border-radius: 6px;
            color: #93c5fd;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s;
        }
        .cip-close:hover { background: rgba(248,113,113,0.2); color: #f87171; }
        .cip-body {
            padding: 14px;
            overflow-y: auto;
            max-height: 400px;
        }
        .cip-country-name {
            font-size: 16px;
            font-weight: 700;
            color: #f0f6ff;
            margin-bottom: 2px;
        }
        .cip-country-code {
            font-size: 11px;
            color: #4b6fa5;
            margin-bottom: 12px;
            font-family: 'JetBrains Mono', monospace;
        }
        .cip-no-data {
            color: #fbbf24;
            font-size: 12px;
            font-weight: 600;
            padding: 8px 0;
        }
        .cip-no-data i { margin-right: 5px; }
        .cip-section-title {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin: 10px 0 6px 0;
        }
        .cip-section-title i { margin-right: 4px; }
        .cip-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 0;
            border-bottom: 1px solid rgba(255,255,255,0.04);
            font-size: 12px;
        }
        .cip-row span:first-child { color: #93c5fd; }
        .cip-footer {
            margin-top: 10px;
            padding-top: 8px;
            border-top: 1px solid rgba(255,255,255,0.06);
            font-size: 10px;
            color: #4b6fa5;
        }
        .cip-footer i { margin-right: 4px; }

        /* Country highlight glow on the map */
        .country-highlight-path {
            filter: drop-shadow(0 0 6px rgba(96,165,250,0.7)) drop-shadow(0 0 12px rgba(96,165,250,0.4));
        }
    `;
    document.head.appendChild(style);

    // Export
    window.countryInfo = { showBuffer, hideBuffer, showHighlight, hideHighlight, closePanel };
    console.log('🌍 Country Info module loaded (draggable panel + highlight)');
})();
