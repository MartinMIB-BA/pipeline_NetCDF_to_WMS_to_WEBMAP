// ═══════════════════════════════════════════════════════════════
// COUNTRY INFO MODULE — click → country forecast popup + buffer overlay
// ═══════════════════════════════════════════════════════════════
// Queries the "country_info" SQL View layer on click (GetFeatureInfo),
// shows a popup with forecast data, and highlights the 400 km
// water-only buffer for that country via a WMS layer with CQL_FILTER.
// ═══════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── Config ─────────────────────────────────────────────────
    const COUNTRY_INFO_LAYER = 'E_and_T:country_info';
    const BUFFER_LAYER = 'E_and_T:country_buffers_400km';

    // ── Buffer overlay WMS layer (single instance, toggled via CQL) ──
    let bufferWmsLayer = null;

    function ensureBufferPane() {
        if (!map.getPane('countryBufferPane')) {
            map.createPane('countryBufferPane');
            map.getPane('countryBufferPane').style.zIndex = 320; // below WMS data (350)
            map.getPane('countryBufferPane').style.pointerEvents = 'none';
        }
    }

    function showBuffer(gid0) {
        ensureBufferPane();
        const cql = `gid_0='${gid0}'`;

        if (bufferWmsLayer) {
            // Update existing layer's CQL filter
            bufferWmsLayer.setParams({ CQL_FILTER: cql });
            if (!map.hasLayer(bufferWmsLayer)) {
                bufferWmsLayer.addTo(map);
            }
        } else {
            bufferWmsLayer = L.tileLayer.wms(GEOSERVER_URL + '/wms', {
                layers: BUFFER_LAYER,
                format: 'image/png',
                transparent: true,
                version: '1.1.1',
                CQL_FILTER: cql,
                styles: '',
                pane: 'countryBufferPane',
                opacity: 0.35
            }).addTo(map);
        }
    }

    function hideBuffer() {
        if (bufferWmsLayer && map.hasLayer(bufferWmsLayer)) {
            map.removeLayer(bufferWmsLayer);
        }
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

        const url = `${GEOSERVER_URL}/wms?${params.toString()}`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        if (!data.features || data.features.length === 0) return null;
        return data.features[0].properties;
    }

    // ── Format popup HTML ───────────────────────────────────────
    function buildPopupContent(props) {
        const name = props.name_0 || 'Unknown';
        const gid = props.gid_0 || '—';

        // Helper: format probability value or show "—"
        const fmt = (val) => {
            if (val === null || val === undefined) return '—';
            return Number(val).toFixed(1) + ' %';
        };

        // Determine if coastal (has data)
        const hasTwl = props.twl_rp10 !== null && props.twl_rp10 !== undefined;
        const hasEpis = props.epis_rp10 !== null && props.epis_rp10 !== undefined;
        const isCoastal = hasTwl || hasEpis;

        let html = `<div style="min-width:220px; max-width:320px;">`;
        html += `<div style="font-size:15px; font-weight:700; color:var(--text-main); margin-bottom:2px;">
                    <i class="fa-solid fa-flag" style="color:var(--primary); margin-right:6px;"></i>${name}
                 </div>`;
        html += `<div style="font-size:11px; color:var(--text-dim); margin-bottom:10px;">${gid}</div>`;

        if (!isCoastal) {
            html += `<div style="color:var(--warning); font-size:12px; font-weight:600;">
                        <i class="fa-solid fa-mountain" style="margin-right:5px;"></i>No coastal forecast data
                     </div>`;
        } else {
            // TWL section
            if (hasTwl) {
                html += `<div style="font-size:11px; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
                            <i class="fa-solid fa-water" style="margin-right:4px;"></i>Total Water Level (TWL)
                         </div>`;
                html += `<table style="width:100%; font-size:12px; margin-bottom:10px; border-collapse:collapse;">
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
                        <td style="padding:3px 6px; color:var(--text-dim);">RP 10yr</td>
                        <td style="padding:3px 6px; font-weight:700; color:#fff; text-align:right;">${fmt(props.twl_rp10)}</td>
                    </tr>
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
                        <td style="padding:3px 6px; color:var(--text-dim);">RP 100yr</td>
                        <td style="padding:3px 6px; font-weight:700; color:#fff; text-align:right;">${fmt(props.twl_rp100)}</td>
                    </tr>
                    <tr>
                        <td style="padding:3px 6px; color:var(--text-dim);">RP 500yr</td>
                        <td style="padding:3px 6px; font-weight:700; color:#fff; text-align:right;">${fmt(props.twl_rp500)}</td>
                    </tr>
                </table>`;
            }

            // Epis section
            if (hasEpis) {
                html += `<div style="font-size:11px; font-weight:700; color:#f472b6; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
                            <i class="fa-solid fa-bolt" style="margin-right:4px;"></i>Episodic Water Level (Epis)
                         </div>`;
                html += `<table style="width:100%; font-size:12px; margin-bottom:6px; border-collapse:collapse;">
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
                        <td style="padding:3px 6px; color:var(--text-dim);">RP 10yr</td>
                        <td style="padding:3px 6px; font-weight:700; color:#fff; text-align:right;">${fmt(props.epis_rp10)}</td>
                    </tr>
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
                        <td style="padding:3px 6px; color:var(--text-dim);">RP 100yr</td>
                        <td style="padding:3px 6px; font-weight:700; color:#fff; text-align:right;">${fmt(props.epis_rp100)}</td>
                    </tr>
                    <tr>
                        <td style="padding:3px 6px; color:var(--text-dim);">RP 500yr</td>
                        <td style="padding:3px 6px; font-weight:700; color:#fff; text-align:right;">${fmt(props.epis_rp500)}</td>
                    </tr>
                </table>`;
            }

            // Grid points info
            if (props.n_grid_points_inside_buffer) {
                html += `<div style="font-size:10px; color:var(--text-faint); margin-top:4px;">
                            <i class="fa-solid fa-border-all" style="margin-right:4px;"></i>${props.n_grid_points_inside_buffer} grid points in buffer
                         </div>`;
            }
        }

        html += `</div>`;
        return html;
    }

    // ── Main click handler — runs in PARALLEL with existing getFeatureInfo ──
    // We hook into the same map click event, but only open a popup if no WMS
    // raster layers are active (so existing functionality takes priority).
    let countryPopup = null;

    async function handleCountryClick(e) {
        // Only show country popup if NO active raster layers are loaded
        // (so the standard getFeatureInfo popup takes priority when layers are active)
        const hasActiveRasterLayers = (typeof activeLayers !== 'undefined' && activeLayers.size > 0);
        if (hasActiveRasterLayers) {
            // When raster layers are active, still show buffer but don't open popup
            // (the existing getFeatureInfo will handle the popup)
            try {
                const props = await queryCountryInfo(e.latlng);
                if (props && props.gid_0) {
                    showBuffer(props.gid_0);
                } else {
                    hideBuffer();
                }
            } catch (_) {
                hideBuffer();
            }
            return;
        }

        // No raster layers active — show full country popup + buffer
        try {
            const props = await queryCountryInfo(e.latlng);
            if (!props) {
                hideBuffer();
                return;
            }

            // Show buffer overlay
            if (props.gid_0) {
                showBuffer(props.gid_0);
            }

            // Show popup
            const content = buildPopupContent(props);
            if (countryPopup) {
                map.closePopup(countryPopup);
            }
            countryPopup = L.popup({ maxWidth: 360, className: 'country-info-popup' })
                .setLatLng(e.latlng)
                .setContent(content)
                .openOn(map);

        } catch (err) {
            console.warn('Country info query failed:', err);
            hideBuffer();
        }
    }

    // Hide buffer when popup closes
    map.on('popupclose', function (e) {
        if (e.popup === countryPopup) {
            hideBuffer();
            countryPopup = null;
        }
    });

    // Register click handler (runs alongside existing map.on('click'))
    map.on('click', handleCountryClick);

    // Export for debugging
    window.countryInfo = { showBuffer, hideBuffer, queryCountryInfo };

    console.log('🌍 Country Info module loaded');
})();
