// ═══════════════════════════════════════════════════════════════
// Theme toggle (V1) — light/dark switch for the Coastal WMS viewer.
// The FOUC-critical part (applying a stored theme before first paint)
// lives inline in index.html <head>. This file only wires the toggle
// button: sets the initial icon and flips/persists the theme on click.
// Build-less vanilla JS, no modules.
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var STORAGE_KEY = 'wms_theme';

    // The currently effective theme: an explicit [data-theme] wins,
    // otherwise fall back to the OS preference (default is dark).
    function effectiveTheme() {
        var manual = document.documentElement.dataset.theme;
        if (manual === 'light' || manual === 'dark') {
            return manual;
        }
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            return 'light';
        }
        return 'dark';
    }

    // Icon reflects the CURRENT theme: moon in dark, sun in light.
    function setIcon(btn, theme) {
        var icon = btn.querySelector('i');
        if (!icon) {
            return;
        }
        icon.classList.remove('fa-moon', 'fa-sun');
        icon.classList.add(theme === 'light' ? 'fa-sun' : 'fa-moon');
    }

    function init() {
        var btn = document.getElementById('theme-toggle-btn');
        if (!btn) {
            return;
        }

        setIcon(btn, effectiveTheme());

        btn.addEventListener('click', function () {
            var next = effectiveTheme() === 'light' ? 'dark' : 'light';
            document.documentElement.dataset.theme = next;
            setIcon(btn, next);
            try {
                localStorage.setItem(STORAGE_KEY, next);
            } catch (e) {
                /* storage unavailable (private mode) — toggle still works for the session */
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
