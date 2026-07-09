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

    // ── Copy Link button ───────────────────────────────────────
    function createButton() {
        const btn = document.createElement('button');
        btn.id = 'share-link-btn';
        btn.title = 'Copy shareable link';
        btn.innerHTML = '<i class="fa-solid fa-link"></i>';
        btn.addEventListener('click', () => {
            const url = buildUrl();
            const ta = document.createElement('textarea');
            ta.value = url;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (_) { }
            document.body.removeChild(ta);
            btn.innerHTML = '<i class="fa-solid fa-check"></i>';
            btn.style.color = '#34d399';
            btn.style.borderColor = 'rgba(52,211,153,0.5)';
            setTimeout(() => {
                btn.innerHTML = '<i class="fa-solid fa-link"></i>';
                btn.style.color = '';
                btn.style.borderColor = '';
            }, 2000);
        });
        document.body.appendChild(btn);
    }

    // ── CSS ─────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
        #share-link-btn {
            position: fixed; bottom: 16px; right: 16px; z-index: 1200;
            width: 44px; height: 44px; border-radius: 14px;
            border: 1px solid rgba(59,130,246,0.16);
            background: rgba(8,20,45,0.82);
            backdrop-filter: blur(28px) saturate(160%);
            -webkit-backdrop-filter: blur(28px) saturate(160%);
            color: #93c5fd; font-size: 16px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 20px 60px -15px rgba(0,0,0,0.8), inset 0 1px 0 rgba(125,180,255,0.07);
            transition: all 0.2s ease;
        }
        #share-link-btn:hover {
            border-color: rgba(6,182,212,0.3); background: rgba(8,20,45,0.92);
            color: #fff; transform: translateY(-1px);
        }
    `;
    document.head.appendChild(style);

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
