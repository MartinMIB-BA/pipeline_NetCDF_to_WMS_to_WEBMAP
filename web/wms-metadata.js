/**
 * WMS Metadata Management
 * Fetches and parses WMS GetCapabilities to provide efficient, locally-cached data availability checks.
 * This replaces the expensive "probe" request method.
 */

class WMSMetadata {
    constructor() {
        this.capabilities = null;
        this.layers = new Map(); // layerId -> { times: Set, elevations: Set, hasElevation: bool }
        this.loading = false;
        this.loaded = false;
    }

    /**
     * Fetch WMS Capabilities from the server
     * @returns {Promise<boolean>} Success status
     */
    async fetchCapabilities() {
        if (this.loaded) return true;

        // ✅ FIX: If already loading (started by another caller), WAIT for it to complete
        // instead of returning false immediately. This prevents race conditions where
        // multi-layer.js fires before app.js's fetch completes.
        if (this.loading) {
            return new Promise((resolve) => {
                const poll = setInterval(() => {
                    if (this.loaded) {
                        clearInterval(poll);
                        resolve(true);
                    } else if (!this.loading) {
                        // Loading stopped but not loaded = failed
                        clearInterval(poll);
                        resolve(false);
                    }
                }, 50); // Check every 50ms
            });
        }

        this.loading = true;
        console.log('📡 Fetching WMS Capabilities...');

        try {
            // Using the existing global GEOSERVER_URL constant
            const url = `${GEOSERVER_URL}/wms?service=WMS&version=1.3.0&request=GetCapabilities`;

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const xmlText = await response.text();
            this.parseCapabilities(xmlText);

            this.loaded = true;
            this.loading = false;
            console.log('✅ WMS Capabilities loaded and parsed.');
            return true;

        } catch (error) {
            console.error('❌ Failed to fetch WMS Capabilities:', error);
            this.loading = false;
            return false;
        }
    }

    /**
     * Parse the GetCapabilities XML (DOM Parser)
     * @param {string} xmlText 
     */
    parseCapabilities(xmlText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");

        // Find all Layer elements
        const layerNodes = xmlDoc.querySelectorAll('Layer > Layer'); // Nested layers usually contain the data

        layerNodes.forEach(layerNode => {
            const nameNode = layerNode.querySelector('Name');
            if (!nameNode) return;

            // Extract Name (e.g. "workspace:layername")
            const fullName = nameNode.textContent;
            // We usually strip workspace for matching if the app uses 'layername' keys, 
            // but app.js uses 'workspace:layer' in requests. 
            // Let's store BOTH full name and local name to be safe.
            const parts = fullName.split(':');
            const localName = parts.length > 1 ? parts[1] : fullName;

            const layerData = {
                times: new Set(),
                elevations: new Set(),
                hasElevation: false,
                timeIndex: null
            };

            // Parse Dimensions
            const dimensions = layerNode.querySelectorAll('Dimension');
            dimensions.forEach(dim => {
                const name = dim.getAttribute('name').toLowerCase();
                const content = dim.textContent.trim();

                if (name === 'time') {
                    // Times are comma-separated ISO strings
                    const times = content.split(',').map(t => t.trim());
                    times.forEach(t => layerData.times.add(t));
                } else if (name === 'elevation') {
                    // Elevations are comma-separated numbers
                    layerData.hasElevation = true;
                    const elevs = content.split(',').map(e => e.trim());
                    elevs.forEach(e => layerData.elevations.add(e)); // Keep as strings for safe comparison
                }
            });

            // Store by local name (as used in activeLayers keys)
            this.layers.set(localName, layerData);
            // Also store by full name just in case
            this.layers.set(fullName, layerData);
        });

        console.log(`📊 Parsed metadata for ${this.layers.size} layers.`);
    }

