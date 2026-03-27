// GeoServer configuration - AUTO DETECT ENVIRONMENT
window.isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const GEOSERVER_URL = window.isLocalhost ? 'http://localhost:8080' : '/geoserver';
// const GEOSERVER_URL = window.isLocalhost ? 'http://89.47.190.36/geoserver' : '/geoserver';

const WORKSPACE = 'E_and_T';

// ═══════════════════════════════════════════════════════════════
// SERVER PROTECTION: Prevent accidental GeoServer overload
// ═══════════════════════════════════════════════════════════════
const SERVER_PROTECTION = {
    enabled: true,
    maxTabs: 2,  // Warn if more than 2 tabs open
    tabId: Math.random().toString(36).substr(2, 9),
    checkInterval: 5000  // Check every 5 seconds
};

// Track active tabs using localStorage
function registerTab() {
    if (!SERVER_PROTECTION.enabled) return;

    const activeTabs = JSON.parse(localStorage.getItem('wms_active_tabs') || '[]');
    const now = Date.now();

    // Add this tab
    activeTabs.push({
        id: SERVER_PROTECTION.tabId,
        timestamp: now
    });

    // Remove stale tabs (older than 10 seconds)
    const freshTabs = activeTabs.filter(t => now - t.timestamp < 10000);
    localStorage.setItem('wms_active_tabs', JSON.stringify(freshTabs));

    // Warn if too many tabs
    if (freshTabs.length > SERVER_PROTECTION.maxTabs) {
        console.warn(`⚠️ [PROTECTION] ${freshTabs.length} tabs detected! Multiple tabs can overload GeoServer.`);
        console.warn(`💡 Recommendation: Close other WMS viewer tabs to prevent server issues.`);
    }
}

// Refresh tab registration periodically
setInterval(() => {
    registerTab();
}, SERVER_PROTECTION.checkInterval);

// Initial registration
registerTab();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    const activeTabs = JSON.parse(localStorage.getItem('wms_active_tabs') || '[]');
    const filtered = activeTabs.filter(t => t.id !== SERVER_PROTECTION.tabId);
    localStorage.setItem('wms_active_tabs', JSON.stringify(filtered));
});

// Initialize map centered on Europe
const map = L.map('map', {
    preferCanvas: true,
    zoomControl: true,
    minZoom: 2            // PREVENT REPEATED WORLDS: Keep zoom level high enough
}).setView([45.0, 15.0], 4);

// Basemap configuration + switcher
const BASEMAP_OPTIONS = {
    esri_world_street: {
        name: 'Esri World Street (EN)',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        options: {
            attribution: 'Tiles © Esri',
            maxZoom: 19,
            minZoom: 2,
            pane: 'tilePane'
        }
    },
    carto_dark: {
        name: 'Carto Dark Matter',
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        options: {
            attribution: '© <a href="https://carto.com/">CARTO</a> | © OpenStreetMap contributors',
            subdomains: 'abcd',
            maxZoom: 20,
            minZoom: 2,
            pane: 'tilePane'
        }
    },
    osm: {
        name: 'OpenStreetMap',
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19,
            minZoom: 2,
            pane: 'tilePane'
        }
    },
    carto_voyager: {
        name: 'Carto Voyager',
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        options: {
            attribution: '© <a href="https://carto.com/">CARTO</a> | © OpenStreetMap contributors',
            subdomains: 'abcd',
            maxZoom: 20,
            minZoom: 2,
            pane: 'tilePane'
        }
    },
    esri_satellite: {
        name: 'Esri World Imagery',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: {
            attribution: 'Tiles © Esri',
            maxZoom: 19,
            minZoom: 2,
            pane: 'tilePane'
        }
    }
};

let currentBaseMapId = 'carto_voyager';
let baseLayer = null;

function setBaseMap(baseMapId) {
    const cfg = BASEMAP_OPTIONS[baseMapId] || BASEMAP_OPTIONS[currentBaseMapId] || BASEMAP_OPTIONS.carto_dark;
    if (!cfg) return;

    if (baseLayer && map.hasLayer(baseLayer)) {
        map.removeLayer(baseLayer);
    }

    baseLayer = L.tileLayer(cfg.url, cfg.options).addTo(map);
    currentBaseMapId = baseMapId in BASEMAP_OPTIONS ? baseMapId : 'carto_dark';
    window.currentBaseMapId = currentBaseMapId;
    console.log(`🗺️ Basemap switched to: ${cfg.name}`);
}

// Default basemap
setBaseMap(currentBaseMapId);

// Expose for UI and debugging
window.setBaseMap = setBaseMap;
window.BASEMAP_OPTIONS = BASEMAP_OPTIONS;

// Expose map to window for multi-layer support
window.map = map;

// ═══════════════════════════════════════════════════════════════
// PANE SETUP: Deterministic z-index separation
// baseWmsPane  (z=350) → base/static WMS layers from multi-layer.js
// animWmsPane  (z=450) → animation frame layers from preloadFrame/animateNextFrame
// ═══════════════════════════════════════════════════════════════
if (!map.getPane('baseWmsPane')) {
    map.createPane('baseWmsPane');
    map.getPane('baseWmsPane').style.zIndex = 350;
    map.getPane('baseWmsPane').style.pointerEvents = 'none';
}
if (!map.getPane('animWmsPane')) {
    map.createPane('animWmsPane');
    map.getPane('animWmsPane').style.zIndex = 450;
    map.getPane('animWmsPane').style.pointerEvents = 'none';
}

// ═══════════════════════════════════════════════════════════════
// MULTI-LEVEL ZOOM CACHE SYSTEM
// ═══════════════════════════════════════════════════════════════
window.frameCache = {}; // Structure: { layerId: { zoomLevel: { elevation: imageData } } }
window.cacheConfig = {
    maxZoomLevels: 3,  // Maximum number of zoom levels to cache per layer
    enabled: true
};

// Track zoom level access times for LRU cleanup
const zoomAccessTimes = {}; // { layerId: { zoomLevel: timestamp } }

// Get current map zoom level
function getCurrentZoomLevel() {
    return map.getZoom();
}

// Get cached frame if available
function getCachedFrame(layerId, zoomLevel, elevation) {
    if (!window.cacheConfig.enabled) return null;

    const layerCache = window.frameCache[layerId];
    if (!layerCache) return null;

    const zoomCache = layerCache[zoomLevel];
    if (!zoomCache) return null;

    // Update access time for LRU
    if (!zoomAccessTimes[layerId]) zoomAccessTimes[layerId] = {};
    zoomAccessTimes[layerId][zoomLevel] = Date.now();

    return zoomCache[elevation] || null;
}

// Store frame in cache
function setCachedFrame(layerId, zoomLevel, elevation, imageData) {
    if (!window.cacheConfig.enabled) return;

    // Initialize cache structure
    if (!window.frameCache[layerId]) {
        window.frameCache[layerId] = {};
    }
    if (!window.frameCache[layerId][zoomLevel]) {
        window.frameCache[layerId][zoomLevel] = {};
    }
    if (!zoomAccessTimes[layerId]) {
        zoomAccessTimes[layerId] = {};
    }

    // Store frame
    window.frameCache[layerId][zoomLevel][elevation] = imageData;
    zoomAccessTimes[layerId][zoomLevel] = Date.now();

    // Cleanup old zoom levels if needed
    cleanupCache(layerId);
}

// LRU cleanup - remove least recently used zoom levels
function cleanupCache(layerId) {
    const layerCache = window.frameCache[layerId];
    if (!layerCache) return;

    const zoomLevels = Object.keys(layerCache);
    if (zoomLevels.length <= window.cacheConfig.maxZoomLevels) return;

    // Sort by access time (oldest first)
    const sortedZooms = zoomLevels.sort((a, b) => {
        const timeA = zoomAccessTimes[layerId]?.[a] || 0;
        const timeB = zoomAccessTimes[layerId]?.[b] || 0;
        return timeA - timeB;
    });

    // Remove oldest zoom levels
    const toRemove = sortedZooms.slice(0, zoomLevels.length - window.cacheConfig.maxZoomLevels);
    toRemove.forEach(zoom => {
        console.log(`🗑️ [CACHE] Removing old zoom level ${zoom} for ${layerId}`);
        delete window.frameCache[layerId][zoom];
        if (zoomAccessTimes[layerId]) {
            delete zoomAccessTimes[layerId][zoom];
        }
    });
}

// Clear cache for specific layer
function clearLayerCache(layerId) {
    if (window.frameCache[layerId]) {
        console.log(`🗑️ [CACHE] Clearing all cache for ${layerId}`);
        delete window.frameCache[layerId];
        delete zoomAccessTimes[layerId];
    }
}

// WMS layer variables - dual layer for crossfade
let wmsLayer = null;
let wmsLayerA = null;  // First animation layer
let wmsLayerB = null;  // Second animation layer
let activeLayer = 'A'; // Which layer is currently visible

// Performance instrumentation
let getMapRequestCount = 0;
let currentLoadCycleStart = null;
let loadingTiles = 0;
let loadingTimeout = null; // Timeout to prevent stuck loading indicator

// FIX #2: Module-scoped error/success counters so updateWMSParams can reset them
let tileErrorCount = 0;
let tileSuccessCount = 0;

// ═══════════════════════════════════════════════════════════════
// PERFORMANCE TRACKING SYSTEM
// ═══════════════════════════════════════════════════════════════
const performanceMetrics = {
    lastOperation: null,
    operationStartTime: null,
    tileLoadTimes: [],
    firstTileTime: null,
    requestCounts: { dateChange: 0, layerChange: 0, zoom: 0, total: 0 },
    completionTimes: { dateChange: [], layerChange: [], zoom: [] }
};

function trackOperationStart(type) {
    performanceMetrics.lastOperation = type;
    performanceMetrics.operationStartTime = performance.now();
    performanceMetrics.firstTileTime = null;
    console.log(`🎯 [${type}] Operation started`);
}

function trackOperationEnd() {
    if (performanceMetrics.operationStartTime) {
        const duration = performance.now() - performanceMetrics.operationStartTime;
        const type = performanceMetrics.lastOperation;

        // Store completion time
        if (performanceMetrics.completionTimes[type]) {
            performanceMetrics.completionTimes[type].push(duration);
        }

        console.log(`✅ [${type}] Completed in ${duration.toFixed(0)}ms`);
        if (performanceMetrics.firstTileTime) {
            console.log(`   ⚡ First tile: ${performanceMetrics.firstTileTime.toFixed(0)}ms`);
        }

        performanceMetrics.operationStartTime = null;
    }
}

function trackFirstTile() {
    if (performanceMetrics.operationStartTime && !performanceMetrics.firstTileTime) {
        performanceMetrics.firstTileTime = performance.now() - performanceMetrics.operationStartTime;
    }
}

function printPerformanceSummary() {
    console.log('\n📊 ═══════════ PERFORMANCE SUMMARY ═══════════');

    const calcAvg = (arr) => arr.length > 0 ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(0) : 'N/A';

    console.log('Average Load Times:');
    console.log(`  📅 Date Change: ${calcAvg(performanceMetrics.completionTimes.dateChange)}ms`);
    console.log(`  🗂️  Layer Change: ${calcAvg(performanceMetrics.completionTimes.layerChange)}ms`);
    console.log(`  🔍 Zoom: ${calcAvg(performanceMetrics.completionTimes.zoom)}ms`);

    console.log('\nRequest Counts:');
    console.log(`  Date Changes: ${performanceMetrics.requestCounts.dateChange}`);
    console.log(`  Layer Changes: ${performanceMetrics.requestCounts.layerChange}`);
    console.log(`  Zoom Operations: ${performanceMetrics.requestCounts.zoom}`);
    console.log(`  Total Requests: ${performanceMetrics.requestCounts.total}`);

    console.log('═════════════════════════════════════════════\n');
}

// Animation controls for VIDEO layers
let animationTimer = null;
window.isAnimating = false;
window.isAnimationLoading = false; // Add missing flag to window
let isAnimationBusy = false; // Lock to prevent overlapping frame transitions
let animationSpeed = 500; // milliseconds per frame (0.5 second local)
let crossfadeDuration = 150; // milliseconds for ultra-smooth fade transition (60fps compatible)
let instantLoadMode = false; // If true, skip preloading and load frames on-demand

