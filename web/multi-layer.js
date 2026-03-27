// ═══════════════════════════════════════════════════════════════
// MULTI-LAYER MANAGEMENT SYSTEM
// ═══════════════════════════════════════════════════════════════

// Active layers (max 3)
const activeLayers = new Map(); // layerId -> { wmsLayer, time, elevation, opacity, metadata }
window.activeLayers = activeLayers; // Export for use in app.js (e.g., stopAnimation restore)
const MAX_LAYERS = 3;
let activeLayerDnDBound = false;

// Layer display names for better UX - UPDATED TO MATCH GEOSERVER
const layerDisplayNames = {
    // Static layers - 10 year return period
    'probability_epis10y_1_1': 'Epis 10y (1d)',
    'probability_epis10y_1_3': 'Epis 10y (1-3d)',
    'probability_epis10y_1_15': 'Epis 10y (1-15d)',
    'probability_epis10y_4_15': 'Epis 10y (4-15d)',
    'probability_epis10y_10_15': 'Epis 10y (10-15d)',
    'probability_twl10y_1_1': 'TWL 10y (1d)',
    'probability_twl10y_1_3': 'TWL 10y (1-3d)',
    'probability_twl10y_1_15': 'TWL 10y (1-15d)',
    'probability_twl10y_4_15': 'TWL 10y (4-15d)',
    'probability_twl10y_10_15': 'TWL 10y (10-15d)',
    // Static layers - 100 year return period
    'probability_epis100y_1_1': 'Epis 100y (1d)',
    'probability_epis100y_1_3': 'Epis 100y (1-3d)',
    'probability_epis100y_1_15': 'Epis 100y (1-15d)',
    'probability_epis100y_4_15': 'Epis 100y (4-15d)',
    'probability_epis100y_10_15': 'Epis 100y (10-15d)',
    'probability_twl100y_1_1': 'TWL 100y (1d)',
    'probability_twl100y_1_3': 'TWL 100y (1-3d)',
    'probability_twl100y_1_15': 'TWL 100y (1-15d)',
    'probability_twl100y_4_15': 'TWL 100y (4-15d)',
    'probability_twl100y_10_15': 'TWL 100y (10-15d)',
    // Static layers - 500 year return period
    'probability_epis500y_1_1': 'Epis 500y (1d)',
    'probability_epis500y_1_3': 'Epis 500y (1-3d)',
    'probability_epis500y_1_15': 'Epis 500y (1-15d)',
    'probability_epis500y_4_15': 'Epis 500y (4-15d)',
    'probability_epis500y_10_15': 'Epis 500y (10-15d)',
    'probability_twl500y_1_1': 'TWL 500y (1d)',
    'probability_twl500y_1_3': 'TWL 500y (1-3d)',
    'probability_twl500y_1_15': 'TWL 500y (1-15d)',
    'probability_twl500y_4_15': 'TWL 500y (4-15d)',
    'probability_twl500y_10_15': 'TWL 500y (10-15d)',
    // Coastal layers
    'probability_epis_coast_01_15': 'Coastal Epis (1-15D)',
    'probability_epis_coast_01_03': 'Coastal Epis (1-3D)',
    'probability_epis_coast_04_15': 'Coastal Epis (4-15D)',
    'probability_twl_coast_01_15': 'Coastal TWL (1-15D)',
    'probability_twl_coast_01_03': 'Coastal TWL (1-3D)',
    'probability_twl_coast_04_15': 'Coastal TWL (4-15D)',
    // Video layers
    'epis_wl75': 'Episode WL 75',

    'twl75': 'Total WL 75',

    // GloFAS layers (external WMS)
    'RPGM': 'Medium Alert (>2yr RP)',
    'RPGH': 'High Alert (>5yr RP)',
    'RPGS': 'Severe Alert (>20yr RP)',
    'sumAL41EGE': 'Flood Summary (1–3d)',
    'sumAL42EGE': 'Flood Summary (4–10d)',
    'sumAL43EGE': 'Flood Summary (11–15d)',
    'FloodSummary1_30': 'Flood Summary (1–15d)',
    'EGE_probRgt50': 'Precip. Prob. >50mm',
    'EGE_probRgt150': 'Precip. Prob. >150mm',
    'AccRainEGE': 'Accumulated Precip.',
    'FloodHazard100y': 'Flood Hazard 100yr',
    'reportingPoints': 'Reporting Points'
};

const LAYER_BUBBLE_CATEGORIES = [
    { key: 'static', label: 'RETURN PERIOD LAYERS', icon: 'fa-layer-group', type: 'static' },
    { key: 'coastal', label: 'COASTAL and POINT DATA', icon: 'fa-location-dot', type: 'points' },
    { key: 'video', label: 'FORECAST LAYERS', icon: 'fa-film', type: 'video' },
    { key: 'glofas', label: 'GloFAS LAYERS', icon: 'fa-water', type: 'glofas' }
];

function hasForecastDateLabel(metadata) {
    return !!metadata && (metadata.type === 'video' || metadata.type === 'points');
}

function isForecastVideoLayer(metadata) {
    return !!metadata && metadata.type === 'video';
}

function formatForecastDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr || '--';
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();
    return `${day}.${month}.${year}`;
}

function updateForecastRangeLabel(layerId, baseTimeIso = null) {
    const rangeEl = document.getElementById(`forecast-range-${layerId}`);
    if (!rangeEl) return;

    let baseTime = baseTimeIso;
    if (!baseTime && activeLayers && activeLayers.has(layerId)) {
        baseTime = activeLayers.get(layerId).time;
    }
    if (!baseTime) {
        const globalTime = document.getElementById('time-select');
        if (globalTime && globalTime.value && globalTime.value.length >= 16) {
            baseTime = `${globalTime.value}:00.000Z`;
        }
    }
    if (!baseTime) {
        rangeEl.textContent = 'Forecast: --.--.---- - --.--.----';
        return;
    }

    const startDate = new Date(baseTime);
    if (isNaN(startDate.getTime())) {
        rangeEl.textContent = 'Forecast: --.--.---- - --.--.----';
        return;
    }
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + 15);

    const start = formatForecastDate(startDate.toISOString());
    const end = formatForecastDate(endDate.toISOString());
    rangeEl.textContent = `Forecast: ${start} - ${end}`;
}