    // Build and cache a { dates: string[], dateToHours: Map<string, Set<string>> } index
    buildTimeIndexForLayer(layerId) {
        if (!this.loaded) return null;
        const layerData = this.layers.get(layerId);
        if (!layerData || layerData.times.size === 0) return null;
        if (layerData.timeIndex) return layerData.timeIndex;

        const dateToHours = new Map();
        const datesSet = new Set();
        const rawTimes = Array.from(layerData.times);

        const addDateHour = (d) => {
            if (!(d instanceof Date) || isNaN(d.getTime())) return;
            const dateStr = d.toISOString().slice(0, 10);
            const hourStr = d.toISOString().slice(11, 13);
            datesSet.add(dateStr);
            if (!dateToHours.has(dateStr)) dateToHours.set(dateStr, new Set());
            dateToHours.get(dateStr).add(hourStr);
        };

        const parseDurationToMs = (dur) => {
            const m = dur.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
            if (!m) return null;
            const days = parseInt(m[1] || '0', 10);
            const hours = parseInt(m[2] || '0', 10);
            const minutes = parseInt(m[3] || '0', 10);
            const seconds = parseInt(m[4] || '0', 10);
            const ms = (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
            return ms > 0 ? ms : null;
        };

        const inferStepMs = (start, end) => {
            if (!(start instanceof Date) || !(end instanceof Date)) return null;
            if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
            // Heuristic: if hours differ, assume 12-hour cadence, otherwise daily.
            const startH = start.getUTCHours();
            const endH = end.getUTCHours();
            return startH !== endH ? 12 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        };

        const MAX_EXPAND = 2000;

        layerData.times.forEach(t => {
            if (!t) return;
            if (t.includes('/')) {
                const parts = t.split('/');
                const start = new Date(parts[0]);
                const end = new Date(parts[1]);
                let stepMs = parts[2] ? parseDurationToMs(parts[2]) : null;
                if (!stepMs) stepMs = inferStepMs(start, end);
                if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && stepMs) {
                    let count = 0;
                    for (let d = new Date(start); d <= end && count < MAX_EXPAND; d = new Date(d.getTime() + stepMs)) {
                        addDateHour(d);
                        count++;
                    }
                    if (count >= MAX_EXPAND) {
                        console.warn(`⚠️ Time interval expansion capped at ${MAX_EXPAND} for ${layerId}`);
                    }
                } else {
                    // Fallback: use start/end only
                    if (!isNaN(start.getTime())) addDateHour(start);
                    if (!isNaN(end.getTime())) addDateHour(end);
                }
            } else {
                const d = new Date(t);
                if (!isNaN(d.getTime())) addDateHour(d);
            }
        });

        const dates = Array.from(datesSet);
        dates.sort((a, b) => new Date(a) - new Date(b));
        layerData.timeIndex = { dates, dateToHours };

        if (layerId === 'epis_wl75' || layerId === 'twl75') {
            const hoursSummary = {};
            dateToHours.forEach((set, date) => {
                hoursSummary[date] = Array.from(set).sort();
            });
            console.log(`🧪 [TIME DEBUG] Layer ${layerId}`);
            console.log('🧪 Raw TIME entries:', rawTimes);
            console.log('🧪 Parsed dates:', dates);
            console.log('🧪 Date → hours:', hoursSummary);
        }

        return layerData.timeIndex;
    }

    getAvailableDatesForLayer(layerId) {
        const idx = this.buildTimeIndexForLayer(layerId);
        return idx ? idx.dates : [];
    }

    getAvailableHoursForLayerDate(layerId, dateStr) {
        const idx = this.buildTimeIndexForLayer(layerId);
        if (!idx || !dateStr) return [];
        const hours = idx.dateToHours.get(dateStr);
        if (!hours) return [];
        return Array.from(hours).sort();
    }