// Get current date and round to 00:00 or 12:00 UTC
function getCurrentTimeUTC() {
    // FIX: Use actual current date instead of hardcoded January 5
    const now = new Date(); // Get real current date/time
    const hours = now.getUTCHours();
    // If before noon UTC, use 00:00, otherwise use 12:00
    const roundedHours = hours < 12 ? 0 : 12;
    now.setUTCHours(roundedHours, 0, 0, 0);
    return now.toISOString();
}

// Format date for datetime-local input (without timezone conversion)
function formatDateTimeLocalUTC(isoString) {
    const date = new Date(isoString);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Current parameters
// NOTE: time starts as null — it is set after WMS metadata is fetched (in multi-layer.js)
// This prevents startup requests with invalid dates (today != server's latest date)
let currentParams = {
    layer: 'probability_epis10y_1_15',
    time: null,
    elevation: 0,
    opacity: 0.7
};

// Layer metadata - UPDATED TO MATCH GEOSERVER LAYER NAMES (snake_case)
const layerMetadata = {
    // Static layers - 10 year return period
    'probability_epis10y_1_1': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (10 year, 1 day)' },
    'probability_epis10y_1_3': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (10 year, 1-3 days)' },
    'probability_epis10y_1_15': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (10 year, 1-15 days)' },
    'probability_epis10y_4_15': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (10 year, 4-15 days)' },
    'probability_epis10y_10_15': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (10 year, 10-15 days)' },
    'probability_twl10y_1_1': { type: 'static', hasElevation: false, description: 'Probability of total water level (10 year, 1 day)' },
    'probability_twl10y_1_3': { type: 'static', hasElevation: false, description: 'Probability of total water level (10 year, 1-3 days)' },
    'probability_twl10y_1_15': { type: 'static', hasElevation: false, description: 'Probability of total water level (10 year, 1-15 days)' },
    'probability_twl10y_4_15': { type: 'static', hasElevation: false, description: 'Probability of total water level (10 year, 4-15 days)' },
    'probability_twl10y_10_15': { type: 'static', hasElevation: false, description: 'Probability of total water level (10 year, 10-15 days)' },

    // Static layers - 100 year return period
    'probability_epis100y_1_1': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (100 year, 1 day)' },
    'probability_epis100y_1_3': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (100 year, 1-3 days)' },
    'probability_epis100y_1_15': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (100 year, 1-15 days)' },
    'probability_epis100y_4_15': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (100 year, 4-15 days)' },
    'probability_epis100y_10_15': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (100 year, 10-15 days)' },
    'probability_twl100y_1_1': { type: 'static', hasElevation: false, description: 'Probability of total water level (100 year, 1 day)' },
    'probability_twl100y_1_3': { type: 'static', hasElevation: false, description: 'Probability of total water level (100 year, 1-3 days)' },
    'probability_twl100y_1_15': { type: 'static', hasElevation: false, description: 'Probability of total water level (100 year, 1-15 days)' },
    'probability_twl100y_4_15': { type: 'static', hasElevation: false, description: 'Probability of total water level (100 year, 4-15 days)' },
    'probability_twl100y_10_15': { type: 'static', hasElevation: false, description: 'Probability of total water level (100 year, 10-15 days)' },

    // Static layers - 500 year return period
    'probability_epis500y_1_1': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (500 year, 1 day)' },
    'probability_epis500y_1_3': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (500 year, 1-3 days)' },
    'probability_epis500y_1_15': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (500 year, 1-15 days)' },
    'probability_epis500y_4_15': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (500 year, 4-15 days)' },
    'probability_epis500y_10_15': { type: 'static', hasElevation: false, description: 'Probability of episodic water level (500 year, 10-15 days)' },
    'probability_twl500y_1_1': { type: 'static', hasElevation: false, description: 'Probability of total water level (500 year, 1 day)' },
    'probability_twl500y_1_3': { type: 'static', hasElevation: false, description: 'Probability of total water level (500 year, 1-3 days)' },
    'probability_twl500y_1_15': { type: 'static', hasElevation: false, description: 'Probability of total water level (500 year, 1-15 days)' },
    'probability_twl500y_4_15': { type: 'static', hasElevation: false, description: 'Probability of total water level (500 year, 4-15 days)' },
    'probability_twl500y_10_15': { type: 'static', hasElevation: false, description: 'Probability of total water level (500 year, 10-15 days)' },

    // Coastal point layers
    'probability_epis_coast_01_15': { type: 'points', hasElevation: true, description: 'Coastal episodic probability (1-15D, with RP)' },
    'probability_epis_coast_01_03': { type: 'points', hasElevation: true, description: 'Coastal episodic probability (1-3D, with RP)' },
    'probability_epis_coast_04_15': { type: 'points', hasElevation: true, description: 'Coastal episodic probability (4-15D, with RP)' },
    'probability_twl_coast_01_15': { type: 'points', hasElevation: true, description: 'Coastal TWL probability (1-15D, with RP)' },
    'probability_twl_coast_01_03': { type: 'points', hasElevation: true, description: 'Coastal TWL probability (1-3D, with RP)' },
    'probability_twl_coast_04_15': { type: 'points', hasElevation: true, description: 'Coastal TWL probability (4-15D, with RP)' },

    // Video layers
    'epis_wl75': { type: 'video', hasElevation: true, description: 'Episode water level 75th percentile (with lead time)' },

    'twl75': { type: 'video', hasElevation: true, description: 'Total water level 75th percentile (with lead time)' },

    // ── GloFAS layers (external WMS) ──────────────────────────────
    'RPGM': { type: 'glofas', hasElevation: false, wmsUrl: 'https://ows.globalfloods.eu/glofas-ows/ows.py', description: 'Medium alert — return period > 2 years' },
    'RPGH': { type: 'glofas', hasElevation: false, wmsUrl: 'https://ows.globalfloods.eu/glofas-ows/ows.py', description: 'High alert — return period > 5 years' },
    'RPGS': { type: 'glofas', hasElevation: false, wmsUrl: 'https://ows.globalfloods.eu/glofas-ows/ows.py', description: 'Severe alert — return period > 20 years' },
    'sumAL41EGE': { type: 'glofas', hasElevation: false, wmsUrl: 'https://ows.globalfloods.eu/glofas-ows/ows.py', description: 'Flood summary days 1–3' },
    'sumAL42EGE': { type: 'glofas', hasElevation: false, wmsUrl: 'https://ows.globalfloods.eu/glofas-ows/ows.py', description: 'Flood summary days 4–10' },
    'sumAL43EGE': { type: 'glofas', hasElevation: false, wmsUrl: 'https://ows.globalfloods.eu/glofas-ows/ows.py', description: 'Flood summary days 11–15' },
    'FloodSummary1_30': { type: 'glofas', hasElevation: false, wmsUrl: 'https://ows.globalfloods.eu/glofas-ows/ows.py', description: 'Flood summary days 1–15' },
    'EGE_probRgt50': { type: 'glofas', hasElevation: false, wmsUrl: 'https://ows.globalfloods.eu/glofas-ows/ows.py', description: 'Precipitation probability > 50 mm' },
    'EGE_probRgt150': { type: 'glofas', hasElevation: false, wmsUrl: 'https://ows.globalfloods.eu/glofas-ows/ows.py', description: 'Precipitation probability > 150 mm' },
    'AccRainEGE': { type: 'glofas', hasElevation: false, wmsUrl: 'https://ows.globalfloods.eu/glofas-ows/ows.py', description: 'Accumulated precipitation' },
    'FloodHazard100y': { type: 'glofas', hasElevation: false, wmsUrl: 'https://ows.globalfloods.eu/glofas-ows/ows.py', description: 'Flood hazard — 100 year return period (static)' },
    'reportingPoints': { type: 'glofas', hasElevation: false, wmsUrl: 'https://ows.globalfloods.eu/glofas-ows/ows.py', requiresTime: true, description: 'Reporting Points', legendHtml: `
        <div style="font-size:11px;line-height:1.6;padding:2px 0;">
            <div style="font-weight:600;margin-bottom:4px;color:var(--text-dim);">Flood Intensity</div>
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px;"><span style="width:11px;height:11px;border-radius:50%;background:#9333ea;flex-shrink:0;display:inline-block;"></span>20-year RP</div>
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px;"><span style="width:11px;height:11px;border-radius:50%;background:#ef4444;flex-shrink:0;display:inline-block;"></span>5-year RP</div>
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px;"><span style="width:11px;height:11px;border-radius:50%;background:#eab308;flex-shrink:0;display:inline-block;"></span>2-year RP</div>
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;"><span style="width:11px;height:11px;border-radius:50%;background:#9ca3af;flex-shrink:0;display:inline-block;"></span>No flood signal</div>
            <div style="font-weight:600;margin-bottom:4px;color:var(--text-dim);">Flood Tendency</div>
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:2px;"><span style="font-size:13px;">▲</span> Increasing trend</div>
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:2px;"><span style="font-size:13px;">▼</span> Decreasing trend</div>
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;"><span style="font-size:13px;">●</span> No trend</div>
            <div style="font-weight:600;margin-bottom:4px;color:var(--text-dim);">Flood Peak Timing</div>
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px;"><span style="font-size:13px;color:#111;">△</span> Peak days 1–3</div>
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px;"><span style="font-size:13px;color:#9ca3af;">△</span> Peak after day 3</div>
            <div style="display:flex;align-items:center;gap:7px;"><span style="font-size:13px;color:#9ca3af;opacity:0.5;">▲</span> Peak after day 10</div>
        </div>` }
};

// Debounce function
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

// ═══════════════════════════════════════════════════════════════
// NO DATA AVAILABLE OVERLAY FUNCTIONS
// ═══════════════════════════════════════════════════════════════
function showNoDataOverlay() {
    const overlay = document.getElementById('no-data-overlay');
    if (overlay && overlay.style.display === 'none') {
        overlay.style.display = 'flex';
        console.log('📢 Showing "No Data Available" overlay');
    }
}


function hideNoDataOverlay() {
    const overlay = document.getElementById('no-data-overlay');
    if (overlay && overlay.style.display !== 'none') {
        overlay.style.display = 'none';
        console.log('✅ Hiding "No Data Available" overlay');
    }
}

// ═══════════════════════════════════════════════════════════════
// LOADING SPINNER FUNCTIONS
// ═══════════════════════════════════════════════════════════════
function showLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'flex';
    // Ensure No Data is hidden when Loading starts
    if (window.hideNoDataOverlay) window.hideNoDataOverlay();
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
}

// Export to window for multi-layer.js
window.showNoDataOverlay = showNoDataOverlay;
window.hideNoDataOverlay = hideNoDataOverlay;
window.showLoadingOverlay = showLoadingOverlay;
window.hideLoadingOverlay = hideLoadingOverlay;

// ═══════════════════════════════════════════════════════════════
// CRITICAL FIX: Robust Rendering & Error Handling
// ═══════════════════════════════════════════════════════════════

// Global Load Cycle Tracking to ignore stale errors
let currentLoadCycleId = 0;

// CRITICAL: Override Leaflet's internal error handler
// This prevents Leaflet from modifying the tile element (src) on error
// and ensures we process 'done' callback to keep state consistent.
L.TileLayer.prototype._tileOnError = function (done, tile, e) {
    // If the layer is marked for destruction, silence everything
    if (this.isDestroying) {
        return;
    }
    // Call done() to ensure tile lifecycle completes
    // We pass the error so 'tileerror' fires, but we handle it safely in the event listener
    done(e, tile);
};

// ═══════════════════════════════════════════════════════════════
// DEFENSIVE GRIDLAYER PATCHES - PREVENTS NULL CRASHES
// ═══════════════════════════════════════════════════════════════

// CRITICAL: Patch TileLayer.createTile to handle null tile elements
const originalCreateTile = L.TileLayer.prototype.createTile;
L.TileLayer.prototype.createTile = function (coords, done) {
    try {
        const tile = originalCreateTile.call(this, coords, done);

        // Ensure tile element exists before accessing properties
        if (!tile) {
            console.warn('⚠️ TileLayer.createTile returned null tile');
            // Return a placeholder empty tile
            const placeholder = document.createElement('img');
            placeholder.style.opacity = '0';
            return placeholder;
        }

        return tile;
    } catch (error) {
        console.error('❌ Error in createTile:', error);
        // Return emergency placeholder to prevent crash
        const placeholder = document.createElement('img');
        placeholder.style.opacity = '0';
        return placeholder;
    }
};

