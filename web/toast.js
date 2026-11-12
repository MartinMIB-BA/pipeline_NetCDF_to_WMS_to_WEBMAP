// ═══════════════════════════════════════════════════════════════
// TOAST + ONBOARDING MODULE (U3 + U4)
//   U3: window.showToast(message, type, durationMs) — a reusable,
//       non-blocking, auto-dismissing bottom-center toast.
//   U4: first-load onboarding hint card prompting the user to pick a
//       layer; dismissal persisted in localStorage.
// Build-less vanilla JS, no modules. Loaded BEFORE share.js/app.js so
// window.showToast is defined before any consumer script runs.
//
// REVERT: remove this file + its <script> tag, drop the toast CSS and
// onboarding CSS sections in styles.css, and remove the showToast call
// sites in app.js / share.js plus the maybeHideOnboarding() hook in
// multi-layer.js.
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // ── Toast (U3) ─────────────────────────────────────────────
    var VALID_TYPES = { info: 1, success: 1, warning: 1, error: 1 };

    function getContainer() {
        var el = document.getElementById('toast-container');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast-container';
            document.body.appendChild(el);
        }
        return el;
    }

    function showToast(message, type, durationMs) {
        if (!VALID_TYPES[type]) type = 'info';
        if (typeof durationMs !== 'number' || durationMs <= 0) durationMs = 3000;

        var container = getContainer();
        var toast = document.createElement('div');
        toast.className = 'toast toast--' + type;
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.textContent = String(message);
        container.appendChild(toast);

        // Force a reflow so the enter transition runs from the hidden state.
        // eslint-disable-next-line no-unused-expressions
        toast.offsetHeight;
        toast.classList.add('toast--visible');

        var removed = false;
        function remove() {
            if (removed) return;
            removed = true;
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }

        setTimeout(function () {
            toast.classList.remove('toast--visible');
            // Remove after the exit transition; a setTimeout fallback
            // guarantees cleanup when there is no transition (reduced motion).
            var done = false;
            function onEnd() {
                if (done) return;
                done = true;
                toast.removeEventListener('transitionend', onEnd);
                remove();
            }
            toast.addEventListener('transitionend', onEnd);
            setTimeout(onEnd, 400);
        }, durationMs);
    }

    window.showToast = showToast;

    // ── Onboarding empty-state (U4) ────────────────────────────
    var ONBOARDING_KEY = 'wms_onboarding_dismissed';

    function onboardingDismissed() {
        try {
            return localStorage.getItem(ONBOARDING_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    function persistDismissal() {
        try {
            localStorage.setItem(ONBOARDING_KEY, '1');
        } catch (e) {
            /* storage unavailable (private mode) — card still hides for the session */
        }
    }

    function anyLayerActive() {
        return !!(window.activeLayers && window.activeLayers.size > 0);
    }

    function removeCard() {
        var card = document.getElementById('onboarding-card');
        if (card && card.parentNode) card.parentNode.removeChild(card);
    }

    function dismissOnboarding() {
        removeCard();
        persistDismissal();
    }

    // Hide (without persisting) when a layer becomes active.
    function maybeHideOnboarding() {
        if (anyLayerActive()) removeCard();
    }

    function initOnboarding() {
        if (onboardingDismissed()) return;
        if (anyLayerActive()) return;
        if (document.getElementById('onboarding-card')) return;

        var card = document.createElement('div');
        card.id = 'onboarding-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-label', 'Getting started');

        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'onboarding-close';
        closeBtn.setAttribute('aria-label', 'Dismiss hint');
        closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';

        var heading = document.createElement('div');
        heading.className = 'onboarding-heading';
        heading.textContent = 'Get started';

        var text = document.createElement('p');
        text.className = 'onboarding-text';
        text.textContent = 'Select a layer from the panel to view forecast data.';

        var hint = document.createElement('div');
        hint.className = 'onboarding-hint';
        hint.innerHTML = '<i class="fa-solid fa-arrow-up"></i><span>Layers are in the bar at the top-right.</span>';

        var gotIt = document.createElement('button');
        gotIt.type = 'button';
        gotIt.className = 'onboarding-gotit';
        gotIt.textContent = 'Got it';

        card.appendChild(closeBtn);
        card.appendChild(heading);
        card.appendChild(text);
        card.appendChild(hint);
        card.appendChild(gotIt);

        closeBtn.addEventListener('click', dismissOnboarding);
        gotIt.addEventListener('click', dismissOnboarding);

        document.body.appendChild(card);
    }

    window.initOnboarding = initOnboarding;
    window.maybeHideOnboarding = maybeHideOnboarding;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initOnboarding);
    } else {
        initOnboarding();
    }
})();