    /**
     * Check if data exists for a given layer, time, and elevation
     * @param {string} layerId - The layer identifier (e.g. 'probability_epis10y...')
     * @param {string} time - ISO time string (e.g. '2026-01-01T00:00:00.000Z')
     * @param {number|string} elevation - Elevation value (optional)
     * @returns {boolean} True if data exists
     */
    isDataAvailable(layerId, time, elevation) {
        if (!this.loaded) {
            console.warn('⚠️ WMS Metadata not loaded yet. Allowing by default.');
            return true;
        }

        // VIDEO LAYERS: Skip time matching - GWC serves these with different
        // time formats and the server will return nearest available frame anyway
        const videoLayers = ['epis_wl75', 'twl75'];
        if (videoLayers.includes(layerId)) {
            return true;
        }

        const layerData = this.layers.get(layerId);

        // If layer not found in capabilities, assume it might be a new or external layer
        // Optimistic default: prevent blocking valid layers just because parsing missed them
        if (!layerData) {
            return true;
        }

        // 1. Check Time
        // The time from controls might be '2026-01-01T00:00:00.000Z'
        // Capabilities might have '2026-01-01T00:00:00.000Z' or shorter formats.
        // IMPROVED: If layer has NO time dimension at all, allow any time (static layers)
        if (layerData.times.size > 0 && time) {
            if (!layerData.times.has(time)) {
                // Try loose matching by comparing just the date part
                const requestedDate = time.split('T')[0];
                let foundMatch = false;
                for (const availableTime of layerData.times) {
                    if (availableTime.startsWith(requestedDate)) {
                        foundMatch = true;
                        break;
                    }
                }
                if (!foundMatch) {
                    console.log(`⚠️ Time mismatch: ${time} not found in available times for ${layerId}`);
                    return false;
                }
            }
        }
        // If layer has no times (static), we allow it
        if (layerData.times.size === 0) {
            console.log(`ℹ️ Layer ${layerId} has no time dimension, allowing request`);
        }

        // 2. Check Elevation
        if (layerData.hasElevation && elevation !== undefined && elevation !== null) {
            const elevStr = String(elevation);
            if (!layerData.elevations.has(elevStr)) {
                // console.log(`Mismatch elevation: ${elevStr} not in`, layerData.elevations);
                return false;
            }
        }

        return true;
    }


    /**
     * Get the full time extent across all layers
     * @returns {Object} { minDate: Date|null, maxDate: Date|null }
     */
    getTimeExtent() {
        if (!this.loaded) return { minDate: null, maxDate: null };

        let allTimes = [];
        this.layers.forEach(layer => {
            if (layer.times.size > 0) {
                layer.times.forEach(t => {
                    // Handle ISO 8601 Interval "start/end/period" -> Take start and end
                    if (t.includes('/')) {
                        const parts = t.split('/');
                        const start = new Date(parts[0]);
                        const end = new Date(parts[1]);
                        if (!isNaN(start.getTime())) allTimes.push(start);
                        if (!isNaN(end.getTime())) allTimes.push(end);
                    } else {
                        // Regular ISO date
                        const d = new Date(t);
                        if (!isNaN(d.getTime())) allTimes.push(d);
                    }
                });
            }
        });

        if (allTimes.length === 0) return { minDate: null, maxDate: null };

        // Sort ascending
        allTimes.sort((a, b) => a - b);

        return {
            minDate: allTimes[0], // Earliest
            maxDate: allTimes[allTimes.length - 1] // Latest
        };
    }
    /**
     * Get the latest available time for a SPECIFIC layer.
     * Use this instead of getTimeExtent() to avoid cross-layer time contamination
     * (e.g., video layers have 12:00Z times but static layers only have 00:00Z).
     * @param {string} layerId - Local layer name (e.g. 'probability_epis10y_1_15')
     * @returns {string|null} Latest ISO time string, or null if not found
     */
    getLatestTimeForLayer(layerId) {
        if (!this.loaded) return null;
        const layerData = this.layers.get(layerId);
        if (!layerData || layerData.times.size === 0) return null;

        const times = [];
        layerData.times.forEach(t => {
            // Handle ISO 8601 intervals (start/end/period) — use end date
            if (t.includes('/')) {
                const parts = t.split('/');
                const end = new Date(parts[1]);
                if (!isNaN(end.getTime())) times.push(end);
            } else {
                const d = new Date(t);
                if (!isNaN(d.getTime())) times.push(d);
            }
        });

        if (times.length === 0) return null;
        times.sort((a, b) => a - b);
        return times[times.length - 1].toISOString();
    }
}

// Export specific instance
window.wmsMetadata = new WMSMetadata();