// Wrap critical GridLayer methods to prevent null access during zoom
const originalUpdateLevels = L.GridLayer.prototype._updateLevels;
L.GridLayer.prototype._updateLevels = function () {
    // Guard against null _map (happens during rapid zoom or layer destruction)
    if (!this._map) {
        console.warn('⚠️ GridLayer._updateLevels blocked (null _map)');
        return;
    }

    // Guard against operations on destroying layers
    if (this.isDestroying) {
        console.warn('⚠️ GridLayer._updateLevels blocked (layer destroying)');
        return;
    }

    return originalUpdateLevels.call(this);
};

const originalRemoveTile = L.GridLayer.prototype._removeTile;
L.GridLayer.prototype._removeTile = function (key) {
    if (!this._map || this.isDestroying) {
        return;
    }
    return originalRemoveTile.call(this, key);
};

const originalAbortLoading = L.GridLayer.prototype._abortLoading;
L.GridLayer.prototype._abortLoading = function () {
    if (this.isDestroying) {
        return; // Don't touch tiles during destruction
    }
    return originalAbortLoading.call(this);
};

// CRITICAL: Patch _resetGrid to prevent "Cannot read properties of null (reading 'options')"
const originalResetGrid = L.GridLayer.prototype._resetGrid;
L.GridLayer.prototype._resetGrid = function () {
    if (!this._map || this.isDestroying) {
        console.warn('⚠️ GridLayer._resetGrid blocked (null _map or destroying)');
        return;
    }
    return originalResetGrid.call(this);
};

// CRITICAL: Patch _setView to prevent crashes during zoom animation
const originalSetView = L.GridLayer.prototype._setView;
L.GridLayer.prototype._setView = function (center, zoom) {
    if (!this._map || this.isDestroying) {
        console.warn('⚠️ GridLayer._setView blocked (null _map or destroying)');
        return;
    }
    return originalSetView.call(this, center, zoom);
};

// CRITICAL: Patch _resetView to prevent "Cannot read properties of null (reading 'getCenter')"
const originalResetView = L.GridLayer.prototype._resetView;
L.GridLayer.prototype._resetView = function (center) {
    if (!this._map || this.isDestroying) {
        console.warn('⚠️ GridLayer._resetView blocked (null _map or destroying)');
        return;
    }
    return originalResetView.call(this, center);
};

// ═══════════════════════════════════════════════════════════════
// MANUAL ZOOM DEBOUNCE LOGIC (Aggressive "Hard Pause")
// ═══════════════════════════════════════════════════════════════

// 1. Patch L.TileLayer to respect a 'pauseUpdates' flag
// We save the original method first to avoid recursion if we patched it before
if (!L.TileLayer.prototype._originalUpdate) {
    L.TileLayer.prototype._originalUpdate = L.TileLayer.prototype._update;
    L.TileLayer.prototype._update = function () {
        if (this.options.pauseUpdates) {
            // console.log('✋ WMS Update Paused (Debounce)');
            return;
        }
        if (this._originalUpdate) {
            this._originalUpdate.apply(this, arguments);
        }
    };
}

let zoomHardDebounceTimer = null;

// FIX #15: Split zoomstart and movestart into separate handlers.
// Previously both fired stopAnimation() which set isAnimating=false, preventing
// the second zoomstart handler from detecting animation → wasAnimatingBeforeZoom never set.
map.on('movestart', function () {
    // MOVE (pan): stop animation fully if playing or preloading
    if (window.isAnimating || window.isAnimationLoading) {
        console.log('🛑 Map panned - Stopping animation & clearing cache');
        if (typeof window.stopAnimation === 'function') {
            window.stopAnimation();
        }

        // FIX MEMORY LEAK: Physically remove layers from map before destroying cache
        if (window.animationCache) {
            Object.values(window.animationCache).forEach(layer => {
                if (layer && window.map && window.map.hasLayer(layer)) {
                    window.map.removeLayer(layer);
                }
            });
            window.animationCache = {};
        }

        if (typeof window.resetPreloadStatus === 'function') {
            window.resetPreloadStatus();
        }
    }

    window.isMapInteracting = true;
});

map.on('zoomend moveend', function () {
    // Interaction finished
    window.isMapInteracting = false;

    if (zoomHardDebounceTimer) clearTimeout(zoomHardDebounceTimer);
});

