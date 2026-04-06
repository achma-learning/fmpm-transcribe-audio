// ==UserScript==
// @name         TurboScribe - Bulk Export All Folders v3
// @namespace    https://turboscribe.ai
// @version      4.2
// @description  Export all TurboScribe folders in all formats (PDF, DOCX, TXT, CSV, SRT, VTT) — twice per folder: once with Section Timestamps and once without.
// @author       Claude
// @match        https://turboscribe.ai/dashboard
// @match        https://turboscribe.ai/transcript/*
// @match        *://turboscribe.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'ts_bulk_export_state_v3';
    const FORMAT_NAMES = ['bool:pdf?', 'bool:docx?', 'bool:txt?', 'bool:csv?', 'bool:srt?', 'bool:vtt?'];
    const DELAY = {
        pageLoad: 5000,
        afterClick: 1500,
        afterHTMX: 4000,
        afterDownload: 3000,
        pollInterval: 500,
        betweenExports: 3000
    };

    // ─── State helpers ─────────────────────────────────────────────────
    const getState = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } };
    const setState = s => localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    const clearState = () => localStorage.removeItem(STORAGE_KEY);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const log = msg => console.log(`[TS-Export] ${msg}`);

    function waitFor(fn, timeout = 20000) {
        return new Promise((resolve, reject) => {
            const r = fn(); if (r) return resolve(r);
            const t0 = Date.now();
            const iv = setInterval(() => {
                const r = fn();
                if (r) { clearInterval(iv); resolve(r); }
                else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('waitFor timeout')); }
            }, DELAY.pollInterval);
        });
    }

    // ─── Are we on a folder page? ──────────────────────────────────────
    function isOnFolderPage() {
        return /\/dashboard\/folder\/\d+/.test(window.location.pathname);
    }

    // ─── Collect folder links from sidebar ─────────────────────────────
    function collectFolders() {
        // Target ONLY the desktop sidebar (hidden sm:block), not mobile sidebar or row menus
        const desktopSidebar = document.querySelector('.hidden.sm\\:block ul.dui-menu');
        // Fallback: any sidebar ul.dui-menu that contains folder links
        const sidebar = desktopSidebar || document.querySelector('ul.dui-menu');
        if (!sidebar) { log('ERROR: No sidebar found'); return []; }

        const links = sidebar.querySelectorAll('a[href*="/dashboard/folder/"]');
        const folders = [];
        const seenIds = new Set();

        for (const a of links) {
            const href = a.getAttribute('href') || '';
            // Extract folder ID (numeric) from the URL path
            const match = href.match(/\/dashboard\/folder\/(\d+)/);
            if (!match) continue;

            const folderId = match[1];
            if (seenIds.has(folderId)) continue;
            seenIds.add(folderId);

            const name = a.querySelector('span.line-clamp-1')?.textContent?.trim() || `folder-${folderId}`;
            // Build a clean URL without query params
            const cleanUrl = `${window.location.origin}/dashboard/folder/${folderId}`;
            folders.push({ href: cleanUrl, name, folderId });
        }

        log(`collectFolders: found ${links.length} links, ${folders.length} unique folders`);
        return folders;
    }

    // ─── Step 1: Click the three-dot button on the folder page ─────────
    // It's a button.dui-btn-circle INSIDE a div.dui-dropdown.dui-dropdown-end
    // that is NOT inside a table row and NOT inside the sidebar.
    // On folder pages it's next to the "TRANSCRIBE FILES" button.
    async function clickThreeDotButton() {
        log('  → Looking for three-dot button...');

        const btn = await waitFor(() => {
            // Get all dui-dropdown-end containers
            const dropdowns = document.querySelectorAll('.dui-dropdown.dui-dropdown-end');
            for (const dd of dropdowns) {
                // Skip if inside sidebar
                if (dd.closest('ul.dui-menu')) continue;
                if (dd.closest('nav')) continue;
                // Skip if inside a table row (per-file menus)
                if (dd.closest('tr')) continue;
                if (dd.closest('table')) continue;

                const btn = dd.querySelector('button');
                if (!btn) continue;

                // Verify it has the three-dot SVG (horizontal ellipsis)
                const pathEl = btn.querySelector('svg path');
                if (pathEl && pathEl.getAttribute('d')?.startsWith('M6 10a2')) {
                    return btn;
                }
            }
            return null;
        }, 10000);

        log('  → Found three-dot button, activating with Enter...');
        btn.focus();
        await sleep(300);
        btn.click();
        await sleep(200);
        // DaisyUI dropdowns respond to keyboard — simulate Enter key
        btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        btn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        btn.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));

        await sleep(DELAY.afterClick);

        // Now wait for the dropdown-content to become visible
        log('  → Waiting for dropdown menu to appear...');
        const dropdownContent = await waitFor(() => {
            const dd = btn.closest('.dui-dropdown');
            if (!dd) return null;
            const content = dd.querySelector('.dui-dropdown-content');
            if (content && content.offsetParent !== null) return content;
            // Also check style attribute
            if (content && content.style.display === 'block') return content;
            // Check if it has any <li> children loaded
            if (content && content.querySelectorAll('li').length > 0) return content;
            return null;
        }, 8000);

        log('  → Dropdown menu is visible');

        // Trigger HTMX lazy-loading of dropdown content by dispatching mouseover
        // The dropdown uses hx-trigger="intersect, mouseover from:#buttonId"
        btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        const dd = btn.closest('.dui-dropdown');
        if (dd) {
            dd.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            const innerDiv = dropdownContent.querySelector('[hx-post]');
            if (innerDiv) {
                innerDiv.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            }
        }
        // Give HTMX time to start loading
        await sleep(2000);

        return dropdownContent;
    }

    // ─── Step 2: Click "Export Folder" in the dropdown ──────────────────
    async function clickExportFolder(dropdownContent) {
        log('  → Looking for "Export Folder" option...');

        // Wait for HTMX to finish loading dropdown content
        // The dropdown starts with class="htmx-loading" and loads items async
        const exportSpan = await waitFor(() => {
            // Check if dropdown still has htmx-loading (content not ready)
            const loadingEl = dropdownContent.querySelector('.htmx-loading');
            if (loadingEl && dropdownContent.querySelectorAll('li').length < 2) {
                return null; // Still loading
            }

            // Search for "Export Folder" text in <p> tags
            const pTags = dropdownContent.querySelectorAll('p');
            for (const p of pTags) {
                if (p.textContent.trim() === 'Export Folder') return p;
            }

            // Broader search
            const allText = dropdownContent.querySelectorAll('li, div, span');
            for (const el of allText) {
                if (el.textContent.trim() === 'Export Folder' && el.children.length <= 1) {
                    return el;
                }
            }

            return null;
        }, 15000);

        if (!exportSpan) {
            throw new Error('"Export Folder" not found in dropdown after waiting. HTML: ' +
                dropdownContent.innerHTML.substring(0, 200));
        }

        log('  → Found "Export Folder", activating...');

        // The HTMX trigger is on the span[tabindex] inside the [role="link"] parent
        // From the HTML: <div role="link"> → <span tabindex="0"> → <div hx-post="..."> + <li>
        const roleLink = exportSpan.closest('[role="link"]') || exportSpan.closest('.inline-block');
        if (roleLink) {
            const triggerSpan = roleLink.querySelector('span[tabindex]');
            if (triggerSpan) {
                log('  → Triggering HTMX via focus + Enter + mousedown...');
                triggerSpan.focus();
                await sleep(300);
                triggerSpan.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                triggerSpan.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                triggerSpan.click();
                triggerSpan.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                triggerSpan.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                await sleep(DELAY.afterHTMX);
                return;
            }
        }

        // Fallback: click the element directly
        exportSpan.click();
        await sleep(DELAY.afterHTMX);
    }

    // ─── Step 3: Wait for the export modal with checkboxes ─────────────
    async function waitForModal() {
        log('  → Waiting for export modal...');
        return waitFor(() => {
            // Check for normal export modal (has PDF checkbox)
            const pdfCb = document.querySelector('input[name="bool:pdf?"]');
            if (pdfCb) {
                const modal = pdfCb.closest('.dui-modal-box') || pdfCb.closest('form');
                return modal || pdfCb;
            }
            // Also check for "No files in this folder" modal
            const modalBoxes = document.querySelectorAll('.dui-modal-box');
            for (const box of modalBoxes) {
                if (box.textContent.includes('No files in this folder')) {
                    log('  → Empty folder modal detected during waitForModal');
                    return box;
                }
            }
            return null;
        }, 20000);
    }

    // ─── Step 4: Check all format checkboxes ───────────────────────────
    function checkAllFormats() {
        let count = 0;
        for (const name of FORMAT_NAMES) {
            const cb = document.querySelector(`input[name="${name}"]`);
            if (cb && !cb.checked) { cb.click(); count++; }
        }
        log(`  → Checked ${count} format checkboxes`);
    }

    // ─── Step 5: Set timestamps checkbox ───────────────────────────────
    function setTimestamps(enable) {
        const cb = document.querySelector('input[name="bool:timestamps?"]');
        if (!cb) { log('  → WARNING: timestamps checkbox not found'); return; }
        const needsClick = (enable && !cb.checked) || (!enable && cb.checked);
        if (needsClick) cb.click();
        log(`  → Timestamps: ${enable ? 'ON' : 'OFF'}${needsClick ? ' (toggled)' : ' (already set)'}`);
    }

    // ─── Step 6: Click Download ────────────────────────────────────────
    async function clickDownload() {
        // Find the Download button inside the export modal
        // It's the submit button inside a dui-modal-box that is currently visible
        let btn = null;
        document.querySelectorAll('.dui-modal-box button[type="submit"]').forEach(b => {
            // Only consider visible buttons (the export modal one)
            if (b.offsetParent !== null || b.getBoundingClientRect().height > 0) {
                // Make sure it's the download button (has the download icon SVG or text)
                const text = b.textContent || '';
                if (text.includes('Download') || text.includes('Exporting')) {
                    btn = b;
                }
            }
        });
        if (!btn) {
            btn = document.querySelector('.dui-modal-box button[type="submit"].dui-btn-primary');
        }
        if (!btn) throw new Error('Download button not found');

        log(`  → Found Download button: id=${btn.id}, text="${btn.textContent.trim().substring(0, 30)}"`);

        // CRITICAL FIX: The Download button is type="submit" but it sits inside
        // the "Transcribe Files" upload form (which wraps much of the page).
        // We must NOT let the form submit. Instead, we:
        // 1. Change button type to "button" to prevent form submission
        // 2. Add a one-time submit blocker on the parent form
        // 3. Use focus + Enter to trigger TurboScribe's native click handler

        const parentForm = btn.closest('form');
        if (parentForm) {
            // Check if this is the WRONG form (upload/transcribe form, not export form)
            const hxPost = parentForm.getAttribute('hx-post') || '';
            if (hxPost.includes('dropzone') || hxPost.includes('create-account') ||
                parentForm.querySelector('input[name="json:handles"]')) {
                log('  → DETECTED: Download button is inside the wrong form (upload/transcribe form)');
                log('  → Blocking parent form submission and using keyboard Enter instead');

                // Block the parent form from submitting
                const submitBlocker = (e) => {
                    log('  → BLOCKED unwanted form submission to upload endpoint');
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    return false;
                };
                parentForm.addEventListener('submit', submitBlocker, true);

                // Focus and Enter the button (native keyboard events are isTrusted)
                btn.focus();
                await sleep(100);

                // Dispatch keyboard Enter
                const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
                btn.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
                btn.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
                btn.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

                // Also try click (TurboScribe's framework might handle click events on buttons)
                btn.click();

                log('  → Dispatched Enter key + click on Download button');

                // Remove the blocker after a short delay
                setTimeout(() => {
                    parentForm.removeEventListener('submit', submitBlocker, true);
                }, 5000);
                return;
            }
        }

        // If we found the correct export form (not the upload form), submit normally
        log('  → Download button is in correct form, clicking normally');
        btn.focus();
        await sleep(100);
        btn.click();
    }

    // ─── Step 7: Wait for download ─────────────────────────────────────
    // Returns: 'success' | 'empty' | 'timeout'
    async function waitForDownloadComplete() {
        log('  → Waiting for download...');
        await sleep(2000);

        const maxWait = 180000; // 3 min
        const t0 = Date.now();
        while (Date.now() - t0 < maxWait) {
            const modalBoxes = document.querySelectorAll('.dui-modal-box');
            for (const box of modalBoxes) {
                // SUCCESS: Export Complete
                if (box.textContent.includes('Export Complete')) {
                    log('  → "Export Complete" detected — download successful!');
                    await sleep(DELAY.afterDownload);
                    return 'success';
                }
                // EMPTY: No files in this folder
                if (box.textContent.includes('No files in this folder')) {
                    log('  → "No files in this folder" detected — skipping empty folder');
                    return 'empty';
                }
            }

            let busy = false;
            const submitBtn = document.querySelector('.dui-modal-box button[type="submit"]');
            if (submitBtn) {
                let el = submitBtn;
                while (el) {
                    if (el.classList?.contains('htmx-request')) { busy = true; break; }
                    el = el.parentElement;
                }
                if (submitBtn.textContent.includes('Exporting')) busy = true;
            }
            const spinner = document.querySelector('.dui-modal-box .dui-loading');
            if (spinner) {
                const parent = spinner.closest('div');
                if (parent && getComputedStyle(parent).display !== 'none') busy = true;
            }
            if (!busy) break;
            await sleep(1000);
        }
        await sleep(DELAY.afterDownload);
        log('  → Download finished (timeout/fallback)');
        return 'timeout';
    }

    // ─── Step 8: Close modal ───────────────────────────────────────────
    async function closeModal() {
        // Find all visible modal boxes and close them
        const modalBoxes = document.querySelectorAll('.dui-modal-box, label.dui-modal-box');
        for (const modal of modalBoxes) {
            // Only try to close visible modals
            if (modal.getBoundingClientRect().height === 0) continue;

            // Try X button (the close circle button)
            const xBtn = modal.querySelector('.dui-btn-circle.dui-btn-ghost, .dui-btn-circle');
            if (xBtn) {
                xBtn.click();
                await sleep(500);
                log('  → Modal closed (X button)');
            }

            // Also try label for= toggle (DaisyUI modal pattern)
            if (modal.tagName === 'LABEL') {
                const forId = modal.getAttribute('for');
                if (forId) {
                    const cb = document.getElementById(forId);
                    if (cb && cb.type === 'checkbox') {
                        cb.checked = false;
                        cb.dispatchEvent(new Event('change', {bubbles:true}));
                        await sleep(500);
                        log('  → Modal closed (checkbox toggle)');
                    }
                }
            }
        }

        // Also try the parent .dui-modal overlay (clicking outside)
        const overlays = document.querySelectorAll('.dui-modal');
        for (const overlay of overlays) {
            if (overlay.tagName === 'LABEL') {
                const forId = overlay.getAttribute('for');
                if (forId) {
                    const cb = document.getElementById(forId);
                    if (cb && cb.type === 'checkbox' && cb.checked) {
                        cb.checked = false;
                        cb.dispatchEvent(new Event('change', {bubbles:true}));
                    }
                }
            }
        }

        // Escape as final fallback
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', code:'Escape', bubbles:true}));
        await sleep(500);
    }

    // ─── Close dropdown by clicking elsewhere ──────────────────────────
    async function closeDropdown() {
        document.body.click();
        // Also blur any focused element
        if (document.activeElement) document.activeElement.blur();
        await sleep(500);
    }

    // ─── Single export (one timestamp setting) ─────────────────────────
    // Returns: 'success' | 'empty' | 'timeout'
    async function doSingleExport(withTimestamps) {
        const ddContent = await clickThreeDotButton();
        await clickExportFolder(ddContent);
        await waitForModal();
        await sleep(1500); // Wait for modal content to fully render

        // ── Check for empty folder BEFORE trying checkboxes ──
        const modalBoxes = document.querySelectorAll('.dui-modal-box');
        for (const box of modalBoxes) {
            if (box.textContent.includes('No files in this folder')) {
                log('  → Empty folder detected (no files) — skipping');
                await closeModal();
                await closeDropdown();
                await sleep(1000);
                return 'empty';
            }
        }

        checkAllFormats();
        setTimestamps(withTimestamps);
        await sleep(500);
        await clickDownload();
        const result = await waitForDownloadComplete();
        await closeModal();
        await closeDropdown();
        await sleep(DELAY.betweenExports);
        return result;
    }

    // ─── Process current folder ────────────────────────────────────────
    async function processCurrentFolder() {
        const state = getState();
        if (!state || !state.active) return;

        const folder = state.folders[state.currentIndex];
        const total = state.folders.length;
        const idx = state.currentIndex + 1;

        // ── CRITICAL: Verify we are on the correct folder page ──
        const expectedFolderId = folder.folderId;
        const currentPathMatch = window.location.pathname.match(/\/dashboard\/folder\/(\d+)/);
        const currentFolderId = currentPathMatch ? currentPathMatch[1] : null;

        if (currentFolderId !== expectedFolderId) {
            log(`Not on correct folder page. Current ID: ${currentFolderId}, Expected ID: ${expectedFolderId}`);
            log(`Navigating to ${folder.href}...`);
            updateUI(`Navigating to folder ${idx}/${total}: "${folder.name}"...`);
            window.location.href = folder.href;
            return; // Will resume after navigation
        }

        log(`On correct folder page: ${window.location.pathname}`);

        try {
            // ── Do ONE export per page load for a clean DOM each time ──
            const withTs = (state.phase === 'with_ts');
            const label = withTs ? 'WITH' : 'WITHOUT';
            updateUI(`[${idx}/${total}] "${folder.name}" — ${label} timestamps...`);
            log(`=== Folder ${idx}/${total}: "${folder.name}" — ${label} timestamps ===`);

            const result = await doSingleExport(withTs);

            // ── EMPTY FOLDER: skip both phases and move to next folder ──
            if (result === 'empty') {
                log(`  → Folder "${folder.name}" is empty — skipping to next folder`);
                updateUI(`⏭ Folder ${idx}/${total} "${folder.name}" is empty — skipping...`);
                state.currentIndex++;
                state.phase = 'with_ts';

                if (state.currentIndex < state.folders.length) {
                    setState(state);
                    const next = state.folders[state.currentIndex];
                    const nextIdx = state.currentIndex + 1;
                    await sleep(2000);
                    window.location.href = next.href;
                    return;
                } else {
                    clearState();
                    updateUI(`✅ Done! Exported all ${total} folders.`);
                    log('=== ALL FOLDERS EXPORTED ===');
                    document.getElementById('ts-export-stop').style.display = 'none';
                    document.getElementById('ts-export-start').style.display = 'block';
                    alert(`Export complete!\n${total} folders processed.`);
                    return;
                }
            }

            // ── Advance state ──
            if (state.phase === 'with_ts') {
                // Done with_ts → next is without_ts on SAME folder
                state.phase = 'without_ts';
                setState(state);
                log('  → Phase complete (with_ts). Reloading for without_ts...');
                updateUI(`[${idx}/${total}] "${folder.name}" — reloading for WITHOUT timestamps...`);
                await sleep(2000);
                window.location.reload();
                return;
            }

            // Done without_ts → move to NEXT folder
            state.currentIndex++;
            state.phase = 'with_ts';

            if (state.currentIndex < state.folders.length) {
                setState(state);
                const next = state.folders[state.currentIndex];
                const nextIdx = state.currentIndex + 1;
                log(`  → Folder ${idx} complete. Navigating to folder ${nextIdx}/${total}: "${next.name}"...`);
                updateUI(`✅ Folder ${idx} done! → Navigating to ${nextIdx}/${total}: "${next.name}"...`);
                await sleep(2000);
                window.location.href = next.href;
                return;
            } else {
                clearState();
                updateUI(`✅ Done! Exported all ${total} folders.`);
                log('=== ALL FOLDERS EXPORTED ===');
                document.getElementById('ts-export-stop').style.display = 'none';
                document.getElementById('ts-export-start').style.display = 'block';
                alert(`Export complete!\n${total} folders processed.`);
            }

        } catch (err) {
            console.error('[TS-Export] Error:', err);
            updateUI(`❌ Error: ${err.message} — Retrying in 10s...`);
            try { await closeModal(); } catch {}
            try { await closeDropdown(); } catch {}
            await sleep(10000);
            window.location.reload();
        }
    }

    // ─── UI ────────────────────────────────────────────────────────────
    function createUI() {
        const container = document.createElement('div');
        container.id = 'ts-export-ui';
        container.style.cssText = `
            position:fixed; bottom:20px; right:20px; z-index:999999;
            font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
            display:flex; flex-direction:column; gap:8px; align-items:flex-end;
        `;

        const status = document.createElement('div');
        status.id = 'ts-export-status';
        status.style.cssText = `
            background:#1a1a2e; color:#4ade80; padding:10px 16px;
            border-radius:10px; font-size:13px; font-family:monospace;
            display:none; max-width:450px; box-shadow:0 4px 20px rgba(0,0,0,0.4);
            border:1px solid #333; line-height:1.4;
        `;
        container.appendChild(status);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; gap:8px;';

        const stopBtn = document.createElement('button');
        stopBtn.id = 'ts-export-stop';
        stopBtn.textContent = '⏹ Stop';
        stopBtn.style.cssText = `
            background:#ef4444; color:white; border:none; padding:10px 18px;
            border-radius:10px; cursor:pointer; font-weight:600; font-size:14px;
            box-shadow:0 4px 12px rgba(239,68,68,0.4); display:none;
        `;
        stopBtn.onclick = () => {
            clearState();
            updateUI('⏹ Stopped.');
            stopBtn.style.display = 'none';
            document.getElementById('ts-export-start').style.display = 'block';
        };
        btnRow.appendChild(stopBtn);

        const startBtn = document.createElement('button');
        startBtn.id = 'ts-export-start';
        startBtn.innerHTML = '📦 Export All Folders';
        startBtn.style.cssText = `
            background:linear-gradient(135deg,#2563eb,#1d4ed8); color:white;
            border:none; padding:12px 22px; border-radius:10px; cursor:pointer;
            font-weight:700; font-size:14px; box-shadow:0 4px 16px rgba(37,99,235,0.5);
        `;
        startBtn.onclick = onStartClick;
        btnRow.appendChild(startBtn);

        container.appendChild(btnRow);
        document.body.appendChild(container);
    }

    function updateUI(msg) {
        const s = document.getElementById('ts-export-status');
        if (s) { s.style.display = 'block'; s.textContent = msg; }
        log(msg);
    }

    // ─── Start ─────────────────────────────────────────────────────────
    function onStartClick() {
        const folders = collectFolders();
        if (!folders.length) {
            alert('No folders found in the sidebar!\nMake sure folders are visible in the left panel.');
            return;
        }

        const msg = `Found ${folders.length} folders:\n\n` +
            folders.map((f, i) => `  ${i + 1}. ${f.name}`).join('\n') +
            `\n\nEach → 6 formats × 2 (with/without timestamps) = ${folders.length * 2} zip downloads.\n\nContinue?`;
        if (!confirm(msg)) return;

        setState({ active: true, folders, currentIndex: 0, phase: 'with_ts' });
        document.getElementById('ts-export-start').style.display = 'none';
        document.getElementById('ts-export-stop').style.display = 'block';

        // Navigate to first folder
        updateUI(`Navigating to folder 1/${folders.length}: "${folders[0].name}"...`);
        setTimeout(() => { window.location.href = folders[0].href; }, 500);
    }

    // ─── Resume ────────────────────────────────────────────────────────
    function resumeIfActive() {
        const state = getState();
        if (!state || !state.active) return;

        const startBtn = document.getElementById('ts-export-start');
        const stopBtn = document.getElementById('ts-export-stop');
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'block';

        const folder = state.folders[state.currentIndex];
        const idx = state.currentIndex + 1;
        updateUI(`Resuming [${idx}/${state.folders.length}]: "${folder?.name}" (${state.phase})...`);

        setTimeout(() => processCurrentFolder(), DELAY.pageLoad);
    }

    // ─── Init ──────────────────────────────────────────────────────────
    function init() {
        // Clean up old state keys from previous versions
        localStorage.removeItem('ts_bulk_export_state');

        createUI();
        resumeIfActive();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 1500);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(init, 1500));
    }

})();
