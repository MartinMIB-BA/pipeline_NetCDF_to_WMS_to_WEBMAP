document.addEventListener('DOMContentLoaded', () => {

    // Helper to make a panel draggable
    function makeDraggable(panel, handle) {
        if (!panel || !handle) return;

        let isDragging = false;
        let pendingDrag = false;
        let startX, startY, initialLeft, initialTop, initialRect;
        const DRAG_THRESHOLD_PX = 4;

        handle.addEventListener('pointerdown', (e) => {
            // Do not drag if clicking on a button inside the handle (like the minimize button)
            if (e.target.closest('button, select, input, textarea, label, option')) return;

            pendingDrag = true;
            isDragging = false;
            startX = e.clientX;
            startY = e.clientY;

            initialRect = panel.getBoundingClientRect();
            initialLeft = initialRect.left;
            initialTop = initialRect.top;

            handle.setPointerCapture(e.pointerId);
        });

        handle.addEventListener('pointermove', (e) => {
            if (!pendingDrag && !isDragging) return;

            // Prevent touch actions like scrolling while dragging
            e.preventDefault();

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // Only start dragging after a small pointer movement threshold.
            if (!isDragging) {
                if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
                isDragging = true;
                pendingDrag = false;

                // Detach from layout and clear transform so position is predictable.
                panel.style.position = 'fixed';
                panel.style.margin = '0';
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                panel.style.transform = 'none';
                panel.style.left = initialRect.left + 'px';
                panel.style.top = initialRect.top + 'px';
                panel.style.width = initialRect.width + 'px';
                panel.style.transition = 'none';
            }

            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            // Constrain to window dimensions
            const rect = panel.getBoundingClientRect();
            if (newLeft < 0) newLeft = 0;
            if (newTop < 0) newTop = 0;
            if (newLeft + rect.width > window.innerWidth) newLeft = window.innerWidth - rect.width;
            if (newTop + rect.height > window.innerHeight) newTop = window.innerHeight - rect.height;

            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
        });

        handle.addEventListener('pointerup', (e) => {
            pendingDrag = false;
            if (!isDragging) {
                try { handle.releasePointerCapture(e.pointerId); } catch (_) { }
                return;
            }
            isDragging = false;
            handle.releasePointerCapture(e.pointerId);
            panel.style.transition = ''; // Restore any potential CSS transitions
            panel.dataset.userPositioned = '1';
        });
    }

    function isVisible(el) {
        return !!(el && el.offsetParent !== null);
    }

    function getLeafletZoomRect() {
        const zoom = document.querySelector('.leaflet-top.leaflet-left .leaflet-control-zoom');
        return zoom ? zoom.getBoundingClientRect() : null;
    }

    // Keep top widgets from overlapping across monitor sizes.
    function autoLayoutTopPanels() {
        const layersPanel = document.querySelector('.layers-panel');
        const uiContainer = document.querySelector('.ui-container');
        const bottomPanel = document.getElementById('bottom-glass-panel');
        if (!layersPanel || !uiContainer) return;

        const margin = 12;
        const gap = 12;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const zoomRect = getLeafletZoomRect();
        const zoomRight = zoomRect ? zoomRect.right : margin;
        const zoomHeight = zoomRect ? zoomRect.height : 0;
        const leftAnchor = Math.max(margin, zoomRight + gap);

        const bottomUserPositioned = bottomPanel && bottomPanel.dataset.userPositioned === '1';
        if (!bottomUserPositioned && isVisible(uiContainer)) {
            uiContainer.style.position = 'fixed';
            uiContainer.style.top = margin + 'px';
            uiContainer.style.left = leftAnchor + 'px';
            uiContainer.style.right = 'auto';
            uiContainer.style.transform = 'none';
        }

        if (!isVisible(layersPanel) || layersPanel.dataset.userPositioned === '1') return;

        const uiRect = isVisible(uiContainer) ? uiContainer.getBoundingClientRect() : null;
        const rightStart = Math.max(leftAnchor, uiRect ? (uiRect.right + gap) : leftAnchor);
        const maxWidth = viewportWidth - rightStart - margin;
        const rowHeight = Math.max(zoomHeight, uiRect ? uiRect.height : 0);

        layersPanel.style.position = 'fixed';
        layersPanel.style.right = 'auto';
        layersPanel.style.bottom = 'auto';
        layersPanel.style.transform = 'none';

        if (maxWidth >= 360) {
            layersPanel.style.top = margin + 'px';
            layersPanel.style.left = rightStart + 'px';
            layersPanel.style.width = Math.min(920, maxWidth) + 'px';
            return;
        }

        // Fallback on narrow screens: place Data Layers below the first row.
        const stackedTop = Math.min(viewportHeight - 120, margin + rowHeight + gap);
        layersPanel.style.top = Math.max(margin, stackedTop) + 'px';
        layersPanel.style.left = margin + 'px';
        layersPanel.style.width = Math.min(920, Math.max(320, viewportWidth - (margin * 2))) + 'px';
    }

    // Connect drag functionality to the side layers panel
    const layersPanel = document.querySelector('.layers-panel');
    const layersDragHandle = document.getElementById('layers-panel-drag-handle');
    makeDraggable(layersPanel, layersDragHandle);

    // Connect drag functionality to the bottom UI dock panel
    const bottomPanel = document.getElementById('bottom-glass-panel');
    const bottomDragHandle = document.getElementById('bottom-panel-drag-handle');
    makeDraggable(bottomPanel, bottomDragHandle);

    // -------------------------------------------------------------------------
    // Minimize / Restore Functionality
    // -------------------------------------------------------------------------

    const btnMinimizeLayers = document.getElementById('minimize-layers-panel');
    const btnRestoreLayers = document.getElementById('restore-layers-panel');

    const btnMinimizeBottom = document.getElementById('minimize-bottom-panel');
    const btnRestoreBottom = document.getElementById('restore-bottom-panel');

    // Store original display properties so we can restore correctly
    let layersPanelOriginalDisplay = layersPanel ? window.getComputedStyle(layersPanel).display : 'flex';
    let bottomPanelOriginalDisplay = bottomPanel ? window.getComputedStyle(bottomPanel).display : 'block';

    if (btnMinimizeLayers && btnRestoreLayers && layersPanel) {
        btnMinimizeLayers.addEventListener('click', () => {
            layersPanel.style.display = 'none';
            btnRestoreLayers.style.display = 'flex';
        });

        btnRestoreLayers.addEventListener('click', () => {
            layersPanel.style.display = layersPanelOriginalDisplay;
            btnRestoreLayers.style.display = 'none';
            autoLayoutTopPanels();
        });
    }

    if (btnMinimizeBottom && btnRestoreBottom && bottomPanel) {
        btnMinimizeBottom.addEventListener('click', () => {
            bottomPanel.style.display = 'none';
            btnRestoreBottom.style.display = 'flex';
        });

        btnRestoreBottom.addEventListener('click', () => {
            bottomPanel.style.display = bottomPanelOriginalDisplay;
            btnRestoreBottom.style.display = 'none';
            autoLayoutTopPanels();
        });
    }

    // Initial layout and resize handling.
    requestAnimationFrame(autoLayoutTopPanels);
    setTimeout(autoLayoutTopPanels, 120);
    window.addEventListener('resize', autoLayoutTopPanels);
});
