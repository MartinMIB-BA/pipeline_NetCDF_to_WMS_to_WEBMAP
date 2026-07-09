// ═══════════════════════════════════════════════════════════════
// PERMALINK MODULE — save/restore map state via URL hash
// ═══════════════════════════════════════════════════════════════
// Encodes active layers, date, zoom, and map center into the URL hash.
// When a user opens a shared link, the map restores to that exact state.
// Also adds a "Copy Link" button to the UI.
//
// REVERT: Remove this file + its <script> tag in index.html.
// ═══════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── Encode current state into URL hash ─────────────────────
    function encodeState() {
        const state = {};

        // Map view
        const center = map.getCenter().wrap();
        state.lat = center.lat.toFixed(4);
        state.lng = center.lng.toFixed(4);
        state.z = map.getZoom();

        // Date/time
        const timeSelect = document.getElementById('time-select');
        if (timeSelect && timeSelect.value) {
            state.t = timeSelect.value; // "YYYY-MM-DDTHH:MM"
        }

        // Active layers (ordered)
        if (typeof activeLayers !== 'undefined' && activeLayers.size > 0) {
            const layers = [];
            activeLayers.forEach((ld, layerId) => {
                layers.push(layerId);
            });
            state.layers = layers.join(',');
        }

        // Basemap
        if (window.currentBaseMapId) {
            state.base = window.currentBaseMapId;
        }

        return state;
    }

    function stateToHash(state) {
        const params = new URLSearchParams();
        Object.entries(state).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') {
                params.set(k, v);
            }
        });
        return params.toString();
    }

    function hashToState(hash) {
        const params = new URLSearchParams(hash);
        const state = {};
        for (const [k, v] of params.entries()) {
            state[k] = v;
        }
        return state;
    }

    // ── Apply state from URL hash on page load ─────────────────
    function restoreFromHash() {
        const hash = window.location.hash.slice(1); // remove '#'
        if (!hash) return false;

        const state = hashToState(hash);
        let restored = false;

        // Restore map view
        if (state.lat && state.lng && state.z) {
            map.setView([parseFloat(state.lat), parseFloat(state.lng)], parseInt(state.z));
            restored = true;
        }

        // Restore basemap
        if (state.base && window.setBaseMap && window.BASEMAP_OPTIONS && window.BASEMAP_OPTIONS[state.base]) {
            window.setBaseMap(state.base);
            const basemapSelect = document.getElementById('basemap-select');
            if (basemapSelect) basemapSelect.value = state.base;
        }

        // Restore date/time (before layers, so layers pick up the right time)
        if (state.t) {
            const timeSelect = document.getElementById('time-select');
            const dateInput = document.getElementById('date-select');
            const hourInput = document.getElementById('hour-select');
            if (timeSelect) {
                timeSelect.value = state.t;
                timeSelect.dispatchEvent(new Event('change'));
            }
            if (dateInput && state.t.length >= 10) {
                dateInput.value = state.t.slice(0, 10);
            }
            if (hourInput && state.t.length >= 16) {
                hourInput.value = state.t.slice(11, 13) >= '12' ? '12' : '00';
            }
        }

        // Restore layers (remove defaults first, then add specified)
        if (state.layers && typeof activeLayers !== 'undefined') {
            const wantedLayers = state.layers.split(',').filter(Boolean);

            // Remove all currently active layers
            const currentLayers = Array.from(activeLayers.keys());
            currentLayers.forEach(layerId => {
                if (typeof removeLayer === 'function') removeLayer(layerId);
            });

            // Add wanted layers
            setTimeout(() => {
                wantedLayers.forEach(layerId => {
                    if (typeof addLayer === 'function' && typeof layerMetadata !== 'undefined' && layerMetadata[layerId]) {
                        addLayer(layerId);
                    }
                });
                if (typeof updateLayerCount === 'function') updateLayerCount();
                if (typeof syncLayerBubbleState === 'function') syncLayerBubbleState();
            }, 200);

            restored = true;
        }

        return restored;
    }

    // ── Update URL hash on state changes (debounced) ───────────
    let hashUpdateTimer = null;
    function scheduleHashUpdate() {
        clearTimeout(hashUpdateTimer);
        hashUpdateTimer = setTimeout(() => {
            const hash = stateToHash(encodeState());
            // Use replaceState to avoid polluting browser history on every pan/zoom
            history.replaceState(null, '', '#' + hash);
        }, 500);
    }

    // Listen to map and control changes
    map.on('moveend', scheduleHashUpdate);

    // Observe time changes
    const timeSelect = document.getElementById('time-select');
    if (timeSelect) {
        timeSelect.addEventListener('change', scheduleHashUpdate);
    }

    // Observe layer additions/removals (MutationObserver on active panel)
    const activePanel = document.getElementById('active-layers-panel');
    if (activePanel) {
        const observer = new MutationObserver(scheduleHashUpdate);
        observer.observe(activePanel, { childList: true, subtree: true });
    }

    // ── Copy Link button ───────────────────────────────────────
    function createCopyLinkButton() {
        const btn = document.createElement('button');
        btn.id = 'copy-link-btn';
        btn.title = 'Copy shareable link';
        btn.innerHTML = '<i class="fa-solid fa-link"></i>';
        btn.addEventListener('click', () => {
            // Force fresh hash
            const hash = stateToHash(encodeState());
            const url = window.location.origin + window.location.pathname + '#' + hash;
            navigator.clipboard.writeText(url).then(() => {
                btn.innerHTML = '<i class="fa-solid fa-check"></i>';
                btn.style.borderColor = 'rgba(52, 211, 153, 0.5)';
                btn.style.color = '#34d399';
                setTimeout(() => {
                    btn.innerHTML = '<i class="fa-solid fa-link"></i>';
                    btn.style.borderColor = '';
                    btn.style.color = '';
                }, 2000);
            }).catch(() => {
                // Fallback for older browsers
                const input = document.createElement('input');
                input.value = url;
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                document.body.removeChild(input);
                btn.innerHTML = '<i class="fa-solid fa-check"></i>';
                setTimeout(() => { btn.innerHTML = '<i class="fa-solid fa-link"></i>'; }, 2000);
            });
        });
        document.body.appendChild(btn);
    }

    // ── Inject CSS for Copy Link button ────────────────────────
    const style = document.createElement('style');
    style.textContent = `
        #copy-link-btn {
            position: fixed;
            bottom: 16px;
            right: 16px;
            z-index: 1200;
            width: 44px;
            height: 44px;
            border-radius: 14px;
            border: 1px solid rgba(59, 130, 246, 0.16);
            background: rgba(8, 20, 45, 0.82);
            backdrop-filter: blur(28px) saturate(160%);
            -webkit-backdrop-filter: blur(28px) saturate(160%);
            color: #93c5fd;
            font-size: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 20px 60px -15px rgba(0,0,0,0.8),
                        inset 0 1px 0 rgba(125,180,255,0.07),
                        0 0 40px -20px rgba(6,182,212,0.25);
            transition: all 0.2s ease;
        }
        #copy-link-btn:hover {
            border-color: rgba(6, 182, 212, 0.3);
            background: rgba(8, 20, 45, 0.92);
            color: #fff;
            transform: translateY(-1px);
        }
    `;
    document.head.appendChild(style);

    // ── Init ───────────────────────────────────────────────────
    // Wait for layers to initialize, then try to restore from hash
    setTimeout(() => {
        const wasRestored = restoreFromHash();
        if (!wasRestored) {
            // No hash — just start updating hash from current state
            scheduleHashUpdate();
        }
    }, 1500); // Give layers time to auto-init

    createCopyLinkButton();

    console.log('🔗 Permalink module loaded');
})();