// Initialize layer list
function initializeLayerList() {
    const layersList = document.getElementById('layers-list');

    // Group layers by category - 3 MAIN COLLAPSIBLE CATEGORIES
    const groups = {
        '🌊 Return Period Layers': [
            // 10 year
            'probability_epis10y_1_1', 'probability_epis10y_1_3', 'probability_epis10y_1_15', 'probability_epis10y_4_15', 'probability_epis10y_10_15',
            'probability_twl10y_1_1', 'probability_twl10y_1_3', 'probability_twl10y_1_15', 'probability_twl10y_4_15', 'probability_twl10y_10_15',
            // 100 year
            'probability_epis100y_1_1', 'probability_epis100y_1_3', 'probability_epis100y_1_15', 'probability_epis100y_4_15', 'probability_epis100y_10_15',
            'probability_twl100y_1_1', 'probability_twl100y_1_3', 'probability_twl100y_1_15', 'probability_twl100y_4_15', 'probability_twl100y_10_15',
            // 500 year
            'probability_epis500y_1_1', 'probability_epis500y_1_3', 'probability_epis500y_1_15', 'probability_epis500y_4_15', 'probability_epis500y_10_15',
            'probability_twl500y_1_1', 'probability_twl500y_1_3', 'probability_twl500y_1_15', 'probability_twl500y_4_15', 'probability_twl500y_10_15'
        ],
        '📍 Coastal & Point Data': [
            'probability_epis_coast_01_15', 'probability_epis_coast_01_03', 'probability_epis_coast_04_15',
            'probability_twl_coast_01_15', 'probability_twl_coast_01_03', 'probability_twl_coast_04_15'
        ],
        '🎥 Forecast Layers': [
            'epis_wl75', 'twl75'
        ],
        '🌐 GloFAS Layers': [
            'RPGM', 'RPGH', 'RPGS',
            'sumAL41EGE', 'sumAL42EGE', 'sumAL43EGE', 'FloodSummary1_30',
            'EGE_probRgt50', 'EGE_probRgt150', 'AccRainEGE',
            'FloodHazard100y', 'reportingPoints'
        ]
    };

    // Build HTML with collapsible groups
    let html = '';
    for (const [groupName, layers] of Object.entries(groups)) {
        const isForecast = groupName === '🎥 Forecast Layers';
        const iconDir = isForecast ? '▼' : '▶';
        const collapseClass = isForecast ? '' : 'collapsed';

        html += `
            <div class="layer-group">
                <div class="layer-group-header collapsible-header" data-group="${groupName}">
                    <span class="collapse-icon">${iconDir}</span>
                    <span>${groupName}</span>
                </div>
                <div class="layer-group-content collapsible-content ${collapseClass}" data-group="${groupName}">
        `;

        layers.forEach(layerId => {
            const displayName = layerDisplayNames[layerId] || layerId;
            html += `
                <div class="layer-item" id="layer-item-${layerId}">
                    <div class="layer-checkbox-row">
                        <input type="checkbox" id="checkbox-${layerId}" value="${layerId}">
                        <label for="checkbox-${layerId}" class="layer-checkbox-label">${displayName}</label>
                        <button type="button" class="layer-info-btn" data-layer-id="${layerId}" title="Show legend" aria-label="Show legend for ${displayName}">
                            <i class="fa-solid fa-circle-info"></i>
                        </button>
                    </div>
                    <div class="layer-legend-panel" id="legend-${layerId}" style="display:none;">
                        <div class="layer-legend-title-row">
                            <div class="layer-legend-title">Legend</div>
                            <div class="layer-legend-scale">
                                <button class="legend-scale-btn" data-legend="${layerId}" data-action="shrink" title="Zmenšiť">−</button>
                                <button class="legend-scale-btn" data-legend="${layerId}" data-action="reset" title="Pôvodná veľkosť">↺</button>
                                <button class="legend-scale-btn" data-legend="${layerId}" data-action="grow" title="Zväčšiť">+</button>
                            </div>
                        </div>
                        <div class="layer-legend-content">
                            <img id="legend-img-${layerId}" alt="Legend for ${displayName}" style="display:none;">
                            <div id="legend-empty-${layerId}" class="layer-legend-empty">Loading legend...</div>
                        </div>
                    </div>
                    <div class="layer-controls" id="controls-${layerId}">
                        ${generateLayerControls(layerId)}
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    }

    layersList.innerHTML = html;

    // Attach event listeners
    attachLayerCheckboxListeners();
    attachCollapsibleListeners();
    attachLegendInfoListeners();
    initializeLayerBubbleBar();
    setupActiveLayerDragAndDrop();
}

function getLayerIdsForBubbleCategory(type) {
    return Object.keys(layerDisplayNames).filter(layerId => {
        const metadata = layerMetadata[layerId];
        return metadata && metadata.type === type;
    });
}

function syncLayerBubbleState() {
    LAYER_BUBBLE_CATEGORIES.forEach(category => {
        const layerIds = getLayerIdsForBubbleCategory(category.type);
        const checkedInCategory = layerIds.filter(layerId => {
            const originalCheckbox = document.getElementById(`checkbox-${layerId}`);
            return !!(originalCheckbox && originalCheckbox.checked);
        });

        const triggerText = document.getElementById(`layer-bubble-current-${category.key}`);
        const countBadge = document.getElementById(`layer-bubble-count-${category.key}`);
        if (triggerText) {
            triggerText.textContent = category.label;
        }
        if (countBadge) {
            const count = checkedInCategory.length;
            countBadge.textContent = String(count);
            countBadge.style.display = count > 0 ? 'inline-flex' : 'none';
        }

        layerIds.forEach(layerId => {
            const toggleBtn = document.getElementById(`bubble-toggle-${category.key}-${layerId}`);
            const originalCheckbox = document.getElementById(`checkbox-${layerId}`);
            if (toggleBtn && originalCheckbox) {
                const isOn = !!originalCheckbox.checked;
                toggleBtn.classList.toggle('active', isOn);
                toggleBtn.textContent = isOn ? 'ON' : 'OFF';
                toggleBtn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
            }
        });
    });
}

function initializeLayerBubbleBar() {
    const wrap = document.getElementById('layer-bubble-bar');
    if (!wrap) return;

    wrap.innerHTML = '';
    LAYER_BUBBLE_CATEGORIES.forEach(category => {
        const layerIds = getLayerIdsForBubbleCategory(category.type);
        const shell = document.createElement('div');
        shell.className = 'layer-bubble-slot';
        shell.setAttribute('data-category', category.key);

        let itemsHtml = '';
        layerIds.forEach(layerId => {
            const displayName = layerDisplayNames[layerId] || layerId;
            itemsHtml += `
                <div class="layer-bubble-item">
                    <span class="layer-bubble-item-name">${displayName}</span>
                    <button type="button" class="layer-bubble-toggle" id="bubble-toggle-${category.key}-${layerId}" data-layer-id="${layerId}" data-category="${category.key}" aria-pressed="false">OFF</button>
                </div>
            `;
        });

        shell.innerHTML = `
            <button type="button" class="layer-bubble-trigger" id="layer-bubble-trigger-${category.key}">
                <i class="fa-solid ${category.icon}"></i>
                <span id="layer-bubble-current-${category.key}" class="layer-bubble-label">${category.label}</span>
                <span id="layer-bubble-count-${category.key}" class="layer-bubble-count" style="display:none;">0</span>
                <i class="fa-solid fa-chevron-down"></i>
            </button>
            <div class="layer-bubble-menu" id="layer-bubble-menu-${category.key}">
                ${itemsHtml}
            </div>
        `;
        wrap.appendChild(shell);
    });

    const closeAllMenus = () => {
        document.querySelectorAll('.layer-bubble-slot.open').forEach(slot => slot.classList.remove('open'));
    };

    const fitBubbleMenuToContent = (slot) => {
        if (!slot) return;
        const menu = slot.querySelector('.layer-bubble-menu');
        const trigger = slot.querySelector('.layer-bubble-trigger');
        if (!menu || !trigger) return;

        // Reset first so we can measure natural content height
        menu.style.maxHeight = '';

        const triggerRect = trigger.getBoundingClientRect();
        const naturalHeight = menu.scrollHeight;
        const viewportPadding = 16;
        const availableHeight = Math.max(120, window.innerHeight - triggerRect.bottom - viewportPadding);
        const targetHeight = Math.min(naturalHeight, availableHeight);

        menu.style.maxHeight = `${targetHeight}px`;
        menu.style.overflowY = naturalHeight > availableHeight ? 'auto' : 'hidden';
    };

    document.querySelectorAll('.layer-bubble-trigger').forEach(trigger => {
        trigger.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const slot = this.closest('.layer-bubble-slot');
            if (!slot) return;
            const wasOpen = slot.classList.contains('open');
            closeAllMenus();
            if (!wasOpen) {
                slot.classList.add('open');
                fitBubbleMenuToContent(slot);
            }
        });
    });

    document.addEventListener('click', function () {
        closeAllMenus();
    });

    window.addEventListener('resize', function () {
        const openSlot = document.querySelector('.layer-bubble-slot.open');
        if (openSlot) fitBubbleMenuToContent(openSlot);
    });

    document.querySelectorAll('.layer-bubble-toggle').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();

            const layerId = this.getAttribute('data-layer-id');
            if (!layerId) return;

            const originalCheckbox = document.getElementById(`checkbox-${layerId}`);
            if (!originalCheckbox) return;

            const shouldEnable = !originalCheckbox.checked;
            if (shouldEnable && activeLayers.size >= MAX_LAYERS) {
                alert(`Maximum ${MAX_LAYERS} layers allowed`);
                return;
            }

            originalCheckbox.checked = shouldEnable;
            originalCheckbox.dispatchEvent(new Event('change'));
            syncLayerBubbleState();
        });
    });

    syncLayerBubbleState();
}

// Generate controls HTML for a layer
function generateLayerControls(layerId) {
    const metadata = layerMetadata[layerId];
    if (!metadata) return '';

    let html = '';

    // Time control (ONLY for non-static layers like video and points)
    if (metadata.type !== 'static' && metadata.type !== 'glofas') {
        // For forecast-style layers (video + coastal points), show dynamic forecast date label
        if (hasForecastDateLabel(metadata)) {
            html += `
            <div class="layer-control">
                <label class="layer-control-label"><i class="fa-regular fa-clock"></i> Forecast Date</label>
                <div id="elevation-date-${layerId}" style="font-size: 11px; font-weight: 600; color: var(--primary-color); background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: 6px; padding: 5px 8px; text-align: center;">--.--.----</div>
                ${isForecastVideoLayer(metadata) ? `<div id="forecast-range-${layerId}" class="forecast-range-note">Forecast range: loading...</div>` : ''}
                <!-- Hidden time input to preserve logic that depends on it -->
                <input type="hidden" id="time-${layerId}" class="layer-time-input" value="">
            </div>
            `;
        } else {
            html += `
            <div class="layer-control">
                <label class="layer-control-label"><i class="fa-regular fa-clock"></i> Time (UTC)</label>
                <input type="datetime-local" id="time-${layerId}" class="layer-time-input"
                       value="">
            </div>
            `;
        }
    }

    // Elevation control (if supported)
    if (metadata.hasElevation) {
        const maxValue = metadata.type === 'video' ? 15 : 8;
        const label = metadata.type === 'video' ? 'Day' : (metadata.type === 'points' ? 'RP' : 'RP');

        html += `
            <div class="layer-control">
                <label class="layer-control-label"><i class="fa-solid fa-ruler-vertical"></i> ${label}</label>
                <div class="layer-control-row">
                    <input type="range" id="elevation-${layerId}" min="0" max="${maxValue}" value="0" step="1" class="layer-elevation-input">
                    <span class="layer-control-value" id="elevation-value-${layerId}">0</span>
                </div>
            </div>
        `;
    }

    // Per-layer opacity (for non-video layers only)
    if (metadata.type !== 'video') {
        html += `
            <div class="layer-control">
                <label class="layer-control-label"><i class="fa-solid fa-eye"></i> Opacity</label>
                <div class="layer-control-row">
                    <input type="range" id="opacity-${layerId}" min="0" max="100" value="70" step="5" class="layer-opacity-input">
                    <span class="layer-control-value" id="opacity-value-${layerId}">70%</span>
                </div>
            </div>
        `;
    }

    // Animation controls for VIDEO layers only
    if (metadata.type === 'video') {
        html += `
            <div class="layer-control" style="border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 8px;">
                <label class="layer-control-label"><i class="fa-solid fa-film"></i> Animation</label>
                <div class="layer-control-row" style="gap: 8px; margin-bottom: 6px;">
                    <button id="play-btn-${layerId}" class="btn btn-sm" style="flex: 1; padding: 6px 10px; font-size: 11px;">
                        <i class="fa-solid fa-play"></i> Play
                    </button>
                </div>
                <div class="layer-control-row">
                    <label class="layer-control-label" style="margin: 0; font-size: 8px;">Speed</label>
                    <input type="range" id="anim-speed-${layerId}" min="200" max="2000" value="500" step="100" style="flex: 1;">
                    <span class="layer-control-value" id="speed-value-${layerId}" style="min-width: 35px;">0.5s</span>
                </div>
            </div>
        `;
    }

    return html;

}

// Attach event listeners to checkboxes and controls
function attachLayerCheckboxListeners() {
    const checkboxes = document.querySelectorAll('[id^="checkbox-"]');

    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function () {
            const layerId = this.value;
            const isChecked = this.checked;

            if (isChecked) {
                // Check if max layers reached
                if (activeLayers.size >= MAX_LAYERS) {
                    alert(`Maximum ${MAX_LAYERS} layers allowed`);
                    this.checked = false;
                    return;
                }

                addLayer(layerId);
            } else {
                removeLayer(layerId);
            }

            updateLayerCount();
            syncLayerBubbleState();
        });
    });
}

// Attach collapsible listeners for expanding/collapsing groups
function attachCollapsibleListeners() {
    const headers = document.querySelectorAll('.collapsible-header');

    headers.forEach(header => {
        header.addEventListener('click', function () {
            const groupName = this.getAttribute('data-group');
            const content = document.querySelector(`.collapsible-content[data-group="${groupName}"]`);
            const icon = this.querySelector('.collapse-icon');

            if (content.classList.contains('collapsed')) {
                // Expand
                content.classList.remove('collapsed');
                icon.textContent = '▼';
            } else {
                // Collapse
                content.classList.add('collapsed');
                icon.textContent = '▶';
            }
        });
    });
}

function buildLegendUrl(layerId) {
    const meta = window.layerMetadata && window.layerMetadata[layerId];
    const isGlofas = !!(meta && meta.wmsUrl);
    const layerName = isGlofas ? layerId : `${WORKSPACE}:${layerId}`;
    const baseUrl = isGlofas ? meta.wmsUrl : `${GEOSERVER_URL}/wms`;
    const legendParams = isGlofas
        ? { service: 'WMS', request: 'GetLegendGraphic', format: 'image/png', version: '1.1.1', SLD_VERSION: '1.1.0', layer: layerName }
        : { service: 'WMS', request: 'GetLegendGraphic', format: 'image/png', transparent: 'true', version: '1.3.0', layer: layerName };
    return `${baseUrl}?${new URLSearchParams(legendParams).toString()}`;
}

function loadLegendForLayer(layerId) {
    const panel = document.getElementById(`legend-${layerId}`);
    const img = document.getElementById(`legend-img-${layerId}`);
    const empty = document.getElementById(`legend-empty-${layerId}`);
    if (!panel || !img || !empty) return;

    if (panel.dataset.loaded === '1') return;

    const meta = window.layerMetadata && window.layerMetadata[layerId];

    if (meta && meta.legendHtml) {
        img.style.display = 'none';
        empty.innerHTML = meta.legendHtml;
        empty.style.display = 'block';
        panel.dataset.loaded = '1';
        return;
    }

    const legendUrl = buildLegendUrl(layerId);
    img.onload = () => {
        img.style.display = 'block';
        empty.style.display = 'none';
        panel.dataset.loaded = '1';
    };
    img.onerror = () => {
        img.style.display = 'none';
        empty.textContent = 'Legend not available for this layer.';
        empty.style.display = 'block';
        panel.dataset.loaded = '1';
    };
    img.src = legendUrl;
}

function attachLegendInfoListeners() {
    const infoButtons = document.querySelectorAll('.layer-info-btn');
    infoButtons.forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();

            const layerId = this.getAttribute('data-layer-id');
            const panel = document.getElementById(`legend-${layerId}`);
            if (!panel) return;

            const isHidden = panel.style.display === 'none';
            panel.style.display = isHidden ? 'block' : 'none';
            this.classList.toggle('active', isHidden);

            if (isHidden) {
                loadLegendForLayer(layerId);
            }
        });
    });

}

// Legend scale buttons — single delegated listener on document (legendEl moves between containers)
document.addEventListener('click', function (e) {
    const btn = e.target.closest('.legend-scale-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const layerId = btn.getAttribute('data-legend');
    const img = document.getElementById(`legend-img-${layerId}`);
    if (!img) return;

    const STEP = 20;
    const current = parseInt(img.dataset.scale || '100', 10);
    let next = current;

    if (btn.dataset.action === 'grow')   next = Math.min(current + STEP, 200);
    if (btn.dataset.action === 'shrink') next = Math.max(current - STEP, 20);
    if (btn.dataset.action === 'reset')  next = 100;

    img.dataset.scale = next;
    img.style.width = `${next}%`;
    img.style.maxWidth = 'none';
});

// Add a layer
function addLayer(layerId) {
    console.log('✅ Adding layer:', layerId);

    const metadata = layerMetadata[layerId];
    if (!metadata) {
        console.error('No metadata for layer:', layerId);
        return;
    }

    // Get initial parameters from GLOBAL controls if available, otherwise individual or defaults
    const globalTime = document.getElementById('time-select');
    const globalElevation = document.getElementById('elevation-select');
    const globalOpacity = document.getElementById('opacity-select');

    // Individual controls (might not exist yet if not created, but usually created in loop)
    // Actually controls are created AFTER addLayer in original code? No, controls created in generateLayerControls called in init... 
    // Wait, controls are in the DOM already because initializeLayerList() runs first.

    // Priorities: Global > Individual > Default
    let initialTime;
    if (globalTime && globalTime.value && globalTime.value.length >= 16) {
        initialTime = globalTime.value + ':00.000Z';
        // Sync individual input
        const indTime = document.getElementById(`time-${layerId}`);
        if (indTime) indTime.value = globalTime.value;
    } else {
        // Do NOT fall back to getCurrentTimeUTC() — that would use today's date
        // which may not be available on the server.
        // The time-select input should have been pre-filled by the metadata fetch.
        const timeInput = document.getElementById(`time-${layerId}`);
        initialTime = timeInput && timeInput.value && timeInput.value.length >= 16 ? timeInput.value + ':00.000Z' : null;
        if (!initialTime) {
            console.warn(`⚠️ [addLayer] No time available yet for ${layerId}. Layer will wait for metadata.`);
        }
    }

    let initialElevation = 0;
    const isVideo = metadata && metadata.type === 'video';

    // 🛑 STRICT VIDEO RESET: Video layers MUST start at Day 0 when added,
    // aborting any active animations from previous layers.
    if (isVideo) {
        if (typeof window.stopAnimation === 'function' && window.isAnimating) {
            window.stopAnimation();
        }
        initialElevation = 0;

        // Force UI sliders back to 0
        if (globalElevation) globalElevation.value = 0;
        const globalElevVal = document.getElementById('elevation-value');
        if (globalElevVal) globalElevVal.textContent = '0';

        const indElev = document.getElementById(`elevation-${layerId}`);
        const indElevVal = document.getElementById(`elevation-value-${layerId}`);
        if (indElev) indElev.value = 0;
        if (indElevVal) indElevVal.textContent = '0';

    } else {
        // Non-video layers inherit global or local values
        if (globalElevation) {
            initialElevation = parseInt(globalElevation.value);
            // Sync individual
            const indElev = document.getElementById(`elevation-${layerId}`);
            const indElevVal = document.getElementById(`elevation-value-${layerId}`);
            if (indElev) indElev.value = initialElevation;
            if (indElevVal) indElevVal.textContent = initialElevation;
        } else {
            const elevationInput = document.getElementById(`elevation-${layerId}`);
            initialElevation = elevationInput ? parseInt(elevationInput.value) : 0;
        }
    }

    let initialOpacity;
    const globalOpacityControl = document.getElementById('global-opacity-container');

    if (isVideo) {
        initialOpacity = 1.0; // Video layers are always 100% visible
        if (globalOpacityControl) {
            globalOpacityControl.style.display = 'none';
        }
    } else if (globalOpacity) {
        initialOpacity = parseInt(globalOpacity.value) / 100;
        // Sync individual control to global value if it was just added
        setTimeout(() => {
            const indOp = document.getElementById(`opacity-${layerId}`);
            const indOpVal = document.getElementById(`opacity-value-${layerId}`);
            if (indOp) indOp.value = globalOpacity.value;
            if (indOpVal) indOpVal.textContent = `${globalOpacity.value}%`;
        }, 100);

        // Ensure global slider is visible if no video layers are active
        if (globalOpacityControl) {
            let hasVideo = false;
            activeLayers.forEach(l => { if (l.metadata && l.metadata.type === 'video') hasVideo = true; });
            if (!hasVideo) globalOpacityControl.style.display = 'flex';
        }
    } else {
        const opacityInput = document.getElementById(`opacity-${layerId}`);
        initialOpacity = opacityInput ? parseInt(opacityInput.value) / 100 : 0.7;
    }

    const params = {
        time: initialTime,
        elevation: initialElevation,
        opacity: initialOpacity
    };

    console.log(`➕ Adding layer ${layerId} with synced params:`, params);

    // Create WMS layer
    // For specialized GWC video layers, use tileSize=256 and tiled=true
    const gwcLayers = ['twl75', 'epis_wl75'];
    const isGwcLayer = gwcLayers.includes(layerId);

    const isGlofas = !!(metadata && metadata.wmsUrl);

    const glofasTime = (isGlofas && metadata.requiresTime)
        ? new Date().toISOString().split('T')[0] + 'T00:00:00'
        : undefined;

    const wmsParams = {
        layers: isGlofas ? layerId : `${WORKSPACE}:${layerId}`,
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        ...(isGlofas ? (glofasTime ? { time: glofasTime } : {}) : {
            time: params.time, // ALWAYS send time for GeoServer layers
            elevation: params.elevation
        })
    };

    if (isGwcLayer) {
        wmsParams.tiled = true;
        wmsParams.version = '1.1.1';
        wmsParams.SRS = 'EPSG:900913';
        wmsParams.srs = 'EPSG:900913'; // GWC parser needs lowercase srs in v1.1.1
    }

    // Use external WMS URL for GloFAS layers, GWC for video, GeoServer WMS otherwise
    const endpoint = isGlofas ? metadata.wmsUrl : (isGwcLayer ? `${GEOSERVER_URL}/gwc/service/wms` : `${GEOSERVER_URL}/wms`);
    let wmsLayer = L.tileLayer.wms(endpoint, {
        ...wmsParams,
        // CRITICAL FIX FOR GWC: Force Leaflet to NOT use the map's custom CRS if it's a GWC layer
        crs: isGwcLayer ? L.CRS.EPSG3857 : (window.map ? window.map.options.crs : L.CRS.EPSG3857),
        tileSize: 512,
        // FAST PAN OPZIMIZATION
        updateWhenIdle: false, // Don't wait until map stops moving (start fetching immediately)
        updateWhenZooming: false, // Prevents flashing and clearing of old tiles during zoom
        updateInterval: 150, // Respond very fast during drag
        keepBuffer: 2, // Reverted to 2
        maxNativeZoom: 19,
        maxZoom: 19,
        minZoom: 0,
        crossOrigin: true,
        opacity: params.opacity,
        pane: 'baseWmsPane'  // FIX: always below animation frames (animWmsPane z=450)
    });

    wmsLayer.addTo(map);

    // ═══════════════════════════════════════════════════════════════
    // ERROR TRACKING FOR NO DATA OVERLAY
    // ═══════════════════════════════════════════════════════════════
    let tileErrorCount = 0;
    let tileSuccessCount = 0;

    // Track tile errors
    wmsLayer.on('tileerror', function (event) {
        // Ignore aborted requests
        const isAborted = !event.tile.src || event.tile.src.startsWith('data:');
        if (!isAborted) {
            tileErrorCount++;
            console.error(`❌ Tile error for layer ${layerId} (${tileErrorCount} errors, ${tileSuccessCount} successes)`);

            // IMPROVED: Only show overlay after significant errors (5+) with no successes
            // This prevents false positives during normal loading
            if (tileErrorCount >= 5 && tileSuccessCount === 0) {
                console.warn(`⚠️ Multiple tile errors for ${layerId}, may show "no data" if persists`);
                // Don't show immediately - wait for load complete event
            }
        }
    });

    // Track successful tile loads
    wmsLayer.on('tileload', function () {
        tileSuccessCount++;
        console.log(`✅ Tile loaded for layer ${layerId} (${tileSuccessCount} successes)`);

        // Hide overlay if we got successful data
        if (tileSuccessCount > 0) {
            if (window.hideNoDataOverlay) {
                window.hideNoDataOverlay();
            }
        }
    });

    // Reset counters on new load cycle
    wmsLayer.on('loading', function () {
        tileErrorCount = 0;
        tileSuccessCount = 0;
        if (window.hideNoDataOverlay) {
            window.hideNoDataOverlay();
        }
    });

    // Store layer data
    activeLayers.set(layerId, {
        wmsLayer,
        time: params.time,
        elevation: params.elevation,
        opacity: params.opacity,
        hidden: false,
        animationSpeed: metadata && metadata.type === 'video' ? 500 : null,
        metadata
    });

    // Show controls
    // FIX #16: Null-check before classList manipulation
    const layerItem = document.getElementById(`layer-item-${layerId}`);
    if (layerItem) layerItem.classList.add('active');

    // Attach control event listeners
    attachLayerControlListeners(layerId);

    // SYNC with App State (metadata panel)
    if (window.setCurrentLayer) {
        window.setCurrentLayer(layerId);
        // Also update global currentParams time/elev/opacity to match this layer
        if (window.currentParams) {
            window.currentParams.time = params.time;
            window.currentParams.elevation = params.elevation;
            window.currentParams.opacity = params.opacity;
            window.updateLayerInfo(); // Refresh display
        }
    }

    // Initialize dynamic forecast date label for video + coastal points layers
    if (hasForecastDateLabel(metadata) && params.time) {
        updateForecastDateLabel(layerId, params.elevation, params.time);
    }
    if (isForecastVideoLayer(metadata)) {
        updateForecastRangeLabel(layerId);
    }



    console.log(`✅ Layer ${layerId} added. Active layers: ${activeLayers.size}`);
    updateBottomPanelLayers();
    syncLayerBubbleState();
}

// Remove a layer
function removeLayer(layerId) {
    console.log('🗑️ Removing layer:', layerId);

    const layerData = activeLayers.get(layerId);
    if (!layerData) return;

    // Cancel any pending atomic transitions
    if (layerTransitions.has(layerId)) {
        const t = layerTransitions.get(layerId);
        if (t.timeoutId) clearTimeout(t.timeoutId);
        if (t.oldLayer && window.map.hasLayer(t.oldLayer)) {
            window.map.removeLayer(t.oldLayer);
        }
        layerTransitions.delete(layerId);
    }

    // Remove from map
    if (window.map && window.map.hasLayer(layerData.wmsLayer)) {
        map.removeLayer(layerData.wmsLayer);
    }

    // Safety check for any other attached layers (zombies)
    map.eachLayer(layer => {
        if (layer.wmsParams && layer.wmsParams.layers.includes(layerId)) {
            map.removeLayer(layer);
        }
    });

    // Remove from active layers
    activeLayers.delete(layerId);

    // CRITICAL FIX: Stop animation if we are removing the layer currently being animated
    // This prevents the loop from running in background or erroring
    if (window.currentParams && window.currentParams.layer === layerId) {
        if (typeof window.stopAnimation === 'function') {
            console.log('🛑 Application Stop: Removed active animated layer');
            window.stopAnimation();
        }
    }

    // Hide controls
    // FIX #16: Null-check before classList manipulation
    const layerItem = document.getElementById(`layer-item-${layerId}`);
    if (layerItem) layerItem.classList.remove('active');

    // Restore opacity slider if no video layers are active
    const globalOpacityControl = document.getElementById('global-opacity-container');
    if (globalOpacityControl) {
        let hasVideo = false;
        activeLayers.forEach(l => { if (l.metadata && l.metadata.type === 'video') hasVideo = true; });
        if (!hasVideo) globalOpacityControl.style.display = 'flex';
    }

    console.log(`✅ Layer ${layerId} removed. Active layers: ${activeLayers.size}`);
    updateBottomPanelLayers();
    syncLayerBubbleState();
}

// Update the active layers list in the bottom panel
function updateBottomPanelLayers() {
    try {
        const panel = document.getElementById('active-layers-panel');
        if (!panel) {
            console.warn('⚠️ active-layers-panel not found in DOM');
            return;
        }

        // Restore controls for inactive layers back to their hidden source containers
        document.querySelectorAll('#active-layers-panel .active-layer-controls-card[data-layer-id]').forEach(card => {
            const layerId = card.getAttribute('data-layer-id');
            if (!layerId || activeLayers.has(layerId)) return;
            const controlsEl = document.getElementById(`controls-${layerId}`);
            const legendEl = document.getElementById(`legend-${layerId}`);
            const layerItem = document.getElementById(`layer-item-${layerId}`);
            if (controlsEl && layerItem) {
                controlsEl.style.display = '';
                layerItem.appendChild(controlsEl);
            }
            if (legendEl && layerItem) {
                legendEl.style.display = 'none';
                layerItem.appendChild(legendEl);
            }
            card.remove();
        });

        if (activeLayers.size === 0) {
            panel.innerHTML = '<span class="active-layer-empty">No active layers</span>';
            return;
        }

        // Remove empty placeholder if it exists
        const emptyState = panel.querySelector('.active-layer-empty');
        if (emptyState) emptyState.remove();

        activeLayers.forEach((layerData, layerId) => {
            const displayName = layerDisplayNames[layerId] || layerId;
            let card = document.getElementById(`active-layer-card-${layerId}`);
            if (!card) {
                card = document.createElement('div');
                card.className = 'active-layer-controls-card';
                card.id = `active-layer-card-${layerId}`;
                card.setAttribute('data-layer-id', layerId);
                card.innerHTML = `
                    <div class="active-layer-controls-header" draggable="true">
                        <i class="fa-solid fa-layer-group"></i>
                        <span>${displayName}</span>
                        <button type="button" class="active-layer-visibility-btn" id="active-layer-visibility-${layerId}" data-layer-id="${layerId}" title="Toggle layer visibility">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                        <button type="button" class="active-layer-info-btn" id="active-layer-info-${layerId}" data-layer-id="${layerId}" title="Show legend">
                            <i class="fa-solid fa-circle-info"></i>
                        </button>
                    </div>
                    <div class="active-layer-controls-body" id="active-layer-controls-body-${layerId}">
                        <div id="active-layer-legend-host-${layerId}"></div>
                    </div>
                `;
                panel.appendChild(card);
            }

            const body = document.getElementById(`active-layer-controls-body-${layerId}`);
            const controlsEl = document.getElementById(`controls-${layerId}`);
            const legendEl = document.getElementById(`legend-${layerId}`);
            const legendHost = document.getElementById(`active-layer-legend-host-${layerId}`);
            const infoBtn = document.getElementById(`active-layer-info-${layerId}`);
            const visBtn = document.getElementById(`active-layer-visibility-${layerId}`);

            if (legendHost && legendEl && legendEl.parentElement !== legendHost) {
                legendEl.style.display = 'none';
                legendHost.appendChild(legendEl);
            }

            if (infoBtn && !infoBtn.dataset.bound) {
                infoBtn.dataset.bound = '1';
                infoBtn.addEventListener('click', function () {
                    const targetLegend = document.getElementById(`legend-${layerId}`);
                    if (!targetLegend) return;
                    const isHidden = targetLegend.style.display === 'none';
                    targetLegend.style.display = isHidden ? 'block' : 'none';
                    this.classList.toggle('active', isHidden);
                    if (isHidden) loadLegendForLayer(layerId);
                });
            }

            if (visBtn && !visBtn.dataset.bound) {
                visBtn.dataset.bound = '1';
                visBtn.addEventListener('click', function () {
                    const current = activeLayers.get(layerId);
                    if (!current) return;
                    setLayerVisibility(layerId, !!current.hidden);
                });
            }

            updateLayerVisibilityButton(layerId);
            updateVideoPlayButtonVisibilityState(layerId);

            if (body && controlsEl && controlsEl.parentElement !== body) {
                controlsEl.style.display = 'block';
                body.appendChild(controlsEl);
            }
        });

        applyMapZOrderFromPanel();
    } catch (err) {
        console.error('❌ updateBottomPanelLayers error:', err);
    }
}
window.updateBottomPanelLayers = updateBottomPanelLayers;

function applyMapZOrderFromPanel() {
    const panel = document.getElementById('active-layers-panel');
    if (!panel) return;

    const cards = Array.from(panel.querySelectorAll('.active-layer-controls-card[data-layer-id]'));
    if (cards.length === 0) return;

    // Top card in panel should be top-most on map:
    // bring layers to front from bottom->top so top card is processed last.
    const bottomToTop = cards.slice().reverse();
    bottomToTop.forEach(card => {
        const layerId = card.getAttribute('data-layer-id');
        const layerData = layerId ? activeLayers.get(layerId) : null;
        if (!layerData || !layerData.wmsLayer) return;
        if (typeof layerData.wmsLayer.bringToFront === 'function') {
            layerData.wmsLayer.bringToFront();
        }
    });
}

function setupActiveLayerDragAndDrop() {
    if (activeLayerDnDBound) return;
    const panel = document.getElementById('active-layers-panel');
    if (!panel) return;
    activeLayerDnDBound = true;

    let draggedCard = null;

    panel.addEventListener('dragstart', (e) => {
        if (e.target.closest('button, input, select, textarea, label')) {
            e.preventDefault();
            return;
        }
        const card = e.target.closest('.active-layer-controls-card[data-layer-id]');
        if (!card) return;
        draggedCard = card;
        card.classList.add('dragging');
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.getAttribute('data-layer-id') || '');
        }
    });

    panel.addEventListener('dragend', () => {
        if (draggedCard) {
            draggedCard.classList.remove('dragging');
        }
        draggedCard = null;
    });

    panel.addEventListener('dragover', (e) => {
        if (!draggedCard) return;
        e.preventDefault();
        const targetCard = e.target.closest('.active-layer-controls-card[data-layer-id]');
        if (!targetCard || targetCard === draggedCard || targetCard.parentElement !== panel) return;

        const rect = targetCard.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        if (before) {
            panel.insertBefore(draggedCard, targetCard);
        } else {
            panel.insertBefore(draggedCard, targetCard.nextSibling);
        }
    });

    panel.addEventListener('drop', (e) => {
        if (!draggedCard) return;
        e.preventDefault();
        applyMapZOrderFromPanel();
    });
}

function updateLayerVisibilityButton(layerId) {
    const layerData = activeLayers.get(layerId);
    const btn = document.getElementById(`active-layer-visibility-${layerId}`);
    if (!layerData || !btn) return;

    const hidden = !!layerData.hidden;
    btn.classList.toggle('active', !hidden);
    btn.title = hidden ? 'Show layer' : 'Hide layer';
    btn.innerHTML = hidden
        ? '<i class="fa-solid fa-eye-slash"></i>'
        : '<i class="fa-solid fa-eye"></i>';
}

function updateVideoPlayButtonVisibilityState(layerId) {
    const layerData = activeLayers.get(layerId);
    if (!layerData || !layerData.metadata || layerData.metadata.type !== 'video') return;

    const playBtn = document.getElementById(`play-btn-${layerId}`);
    if (!playBtn) return;

    if (layerData.hidden) {
        playBtn.disabled = true;
        playBtn.title = 'Vrstva je skrytá (eye-slash). Najprv ju zobraz pre spustenie animácie.';
        playBtn.style.opacity = '0.45';
        playBtn.style.cursor = 'not-allowed';
        return;
    }

    // Restore default state and let zoom guards (if any) re-apply constraints.
    playBtn.disabled = false;
    playBtn.title = 'Spustiť animáciu';
    playBtn.style.opacity = '1';
    playBtn.style.cursor = 'pointer';
    if (window.updatePlayButtonsState) {
        window.updatePlayButtonsState();
    }
}

function setLayerVisibility(layerId, visible) {
    const layerData = activeLayers.get(layerId);
    if (!layerData || !layerData.wmsLayer) return;

    if (!visible && layerData.metadata && layerData.metadata.type === 'video') {
        if (window.isAnimating && window.currentParams && window.currentParams.layer === layerId && typeof window.stopAnimation === 'function') {
            window.stopAnimation();
        }
    }

    layerData.hidden = !visible;

    if (!visible) {
        // LAZY LOADING: Physically remove from map – no more tile requests on zoom/pan
        if (window.map && window.map.hasLayer(layerData.wmsLayer)) {
            window.map.removeLayer(layerData.wmsLayer);
            console.log(`🚫 [LAZY] Layer ${layerId} removed from map (no tile requests)`);
        }
    } else {
        // Re-add to map – Leaflet will automatically fetch fresh tiles for current view
        if (window.map && !window.map.hasLayer(layerData.wmsLayer)) {
            layerData.wmsLayer.addTo(window.map);
            // Ensure correct params are applied (may have changed while hidden)
            refreshLayerTiles(layerId, layerData, {});
            console.log(`✅ [LAZY] Layer ${layerId} restored to map`);
        }
        // Restore correct opacity after re-adding
        const targetOpacity = (layerData.metadata && layerData.metadata.type === 'video') ? 1 : layerData.opacity;
        layerData.wmsLayer.setOpacity(targetOpacity);
    }

    updateLayerVisibilityButton(layerId);
    updateVideoPlayButtonVisibilityState(layerId);
}

const initializedControls = new Set();

// Attach control listeners for a specific layer
function attachLayerControlListeners(layerId) {
    if (initializedControls.has(layerId)) return;
    initializedControls.add(layerId);

    // Time control
    const timeInput = document.getElementById(`time-${layerId}`);
    if (timeInput) {
        timeInput.addEventListener('change', function () {
            const layerData = activeLayers.get(layerId);
            if (!layerData) return;

            if (!this.value || this.value.length < 16) return; // Prevent ":00.000Z" bug

            // --- STRICT 12-HOUR AND MIN/MAX ENFORCEMENT ---
            let targetDate = new Date(this.value + ':00.000Z');

            let hours = targetDate.getUTCHours();
            hours = hours >= 12 ? 12 : 0;
            targetDate.setUTCHours(hours, 0, 0, 0);

            if (window.wmsMetadata && window.wmsMetadata.loaded) {
                const { minDate, maxDate } = window.wmsMetadata.getTimeExtent();
                if (minDate && targetDate < minDate) targetDate = new Date(minDate);
                if (maxDate && targetDate > maxDate) targetDate = new Date(maxDate);
            }

            hours = targetDate.getUTCHours();
            hours = hours >= 12 ? 12 : 0;
            targetDate.setUTCHours(hours, 0, 0, 0);

            const safeValue = targetDate.toISOString().slice(0, 16);
            if (this.value !== safeValue) {
                this.value = safeValue;
            }

            const newTime = safeValue + ':00.000Z';
            layerData.time = newTime;

            // Update dynamic date label if this is a forecast (video) layer
            updateForecastDateLabel(layerId, layerData.elevation, newTime);
            if (isForecastVideoLayer(layerData.metadata)) {
                updateForecastRangeLabel(layerId, newTime);
            }

            // Stop animation if this layer is currently playing
            if (window.isAnimating && window.currentParams && window.currentParams.layer === layerId) {
                window.stopAnimation();
            }

            // Clear animation cache so TIME changes actually reload frames
            if (layerData.metadata && layerData.metadata.type === 'video' && typeof window.clearAnimationCacheForLayer === 'function') {
                window.clearAnimationCacheForLayer(layerId);
            }

            refreshLayerTiles(layerId, layerData, { time: newTime });
            checkAllLayersAvailability();
            console.log(`⏰ Layer ${layerId} time updated to ${newTime}`);
        });
    }

    // Elevation control
    const elevationInput = document.getElementById(`elevation-${layerId}`);
    const elevationValue = document.getElementById(`elevation-value-${layerId}`);
    if (elevationInput && elevationValue) {
        elevationInput.addEventListener('input', function () {
            const layerData = activeLayers.get(layerId);
            if (!layerData) return;

            const newVal = parseInt(this.value);
            // 1. Update UI Immediately
            elevationValue.textContent = newVal;

            // Update dynamic date label (video + coastal points)
            if (hasForecastDateLabel(layerData.metadata)) {
                updateForecastDateLabel(layerId, newVal, layerData.time);
            }

            // Stop animation if this layer is currently playing
            if (window.isAnimating && window.currentParams && window.currentParams.layer === layerId) {
                window.stopAnimation();
            }

            // 2. Debounce WMS Request
            debouncedIndividualElevationUpdate(layerId, newVal);
        });
    }

    // Opacity control (ONLY for non-video layers)
    const opacityInput = document.getElementById(`opacity-${layerId}`);
    const opacityValue = document.getElementById(`opacity-value-${layerId}`);
    if (opacityInput && opacityValue) {
        opacityInput.addEventListener('input', function () {
            const layerData = activeLayers.get(layerId);
            if (!layerData || (layerData.metadata && layerData.metadata.type === 'video')) return;

            const newVal = parseInt(this.value);
            // 1. Update UI Immediately
            opacityValue.textContent = `${newVal}%`;

            // 2. Debounce WMS Request
            debouncedIndividualOpacityUpdate(layerId, newVal);
        });
    }

    // Animation controls (for VIDEO layers only)
    // Animation controls (for VIDEO layers)
    const playBtn = document.getElementById(`play-btn-${layerId}`);
    if (playBtn) {
        playBtn.addEventListener('click', async function (e) {
            e.preventDefault(); // Stop default button behavior
            const layerData = activeLayers.get(layerId);
            if (!layerData || (layerData.metadata && layerData.metadata.type !== 'video')) return;
            if (layerData.hidden) {
                console.log(`🙈 Layer ${layerId} is hidden. Ignoring Play.`);
                return;
            }

            console.log(`🔘 Play/Stop button clicked for layer ${layerId}`);
            const isPlaying = window.isAnimating && window.currentParams && window.currentParams.layer === layerId;

            if (isPlaying) {
                // Stop animation and reset
                console.log('🔘 Calling window.stopAnimation()...');
                if (window.stopAnimation) {
                    window.stopAnimation();
                }
            } else {
                // Start animation
                console.log('🔘 Starting animation...');
                if (window.setCurrentLayer && window.currentParams) {
                    if (window.currentParams.layer !== layerId) {
                        window.setCurrentLayer(layerId);
                        window.currentParams.layer = layerId;
                        window.currentParams.time = layerData.time;
                        window.currentParams.elevation = layerData.elevation;
                        window.currentParams.opacity = layerData.opacity;
                    }
                }

                // Always sync speed from this layer before start (even if slider wasn't moved)
                const speedInput = document.getElementById(`anim-speed-${layerId}`);
                const speedFromLayer = speedInput ? parseInt(speedInput.value) : parseInt(layerData.animationSpeed || 500);
                if (!isNaN(speedFromLayer)) {
                    layerData.animationSpeed = speedFromLayer;
                    if (window.setAnimationSpeed) {
                        window.setAnimationSpeed(speedFromLayer);
                    }
                }

                if (window.startAnimation) {
                    await window.startAnimation(false);
                }
            }
        });
    }

    const speedInput = document.getElementById(`anim-speed-${layerId}`);
    const speedValue = document.getElementById(`speed-value-${layerId}`);
    if (speedInput && speedValue) {
        const layerData = activeLayers.get(layerId);
        if (layerData && layerData.metadata && layerData.metadata.type === 'video' && layerData.animationSpeed) {
            speedInput.value = String(layerData.animationSpeed);
            speedValue.textContent = `${(layerData.animationSpeed / 1000).toFixed(1)}s`;
        }

        speedInput.addEventListener('input', function () {
            const speed = parseInt(this.value);
            speedValue.textContent = `${(speed / 1000).toFixed(1)}s`;

            const currentLayerData = activeLayers.get(layerId);
            if (currentLayerData) {
                currentLayerData.animationSpeed = speed;
            }

            // Update animation speed in app.js
            if (window.setAnimationSpeed) {
                window.setAnimationSpeed(speed);
            }
        });
    }

    // Initial state check for play buttons
    if (window.updatePlayButtonsState) {
        window.updatePlayButtonsState();
    }
}

// Automatically disable play buttons on high zoom levels for GWC layers to prevent server overload
window.updatePlayButtonsState = function () {
    if (!window.map) return;
    const currentZoom = window.map.getZoom();

    activeLayers.forEach((layerData, layerId) => {
        if (layerData.metadata && layerData.metadata.type === 'video') {
            const playBtn = document.getElementById(`play-btn-${layerId}`);
            if (!playBtn) return;

            // Limit animation for GWC at high zooms
            const gwcLayers = ['twl75', 'epis_wl75'];
            const isGwcLayer = gwcLayers.includes(layerId);

            if (isGwcLayer && currentZoom >= 6) {
                playBtn.disabled = true;
                playBtn.title = 'Animácia je pri úrovni priblíženia 6+ vypnutá z dôvodu ochrany servera. Snímky sa ukladajú iba pre statický pohľad.';
                playBtn.style.opacity = '0.5';
                playBtn.style.cursor = 'not-allowed';
            } else {
                playBtn.disabled = false;
                playBtn.title = "Spustiť animáciu";
                playBtn.style.opacity = '1';
                playBtn.style.cursor = 'pointer';
            }
        }
    });
};

// Helper: Calculate and update the dynamic date label for forecast layers
function updateForecastDateLabel(layerId, dayOffset, baseTimeIso) {
    const dateLabel = document.getElementById(`elevation-date-${layerId}`);
    if (!dateLabel) return;

    if (!baseTimeIso) {
        dateLabel.textContent = '';
        return;
    }

    try {
        const baseDate = new Date(baseTimeIso);
        // Add the day offset
        baseDate.setUTCDate(baseDate.getUTCDate() + parseInt(dayOffset));

        // Format to European date format (DD.MM.YYYY)
        const day = baseDate.getUTCDate().toString().padStart(2, '0');
        const month = (baseDate.getUTCMonth() + 1).toString().padStart(2, '0');
        const year = baseDate.getUTCFullYear();

        dateLabel.textContent = `${day}.${month}.${year}`;
    } catch (e) {
        console.error('Error calculating forecast date:', e);
        dateLabel.textContent = '';
    }
}
window.updateForecastDateLabel = updateForecastDateLabel;

// Proactively check availability for a specific layer
// Proactively check availability for a specific layer using METADATA
function checkLayerDataAvailability(layerId, time, elevation) {
    if (!window.wmsMetadata) return true; // Safety

    // Check local metadata interactively
    return window.wmsMetadata.isDataAvailable(layerId, time, elevation);
}

// Check all active layers and manage banner
// Check all active layers and manage banner
function checkAllLayersAvailability() {
    if (activeLayers.size === 0) return;

    // Show loading spinner (briefly, mostly for consistency/debounce visualization)
    if (window.showLoadingOverlay) window.showLoadingOverlay();

    console.log('🔍 Checking all layers (Local Metadata)...');

    const checks = [];
    for (const [layerId, layerData] of activeLayers.entries()) {
        const result = checkLayerDataAvailability(layerId, layerData.time, layerData.elevation);
        checks.push(result);
    }

    // Since checks are now synchronous, we can process immediately
    // Artificial delay removed as local check is instant

    if (window.hideLoadingOverlay) window.hideLoadingOverlay();

    const hasData = checks.some(r => r === true);

    if (hasData) {
        console.log('✅ Data available in at least one layer');
        if (window.hideNoDataOverlay) window.hideNoDataOverlay();
    } else {
        console.warn('⚠️ No data available in any active layer (Metadata check)');
        // DISABLED: Do not show overlay based on metadata alone
        // if (window.showNoDataOverlay) window.showNoDataOverlay();
    }
}

// Update layer count display
function updateLayerCount() {
    const layerCount = document.getElementById('layer-count');
    if (layerCount) {
        layerCount.textContent = `${activeLayers.size}/${MAX_LAYERS}`;
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function () {
    initializeLayerList();
    console.log('🎛️ Multi-layer system initialized');

    // ═══════════════════════════════════════════════════════════════
    // GLOBAL CONTROL LISTENERS
    // ═══════════════════════════════════════════════════════════════

    // 1. Time Selection
    // NOTE: refreshLayerTiles MUST stay here - app.js debouncedTimeUpdate only updates
    // the legacy wmsLayer, NOT the multi-layer activeLayers tiles.
    const timeSelect = document.getElementById('time-select');
    if (timeSelect) {
        timeSelect.addEventListener('change', function () {
            if (!this.value || this.value.length < 16) return;
            const newTime = this.value + ':00.000Z';
            console.log('⏰ [multi-layer] Global time changed:', newTime);

            activeLayers.forEach((layerData, layerId) => {
                layerData.time = newTime;

                if (window.isAnimating && window.currentParams && window.currentParams.layer === layerId) {
                    window.stopAnimation();
                }

                if (layerData.metadata && layerData.metadata.type === 'video' && typeof window.clearAnimationCacheForLayer === 'function') {
                    window.clearAnimationCacheForLayer(layerId);
                }

                refreshLayerTiles(layerId, layerData, { time: newTime });

                const individualInput = document.getElementById(`time-${layerId}`);
                if (individualInput) individualInput.value = this.value;

                if (hasForecastDateLabel(layerData.metadata)) {
                    updateForecastDateLabel(layerId, layerData.elevation, newTime);
                }
                if (isForecastVideoLayer(layerData.metadata)) {
                    updateForecastRangeLabel(layerId, newTime);
                }
            });
            checkAllLayersAvailability();
        });
    }

    // 2. Elevation/Dimension Selection
    const elevationSelect = document.getElementById('elevation-select');
    const elevationValue = document.getElementById('elevation-value');
    if (elevationSelect) {
        elevationSelect.addEventListener('input', function () {
            const newVal = parseInt(this.value);
            // 1. Update UI Immediately
            if (elevationValue) elevationValue.textContent = newVal;

            // Stop animation if the currently playing layer is a video layer
            if (window.isAnimating && window.currentParams && window.currentParams.layer) {
                const meta = layerMetadata[window.currentParams.layer];
                if (meta && meta.type === 'video') {
                    window.stopAnimation();
                }
            }

            // Sync individual values visibly immediately (UX)
            activeLayers.forEach((layerData, layerId) => {
                const individualVal = document.getElementById(`elevation-value-${layerId}`);
                if (individualVal) individualVal.textContent = newVal;

                // Keep forecast date label in sync while scrubbing the global slider
                if (hasForecastDateLabel(layerData.metadata)) {
                    updateForecastDateLabel(layerId, newVal, layerData.time);
                }
            });

            // 2. Debounce WMS Request
            debouncedGlobalElevationUpdate(newVal);
        });
    }

    // 3. Opacity Selection
    const opacitySelect = document.getElementById('opacity-select');
    const opacityVal = document.getElementById('opacity-value');
    if (opacitySelect) {
        opacitySelect.addEventListener('input', function () {
            const newVal = parseInt(this.value);
            if (opacityVal) opacityVal.textContent = newVal + '%';

            // Sync individual values visibly immediately
            activeLayers.forEach((layerData, layerId) => {
                const individualVal = document.getElementById(`opacity-value-${layerId}`);
                if (individualVal) individualVal.textContent = newVal + '%';
            });

            // 2. Debounce WMS Request
            debouncedGlobalOpacityUpdate(newVal);
        });
    }

    // 4. AUTO-INITIALIZE DEFAULT LAYER
    // ✅ FIXED: Wait for WMS metadata FIRST so we have the correct date range
    //    before triggering addLayer (which reads getCurrentTimeUTC = today by default).
    const defaultLayerId = 'epis_wl75';
    const defaultCheckbox = document.getElementById(`checkbox-${defaultLayerId}`);

    if (defaultCheckbox) {
        console.log('⏳ Waiting for WMS Capabilities before auto-init...');

        // Immediately kick off capability fetch (non-blocking for UI setup above)
        const metadataReady = window.wmsMetadata
            ? window.wmsMetadata.fetchCapabilities()
            : Promise.resolve(false);

        metadataReady.then(() => {
            // Update forecast range notes (start = selected time, end = +15 days)
            Object.keys(layerMetadata).forEach(layerId => {
                if (isForecastVideoLayer(layerMetadata[layerId])) {
                    updateForecastRangeLabel(layerId);
                }
            });

            // After metadata is ready, sync the global time input to the SPECIFIC layer's latest date
            // Using getLatestTimeForLayer() prevents cross-layer contamination:
            // e.g., video layers have 12:00Z times but static layers only have 00:00Z times.
            if (window.wmsMetadata && window.wmsMetadata.loaded) {
                // Try layer-specific time first, fall back to global max
                const latestISO = window.wmsMetadata.getLatestTimeForLayer(defaultLayerId)
                    || window.wmsMetadata.getTimeExtent().maxDate?.toISOString();

                if (latestISO) {
                    console.log(`✅ Metadata loaded. Layer-specific latest time: ${latestISO}`);

                    // Update the global time input so addLayer() picks up the right value
                    const timeInput = document.getElementById('time-select');
                    if (timeInput) {
                        timeInput.value = latestISO.slice(0, 16); // "YYYY-MM-DDTHH:mm"
                    }
                } else {
                    console.warn('⚠️ Could not determine latest time from metadata');
                }
            }

            // Now trigger the default layer load (it reads the time-select we just set)
            if (defaultCheckbox && !defaultCheckbox.checked) {
                console.log(`🚀 Auto-initializing default layer: ${defaultLayerId}`);
                defaultCheckbox.click(); // Trigger native event pipeline
            }

            // Auto-initialize GloFAS reporting points (uses its own time, no metadata needed)
            const reportingPointsCheckbox = document.getElementById('checkbox-reportingPoints');
            if (reportingPointsCheckbox && !reportingPointsCheckbox.checked) {
                console.log('🚀 Auto-initializing default layer: reportingPoints');
                reportingPointsCheckbox.click();
            }
        }).catch(err => {
            // Fallback: init anyway even if metadata fails
            console.warn('⚠️ Metadata fetch failed, initializing layer with default time:', err);
            defaultCheckbox.checked = true;
            defaultCheckbox.dispatchEvent(new Event('change'));
        });
    }

    // Attach zoom event to update play buttons state
    if (window.map) {
        window.map.on('zoomend', window.updatePlayButtonsState);
    } else {
        // Fallback in case map is initialized slightly later
        setTimeout(() => {
            if (window.map) window.map.on('zoomend', window.updatePlayButtonsState);
        }, 1000);
    }
});

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// WMTS helper: update tile URL or setParams depending on layer type,
// then redraw. Call this instead of layer.setParams() everywhere.
// newParams: { time?, elevation? } — only pass what changed
// ─────────────────────────────────────────────────────────────────────────────
function refreshLayerTiles(layerId, layerData, newParams = {}) {
    // GloFAS layers with requiresTime manage their own time — ignore external time updates
    const meta = layerData.metadata || (window.layerMetadata && window.layerMetadata[layerId]);
    if (meta && meta.requiresTime && newParams.time !== undefined) {
        delete newParams.time;
    }

    // LAZY LOADING GUARD: If layer is hidden, only update state – don't send tile requests.
    // Tiles will be fetched automatically when the layer is shown again (addTo triggers reload).
    if (layerData.hidden) {
        if (newParams.time !== undefined) layerData.time = newParams.time;
        if (newParams.elevation !== undefined) layerData.elevation = newParams.elevation;
        console.log(`⏸️ [LAZY] Layer ${layerId} is hidden, state updated without network request`);
        return;
    }

    // Merge new values into layerData
    if (newParams.time !== undefined) layerData.time = newParams.time;
    if (newParams.elevation !== undefined) layerData.elevation = newParams.elevation;

    // Standard WMS: update only what changed
    const wmsUpdate = {};
    if (newParams.time !== undefined) wmsUpdate.time = newParams.time;
    if (newParams.elevation !== undefined) wmsUpdate.elevation = newParams.elevation;

    console.log(`🔄 [WMS UPDATE] Layer ${layerId} updating params:`, wmsUpdate);

    if (Object.keys(wmsUpdate).length) {
        layerData.wmsLayer.setParams(wmsUpdate, false);
    }
    layerData.wmsLayer.redraw();
    console.log(`✅ [WMS UPDATE] Layer ${layerId} redrawn. Current WMS Params:`, layerData.wmsLayer.wmsParams);
}

// Debounce function to prevent request flooding during slider scrubbing
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Debounced update functions
const debouncedGlobalElevationUpdate = debounce((newVal) => {
    console.log(`📉 Debounced Global Elevation Update: ${newVal}`);
    activeLayers.forEach((layerData, layerId) => {
        if (layerData.metadata.hasElevation) {
            layerData.elevation = newVal;
            refreshLayerTiles(layerId, layerData, { elevation: newVal });

            if (hasForecastDateLabel(layerData.metadata)) {
                updateForecastDateLabel(layerId, newVal, layerData.time);
            }

            // Sync individual control
            const individualInput = document.getElementById(`elevation-${layerId}`);
            if (individualInput) individualInput.value = newVal;
        }
    });
    checkAllLayersAvailability();
}, 250); // 250ms delay

const debouncedGlobalOpacityUpdate = debounce((newVal) => {
    console.log(`👁️ Debounced Global Opacity Update: ${newVal}%`);
    activeLayers.forEach((layerData, layerId) => {
        // Skip video layers, they must remain at 100% opacity
        if (layerData.metadata && layerData.metadata.type === 'video') {
            return;
        }

        const opacity = newVal / 100;
        layerData.opacity = opacity;
        if (!layerData.hidden) {
            layerData.wmsLayer.setOpacity(opacity);
        }

        // Sync individual control
        const individualInput = document.getElementById(`opacity-${layerId}`);
        if (individualInput) individualInput.value = newVal;
    });
}, 250);

// Track active transitions to prevent stacking
const layerTransitions = new Map(); // layerId -> { timeoutId, currentLayer, targetElevation }

const debouncedIndividualElevationUpdate = debounce(async (layerId, newVal) => {
    // ⚠️ GUARD: Ignore slider changes triggered programmatically by the animation loop.
    // animateNextFrame updates elevationSlider.value which fires an 'input' event and
    // would call stopAnimation() here → animation stops after first/second frame.
    if (window.isAnimating) {
        return; // Let the animation handle frame switching
    }

    console.log(`📉 Debounced Individual Elevation Update for ${layerId}: ${newVal}`);
    const layerData = activeLayers.get(layerId);
    if (!layerData) return;

    // CANCEL PREVIOUS TRANSITION
    if (layerTransitions.has(layerId)) {
        const t = layerTransitions.get(layerId);
        if (t.timeoutId) clearTimeout(t.timeoutId);
        // If we were mid-transition, force cleanup of the OLD layer immediately
        // to prevent "ghost" layers carrying over
        if (window.map && t.oldLayer && window.map.hasLayer(t.oldLayer) && t.oldLayer !== layerData.wmsLayer) {
            window.map.removeLayer(t.oldLayer);
        }
        layerTransitions.delete(layerId);
    }


    // VIDEO LAYER: Use animation cache if available to avoid network requests
    if (layerData.metadata && layerData.metadata.type === 'video' && window.animationCache) {
        const animZoom = Math.round(window.map.getZoom());
        const gwcLayers = ['twl75', 'epis_wl75'];
        const fixedZoom = (gwcLayers.includes(layerId) && animZoom >= 6) ? 6 : animZoom;
        const cacheKey = `${layerId}-${newVal}-${fixedZoom}`;

        if (window.animationCache[cacheKey]) {
            // Cache hit: show cached frame without any network request
            const targetLayer = window.animationCache[cacheKey];

            // Hide all other cached layers still on the map
            Object.values(window.animationCache).forEach(layer => {
                if (layer && layer !== targetLayer && window.map && window.map.hasLayer(layer)) {
                    layer.setOpacity(0);
                }
            });

            // Re-attach target layer if it was removed (e.g. after stopAnimation)
            if (window.map && !window.map.hasLayer(targetLayer)) {
                targetLayer.setOpacity(0);
                targetLayer.addTo(window.map);
            }

            // Show cached frame (animWmsPane z=450 naturally covers baseWmsPane z=350)
            // Do NOT hide wmsLayer — if tiles fail to reload after removeLayer, base stays visible
            targetLayer.setOpacity(1.0);

            layerData.elevation = newVal;
            if (window.updateLayerInfo && window.currentParams && window.currentParams.layer === layerId) {
                window.currentParams.elevation = newVal;
                window.updateLayerInfo();
            }
            checkAllLayersAvailability();
            return;
        } else {
            // Cache miss: remove all cached layers from map, restore base layer for normal request
            Object.values(window.animationCache).forEach(layer => {
                if (layer && window.map && window.map.hasLayer(layer)) {
                    window.map.removeLayer(layer);
                }
            });
            if (layerData.wmsLayer) layerData.wmsLayer.setOpacity(layerData.opacity != null ? layerData.opacity : 1.0);
        }
    }

    // Fallback: non-video layers or video cache miss — normal network request
    layerData.elevation = newVal;

    // LAZY LOADING GUARD: skip network request if layer is hidden
    if (!layerData.hidden) {
        layerData.wmsLayer.setParams({ elevation: newVal }, false);
        layerData.wmsLayer.redraw();
    }

    if (window.updateLayerInfo && window.currentParams && window.currentParams.layer === layerId) {
        window.currentParams.elevation = newVal;
        window.updateLayerInfo();
    }

    checkAllLayersAvailability();
}, 150); // Lower debounce for better responsiveness

const debouncedIndividualOpacityUpdate = debounce((layerId, newVal) => {
    const layerData = activeLayers.get(layerId);
    if (!layerData) return;

    const opacity = newVal / 100;
    layerData.opacity = opacity;
    if (!layerData.hidden) {
        layerData.wmsLayer.setOpacity(opacity);
    }
    console.log(`🎨 Debounced Individual Opacity for ${layerId}: ${opacity}`);
}, 100);