// Attach WMS layer event listeners (called once during init)
function attachWMSEvents() {
    if (!wmsLayer) return;

    // ──────── Loading Cycle Tracking ────────
    wmsLayer.on('loading', function () {
        loadingTiles++;
        currentLoadCycleStart = performance.now();
        // FIX #6: Reset counters here (was also duplicated below)
        tileErrorCount = 0;
        tileSuccessCount = 0;
        hideNoDataOverlay();
        console.log(`⏱️  [${new Date().toISOString()}] Load cycle started (Cycle #${currentLoadCycleId})`);
    });

    wmsLayer.on('load', function () {
        loadingTiles = Math.max(0, loadingTiles - 1);

        if (currentLoadCycleStart) {
            const duration = performance.now() - currentLoadCycleStart;
            console.log(`✅ Load cycle completed in ${duration.toFixed(1)}ms`);
            console.log(`📊 Total GetMap requests this session: ${getMapRequestCount}`);
            currentLoadCycleStart = null;
            trackOperationEnd();
        }

        // Only show "No Data" if significant errors and no successes
        if (tileSuccessCount === 0 && tileErrorCount >= 5) {
            console.warn('❌ Load complete but NO successful tiles after multiple attempts.');
            setTimeout(() => {
                if (tileSuccessCount === 0 && tileErrorCount >= 5) {
                    showNoDataOverlay();
                }
            }, 1000);
        }
    });

    // ──────── Request Counting ────────
    wmsLayer.on('tileloadstart', function (event) {
        event.tile.loadCycleId = currentLoadCycleId;
        getMapRequestCount++;
        performanceMetrics.requestCounts.total++;
        if (performanceMetrics.lastOperation) {
            performanceMetrics.requestCounts[performanceMetrics.lastOperation]++;
        }
        console.log(`🌐 GetMap request #${getMapRequestCount}`);
    });

    // FIX #6: Single merged tileload listener (was two separate listeners)
    wmsLayer.on('tileload', function () {
        trackFirstTile();
        tileSuccessCount++;
        if (tileSuccessCount > 0) {
            hideNoDataOverlay();
        }
    });

    // ──────── Error Handling with No Data Overlay ────────
    const maxTileErrors = 10;

    wmsLayer.on('tileerror', function (event) {
        loadingTiles = Math.max(0, loadingTiles - 1);

        if (!map.hasLayer(wmsLayer) || (wmsLayer && wmsLayer.isDestroying)) {
            return;
        }

        if (event.tile && event.tile.loadCycleId !== undefined && event.tile.loadCycleId !== currentLoadCycleId) {
            return; // stale cycle
        }

        // Check for aborted requests
        const isAborted = !event.tile.src || event.tile.src.startsWith('data:');
        if (!isAborted) {
            tileErrorCount++;
            if (tileErrorCount <= maxTileErrors) {
                console.error('❌ WMS Tile Error');
                if (event.tile && event.tile.src && event.tile.src.includes('localhost:8080')) {
                    console.warn('🔴 PROXY/WMS ERROR: Failed to load tile');
                }
            }
            if (tileErrorCount >= 5 && tileSuccessCount === 0) {
                console.warn(`⚠️ Layer ${currentLoadCycleId}: ${tileErrorCount} errors, no successes yet...`);
            }
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// WMTS HELPER – builds a GeoWebCache WMTS URL for Leaflet L.tileLayer
// Uses Z/X/Y tile coordinates (no BBOX) → eliminates HTTP 400 from GWC
// GridSet: EPSG:900913 (standard GeoServer GWC alias for EPSG:3857)
// ─────────────────────────────────────────────────────────────────────────────
function buildWMTSUrl(layerName, time, elevation) {
    const base = `${GEOSERVER_URL}/gwc/service/wmts`;
    let url = `${base}?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile` +
        `&LAYER=${WORKSPACE}:${layerName}` +
        `&STYLE=` +
        `&TILEMATRIXSET=EPSG:900913` +
        `&TILEMATRIX=EPSG:900913:{z}` +
        `&TILEROW={y}&TILECOL={x}` +
        `&FORMAT=image/png`;
    if (time) url += `&TIME=${encodeURIComponent(time)}`;
    if (elevation !== undefined) url += `&ELEVATION=${elevation}`;
    return url;
}

// Initialize WMS layer (called ONCE on page load)
async function initWMSLayer() {
    console.log('🏗️  Initializing WMS layer...');

    // 1. CRITICAL FIX: Wait for metadata BEFORE creating layer
    // This ensures we have the correct date range and don't request invalid times (404s)
    if (window.wmsMetadata) {
        if (!window.wmsMetadata.loaded) {
            console.log('⏳ Waiting for WMS capabilities...');
            await window.wmsMetadata.fetchCapabilities();
        }

        // 2. Set Time to Latest Available
        const { minDate, maxDate } = window.wmsMetadata.getTimeExtent();
        if (maxDate) {
            const latestTime = maxDate.toISOString();
            console.log(`🔄 Setting initial time to LATEST available: ${latestTime}`);
            currentParams.time = latestTime;

            // Update global time input
            const timeInput = document.getElementById('time-select');
            if (timeInput) {
                timeInput.value = latestTime.slice(0, 16);
            }

            // Update UI Range Display
            const rangeDisplay = document.getElementById('date-range-display');
            if (rangeDisplay && minDate) {
                const format = d => d.toISOString().split('T')[0];
                rangeDisplay.textContent = `Avail: ${format(minDate)} to ${format(maxDate)}`;
            }
        }
    }

    // New Load Cycle
    currentLoadCycleId++;

    const metadata = layerMetadata[currentParams.layer];
    const isVideo = metadata && metadata.type === 'video';

    const wmsParams = {
        layers: `${WORKSPACE}:${currentParams.layer}`,
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        time: currentParams.time
    };

    if (metadata && metadata.hasElevation) {
        wmsParams.elevation = currentParams.elevation;
    }

    // FIX #7: single isGwcLayer check, gwcLayers const removed (was declared but unused)
    const isGwcLayer = ['twl75', 'epis_wl75'].includes(currentParams.layer);

    if (isGwcLayer) {
        wmsParams.tiled = true;
    }

    //wmsLayer = L.tileLayer.wms(`${GEOSERVER_URL}/wms`, {
    // Direct GWC integration for video layers
    const endpoint = isGwcLayer ? `${GEOSERVER_URL}/gwc/service/wms` : `${GEOSERVER_URL}/wms`;
    wmsLayer = L.tileLayer.wms(endpoint, {
        ...wmsParams,
        // CRITICAL FIX FOR GWC
        crs: isGwcLayer ? L.CRS.EPSG3857 : customCRS,
        tileSize: 512,
        updateWhenIdle: false, // Optimize panning
        updateWhenZooming: false, // Prevents flashing during zoom
        updateInterval: 300, // Faster reaction times
        keepBuffer: 2, // Reverted to 2
        maxNativeZoom: 19,
        maxZoom: 19,
        minZoom: 0,
        crossOrigin: true
    });

    // Tag layer
    wmsLayer.loadCycleId = currentLoadCycleId;

    attachWMSEvents();
    wmsLayer.setOpacity(currentParams.opacity);

    console.log(`✅ WMS initialized (Cycle #${currentLoadCycleId})`);
    updateLayerInfo();

    // 🔗 CRITICAL SYNC: Ensure the old-style dropdown layer populates the modern multi-layer badges
    if (window.activeLayers && currentParams.layer) {
        window.activeLayers.clear();
        window.activeLayers.set(currentParams.layer, {
            wmsLayer: wmsLayer,
            time: currentParams.time,
            elevation: currentParams.elevation,
            metadata: layerMetadata[currentParams.layer]
        });
        if (typeof window.updateBottomPanelLayers === 'function') {
            window.updateBottomPanelLayers();
        }
    }

    // Proactively check availability
    checkDataAvailability();
}
async function checkDataAvailability() {
    if (!wmsLayer) return;

    // 0. Guard against map interaction
    if (window.isMapInteracting) {
        console.warn('⚠️ Cannot start animation while map is moving');
        return;
    }

    // FIX #1: Check wmsMetadata existence BEFORE calling its methods
    if (!window.wmsMetadata || !window.wmsMetadata.loaded) {
        console.warn('⚠️ Metadata not loaded yet, skipping availability check...');
        return true; // optimistic
    }

    // FIX #1: Typo fixed ("unavailable") and null-safe check
    if (!window.wmsMetadata.isDataAvailable(currentParams.layer, null)) {
        alert('Data unavailable for this layer (Metadata Check)');
        return false;
    }

    const layerId = currentParams.layer;
    const time = currentParams.time;
    const elevation = currentParams.elevation;

    console.log(`🔍 Checking availability locally: ${layerId} @ ${time} (Elev: ${elevation})`);

    const isAvailable = window.wmsMetadata.isDataAvailable(layerId, time, elevation);

    if (isAvailable) {
        console.log('✅ Data available (Metadata Verified)');
        if (window.hideNoDataOverlay) window.hideNoDataOverlay();
        return true;
    } else {
        console.warn('⚠️ Data UNAVAILABLE (Metadata Verified) - but allowing request to proceed');
        return false;
    }
}

// Update WMS parameters WITHOUT recreating layer
async function updateWMSParams() {
    // Sync wmsLayer alias with modern multi-layer engine if possible
    if (window.activeLayers && window.activeLayers.has(currentParams.layer)) {
        const layerData = window.activeLayers.get(currentParams.layer);
        if (layerData && layerData.wmsLayer) {
            wmsLayer = layerData.wmsLayer;
            // Sync params locally within activeLayers
            layerData.time = currentParams.time;
            layerData.elevation = currentParams.elevation;
        }
    }

    if (!wmsLayer) {
        console.warn('⚠️ updateWMSParams aborted: No active wmsLayer found.');
        return;
    }
    console.warn("DEBUG updateWMSParams:", currentParams.layer, "time:", currentParams.time);

    // A param update is effectively a new "load cycle" as it invalidates old tiles
    currentLoadCycleId++;
    wmsLayer.loadCycleId = currentLoadCycleId;

    const metadata = layerMetadata[currentParams.layer];
    const wmtsLayers = ['twl75', 'epis_wl75'];
    const isWmtsLayer = wmtsLayers.includes(currentParams.layer);

    console.log(`📝 Updating params (Cycle #${currentLoadCycleId})`);

    // FIX #2: tileErrorCount/tileSuccessCount are now module-scoped, reset in 'loading' listener
    // tileErrorCount = 0;
    // tileSuccessCount = 0;

    // UI Updates
    if (window.showLoadingOverlay) window.showLoadingOverlay(); // Show spinner

    // Standard WMS: update only changed params
    // GloFAS requiresTime layers use date-only format (YYYY-MM-DDT00:00:00), not the global time string
    let newTime = currentParams.time;
    if (metadata && metadata.requiresTime && currentParams.time) {
        newTime = currentParams.time.split('T')[0] + 'T00:00:00';
    }
    const newParams = { time: newTime };
    if (metadata && metadata.hasElevation) {
        newParams.elevation = currentParams.elevation;
    }
    wmsLayer.setParams(newParams, false);

    // CRITICAL: Proactively check data availability
    // This shows banner IMMEDIATELY without waiting for tiles
    await checkDataAvailability();

    if (window.hideLoadingOverlay) window.hideLoadingOverlay(); // Hide spinner

    updateLayerInfo();
}

// Recreate layer (only for layer type changes)
async function recreateWMSLayer() {
    console.log('🔄 Recreating WMS layer');

    if (wmsLayer) {
        console.log('🧹 Cleaning up old layer...');

        // 1. Mark as destroying to suppress all error events
        wmsLayer.isDestroying = true;

        // 2. Detach event listeners immediately
        if (wmsLayer.off) wmsLayer.off();

        // 3. Cancel pending requests
        if (wmsLayer._tiles) {
            Object.keys(wmsLayer._tiles).forEach(key => {
                const tile = wmsLayer._tiles[key];
                if (tile.el && !tile.complete) {
                    tile.el.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
                }
            });
        }

        // 4. Short settle time
        await new Promise(resolve => setTimeout(resolve, 50));

        // 5. Remove
        map.removeLayer(wmsLayer);
        wmsLayer = null;
    }

    initWMSLayer();
}

// Debounced versions for slider interactions (OPTIMIZED: slower updates for stability)
const debouncedUpdateParams = debounce(updateWMSParams, 500); // Increased from 150ms
const debouncedTimeUpdate = debounce(updateWMSParams, 100);   // Quick response for immediate feedback

// Update layer info display
function updateLayerInfo() {
    const metadata = layerMetadata[currentParams.layer];
    const infoEl = document.getElementById('layer-info');

    if (metadata) {
        const timeDate = new Date(currentParams.time);
        const timeStr = timeDate.toISOString().replace('T', ' ').substring(0, 16) + ' UTC';

        let info = `<strong>${currentParams.layer}</strong><br>`;
        info += `${metadata.description}<br>`;
        info += `🕐 Time: ${timeStr}<br>`;

        if (metadata.hasElevation) {
            if (metadata.type === 'points') {
                info += `📊 Return Period: ${currentParams.elevation}`;
            } else if (metadata.type === 'video') {
                info += `📅 Forecast Day: ${currentParams.elevation}`;
            } else {
                info += `📈 Lead Time: ${currentParams.elevation}`;
            }
        }

        if (infoEl) {
            infoEl.innerHTML = info;
        }

        // 🆕 FIX: Also update main panel TIME WINDOW input
        const globalTimeInput = document.getElementById('time-select');
        if (globalTimeInput && currentParams.time) {
            if (!isUserChangingDate) {
                const localFormat = currentParams.time.substring(0, 16);
                globalTimeInput.value = localFormat;
                console.log(`✅ [DATE FIX] Updated main panel date to: ${localFormat}`);
            } else {
                console.log('🧪 [DATE FIX] Skipped main panel update (user change in progress)');
            }
        }
    }
}

// EXPOSE TO WINDOW for multi-layer.js
window.currentParams = currentParams;
window.updateLayerInfo = updateLayerInfo;
window.setCurrentLayer = function (layerId) {
    // Clear cache for old layer
    if (currentParams.layer && currentParams.layer !== layerId) {
        clearLayerCache(currentParams.layer);
    }

    currentParams.layer = layerId;
    updateLayerInfo();
    updateGlobalDateControlsForLayer(layerId, 'layer switch');
};

// EXPOSE animation functions for multi-layer.js
window.startAnimation = startAnimation;
window.pauseAnimation = pauseAnimation;
window.stopAnimation = stopAnimation;
window.setAnimationSpeed = setAnimationSpeed;

// Global cache for animation layers (L.tileLayer instances)
if (!window.animationCache) window.animationCache = {};

// Helper function to preload a single frame with cache support
// Helper to preload a single frame (exposed for manual navigation)
// Track in-flight preload promises to avoid duplicate requests
const activePreloads = new Map();

// Clear animation-related caches for a specific layer (e.g., when TIME changes)
function clearAnimationCacheForLayer(layerId) {
    if (!layerId) return;

    // Remove cached animation layers from map and cache
    if (window.animationCache) {
        Object.keys(window.animationCache).forEach(key => {
            if (key.startsWith(`${layerId}-`)) {
                const layer = window.animationCache[key];
                try {
                    if (layer && window.map && window.map.hasLayer(layer)) {
                        // FIX: Do NOT remove the layer instantly, as it might be currently rendering.
                        // Hide it first, then remove it safely in the next cycle.
                        layer.setOpacity(0);
                        setTimeout(() => {
                            if (window.map.hasLayer(layer)) {
                                window.map.removeLayer(layer);
                            }
                        }, 100);
                    }
                } catch (e) {
                    console.warn('⚠️ Failed to remove cached layer', e);
                }
                delete window.animationCache[key];
            }
        });
    }

    // Clear frame metadata cache (LRU) for this layer
    clearLayerCache(layerId);

    // FIX #14: Collect keys first, then delete to avoid undefined behavior when deleting during iteration
    const keysToDelete = [];
    activePreloads.forEach((_, key) => {
        if (key.startsWith(`${layerId}-`)) {
            keysToDelete.push(key);
        }
    });
    keysToDelete.forEach(key => activePreloads.delete(key));

    // Reset preload flags so next Play does a clean reload
    if (typeof window.resetPreloadStatus === 'function') {
        window.resetPreloadStatus();
    }
}

// Expose for multi-layer.js (time changes per-layer)
window.clearAnimationCacheForLayer = clearAnimationCacheForLayer;

window.preloadSingleFrame = async function (layerId, elevation) {
    // FIX #3: Round zoom to match preloadFrame cacheKey generation
    const zoom = Math.round(map.getZoom());
    // FIX #3: Apply same GWC zoom cap as preloadAllFrames
    const fixedZoom = (['twl75', 'epis_wl75'].includes(layerId) && zoom >= 6) ? 6 : zoom;
    const cacheKey = `${layerId}-${elevation}-${fixedZoom}`;

    if (animationCache[cacheKey]) {
        return animationCache[cacheKey];
    }

    if (activePreloads.has(cacheKey)) {
        return activePreloads.get(cacheKey);
    }

    console.log(`📥 [MANUAL] Preloading single frame: ${layerId} day ${elevation}`);

    // FIX #3: Temporarily set currentParams.layer so preloadFrame uses correct layer
    const prevLayer = currentParams.layer;
    currentParams.layer = layerId;

    const preloadPromise = preloadFrame(elevation, null, fixedZoom).then(result => {
        currentParams.layer = prevLayer; // restore
        activePreloads.delete(cacheKey);
        if (result.success && window.animationCache[cacheKey]) {
            return window.animationCache[cacheKey];
        }
        return null;
    });

    activePreloads.set(cacheKey, preloadPromise);
    return preloadPromise;
};

async function preloadFrame(day, updateProgress = null, zoomLevel = null) {
    // Use current zoom if not specified
    if (zoomLevel === null) {
        zoomLevel = getCurrentZoomLevel();
    }

    const cacheKey = `${currentParams.layer}-${day}-${zoomLevel}`;

    // Check animation cache first (for layer instances)
    if (window.animationCache[cacheKey]) {
        const cachedLayer = window.animationCache[cacheKey];
        console.log(`💾 [CACHE HIT] Using cached layer for day ${day} at zoom ${zoomLevel}`);
        // Re-attach layer if it was physically removed from map (e.g. after stopAnimation)
        if (cachedLayer && window.map && !window.map.hasLayer(cachedLayer)) {
            cachedLayer.setOpacity(0);
            cachedLayer.addTo(window.map);
        }
        if (updateProgress) updateProgress(day);
        return Promise.resolve({ success: true, day, fromCache: true });
    }

    // Check frame cache (legacy/metadata)
    const cachedFrame = getCachedFrame(currentParams.layer, zoomLevel, day);
    if (cachedFrame && cachedFrame.loaded) {
        // Even if metadata says loaded, we might need to recreate the layer instance if missing from animationCache
        // But for now, let's treat it as a miss to ensure we get a fresh layer instance
        // console.log(`💾 [CACHE HIT] Metadata says loaded...`); 
    }

    console.log(`📥 [PRELOAD] Initializing new frame for day ${day} at zoom ${zoomLevel}`);

    return new Promise((resolve) => {
        const metadata = layerMetadata[currentParams.layer];
        const isVideo = metadata && metadata.type === 'video';
        // FIX #7: isGwcLayer declaration (removed gwcLayers unused const)
        const isGwcLayer = ['twl75', 'epis_wl75'].includes(currentParams.layer);
        let tempLayer;

        const wmsParams = {
            layers: `${WORKSPACE}:${currentParams.layer}`,
            format: 'image/png',
            transparent: true,
            version: '1.3.0',
            time: currentParams.time,
            elevation: day
        };
        if (isGwcLayer) {
            wmsParams.tiled = true;
            wmsParams.version = '1.1.1';
            wmsParams.SRS = 'EPSG:900913';
            wmsParams.srs = 'EPSG:900913'; // GWC parser needs lowercase srs in v1.1.1
            // FIX: Leaflet translates crs objects into srs/crs param depending on version. 
            // We must force the internal Leaflet CRS to EPSG3857 (which outputs as 900913 internally for v1.1.1)
        }

        // Direct GWC integration for video layers
        const endpoint = isGwcLayer ? `${GEOSERVER_URL}/gwc/service/wms` : `${GEOSERVER_URL}/wms`;
        tempLayer = L.tileLayer.wms(endpoint, {
            ...wmsParams,
            // CRITICAL FIX FOR GWC: Force Leaflet to NOT use the map's custom CRS if it's a GWC layer
            // GWC needs standard Web Mercator to generate the 900913 SRS parameter correctly
            crs: isGwcLayer ? L.CRS.EPSG3857 : customCRS,
            tileSize: 512,
            tiled: isGwcLayer,
            opacity: 0, // invisible during preload
            updateWhenIdle: false,
            updateWhenZooming: false,
            keepBuffer: 1,
            maxNativeZoom: 19,
            className: 'no-fade-tile', // Bypasses slow tile fade in
            pane: 'animWmsPane'  // FIX: always above base WMS layers
        });

        let tilesLoaded = false;
        let loadTimeout = null;
        let tilesLoadedCount = 0;
        let totalTilesNeeded = 0;

        // ✅ FIX: Attach tile listeners BEFORE adding to map to prevent race condition!
        // Track individual tile loads to ensure ALL tiles are loaded
        tempLayer.on('tileloadstart', () => {
            totalTilesNeeded++;
        });

        tempLayer.on('tileload', () => {
            tilesLoadedCount++;
            // console.log(`📥 Day ${day}: Tile ${tilesLoadedCount}/${totalTilesNeeded} loaded`);
        });

        // Wait for tiles to load
        const handleLoad = () => {
            if (!tilesLoaded) {
                tilesLoaded = true;
                clearTimeout(loadTimeout);
                // console.log(`✅ Preloaded day ${day} (${tilesLoadedCount} tiles)`);

                // Store INSTANCE in animation cache
                window.animationCache[cacheKey] = tempLayer;

                // Store metadata in frame cache
                setCachedFrame(currentParams.layer, zoomLevel, day, { loaded: true, timestamp: Date.now() });

                if (updateProgress) updateProgress(day);

                // Keep layer on the map with opacity 0 to prevent DOM recreation/blinking
                setTimeout(() => {
                    resolve({ success: true, day, fromCache: false });
                }, 20);
            }
        };

        tempLayer.on('load', handleLoad);

        // NOW add to map (AFTER all listeners are attached)
        tempLayer.addTo(map);

        // Timeout fallback (5000ms = 5 seconds for complete loading)
        // INCREASED to 60s for slow connections/large layers
        loadTimeout = setTimeout(() => {
            if (!tilesLoaded) {
                tilesLoaded = true;
                console.warn(`⚠️ Timeout loading day ${day} (${tilesLoadedCount}/${totalTilesNeeded} tiles loaded)`);

                // Even on timeout, cache what we have
                window.animationCache[cacheKey] = tempLayer;
                // keep on map with opacity 0

                // Still resolve as success if we got SOME tiles
                const success = tilesLoadedCount > 0;
                resolve({ success, day, fromCache: false });
            }
        }, 60000);
    });
}


// Animation control functions - OPTIMIZED with parallel batch loading
async function preloadAllFrames() {
    const metadata = layerMetadata[currentParams.layer];
    if (!metadata || metadata.type !== 'video') {
        return false;
    }

    console.log('📦 Preloading all animation frames (days 0-15) with parallel batching...');
    console.time('⏱️ Total preload time');

    // Restore keepBuffer for GWC base layer during animation (higher buffer = smoother re-play)
    const gwcLayersKBPre = ['twl75', 'epis_wl75'];
    if (gwcLayersKBPre.includes(currentParams.layer) && window.activeLayers) {
        const layerDataKB = window.activeLayers.get(currentParams.layer);
        if (layerDataKB && layerDataKB.wmsLayer) {
            layerDataKB.wmsLayer.options.keepBuffer = 4;
            console.log('📦 [KEEPBUFFER] GWC base layer → 4 (animation)');
        }
    }

    // Update button to show loading state
    const playBtn = document.getElementById(`play-btn-${currentParams.layer}`);
    if (!playBtn) {
        console.error('Play button not found for layer:', currentParams.layer);
        return false;
    }
    const originalText = playBtn.innerHTML;

    let loadedCount = 0;
    const updateProgress = (day) => {
        loadedCount++;
        // FIX #13: totalFrames computed dynamically below, use +1 approach for display
        const m = layerMetadata[currentParams.layer];
        const total = (m && m.hasElevation) ? (m.type === 'video' ? 16 : 9) : 1;
        playBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${loadedCount}/${total}`;
    };

    try {
        const batchSize = 4;  // Utilize full proxy capacity (8 concurrent)
        // FIX #13: Derive totalFrames from layer metadata instead of hardcoding
        const elevationMax = (() => {
            const m = layerMetadata[currentParams.layer];
            if (!m || !m.hasElevation) return 0;
            return m.type === 'video' ? 15 : 8; // video: days 0-15, points: RP 0-8
        })();
        const totalFrames = elevationMax + 1;

        let currentZoom = map ? map.getZoom() : (typeof window.map !== 'undefined' ? window.map.getZoom() : 5);
        currentZoom = Math.round(currentZoom);

        // FIX PRELOAD: For high zoom levels (>= 6) on GWC layers, adjust the preload zoom
        const gwcLayersFix = ['twl75', 'epis_wl75'];
        if (gwcLayersFix.includes(currentParams.layer) && currentZoom >= 6) {
            currentZoom = 6;
        }

        // NOTE: Do NOT seed layerData.wmsLayer (base layer) into animationCache here.
        // The base layer lives in baseWmsPane (z=350); seeding it causes animateNextFrame
        // to retrieve the base layer for that day and never show real animation frames.

        // CACHE QUICK CHECK: If all frames are already cached, skip loading entirely!
        let allCached = true;
        for (let i = 0; i < totalFrames; i++) {
            const cacheKey = `${currentParams.layer}-${i}-${currentZoom}`;
            if (!animationCache[cacheKey]) {
                allCached = false;
                break;
            }
        }

        if (allCached) {
            console.log('⚡ All frames cached - re-attaching removed layers before start');
            // Re-attach any frames that were removed by stopAnimation (opacity-0 ones).
            // Tiles reload from browser memory cache almost instantly → no flash on first loop.
            for (let i = 0; i < totalFrames; i++) {
                const ck = `${currentParams.layer}-${i}-${currentZoom}`;
                const cl = animationCache[ck];
                if (cl && window.map && !window.map.hasLayer(cl)) {
                    cl.setOpacity(0);
                    cl.addTo(window.map);
                }
            }
            playBtn.innerHTML = originalText;
            console.timeEnd('⏱️ Total preload time');
            return true;
        }

        const results = [];

        for (let i = 0; i < totalFrames; i += batchSize) {
            // Create batch of promises
            const batch = [];
            for (let j = 0; j < batchSize && (i + j) < totalFrames; j++) {
                batch.push(preloadFrame(i + j, updateProgress, currentZoom));
            }

            // Wait for entire batch to complete in parallel
            console.log(`🔄 [PROTECTION] Loading batch: frames ${i} to ${Math.min(i + batchSize - 1, totalFrames - 1)} (conservative mode)`);
            const batchResults = await Promise.all(batch);
            results.push(...batchResults);

            // ABORT CHECK: Verify if we should still be loading
            if (!window.isAnimationLoading) {
                console.warn('🛑 Preloading ABORTED by user');
                return false;
            }

            // SPEED: Minimal delay between batches for maximum throughput
            if (i + batchSize < totalFrames) {
                console.log('⏳ [SPEED] Waiting 50ms before next batch...');
                await new Promise(resolve => setTimeout(resolve, 50)); // SPEED: 50ms delay
            }

            // SECOND ABORT CHECK: Check again after delay
            if (!window.isAnimationLoading) {
                console.warn('🛑 Preloading ABORTED by user');
                return false;
            }
        }

        // Check results
        const failedFrames = results.filter(r => !r.success);
        if (failedFrames.length > 0) {
            console.warn(`⚠️ ${failedFrames.length} frames failed to load:`, failedFrames.map(f => f.day));
        }

        playBtn.innerHTML = originalText;
        console.timeEnd('⏱️ Total preload time');
        console.log(`✅ Preloading complete: ${results.length - failedFrames.length}/${results.length} frames loaded`);

        return true;

    } catch (error) {
        console.error('❌ Error during preloading:', error);
        playBtn.innerHTML = originalText;
        return false;
    }
}

async function startAnimation(skipPreload = false) {
    if (window.isAnimating) {
        console.warn('⚠️ Animation already running');
        return;
    }

    // RACE CONDITION FIX: Prevent multiple clicks while loading
    if (window.isAnimationLoading) {
        console.warn('⚠️ Animation is already loading, ignoring click');
        return;
    }

    const metadata = layerMetadata[currentParams.layer];

    // ENHANCED VALIDATION: Check layer type explicitly
    if (!metadata) {
        console.error('❌ No metadata found for layer:', currentParams.layer);
        alert('Error: Layer metadata not found. Cannot start animation.');
        return;
    }

    if (metadata.type !== 'video') {
        console.warn('⚠️ Animation only works for VIDEO layers. Current type:', metadata.type);
        alert('Animation is only available for Video layers (episWL75, TWL75).\\nPlease select a Video layer first.');
        return;
    }

    // Sync global animation speed from the active layer settings before every start.
    // This prevents carrying speed from a previously played video layer.
    if (window.activeLayers && window.activeLayers.has(currentParams.layer)) {
        const layerData = window.activeLayers.get(currentParams.layer);
        const speedInput = document.getElementById(`anim-speed-${currentParams.layer}`);
        const speedFromLayer = speedInput
            ? parseInt(speedInput.value)
            : parseInt(layerData?.animationSpeed ?? animationSpeed);
        if (!isNaN(speedFromLayer)) {
            animationSpeed = speedFromLayer;
            if (layerData) layerData.animationSpeed = speedFromLayer;
            console.log(`⚡ [ANIM] Start speed synced for ${currentParams.layer}: ${animationSpeed}ms`);
        }
    }

    console.log('🎬 Starting animation for layer:', currentParams.layer);
    console.log('📊 Current parameters:', currentParams);

    const playBtn = document.getElementById(`play-btn-${currentParams.layer}`);
    if (!playBtn) {
        console.error('Play button not found for layer:', currentParams.layer);
        return;
    }

    // Set loading state
    playBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
    playBtn.disabled = true;

    try {
        // INSTANT MODE: Skip preloading if requested
        if (!skipPreload) {
            window.isAnimationLoading = true;
            const preloaded = await preloadAllFrames();
            window.isAnimationLoading = false;

            if (!preloaded) {
                console.warn('⚠️ Preloading failed or aborted, stopping startAnimation');
                window.isAnimationLoading = false;
                window.isAnimating = false;
                playBtn.innerHTML = '<i class="fa-solid fa-play"></i> Play';
                playBtn.classList.remove('btn-stop');
                playBtn.disabled = false;
                return;
            }
        } else {
            console.log('⚡ INSTANT MODE: Starting animation without preload');
        }

        // Initialize dual layers for transition
        // Reset wmsLayerA to null so tick 1 knows there is no previous animation frame to hide
        wmsLayerA = null;
        activeLayer = 'A';

        // ─── DO NOT forcibly remove the static base layer ──────
        // We will keep it on the map but set its opacity to 0
        // on the very first animated frame so it doesn't bleed through
        // transparent video frames.
        // ─────────────────────────────────────────────────────────────────────────────

        // Start Animation Loop
        window.isAnimating = true;
        animateNextFrame(); // Single call here
        updateAnimationControls();
        console.log('▶️ Animation started');
    } catch (error) {
        console.error('❌ Error starting animation:', error);
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i> Play';
        playBtn.classList.remove('btn-stop');
        playBtn.disabled = false;
        alert('Error starting animation: ' + error.message);
    }
}

async function animateNextFrame() {
    // If not animating, strictly abort.
    if (!window.isAnimating) {
        isAnimationBusy = false;
        return;
    }
    // If we're already processing a frame, let it finish.
    if (isAnimationBusy) return;

    isAnimationBusy = true;

    try {

        const nextElevation = currentParams.elevation >= 15 ? 0 : currentParams.elevation + 1;
        // FIX: Use Math.round to match the zoom key used by preloadFrame/preloadAllFrames
        const animZoom = Math.round(map.getZoom());
        const gwcLayersAnim = ['twl75', 'epis_wl75'];
        const fixedZoom = (gwcLayersAnim.includes(currentParams.layer) && animZoom >= 6) ? 6 : animZoom;
        const cacheKey = `${currentParams.layer}-${nextElevation}-${fixedZoom}`;
        let newLayer = animationCache[cacheKey];

        console.log(`[ANIM] Tick ${nextElevation}. Key: ${cacheKey}. Has Cache: ${!!newLayer}`);

        if (!newLayer) {
            console.warn("⚠️ Cache miss for day", nextElevation, "– scheduling retry");
            isAnimationBusy = false;
            // CHECK AGAIN before setting a timeout, the user might have clicked Stop during this split millisecond
            if (window.isAnimating) {
                currentParams.elevation = nextElevation;
                animationTimer = setTimeout(animateNextFrame, animationSpeed);
            }
            return;
        }

        // Ensure new layer is on the map (opacity 0 = invisible)
        if (!map.hasLayer(newLayer)) {
            console.log(`[ANIM] Adding layer to map: ${cacheKey}`);
            newLayer.setOpacity(0);
            map.addLayer(newLayer);
        }

        newLayer.bringToFront();

        requestAnimationFrame(() => {
            // STOP CORRUPTION FIX: If user clicked Stop while we were waiting for the paint frame, abort!
            if (!window.isAnimating) {
                isAnimationBusy = false;
                return;
            }

            // Video layers are always 100% opaque.
            const targetOpacity = 1.0;
            console.log(`[ANIM] Showing new layer ${cacheKey} at opacity ${targetOpacity}`);
            newLayer.setOpacity(targetOpacity);

            // Hide old animation frame WITHOUT removing it from the map
            // Use wmsLayerA to track the previous frame so we don't accidentally hide the static base Layer
            if (wmsLayerA && wmsLayerA !== newLayer) {
                console.log(`[ANIM] Hiding previous layer`);
                wmsLayerA.setOpacity(0);
            }

            // Hide the static base layer now that we have an active frame rendering
            if (window.activeLayers && currentParams.layer) {
                const layerData = window.activeLayers.get(currentParams.layer);
                if (layerData && layerData.wmsLayer) {
                    layerData.wmsLayer.setOpacity(0);
                }
            }

            // Track current frame
            wmsLayerA = newLayer;
            currentParams.elevation = nextElevation;

            const elevationSlider = document.getElementById(`elevation-${currentParams.layer}`);
            const elevationLabel = document.getElementById(`elevation-value-${currentParams.layer}`);

            if (elevationSlider) elevationSlider.value = nextElevation;
            if (elevationLabel) elevationLabel.textContent = `Day: ${nextElevation}`;

            if (window.updateForecastDateLabel && window.activeLayers && window.activeLayers.has(currentParams.layer)) {
                const layerTime = window.activeLayers.get(currentParams.layer).time;
                window.updateForecastDateLabel(currentParams.layer, nextElevation, layerTime);
            }

            if (window.isAnimating) {
                animationTimer = setTimeout(animateNextFrame, animationSpeed);
            }

            isAnimationBusy = false;
        });

    } catch (err) {
        console.error(err);
        isAnimationBusy = false;
    }
}




function pauseAnimation() {
    if (animationTimer) {
        clearTimeout(animationTimer);
        animationTimer = null;
    }
    window.isAnimating = false;
    isAnimationBusy = false;
    updateAnimationControls();

    // Ensure play button is enabled and reset to "Play"
    const playBtn = document.getElementById(`play-btn-${currentParams.layer}`);
    if (playBtn) {
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i> Play';
        playBtn.disabled = false;
    }

    console.log('⏸️ Animation paused');
}

// Make stopAnimation available globally for multi-layer.js
window.stopAnimation = stopAnimation;
window.resetPreloadStatus = resetPreloadStatus;

function resetPreloadStatus() {
    isPreloaded = false;
    currentPreloadDay = 0;
    // update controls if needed
}

function stopAnimation() {
    try {
        // Force immediate flag updates to stop loop
        window.isAnimationLoading = false;
        window.isAnimating = false;

        if (animationTimer) {
            clearTimeout(animationTimer);
            animationTimer = null;
        }
        isAnimationBusy = false;

        console.log('🧹 [CLEANUP] Stopping animation and freezing at current frame...');

        let layerDataAdopted = null;

        // FIX #4: Only reset elevation to 0 for video layers
        // Non-video layers (coastal/points) should keep their elevation on stop
        const stoppedMeta = layerMetadata[currentParams.layer];
        if (stoppedMeta && stoppedMeta.type === 'video') {
            currentParams.elevation = 0;
        }

        // 1. GUARANTEE UI RESET FIRST
        try {
            updateAnimationControls();

            const elevationSlider = document.getElementById(`elevation-${currentParams.layer}`);
            const elevationLabel = document.getElementById(`elevation-value-${currentParams.layer}`);
            if (elevationSlider) elevationSlider.value = 0;
            if (elevationLabel) elevationLabel.textContent = 'Day: 0';

            if (window.updateForecastDateLabel && window.activeLayers && window.activeLayers.has(currentParams.layer)) {
                const layerTime = window.activeLayers.get(currentParams.layer).time;
                window.updateForecastDateLabel(currentParams.layer, 0, layerTime);
            }

            const globalElev = document.getElementById('elevation-select');
            const globalElevVal = document.getElementById('elevation-value');
            if (globalElev) globalElev.value = 0;
            if (globalElevVal) globalElevVal.textContent = '0';
        } catch (uiErr) {
            console.warn('UI Reset Error:', uiErr);
        }

        // Sync the stopped state back to the static layer manager in multi-layer.js
        if (window.activeLayers && currentParams.layer) {
            const layerData = window.activeLayers.get(currentParams.layer);
            if (layerData) {
                // Update tracked static layer elevation to day 0
                layerData.elevation = 0;

                // Sync the main static base layer to reflect day 0 and restore full opacity
                if (layerData.wmsLayer) {
                    layerData.wmsLayer.setParams({ elevation: 0 }, false);
                    layerData.wmsLayer.redraw();
                    // Videos enforce 1.0 opacity natively, but safeguard just in case
                    layerData.wmsLayer.setOpacity(1.0);

                    if (window.map && !window.map.hasLayer(layerData.wmsLayer)) {
                        layerData.wmsLayer.addTo(window.map);
                    }

                    // Reduce keepBuffer for idle GWC layers — fewer off-screen tile requests while browsing
                    const gwcLayersKB = ['twl75', 'epis_wl75'];
                    if (gwcLayersKB.includes(currentParams.layer)) {
                        layerData.wmsLayer.options.keepBuffer = 2;
                        console.log('📦 [KEEPBUFFER] GWC base layer → 2 (idle)');
                    }
                }
            }
        }

        // Remove cached animation layers from map (cache object preserved for re-play).
        // If we just stop, we want Day 0 to be visible, so we must remove ALL animated frames
        // including the last visible one, because the base wmsLayer will now show Day 0.
        if (window.animationCache) {
            Object.values(window.animationCache).forEach(layer => {
                try {
                    if (layer && window.map && window.map.hasLayer(layer)) {
                        window.map.removeLayer(layer);
                    }
                } catch (e) {
                    console.warn('Could not remove cached layer on stop', e);
                }
            });
        }

        wmsLayerA = null;
        wmsLayerB = null;

        // Clear animation caches so next Play reloads frames for the current time
        // clearAnimationCacheForLayer(currentParams.layer); // DISABLED: keep cache for instant re-play

        updateLayerInfo();



        console.log('⏹️ Animation stopped successfully');
    } catch (err) {
        console.error('❌ Error during stopAnimation:', err);
    }
}

// Export layerMetadata globally for multi-layer.js
window.layerMetadata = layerMetadata;

// Function to set animation speed dynamically
function setAnimationSpeed(speed) {
    const oldSpeed = animationSpeed;
    animationSpeed = speed;
    if (window.activeLayers && currentParams.layer && window.activeLayers.has(currentParams.layer)) {
        const layerData = window.activeLayers.get(currentParams.layer);
        if (layerData && layerData.metadata && layerData.metadata.type === 'video') {
            layerData.animationSpeed = speed;
        }
    }
    console.log(`⚡ Animation speed updated to ${speed}ms (effective next frame)`);
}

function updateAnimationControls() {
    if (!currentParams.layer) return;

    const playBtn = document.getElementById(`play-btn-${currentParams.layer}`);

    if (playBtn) {
        // ALWAYS re-enable the button once we reach this state check, so users can interact
        playBtn.disabled = false;

        if (window.isAnimating) {
            playBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
            playBtn.classList.add('btn-stop');
        } else {
            playBtn.innerHTML = '<i class="fa-solid fa-play"></i> Play';
            playBtn.classList.remove('btn-stop');
        }
    }
}

// Event listeners
let layerSwitchDebounce = null;
document.getElementById('layer-select').addEventListener('change', (e) => {
    // CRITICAL FIX: Debounce rapid layer switching
    clearTimeout(layerSwitchDebounce);

    layerSwitchDebounce = setTimeout(async () => {
        trackOperationStart('layerChange');

        // CRITICAL FIX: Stop animation FIRST if running
        if (window.isAnimating) {
            console.log('🛑 [LAYER SWITCH] Stopping animation before layer change');
            stopAnimation();

            // CRITICAL: Wait for animation cleanup to complete
            await new Promise(resolve => setTimeout(resolve, 200));
            console.log('✅ [LAYER SWITCH] Animation cleanup complete');
        }

        // Clear cache for old layer before switching
        const oldLayer = currentParams.layer;
        currentParams.layer = e.target.value;

        if (oldLayer && oldLayer !== currentParams.layer) {
            clearLayerCache(oldLayer);
        }

        // PROTECTION: Cancel pending tile requests before loading new layer
        if (wmsLayer && wmsLayer._tiles) {
            console.log('🛡️ [PROTECTION] Cancelling pending requests from previous layer');
            // Actual cancellation now happens in recreateWMSLayer()
        }

        // Update elevation control visibility based on layer
        const metadata = layerMetadata[currentParams.layer];

        // Show/hide animation controls for VIDEO layers
        // DISABLED: Animation feature removed
        /*
        const animationControls = document.getElementById('animation-controls');
        if (animationControls) {
            if (metadata && metadata.type === 'video') {
                animationControls.style.display = 'flex';
                console.log('✅ Animation controls shown for VIDEO layer');
            } else {
                animationControls.style.display = 'none';
                console.log('🔒 Animation controls hidden for non-VIDEO layer');
            }
        }
        */

        // Show/hide Global Opacity control depending on layer type
        const globalOpacityControl = document.getElementById('global-opacity-container');
        if (globalOpacityControl) {
            if (metadata && metadata.type === 'video') {
                globalOpacityControl.style.display = 'none';
                console.log('🔒 Global Opacity control HIDDEN for VIDEO layer');
            } else {
                globalOpacityControl.style.display = 'flex';
                console.log('✅ Global Opacity control shown for non-VIDEO layer');
            }
        }

        // ENHANCED FIX: Explicitly hide elevation control for static layers
        if (metadata && metadata.hasElevation === true) {
            elevationControl.style.display = 'flex';
            console.log('✅ Elevation control shown (hasElevation=true)');

            // Adjust range based on layer type
            if (metadata.type === 'video') {
                elevationSlider.max = 15;  // Forecast days 0-15
                const label = 'Day';
                elevationLabel.textContent = `${label}: ${currentParams.elevation}`;
            } else {
                elevationSlider.max = 8;   // Return periods 0-8
                const label = metadata.type === 'points' ? 'RP' : 'RP';
                elevationLabel.textContent = `${label}: ${currentParams.elevation}`;
            }

            // CRITICAL FIX: Always reset elevation to 0 when switching layers
            // This ensures first frame is shown
            currentParams.elevation = 0;
            elevationSlider.value = 0;
            elevationLabel.textContent = metadata.type === 'video' ? 'Day: 0' : 'RP: 0';
            console.log('🔄 [LAYER SWITCH] Reset elevation to 0 (first frame)');
        } else {
            // ENHANCED FIX: Force hide elevation control for static layers with explicit logging
            elevationControl.style.display = 'none';
            console.log('🔒 Elevation control HIDDEN for static layer (hasElevation=false)');

            // Reset elevation to 0 when switching to layer without elevation
            currentParams.elevation = 0;
            elevationSlider.value = 0;
        }

        // ✅ CRITICAL: Layer change requires recreation (now with graceful cleanup)
        await recreateWMSLayer();
    }, 250); // 250ms debounce - prevents rapid-fire layer changes
});

let isSyncingDateControls = false;
let isSyncingTimeSelect = false;
let isUserChangingDate = false;

function getCurrentLayerIdForGlobalTime() {
    if (window.currentParams && window.currentParams.layer) return window.currentParams.layer;
    if (window.activeLayers && window.activeLayers.size > 0) {
        const first = window.activeLayers.keys().next();
        if (!first.done) return first.value;
    }
    return null;
}

function findClosestDate(targetDateStr, availableDates) {
    if (!targetDateStr || !availableDates || availableDates.length === 0) return null;
    const target = new Date(targetDateStr);
    if (isNaN(target.getTime())) return null;
    let closest = availableDates[0];
    let closestDiff = Math.abs(new Date(closest) - target);
    for (const d of availableDates) {
        const diff = Math.abs(new Date(d) - target);
        if (diff < closestDiff) {
            closestDiff = diff;
            closest = d;
        }
    }
    return closest;
}

function updateGlobalDateControlsForLayer(layerId, reason = '') {
    if (!window.wmsMetadata || !window.wmsMetadata.loaded || !layerId) return;
    const dates = window.wmsMetadata.getAvailableDatesForLayer(layerId);
    if (!dates || dates.length === 0) return;

    const dateInput = document.getElementById('date-select');
    const hourSelect = document.getElementById('hour-select');
    const timeSelect = document.getElementById('time-select');
    if (!dateInput || !hourSelect || !timeSelect) return;

    const currentDate = dateInput.value;
    const currentHour = hourSelect.value || '00';

    dateInput.min = dates[0];
    dateInput.max = dates[dates.length - 1];

    let nextDate = currentDate;
    if (!dates.includes(currentDate)) {
        nextDate = findClosestDate(currentDate, dates) || dates[dates.length - 1];
    }

    const availableHours = window.wmsMetadata.getAvailableHoursForLayerDate(layerId, nextDate);
    const hours = availableHours.length > 0 ? availableHours : ['00', '12'];

    hourSelect.innerHTML = '';
    hours.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = `${h}:00`;
        hourSelect.appendChild(opt);
    });

    let nextHour = currentHour;
    if (!hours.includes(currentHour)) {
        nextHour = hours[0];
    }

    isSyncingDateControls = true;
    try {
        dateInput.value = nextDate;
        hourSelect.value = nextHour;
    } finally {
        isSyncingDateControls = false;
    }

    const nextTimeValue = `${nextDate}T${nextHour}:00`;
    if (timeSelect.value !== nextTimeValue) {
        isSyncingTimeSelect = true;
        try {
            timeSelect.value = nextTimeValue;
            timeSelect.dispatchEvent(new Event('change'));
            console.log(`🧭 [DATE FILTER] Global time synced (${reason}): ${nextTimeValue}`);
        } finally {
            isSyncingTimeSelect = false;
        }
    }

    console.log('🧪 [DATE FILTER DEBUG]', {
        layerId,
        reason,
        datesCount: dates.length,
        datesMin: dates[0],
        datesMax: dates[dates.length - 1],
        currentDate,
        currentHour,
        nextDate,
        nextHour,
        hoursForDate: hours
    });
}
function syncDateHourFromTimeValue(timeValue) {
    if (!timeValue || timeValue.length < 16) return;
    if (isSyncingDateControls) return;
    isSyncingDateControls = true;
    try {
        const datePart = timeValue.slice(0, 10);
        const hourPart = timeValue.slice(11, 13);
        const dateInput = document.getElementById('date-select');
        const hourSelect = document.getElementById('hour-select');
        if (dateInput) dateInput.value = datePart;
        if (hourSelect) hourSelect.value = hourPart === '12' ? '12' : '00';
    } finally {
        isSyncingDateControls = false;
    }
}

document.getElementById('time-select').addEventListener('change', (e) => {
    isUserChangingDate = true;
    trackOperationStart('dateChange');

    const currentMeta = layerMetadata[currentParams.layer];

    // STICT VIDEO RESET: If the layer is a video, changing the date must reset the 
    // frame to Day 0 regardless of whether it is currently animating or stopped.
    if (currentMeta && currentMeta.type === 'video') {
        console.log('🔄 Time changed on a video layer. Forcing reset to Day 0.');
        if (typeof window.stopAnimation === 'function') {
            window.stopAnimation();
        }
    } else if (window.isAnimating) {
        // Stop animation if currently playing for non-video layers (safety catch)
        console.log('⏸️ Stopping animation due to time change');
        stopAnimation();
    }

    // Parse the datetime-local value as UTC
    const dateValue = e.target.value; // Format: YYYY-MM-DDTHH:mm
    console.log('🧪 [TIME INPUT] time-select raw value:', dateValue);
    // Guard: skip if value is empty (can happen when input clears)
    if (!dateValue || dateValue.length < 16) {
        console.warn('⚠️ Time input value is empty or invalid, skipping update.');
        isUserChangingDate = false;
        return;
    }

    // --- STRICT 12-HOUR AND MIN/MAX ENFORCEMENT ---
    let targetDate = new Date(dateValue + ':00.000Z');
    console.log('🧪 [TIME INPUT] parsed targetDate (UTC):', targetDate.toISOString());

    // Enforce 12-Hour Snapping (00:00 or 12:00)
    let hours = targetDate.getUTCHours();
    hours = hours >= 12 ? 12 : 0;
    targetDate.setUTCHours(hours, 0, 0, 0);

    // Enforce API Bounds (Clamp to min/max available)
    if (window.wmsMetadata && window.wmsMetadata.loaded) {
        const { minDate, maxDate } = window.wmsMetadata.getTimeExtent();
        if (minDate && targetDate < minDate) targetDate = new Date(minDate);
        if (maxDate && targetDate > maxDate) targetDate = new Date(maxDate);
    }

    // Force snap the target date back onto the 12-hour grid securely
    hours = targetDate.getUTCHours();
    hours = hours >= 12 ? 12 : 0;
    targetDate.setUTCHours(hours, 0, 0, 0);

    const safeValue = targetDate.toISOString().slice(0, 16);
    console.log('🧪 [TIME INPUT] normalized safeValue:', safeValue);
    // Write back the corrected syntax to the DOM to visually demonstrate limits to the user
    if (e.target.value !== safeValue) {
        e.target.value = safeValue;
    }
    // Keep the visible controls in sync with the normalized hidden value
    syncDateHourFromTimeValue(safeValue);
    // Enforce real available dates/hours for the current layer
    updateGlobalDateControlsForLayer(getCurrentLayerIdForGlobalTime(), 'time-select change');

    // Append seconds and 'Z' to treat as UTC
    currentParams.time = safeValue + ':00.000Z';
    console.log('⏰ Time changed to (UTC):', currentParams.time);

    // Clear video caches so new TIME actually loads fresh frames
    if (currentMeta && currentMeta.type === 'video') {
        clearAnimationCacheForLayer(currentParams.layer);
    }

    // ✅ CRITICAL: Use debounced param update, NOT layer recreation
    debouncedTimeUpdate();
    isUserChangingDate = false;
});

// FIX #10: isUserChangingDate is reset after dispatch (or immediately if no dispatch needed)
function syncSplitDateToProxy() {
    if (isSyncingTimeSelect) return;
    const d = document.getElementById('date-select').value;
    const h = document.getElementById('hour-select').value;
    const proxy = document.getElementById('time-select');
    if (d && h && proxy) {
        isUserChangingDate = true;
        console.log('🧪 [DATE INPUT] date-select/hour-select change ->', { d, h });
        const newVal = `${d}T${h}:00`;
        if (proxy.value !== newVal) {
            proxy.value = newVal;
            proxy.dispatchEvent(new Event('change'));
            // time-select change listener will set isUserChangingDate = false
        } else {
            // Value unchanged, dispatch won't fire or won't reset flag — reset manually
            isUserChangingDate = false;
        }
    }
}
document.getElementById('date-select').addEventListener('change', syncSplitDateToProxy);
document.getElementById('hour-select').addEventListener('change', syncSplitDateToProxy);

// Initialize map and layer
// initWMSLayer(); // DISABLED: Fixed ghost layer issue (conflict with multi-layer.js)

// Add scale control
L.control.scale({ imperial: false, metric: true }).addTo(map);

// Unified interaction handler for map movement/zooming
map.on('zoomstart', function () {
    trackOperationStart('zoom');

    if (window.isAnimating || window.isAnimationLoading) {
        // Just STOP the animation completely. Do not try to auto-resume or reload frames.
        // The user complained about the animation trying to aggressively reload/resume automatically.
        console.log('🛑 Zoom detected - Stopping animation');
        if (typeof window.stopAnimation === 'function') {
            window.stopAnimation();
        }

        // Clear cache and remove layers to prevent background loading
        if (window.animationCache) {
            Object.values(window.animationCache).forEach(layer => {
                if (layer && window.map && window.map.hasLayer(layer)) {
                    window.map.removeLayer(layer);
                }
            });
            window.animationCache = {};
        }
        if (typeof window.resetPreloadStatus === 'function') {
            window.resetPreloadStatus();
        }
    }

    // If animation is stopped but cached layers are still on map, remove them to
    // prevent tile requests being fired at the new zoom level for invisible layers.
    // Cache object is preserved — re-play will re-attach layers via preloadFrame().
    if (!window.isAnimating && !window.isAnimationLoading && window.animationCache) {
        Object.values(window.animationCache).forEach(layer => {
            if (layer && window.map && window.map.hasLayer(layer)) {
                const isVisible = layer.options.opacity > 0;
                if (!isVisible) window.map.removeLayer(layer); // len skryté
            }
        });
    }

    window.isMapInteracting = true;
});

map.on('zoomend', function () {
    console.log(`🔍 Zoom level: ${map.getZoom()}`);

    if (wmsLayer && map.hasLayer(wmsLayer)) {
        setTimeout(() => {
            // console.log('🔄 [ZOOM FIX] Forcing WMS layer redraw');
            // wmsLayer.redraw();

            // 🔥 PRIDANÝ PRE-WARM:
            // Ak nebeží animácia, okamžite načítaj aktuálny snímok pre nový zoom level
            if (!window.isAnimating && currentParams.layer) {
                console.log('🔥 [PRE-WARM] Preloading current frame for new zoom level');
                window.preloadSingleFrame(currentParams.layer, currentParams.elevation);
            }

            console.log('✅ WMS layer refreshed for zoom level', map.getZoom());
        }, 100);
    }
});

// ═══════════════════════════════════════════════════════════════
// GET FEATURE INFO - CLICK TO VIEW DATA
// ═══════════════════════════════════════════════════════════════
// Track active GetFeatureInfo request to allow cancellation
let activeGetFeatureInfoController = null;

// Function to fetch and display GetFeatureInfo for all active layers
async function getFeatureInfo(latlng) {
    // Check if using multi-layer system or single layer
    const useMultiLayer = typeof activeLayers !== 'undefined' && activeLayers.size > 0;

    if (!useMultiLayer && !wmsLayer) {
        console.warn('⚠️ No WMS layer active');
        return;
    }

    // Cancel any previous pending request
    if (activeGetFeatureInfoController) {
        console.log('🛑 Cancelling previous GetFeatureInfo request');
        activeGetFeatureInfoController.abort();
    }

    // Create new AbortController for this request
    activeGetFeatureInfoController = new AbortController();
    const signal = activeGetFeatureInfoController.signal;

    // Show loading popup
    const loadingPopup = L.popup()
        .setLatLng(latlng)
        .setContent('<i class="fa-solid fa-spinner fa-spin"></i> Loading data...')
        .openOn(map);

    try {
        // Get map pixel coordinates
        const point = map.latLngToContainerPoint(latlng);
        const size = map.getSize();
        const bounds = map.getBounds();
        // Extracting bounds exactly covering the map view. Because we restricted
        // map panning (maxBounds) to a single world copy, we don't need complex bounding 
        // box wrapping translations - the map viewport BBOX perfectly maps to GeoServer bounds.
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();

        const swProjected = L.CRS.EPSG3857.project(sw);
        const neProjected = L.CRS.EPSG3857.project(ne);

        let allResults = [];

        if (useMultiLayer) {
            // Query all active layers
            console.log(`🔍 Querying ${activeLayers.size} active layers`);

            const promises = [];
            const panelOrder = Array.from(document.querySelectorAll('#active-layers-panel .active-layer-controls-card[data-layer-id]'))
                .map(card => card.getAttribute('data-layer-id'))
                .filter(Boolean);

            const orderedLayerIds = panelOrder.filter(layerId => activeLayers.has(layerId));
            for (const layerId of activeLayers.keys()) {
                if (!orderedLayerIds.includes(layerId)) {
                    orderedLayerIds.push(layerId);
                }
            }

            for (const layerId of orderedLayerIds) {
                const layerData = activeLayers.get(layerId);
                if (!layerData) continue;
                promises.push(queryLayer(layerId, layerData, latlng, point, size, signal));
            }

            allResults = await Promise.all(promises);
        } else {
            // Single layer mode (legacy)
            const metadata = layerMetadata[currentParams.layer];
            if (metadata && metadata.external) {
                loadingPopup.setContent('GetFeatureInfo not available for external Copernicus layers.');
                return;
            }

            const result = await queryLayer(currentParams.layer, { time: currentParams.time, elevation: currentParams.elevation, metadata }, latlng, point, size, signal);
            allResults = [result];
        }

        // Build combined popup content
        let content = '<div style="max-width: 380px; max-height: 500px; overflow-y: auto;">';
        content += `<div style="margin-bottom:8px; font-size:12px;">`;
        content += `<span style="font-weight:600; color:#4fc3f7;">Lat:</span> `;
        content += `<span style="color:#ffffff; font-weight:700;">${latlng.lat.toFixed(6)}</span> `;
        content += `<span style="font-weight:600; color:#4fc3f7; margin-left:10px;">Lon:</span> `;
        content += `<span style="color:#ffffff; font-weight:700;">${latlng.lng.toFixed(6)}</span>`;
        content += `</div>`;
        content += '<div style="border-top: 1px solid #2d3548; margin: 6px 0 10px 0;"></div>';

        const layersWithData = allResults.filter(r => r.features && r.features.length > 0);

        if (layersWithData.length === 0) {
            content += '<span style="color: #8f9bb3;">No data at this location</span>';
        } else {
            layersWithData.forEach((result, idx) => {
                if (idx > 0) {
                    content += '<div style="border-top: 2px solid #2d3548; margin: 14px 0;"></div>';
                }

                content += `<strong style="color: #4A90E2; font-size: 13px;">${result.layerName || result.layerId}</strong><br>`;

                result.features.forEach((feature, fIdx) => {
                    if (fIdx > 0) {
                        content += '<div style="border-top: 1px solid #3a4254; margin: 8px 0;"></div>';
                    }

                    const props = feature.properties || {};
                    Object.keys(props).forEach(key => {
                        const value = props[key];
                        if (value !== null && value !== undefined && value !== '') {
                            let displayValue = value;
                            if (typeof value === 'number') {
                                displayValue = value.toFixed(4); // Keep GeoServer float format
                            }

                            // UX: Rename GeoServer raster internal names
                            let displayName = key;
                            if (key === 'GRAY_INDEX') {
                                displayName = 'Value';
                            }

                            content += `<div style="margin: 3px 0; font-size: 13px;">`;
                            content += `<span style="font-weight: 600; color: #4fc3f7;">${displayName}:</span> `;
                            content += `<span style="color: #ffffff; font-weight: 700;">${displayValue}</span>`;
                            content += `</div>`;
                        }
                    });
                });

            });
        }

        content += '</div>';
        loadingPopup.setContent(content);

    } catch (error) {
        // Check if request was aborted
        if (error.name === 'AbortError') {
            console.log('ℹ️ GetFeatureInfo request cancelled');
            return;
        }

        console.error('❌ GetFeatureInfo error:', error);

        let errorMsg = error.message;
        if (errorMsg.includes('timeout')) {
            errorMsg = 'Request timeout - server is slow';
        } else if (errorMsg.includes('Failed to fetch')) {
            errorMsg = 'Network error - check proxy';
        }

        loadingPopup.setContent(`<span style="color: #FF6B6B;">Error: ${errorMsg}</span>`);
    } finally {
        activeGetFeatureInfoController = null;
    }
}

// Helper function to query a single layer
async function queryLayer(layerId, layerData, latlng, point, size, signal) {
    const metadata = layerData.metadata || layerMetadata[layerId];

    // Skip external layers (Copernicus) and GloFAS WMS layers (not on local GeoServer)
    if (metadata && (metadata.external || metadata.wmsUrl)) {
        return { layerId, layerName: layerDisplayNames[layerId] || layerId, features: [] };
    }

    // Inherit the exact same formatting parameters from the visual layer
    const wmsParams = layerData.wmsLayer ? layerData.wmsLayer.wmsParams : {};

    // 🌟 THE ULTIMATE FIX FOR GEOSERVER IMAGEMOSAIC 0.0 VALUES:
    // If the ImageMosaic lacks a NoData value in EPSG:3857, complex boundary translation 
    // forces it to interpolate to 0. Asking directly in its native EPSG:4326 via a 
    // precise micro-envelope around the exact click point correctly hits the TIFF raster values.
    // FIX #11: Apply .wrap() to the whole latlng point (not just lng) to keep lat/lng consistent
    const wrappedLatlng = latlng.wrap();
    const microBboxStr = `${wrappedLatlng.lat - 0.001},${wrappedLatlng.lng - 0.001},${wrappedLatlng.lat + 0.001},${wrappedLatlng.lng + 0.001}`;

    const params = {
        SERVICE: 'WMS',
        VERSION: '1.3.0',
        REQUEST: 'GetFeatureInfo',
        LAYERS: `${WORKSPACE}:${layerId}`,
        layers: `${WORKSPACE}:${layerId}`, // duplicate in lowercase for proxy parser
        QUERY_LAYERS: `${WORKSPACE}:${layerId}`,
        INFO_FORMAT: 'application/json',
        FEATURE_COUNT: 10,
        CRS: 'EPSG:4326', // Use true WGS84 for probing data!
        BBOX: microBboxStr, // Micro-bbox isolating the click
        WIDTH: 10, // Small logical width mapping to bbox
        HEIGHT: 10,
        I: 5, // Center of our micro-bbox
        J: 5,
        STYLES: wmsParams.styles || '',
        FORMAT: wmsParams.format || 'image/png',
        TRANSPARENT: true
    };

    // Keep WMS 1.1.1 compatibility if the layer was initialized with it
    if (params.VERSION === '1.1.1') {
        params.SRS = 'EPSG:3857';
        delete params.CRS;
        params.X = params.I;
        params.Y = params.J;
        delete params.I;
        delete params.J;
    }

    // Always send TIME and ELEVATION if available, even for video layers
    if (layerData.time) {
        params.TIME = layerData.time;
    }
    if (metadata && metadata.hasElevation) {
        params.ELEVATION = layerData.elevation;
    }

    const queryString = new URLSearchParams(params).toString();
    // Explicitly target the geoserver WMS endpoint to bypass GWC caching logic
    const url = `${GEOSERVER_URL}/wms?target=geoserver&${queryString}`;

    // Create timeout promise (5 seconds)
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout (5s)')), 5000);
    });

    // Race between fetch and timeout
    const fetchPromise = fetch(url, { signal });
    const response = await Promise.race([fetchPromise, timeoutPromise]);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check response content type to handle different formats
    const contentType = response.headers.get('content-type') || '';
    console.log(`📦 GetFeatureInfo response type: ${contentType}`);

    let features = [];

    if (contentType.includes('application/json') || contentType.includes('application/geo+json')) {
        // Parse JSON/GeoJSON
        const data = await response.json();
        features = data.features || [];
    } else if (contentType.includes('text/xml') || contentType.includes('application/xml')) {
        // Parse XML response
        const xmlText = await response.text();
        console.log('📄 Parsing XML GetFeatureInfo response');

        // Parse XML to extract features
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

        // Check for parsing errors
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
            console.error('❌ XML parsing error:', parserError.textContent);
            throw new Error('Failed to parse XML response');
        }

        // Extract feature data from XML (GML format)
        const featureMembers = xmlDoc.querySelectorAll('gml\\:featureMember, featureMember');

        features = Array.from(featureMembers).map(member => {
            const properties = {};

            // Get all child elements (these are the properties)
            const children = member.children[0]?.children || [];

            for (const child of children) {
                const tagName = child.tagName.split(':').pop(); // Remove namespace prefix
                const value = child.textContent.trim();

                // Skip geometry fields (usually named 'geom', 'the_geom', 'geometry')
                if (!tagName.toLowerCase().includes('geom')) {
                    // Try to parse as number if possible
                    const numValue = parseFloat(value);
                    properties[tagName] = isNaN(numValue) ? value : numValue;
                }
            }

            return { properties };
        });

        console.log(`✅ Extracted ${features.length} features from XML`);
    } else {
        // Fallback: try to parse as JSON anyway
        console.warn('⚠️ Unexpected content type, attempting JSON parse');
        try {
            const data = await response.json();
            features = data.features || [];
        } catch (e) {
            console.error('❌ Failed to parse response:', e);
            throw new Error(`Unsupported response format: ${contentType}`);
        }
    }

    return {
        layerId,
        layerName: (typeof layerDisplayNames !== 'undefined' ? layerDisplayNames[layerId] : null) || layerId,
        features: features
    };
}


// Add click handler to map
map.on('click', function (e) {
    console.log('🖱️ Map clicked at:', e.latlng);
    getFeatureInfo(e.latlng);
});

// Global command to print performance summary (type in console: printPerformanceSummary())
window.printPerformanceSummary = printPerformanceSummary;

// Basemap selector UI binding
const basemapSelect = document.getElementById('basemap-select');
if (basemapSelect) {
    basemapSelect.value = currentBaseMapId;
    basemapSelect.addEventListener('change', (e) => {
        setBaseMap(e.target.value);
    });
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🗺️ WMS Viewer initialized');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📡 GeoServer:', GEOSERVER_URL);
console.log('📂 Workspace:', WORKSPACE);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ═══════════════════════════════════════════════════════════════
// GLOBAL METADATA INIT — runs on page load, NOT inside initWMSLayer
// Sets default date to latest available and shows date range in UI
// ═══════════════════════════════════════════════════════════════
function applyDateRangeFromMetadata() {
    if (!window.wmsMetadata || !window.wmsMetadata.loaded) return;

    const { minDate, maxDate } = window.wmsMetadata.getTimeExtent();
    if (!minDate || !maxDate) {
        console.warn('⚠️ getTimeExtent returned null — no time data in capabilities?');
        return;
    }

    const format = d => d.toISOString().split('T')[0];
    console.log(`📅 Date range: ${format(minDate)} → ${format(maxDate)}`);

    // 1. Update the date range display
    const rangeDisplay = document.getElementById('date-range-text');
    if (rangeDisplay) {
        rangeDisplay.textContent = `${format(minDate)} – ${format(maxDate)}`;
    }

    // 2. Set currentParams.time to latest available date
    const latestTime = maxDate.toISOString();
    if (window.currentParams) {
        window.currentParams.time = latestTime;
    }

    // 3. Update the global time inputs in the bottom panel
    const timeInput = document.getElementById('time-select');
    const dateInput = document.getElementById('date-select');
    const hourInput = document.getElementById('hour-select');

    if (timeInput) {
        // Enforce boundary limits natively on the Date calendar explicitly
        if (dateInput) {
            dateInput.min = minDate.toISOString().slice(0, 10);
            dateInput.max = maxDate.toISOString().slice(0, 10);
            dateInput.value = latestTime.slice(0, 10);
        }

        if (hourInput) {
            hourInput.value = latestTime.slice(11, 13) >= '12' ? '12' : '00';
        }

        timeInput.min = minDate.toISOString().slice(0, 16);
        timeInput.max = maxDate.toISOString().slice(0, 16);
        timeInput.value = latestTime.slice(0, 16); // "YYYY-MM-DDTHH:MM"

        // Trigger change event so any listeners update
        timeInput.dispatchEvent(new Event('change'));
    }

    updateGlobalDateControlsForLayer(getCurrentLayerIdForGlobalTime(), 'metadata init');

    console.log(`🔄 Default time set to LATEST: ${latestTime}`);
}



function globalMetadataInit() {
    console.log('🌐 [GLOBAL] Starting metadata fetch for date range...');
    if (!window.wmsMetadata) {
        console.error('❌ window.wmsMetadata not found!');
        return;
    }

    if (window.wmsMetadata.loaded) {
        applyDateRangeFromMetadata();
        return;
    }

    if (window.wmsMetadata.loading) {
        // Already loading — poll until done
        const poll = setInterval(() => {
            if (window.wmsMetadata.loaded) {
                clearInterval(poll);
                applyDateRangeFromMetadata();
            }
        }, 300);
        return;
    }

    // Not loading yet — fetch now
    window.wmsMetadata.fetchCapabilities().then(success => {
        if (success) {
            applyDateRangeFromMetadata();
        } else {
            console.error('❌ fetchCapabilities failed');
        }
    });
}

// Run immediately if DOM is ready, otherwise wait
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', globalMetadataInit);
} else {
    globalMetadataInit();
}
