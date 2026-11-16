// ═══════════════════════════════════════════════════════════════
// SHARE MODULE — shareable link (URL hash) for map state
// ═══════════════════════════════════════════════════════════════
// Loaded FIRST so window._sharedState is available to the init code
// (app.js applyDateRangeFromMetadata + multi-layer.js auto-init read it
//  as the single source of truth for the initial date and layers).
//
// This module itself only does PASSIVE work that doesn't fight init:
//   - parse the hash once (synchronously, on load)
//   - restore map view (center/zoom) + basemap
//   - add a "Copy Link" button
//   - write the hash on state changes (debounced, replaceState)
//
// REVERT: remove this file + its <script> tag, and remove the two
// small "shared state" reads in app.js and multi-layer.js.
// ═══════════════════════════════════════════════════════════════

// ── Parse hash synchronously (before any init runs) ────────────
window._sharedState = (function () {
    const h = window.location.hash.slice(1);
    if (!h) return null;
    const params = new URLSearchParams(h);
    const s = {};
    for (const [k, v] of params.entries()) s[k] = v;
    return s;
})();

(function () {
    'use strict';

    // ── Build current state ────────────────────────────────────
    function encodeState() {
        const state = {};
        if (window.map) {
            const c = window.map.getCenter().wrap();
            state.lat = c.lat.toFixed(4);
            state.lng = c.lng.toFixed(4);
            state.z = window.map.getZoom();
        }
        const timeSelect = document.getElementById('time-select');
        if (timeSelect && timeSelect.value) state.t = timeSelect.value;

        if (typeof window.activeLayers !== 'undefined' && window.activeLayers.size > 0) {
            state.layers = Array.from(window.activeLayers.keys()).join(',');
        }
        if (window.currentBaseMapId) state.base = window.currentBaseMapId;

        // Open GetFeatureInfo popups (read-only): share just the clicked points.
        // Each point's values + charts are re-queried live on restore.
        if (typeof window.getClickPoints === 'function') {
            const pts = window.getClickPoints();
            if (pts && pts.length > 0) {
                state.pts = pts.map(p => `${p.lat},${p.lng}`).join(';');
            }
        }

        // Open Country Info panel (land click) — share its clicked point so the
        // panel reopens and re-queries country data live on restore.
        if (typeof window.getOpenCountryPoint === 'function') {
            const cp = window.getOpenCountryPoint();
            if (cp) state.ci = `${cp.lat},${cp.lng}`;
        }
        return state;
    }

    function buildUrl() {
        const params = new URLSearchParams();
        const state = encodeState();
        Object.entries(state).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') params.set(k, v);
        });
        return window.location.origin + window.location.pathname + '#' + params.toString();
    }

    // ── Write hash on changes (passive, debounced) ─────────────
    let hashTimer = null;
    function scheduleHashUpdate() {
        clearTimeout(hashTimer);
        hashTimer = setTimeout(() => {
            history.replaceState(null, '', buildUrl());
        }, 600);
    }

    // ── Restore map view + basemap (does not affect layers/date) ─
    function restoreView() {
        const s = window._sharedState;
        if (!s || !window.map) return;
        if (s.base && window.setBaseMap && window.BASEMAP_OPTIONS && window.BASEMAP_OPTIONS[s.base]) {
            window.setBaseMap(s.base);
            const sel = document.getElementById('basemap-select');
            if (sel) sel.value = s.base;
        }
        if (s.lat && s.lng && s.z) {
            window.map.setView([parseFloat(s.lat), parseFloat(s.lng)], parseInt(s.z));
        }
    }

    // ── Restore shared GetFeatureInfo popups ───────────────────
    // Replays each clicked point once an overlay WMS layer is actually on the
    // map (getFeatureInfo bails out with no visible overlay). Read-only: it just
    // re-issues the same query a user click would. Gives up after ~20s.
    function restoreClickPoints() {
        const s = window._sharedState;
        if (!s) return;
        const haveSeaPts = s.pts && typeof window.restoreClickPoint === 'function';
        const haveCountryPt = s.ci && typeof window.restoreCountryPoint === 'function';
        if (!haveSeaPts && !haveCountryPt) return;

        const points = (haveSeaPts ? s.pts.split(';') : []).map(pair => {
            const [lat, lng] = pair.split(',').map(parseFloat);
            return (isFinite(lat) && isFinite(lng)) ? { lat, lng } : null;
        }).filter(Boolean);

        let countryPt = null;
        if (haveCountryPt) {
            const [lat, lng] = s.ci.split(',').map(parseFloat);
            if (isFinite(lat) && isFinite(lng)) countryPt = { lat, lng };
        }
        if (points.length === 0 && !countryPt) return;
        console.log('🔗 restoreClickPoints: will restore', points.length, 'sea point(s) and',
            countryPt ? '1 country point' : 'no country point');

        function hasVisibleOverlay() {
            if (!window.map || typeof window.map.eachLayer !== 'function') return false;
            let count = 0;
            window.map.eachLayer(layer => {
                if (layer && layer.wmsParams && layer.wmsParams.layers) count++;
            });
            return count > 0;
        }

        let tries = 0;
        const poll = setInterval(() => {
            tries++;
            if (hasVisibleOverlay()) {
                clearInterval(poll);
                console.log('🔗 restoreClickPoints: overlay ready after', tries * 100, 'ms — replaying');
                // Small delay so layer params (TIME etc.) are fully settled.
                setTimeout(() => {
                    points.forEach(p => window.restoreClickPoint(p.lat, p.lng));
                    if (countryPt) window.restoreCountryPoint(countryPt.lat, countryPt.lng);
                }, 800);
            } else if (tries > 300) {
                clearInterval(poll);
                console.warn('🔗 restoreClickPoints: gave up waiting for a visible overlay layer (30s)');
            }
        }, 100);
    }

    // ── Copy Link button ───────────────────────────────────────
    function createButton() {
        const btn = document.createElement('button');
        btn.id = 'share-link-btn';
        btn.title = 'Copy shareable link';
        btn.setAttribute('aria-label', 'Copy shareable link');
        btn.innerHTML = '<i class="fa-solid fa-link"></i>';

        // Green check confirmation, then restore after 2s (identical in both paths).
        function showCopied() {
            btn.innerHTML = '<i class="fa-solid fa-check"></i>';
            btn.style.color = '#34d399';
            btn.style.borderColor = 'rgba(52,211,153,0.5)';
            if (typeof window.showToast === 'function') window.showToast('Link copied', 'success');
            setTimeout(() => {
                btn.innerHTML = '<i class="fa-solid fa-link"></i>';
                btn.style.color = '';
                btn.style.borderColor = '';
            }, 2000);
        }

        // Legacy fallback for insecure contexts / older browsers.
        function copyFallback(url) {
            const ta = document.createElement('textarea');
            ta.value = url;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (_) { }
            document.body.removeChild(ta);
            showCopied();
        }

        btn.addEventListener('click', () => {
            const url = buildUrl();
            // Try the async Clipboard API first (secure contexts / modern browsers).
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url)
                    .then(showCopied)
                    .catch(() => copyFallback(url));
            } else {
                copyFallback(url);
            }
        });
        document.body.appendChild(btn);
    }

    // ── CSS moved to styles.css (#share-link-btn) ───────────────

    // ── Init passive parts once DOM + map are ready ────────────
    function init() {
        createButton();
        // Restore view once map exists
        let tries = 0;
        const poll = setInterval(() => {
            tries++;
            if (window.map) {
                clearInterval(poll);
                restoreView();
                // Attach change listeners for hash writing
                window.map.on('moveend', scheduleHashUpdate);
                const ts = document.getElementById('time-select');
                if (ts) ts.addEventListener('change', scheduleHashUpdate);
                const panel = document.getElementById('active-layers-panel');
                if (panel) new MutationObserver(scheduleHashUpdate)
                    .observe(panel, { childList: true, subtree: true });
                // Open/close of GetFeatureInfo popups → update hash
                window.onClickPointsChange = scheduleHashUpdate;
                // Open/close of Country Info panel → update hash
                window.onCountryInfoChange = scheduleHashUpdate;
                // Re-open shared popups once layers are ready
                restoreClickPoints();
            } else if (tries > 50) {
                clearInterval(poll);
            }
        }, 100);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    console.log('🔗 Share module loaded', window._sharedState ? '(restoring shared state)' : '');
})();
