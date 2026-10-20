/*
 * MIT License
 * Copyright (C) 2026  Mobile-qbit contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/*
 * Glue code for the small screen ("phone") layout defined in css/mobile.css.
 *
 * Most of the responsive behaviour is pure CSS. This script only handles the
 * parts that MochaUI computes in JavaScript or that need interaction:
 *  - the menu button and the filters drawer of the phone layout
 *  - the "More actions" button of the torrent cards
 *  - fitting MochaUI windows (dialogs) into the viewport
 *  - row height of the torrents table when the virtual list is used
 *  - the browser's theme color (status bar of the app added to the home screen)
 */

"use strict";

window.qBittorrent ??= {};
window.qBittorrent.Mobile ??= (() => {
    const exports = () => {
        return {
            isMobileLayout: isMobileLayout,
            onLayoutChange: onLayoutChange,
            closeMenus: closeMenus,
            fitWindowToViewport: fitWindowToViewport
        };
    };

    // Keep in sync with the phone layout media queries in css/mobile.css
    const mobileLayoutQuery = window.matchMedia("(width <= 767px), (pointer: coarse) and (height <= 500px)");
    const isMobileLayout = () => mobileLayoutQuery.matches;

    const layoutChangeListeners = [];
    const onLayoutChange = (listener) => {
        layoutChangeListeners.push(listener);
    };

    // Height of the window title bar in the phone layout, large enough for touch
    const WINDOW_HEADER_HEIGHT = 40;
    // Space kept around windows that are not shown full screen
    const WINDOW_MARGIN = 8;
    // Height of a torrent "card" in the phone layout, used by the virtual list
    const TORRENT_CARD_HEIGHT = 84;

    /* Menus and drawer */

    const getElements = () => {
        return {
            backdrop: document.getElementById("mobileBackdrop"),
            filtersButton: document.getElementById("mobileFiltersButton"),
            filtersColumn: document.getElementById("filtersColumn"),
            menuButton: document.getElementById("mobileMenuButton"),
            navbar: document.getElementById("desktopNavbar")
        };
    };

    const updateBackdrop = () => {
        const { backdrop, filtersColumn, navbar } = getElements();
        const isOpen = navbar.classList.contains("mobileOpen") || (filtersColumn?.classList.contains("mobileOpen") ?? false);
        backdrop.classList.toggle("invisible", !isOpen);
    };

    // Keyboard and screen reader access. The entries of the menu panel and of the
    // filters drawer are links without href and spans, which can't be focused.
    // While a panel is open they get a tabindex, Enter and Space activate them,
    // focus moves into the panel and Tab keeps it there. Closing the panel brings
    // focus back to its button.
    const panelEntries = {
        desktopNavbar: ":scope > ul > li > a, li li > a, li li > div.anchor > label",
        filtersColumn: ".filterTitle, .filterList li > span.link"
    };
    let focusedPanel = null;

    const makeEntriesFocusable = (panel) => {
        for (const entry of panel.querySelectorAll(panelEntries[panel.id])) {
            // links without href report a tabIndex of 0, but can't be focused
            if (!entry.hasAttribute("tabindex") && !entry.matches("a[href]")) {
                entry.tabIndex = 0;
                entry.dataset.mobileFocusable = "";
            }
        }
    };

    const getFocusableElements = (panel) => {
        return [...panel.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")]
            .filter((element) => (element.tabIndex >= 0) && !element.disabled && (element.getClientRects().length > 0));
    };

    const focusPanel = (panel, button) => {
        makeEntriesFocusable(panel);
        // the filter lists are rebuilt when categories, tags or trackers change
        const observer = new MutationObserver(() => makeEntriesFocusable(panel));
        observer.observe(panel, { childList: true, subtree: true });
        focusedPanel = { panel, button, observer };

        getFocusableElements(panel)[0]?.focus({ preventScroll: true });
    };

    const releasePanelFocus = () => {
        if (focusedPanel === null)
            return;

        const { panel, button, observer } = focusedPanel;
        focusedPanel = null;
        observer.disconnect();
        // not if an entry moved the focus elsewhere, e.g. into a dialog
        const active = document.activeElement;
        if ((active === null) || (active === document.body) || panel.contains(active))
            button.focus({ preventScroll: true });

        for (const entry of panel.querySelectorAll("[data-mobile-focusable]")) {
            entry.removeAttribute("tabindex");
            delete entry.dataset.mobileFocusable;
        }
    };

    const onPanelKeyDown = (event) => {
        if (focusedPanel === null)
            return;

        const { panel } = focusedPanel;
        if (event.key === "Tab") {
            const elements = getFocusableElements(panel);
            const index = elements.indexOf(document.activeElement);
            const next = event.shiftKey
                ? ((index <= 0) ? elements.at(-1) : null)
                : (((index === -1) || (index === (elements.length - 1))) ? elements[0] : null);
            if ((next !== null) || (elements.length === 0)) {
                event.preventDefault();
                next?.focus();
            }
        }
        else if (((event.key === "Enter") || (event.key === " ")) && (event.target.dataset?.mobileFocusable !== undefined) && panel.contains(event.target)) {
            event.preventDefault();
            event.target.click();
        }
    };

    const closeMenus = () => {
        const { filtersButton, filtersColumn, menuButton, navbar } = getElements();
        if (navbar === null)
            return;

        releasePanelFocus();
        navbar.classList.remove("mobileOpen");
        for (const item of navbar.querySelectorAll(".mobileOpen"))
            item.classList.remove("mobileOpen");
        menuButton.setAttribute("aria-expanded", "false");

        filtersColumn?.classList.remove("mobileOpen");
        filtersButton.setAttribute("aria-expanded", "false");

        updateBackdrop();
    };

    const toggleMenu = () => {
        const { menuButton, navbar } = getElements();
        const open = !navbar.classList.contains("mobileOpen");
        closeMenus();
        if (open) {
            navbar.classList.add("mobileOpen");
            navbar.scrollTop = 0;
            menuButton.setAttribute("aria-expanded", "true");
            focusPanel(navbar, menuButton);
        }
        updateBackdrop();
    };

    const toggleFiltersDrawer = () => {
        const { filtersButton, filtersColumn } = getElements();
        if (!filtersColumn)
            return;

        const open = !filtersColumn.classList.contains("mobileOpen");
        closeMenus();
        if (open) {
            filtersColumn.classList.add("mobileOpen");
            filtersButton.setAttribute("aria-expanded", "true");
            focusPanel(filtersColumn, filtersButton);
        }
        updateBackdrop();
    };

    const setupMenus = () => {
        const { backdrop, filtersButton, menuButton, navbar } = getElements();

        menuButton.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleMenu();
        });

        // the filters column is created later on by MochaUI
        filtersButton.setAttribute("aria-controls", "filtersColumn");
        filtersButton.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleFiltersDrawer();
        });

        backdrop.addEventListener("click", (event) => {
            closeMenus();
        });

        // In the phone layout the top level menu entries (File, Edit, ...) work as an accordion
        for (const anchor of navbar.querySelectorAll(":scope > ul > li > a")) {
            anchor.addEventListener("click", (event) => {
                if (!isMobileLayout())
                    return;

                const item = anchor.parentElement;
                const open = !item.classList.contains("mobileOpen");
                for (const sibling of item.parentElement.children)
                    sibling.classList.remove("mobileOpen");
                item.classList.toggle("mobileOpen", open);
            });
        }

        // Close the menu once an entry was activated. Capture phase because
        // most entries stop the propagation of the click event.
        navbar.addEventListener("click", (event) => {
            if (!isMobileLayout() || !navbar.classList.contains("mobileOpen"))
                return;
            if (event.target.closest("li li") === null)
                return;

            // let the entry's own click handler run first (e.g. opening the file chooser)
            setTimeout(closeMenus, 0);
        }, true);

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape")
                closeMenus();
        });
        document.addEventListener("keydown", onPanelKeyDown);
    };

    const setupFiltersDrawer = () => {
        // Selecting a filter closes the drawer so the result is visible right away.
        // The filters column is created asynchronously, hence the event delegation.
        document.addEventListener("click", (event) => {
            if (!isMobileLayout())
                return;

            const filtersColumn = event.target.closest("#filtersColumn.mobileOpen");
            if (filtersColumn === null)
                return;
            if (event.target.closest(".categoryToggle, .filterTitle") !== null)
                return;
            if (event.target.closest(".filterList li") === null)
                return;

            setTimeout(closeMenus, 150);
        });
    };

    const setupDetailsPanel = () => {
        // Opening the details panel shrinks the torrent list, keep the selected torrent visible
        document.addEventListener("click", (event) => {
            if (!isMobileLayout() || (event.target.closest("#propertiesTabs, #propertiesPanel_collapseToggle") === null))
                return;

            setTimeout(() => {
                document.querySelector("#torrentsTableDiv tr.selected")?.scrollIntoView({ block: "nearest" });
            }, 50);
        });
    };

    /* Selecting several torrents without CTRL/SHIFT keys */

    const setupTorrentSelection = () => {
        const selectButton = document.getElementById("mobileSelectButton");
        const count = document.getElementById("mobileSelectionCount");
        let selectionObserver = null;

        const updateCount = () => {
            count.textContent = `✓ ${window.torrentsTable.selectedRowsIds().length}`;
        };

        const setSelectMode = (enabled) => {
            const table = window.torrentsTable;
            if (table?.tableBody === undefined)
                return;

            table.multiSelect = enabled;
            document.getElementById("desktopHeader").classList.toggle("torrentSelectMode", enabled);
            table.dynamicTableDiv.classList.toggle("selectMode", enabled);
            selectButton.setAttribute("aria-pressed", enabled.toString());

            if (enabled) {
                updateCount();
                // rows change class when they get (de)selected, also by the table itself
                selectionObserver ??= new MutationObserver(updateCount);
                selectionObserver.observe(table.tableBody, { attributeFilter: ["class"], childList: true, subtree: true });
            }
            else {
                selectionObserver?.disconnect();
            }
        };

        selectButton.addEventListener("click", (event) => {
            setSelectMode(!window.torrentsTable.multiSelect);
        });
        document.getElementById("mobileSelectionClose").addEventListener("click", (event) => {
            setSelectMode(false);
        });
        document.getElementById("mobileSelectAll").addEventListener("click", (event) => {
            window.torrentsTable.selectAll();
            updateCount();
        });
        document.getElementById("mobileSelectNone").addEventListener("click", (event) => {
            window.torrentsTable.deselectAll();
            window.torrentsTable.setRowClass();
            updateCount();
        });

        // leave the selection mode with the Transfers tab or the layout
        document.getElementById("mainWindowTabsList").addEventListener("click", (event) => {
            setSelectMode(false);
        });
        onLayoutChange(() => setSelectMode(false));
    };

    /* Theme color */

    // The theme-color meta tags follow the system's color scheme. The WebUI can be
    // set to another one, so use the header color of the scheme it actually shows.
    const setupThemeColor = () => {
        const metas = document.querySelectorAll("meta[name='theme-color']");
        const update = () => {
            const color = window.getComputedStyle(document.documentElement).getPropertyValue("--color-background-default").trim();
            if (color === "")
                return;
            for (const meta of metas)
                meta.content = color;
        };

        // color-scheme.js toggles the "dark" class
        new MutationObserver(update).observe(document.documentElement, { attributeFilter: ["class"] });
        update();
    };

    /* MochaUI windows */

    const getWindowChromeHeight = (instance) => {
        const { options } = instance;
        let height = options.headerHeight + options.footerHeight;
        if (instance.contentBorderEl) {
            const style = window.getComputedStyle(instance.contentBorderEl);
            height += Number.parseFloat(style.marginTop) + Number.parseFloat(style.marginBottom)
                + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
        }
        for (const toolbar of [instance.toolbarWrapperEl, instance.toolbar2WrapperEl]) {
            if (toolbar)
                height += toolbar.offsetHeight;
        }
        return height;
    };

    const isWindowShown = (instance) => {
        return (instance.windowEl !== undefined)
            && document.body.contains(instance.windowEl)
            && !instance.windowEl.classList.contains("windowClosed")
            && !instance.isMinimized;
    };

    const fitWindowToViewport = (instance) => {
        if (!instance?.contentWrapperEl || !isWindowShown(instance))
            return;

        const { contentWrapperEl, windowEl } = instance;
        const requested = instance.mobileRequestedSize;
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight;

        if (!isMobileLayout()) {
            if (!instance.isMobileFitted)
                return;

            // back to the regular layout: restore the original size
            instance.isMobileFitted = false;
            windowEl.classList.remove("mobileFullscreen");
            contentWrapperEl.style.width = `${Math.min(requested.width, (viewportWidth - 20))}px`;
            contentWrapperEl.style.height = `${Math.min(requested.height, (viewportHeight - getWindowChromeHeight(instance) - 20))}px`;
            instance.drawWindow();
            MUI.centerWindow(windowEl);
            return;
        }

        const chromeHeight = getWindowChromeHeight(instance);
        const availableWidth = viewportWidth - (2 * WINDOW_MARGIN);
        const availableHeight = viewportHeight - chromeHeight - (2 * WINDOW_MARGIN);

        // Big windows (options, add torrent, ...) are shown full screen,
        // small ones (prompts, confirmations) are centered.
        // Most windows were already narrowed down to the viewport width by
        // qBittorrent.Dialog.limitWidthToViewport(), so such a width counts as big.
        const isWide = requested.width >= (availableWidth - 4);
        const isFullscreen = (requested.width > (availableWidth * 1.5))
            || (requested.height > (availableHeight * 0.75))
            || (isWide && (requested.height >= (availableHeight * 0.4)));

        // Inputs are bigger in the phone layout, let small dialogs grow to fit their content
        let contentHeight = requested.height;
        try {
            const frameDocument = instance.iframeEl?.contentDocument;
            if ((frameDocument?.readyState === "complete") && (frameDocument.documentElement !== null))
                contentHeight = Math.max(contentHeight, frameDocument.documentElement.scrollHeight);
        }
        catch {
            // not accessible, keep the requested height
        }

        let width;
        let height;
        let left;
        let top;
        if (isFullscreen) {
            width = viewportWidth;
            height = viewportHeight - chromeHeight;
            left = 0;
            top = 0;
        }
        else {
            width = Math.min(requested.width, availableWidth);
            height = Math.min(contentHeight, availableHeight);
            left = Math.round((viewportWidth - width) / 2);
            top = Math.max(WINDOW_MARGIN, Math.round((viewportHeight - height - chromeHeight) / 3));
        }

        instance.isMobileFitted = true;
        windowEl.classList.toggle("mobileFullscreen", isFullscreen);
        contentWrapperEl.style.width = `${Math.max(width, 0)}px`;
        contentWrapperEl.style.height = `${Math.max(height, 0)}px`;
        instance.drawWindow();
        windowEl.style.left = `${left}px`;
        windowEl.style.top = `${top}px`;
    };

    const fitAllWindows = () => {
        for (const instance of Object.values(MUI.Windows.instances))
            fitWindowToViewport(instance);
    };

    const patchMochaWindows = () => {
        const newWindow = MUI.Window.prototype.newWindow;
        MUI.Window.prototype.newWindow = function(...args) {
            const { options } = this;
            // MooTools' Hash.get() returns null for unknown keys
            const isNew = (MUI.Windows.instances.get(options.id) ?? null) === null;

            if (isNew) {
                this.mobileRequestedSize = {
                    width: options.width,
                    height: options.height
                };

                if (isMobileLayout()) {
                    // touch friendly title bar, no dragging or resizing on small screens
                    if (options.headerHeight > 0)
                        options.headerHeight = WINDOW_HEADER_HEIGHT;
                    options.footerHeight = 0;
                    options.draggable = false;
                    options.resizable = false;
                    options.maximizable = false;
                }
            }

            const result = newWindow.apply(this, args);

            if (isNew && (MUI.Windows.instances.get(options.id) === this)) {
                fitWindowToViewport(this);
                // dialogs loaded in an iframe may need more room once their content is known
                this.iframeEl?.addEventListener("load", () => {
                    if (isMobileLayout())
                        fitWindowToViewport(this);
                });
            }

            return result;
        };
    };

    /* Torrents table */

    const updateTorrentsTableRowHeight = (table) => {
        if (!table?.useVirtualList || (table.rowHeight === undefined))
            return;

        table.desktopRowHeight ??= table.rowHeight;
        const rowHeight = isMobileLayout() ? TORRENT_CARD_HEIGHT : table.desktopRowHeight;
        if (table.rowHeight === rowHeight)
            return;

        table.rowHeight = rowHeight;
        table.rerender();
    };

    // A long press isn't discoverable: the cards also get a "More actions" (⋮) button
    // that opens the same menu. In selection mode the menu acts on the selection,
    // which the torrent of the card is added to.
    const openRowMenu = (table, tr, event) => {
        // the row's own handlers would change the selection and close the menu again
        event.stopPropagation();

        if (!table.isRowSelected(tr.rowId)) {
            if (!table.multiSelect)
                table.deselectAll();
            table.selectRow(tr.rowId);
        }
        table.contextMenu?.triggerMenu(event, tr);
    };

    const addMoreActionsButton = (table, tr) => {
        // rows of the virtual list are reused, and reordering the columns drops the cell
        if (tr.querySelector(":scope > td.mobileMoreCell") !== null)
            return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "mobileMoreButton";
        button.title = "QBT_TR(More actions)QBT_TR[CONTEXT=MainWindow]";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-haspopup", "menu");
        button.addEventListener("click", (event) => {
            openRowMenu(table, tr, event);
        });
        // a quick second tap must not run the double click action of the row
        button.addEventListener("dblclick", (event) => {
            event.stopPropagation();
        });

        // after the column cells, so their indexes don't change; hidden outside the card layout
        const td = document.createElement("td");
        td.className = "mobileMoreCell";
        td.append(button);
        tr.append(td);
    };

    const patchTorrentsTable = () => {
        const TorrentsTable = window.qBittorrent.DynamicTable?.TorrentsTable;
        if (TorrentsTable === undefined)
            return;

        const setup = TorrentsTable.prototype.setup;
        TorrentsTable.prototype.setup = function(...args) {
            const result = setup.apply(this, args);
            updateTorrentsTableRowHeight(this);
            return result;
        };
        onLayoutChange(() => updateTorrentsTableRowHeight(window.torrentsTable));

        const updateRowElement = TorrentsTable.prototype.updateRowElement;
        TorrentsTable.prototype.updateRowElement = function(tr, ...args) {
            const result = updateRowElement.call(this, tr, ...args);
            addMoreActionsButton(this, tr);
            return result;
        };
    };

    /* Initialization */

    const init = () => {
        if (window.MUI?.Window !== undefined)
            patchMochaWindows();
        patchTorrentsTable();

        mobileLayoutQuery.addEventListener("change", () => {
            for (const listener of layoutChangeListeners)
                listener(isMobileLayout());
        });
        onLayoutChange(() => {
            closeMenus();
            if (window.MUI?.Windows !== undefined)
                fitAllWindows();
        });

        let resizeTimer = -1;
        window.addEventListener("resize", () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (isMobileLayout() && (window.MUI?.Windows !== undefined))
                    fitAllWindows();
            }, 150);
        });

        if (document.getElementById("mobileBar") !== null) {
            window.addEventListener("DOMContentLoaded", () => {
                setupMenus();
                setupFiltersDrawer();
                setupDetailsPanel();
                setupTorrentSelection();
                setupThemeColor();
            });
        }
    };

    init();

    return exports();
})();
Object.freeze(window.qBittorrent.Mobile);
