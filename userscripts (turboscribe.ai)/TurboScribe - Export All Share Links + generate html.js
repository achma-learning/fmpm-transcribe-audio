// ==UserScript==
// @name         TurboScribe - Export All Share Links v2
// @namespace    https://turboscribe.ai
// @version      2.1
// @description  Collect share links for every transcript in every folder. Folder picker, merge with existing JSON, outputs .txt/.json/.html. Crash-resilient, auto-retry, progress bar + ETA.
// @author       Claude
// @match        https://turboscribe.ai/dashboard*
// @match        https://turboscribe.ai/transcript/*
// @match        *://turboscribe.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════
    //  CONFIG
    // ═══════════════════════════════════════════════════════════════════
    const STORAGE_KEY = 'ts_share_links_v2';
    const MAX_RETRIES = 3;
    const DELAY = {
        pageLoad:    5000,
        afterClick:  1500,
        afterHTMX:   4000,
        pollInterval: 500,
        scrollWait:  2000,
        navigation:  1500,
        retryPause:  8000,
    };

    // ═══════════════════════════════════════════════════════════════════
    //  UTILITIES
    // ═══════════════════════════════════════════════════════════════════
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const log   = msg => console.log(`[TS-Share-v2] ${msg}`);
    const now   = () => Date.now();

    function getState()  { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } }
    function setState(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
    function clearState() { localStorage.removeItem(STORAGE_KEY); }

    /** Patch a single field without serializing the whole state twice */
    function patchState(updates) {
        const s = getState();
        if (!s) return;
        Object.assign(s, updates);
        setState(s);
        return s;
    }

    function waitFor(fn, timeout = 20000) {
        return new Promise((resolve, reject) => {
            const r = fn(); if (r) return resolve(r);
            const t0 = now();
            const iv = setInterval(() => {
                const r = fn();
                if (r) { clearInterval(iv); resolve(r); }
                else if (now() - t0 > timeout) { clearInterval(iv); reject(new Error('waitFor timeout')); }
            }, DELAY.pollInterval);
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  STATE STRUCTURE
    // ═══════════════════════════════════════════════════════════════════
    //
    //  {
    //    active: true,
    //    startedAt: <epoch ms>,
    //    completedOps: 0,          // total share-link extractions done (for ETA)
    //    totalOps: 0,              // estimated total (updated as we discover transcripts)
    //
    //    folders: [ { name, href, folderId } ],
    //    currentFolder: 0,
    //
    //    // Per-folder transcript list (populated when we land on a folder page)
    //    transcripts: [ { name, href } ],
    //    currentTranscript: 0,
    //
    //    // Collected links — saved INCREMENTALLY so a crash never loses data
    //    collectedLinks: {
    //      "<folderId>": { name, items: [ { name, url } ] }
    //    },
    //
    //    // Transcripts that failed even after in-page retry
    //    failed: [ { folderName, folderId, transcriptName, href, attempts } ],
    //
    //    // Workflow step for the CURRENT page load
    //    step: 'collect_transcripts' | 'get_share_url' | 'retry_failed' | 'done'
    //  }

    // ═══════════════════════════════════════════════════════════════════
    //  SIDEBAR: COLLECT FOLDERS
    // ═══════════════════════════════════════════════════════════════════
    function collectFolders() {
        const desktopSidebar = document.querySelector('.hidden.sm\\:block ul.dui-menu');
        const sidebar = desktopSidebar || document.querySelector('ul.dui-menu');
        if (!sidebar) { log('ERROR: No sidebar found'); return []; }

        const links = sidebar.querySelectorAll('a[href*="/dashboard/folder/"]');
        const folders = [];
        const seen = new Set();

        for (const a of links) {
            const href = a.getAttribute('href') || '';
            const m = href.match(/\/dashboard\/folder\/(\d+)/);
            if (!m) continue;
            const folderId = m[1];
            if (seen.has(folderId)) continue;
            seen.add(folderId);
            const name = a.querySelector('span.line-clamp-1')?.textContent?.trim() || `folder-${folderId}`;
            folders.push({ href: `${location.origin}/dashboard/folder/${folderId}`, name, folderId });
        }
        log(`collectFolders: ${folders.length} unique`);
        return folders;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  FOLDER PAGE: COLLECT TRANSCRIPT LINKS
    // ═══════════════════════════════════════════════════════════════════
    async function scrollToLoadAll() {
        // Wait for initial HTMX content to render
        await sleep(2000);
        let prevCount = 0, stableRounds = 0;
        for (let i = 0; i < 80; i++) {
            const count = document.querySelectorAll('a[href*="/transcript/"]:not([href*="/share/"])').length;
            if (count === prevCount) {
                stableRounds++;
                // Require 5 stable rounds AND at least 2 scroll attempts
                if (stableRounds >= 5 && i >= 2) break;
            } else { stableRounds = 0; }
            prevCount = count;
            window.scrollTo(0, document.body.scrollHeight);
            // Also trigger any HTMX infinite scroll observers
            const sentinel = document.querySelector('[hx-trigger*="intersect"]');
            if (sentinel) {
                sentinel.dispatchEvent(new Event('intersect', { bubbles: true }));
            }
            await sleep(DELAY.scrollWait);
        }
        window.scrollTo(0, 0);
        await sleep(500);
    }

    function collectTranscripts() {
        const links = document.querySelectorAll('a[href*="/transcript/"]:not([href*="/share/"])');
        const transcripts = [];
        const seen = new Set();

        for (const a of links) {
            if (a.closest('nav') || a.closest('ul.dui-menu')) continue;
            const href = a.getAttribute('href') || '';
            if (href.includes('/share/')) continue;
            const fullHref = href.startsWith('http') ? href : location.origin + href;
            if (seen.has(fullHref)) continue;
            seen.add(fullHref);

            let name = '';
            const span = a.querySelector('span.line-clamp-1, span.line-clamp-2, span.truncate');
            if (span) name = span.textContent.trim();
            if (!name) name = a.textContent.replace(/\s+/g, ' ').trim();
            if (name.length > 300) name = name.substring(0, 150) + '...';
            if (!name) name = 'unnamed';

            transcripts.push({ name, href: fullHref });
        }
        log(`collectTranscripts: ${transcripts.length} found`);
        return transcripts;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  TRANSCRIPT PAGE: CLICK "SHARE TRANSCRIPT" & EXTRACT URL
    // ═══════════════════════════════════════════════════════════════════
    async function clickShareTranscript() {
        log('  → Looking for "Share Transcript"...');

        // First, we need to open the three-dot / action menu on the transcript page
        // TurboScribe transcript pages have the actions in a dropdown or directly visible
        // Try finding "Share Transcript" directly first (sometimes visible without dropdown)
        let shareEl = null;

        try {
            shareEl = await waitFor(() => {
                // Search in all <p> and <span> tags
                for (const tag of ['p', 'span', 'div', 'li']) {
                    const els = document.querySelectorAll(tag);
                    for (const el of els) {
                        const txt = el.textContent.trim();
                        if (txt === 'Share Transcript' && el.children.length <= 2) return el;
                    }
                }
                return null;
            }, 10000);
        } catch {
            // "Share Transcript" not directly visible — need to open dropdown first
            log('  → "Share Transcript" not immediately visible, looking for action menu...');
            await openTranscriptDropdown();

            shareEl = await waitFor(() => {
                for (const tag of ['p', 'span', 'div', 'li']) {
                    const els = document.querySelectorAll(tag);
                    for (const el of els) {
                        if (el.textContent.trim() === 'Share Transcript' && el.children.length <= 2) return el;
                    }
                }
                return null;
            }, 15000);
        }

        if (!shareEl) throw new Error('"Share Transcript" not found');

        log('  → Found "Share Transcript", activating...');

        // Use the HTMX trigger pattern from the bulk export script
        const roleLink = shareEl.closest('[role="link"]') || shareEl.closest('.inline-block');
        if (roleLink) {
            const triggerSpan = roleLink.querySelector('span[tabindex]');
            if (triggerSpan) {
                log('  → Using HTMX span[tabindex] trigger');
                triggerSpan.focus();
                await sleep(300);
                triggerSpan.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                triggerSpan.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
                triggerSpan.click();
                triggerSpan.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                triggerSpan.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                await sleep(DELAY.afterHTMX);
                return;
            }
        }

        // Fallback: click ancestors
        const li = shareEl.closest('li');
        const target = li || shareEl.closest('div') || shareEl;
        target.click();
        await sleep(DELAY.afterHTMX);

        // If modal didn't appear, try harder
        if (!document.querySelector('input[value*="turboscribe.ai/transcript/share/"]')) {
            log('  → Modal not visible, retrying with aggressive events...');
            if (li) {
                li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                li.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
                li.click();
                const hxEl = li.querySelector('[hx-post], [hx-get]') || li.closest('[hx-post], [hx-get]');
                if (hxEl) hxEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
            await sleep(DELAY.afterHTMX);
        }
    }

    async function openTranscriptDropdown() {
        const dropdowns = document.querySelectorAll('.dui-dropdown.dui-dropdown-end');
        for (const dd of dropdowns) {
            if (dd.closest('ul.dui-menu') || dd.closest('nav') || dd.closest('tr') || dd.closest('table')) continue;
            const btn = dd.querySelector('button');
            if (!btn) continue;
            const pathEl = btn.querySelector('svg path');
            if (pathEl && pathEl.getAttribute('d')?.startsWith('M6 10a2')) {
                log('  → Found three-dot button on transcript page');
                btn.focus();
                await sleep(300);
                btn.click();
                await sleep(200);
                btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                await sleep(2500);
                return;
            }
        }
        log('  → No three-dot button found — Share might be directly visible');
    }

    async function extractShareUrl() {
        log('  → Waiting for share modal...');
        const input = await waitFor(() => {
            const inputs = document.querySelectorAll('input');
            for (const inp of inputs) {
                if ((inp.value || '').includes('turboscribe.ai/transcript/share/')) return inp;
            }
            return null;
        }, 25000);

        const url = input.value.trim();
        log(`  → Share URL: ${url}`);
        return url;
    }

    async function closeModal() {
        const modalBoxes = document.querySelectorAll('.dui-modal-box');
        for (const modal of modalBoxes) {
            if (modal.getBoundingClientRect().height === 0) continue;
            const xBtn = modal.querySelector('.dui-btn-circle.dui-btn-ghost, .dui-btn-circle');
            if (xBtn) { xBtn.click(); await sleep(500); log('  → Modal closed'); return; }
        }
        // Checkbox toggle pattern
        for (const label of document.querySelectorAll('label.dui-modal-box')) {
            const forId = label.getAttribute('for');
            if (forId) {
                const cb = document.getElementById(forId);
                if (cb?.type === 'checkbox' && cb.checked) {
                    cb.checked = false;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                    await sleep(500); return;
                }
            }
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await sleep(500);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  OUTPUT GENERATION — .txt, .json, .html
    // ═══════════════════════════════════════════════════════════════════

    function buildResults(state) {
        // Reconstruct ordered results from collectedLinks using folder order
        const results = [];
        const seenIds = new Set();

        // If we have a merge base from a previous export, include those folders first
        if (window._mergeBase?.folders) {
            for (const folder of window._mergeBase.folders) {
                // Check if this folder was re-exported (overwrite with new data)
                const freshData = state.collectedLinks[folder.folderId];
                if (freshData && freshData.items.length > 0) {
                    results.push({
                        name:     folder.name,
                        folderId: folder.folderId,
                        items:    freshData.items
                    });
                } else {
                    // Use existing data from merge base
                    results.push({
                        name:     folder.name,
                        folderId: folder.folderId,
                        items:    folder.transcripts.map(t => ({ name: t.name, url: t.shareUrl }))
                    });
                }
                seenIds.add(folder.folderId);
            }
        }

        // Add any folders from the current run that weren't in the merge base
        for (const folder of state.folders) {
            if (seenIds.has(folder.folderId)) continue;
            const data = state.collectedLinks[folder.folderId];
            results.push({
                name:     folder.name,
                folderId: folder.folderId,
                items:    data ? data.items : []
            });
        }
        return results;
    }

    function downloadBlob(content, filename, type) {
        const blob = new Blob([content], { type });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function generateTxt(results) {
        let txt = '';
        for (const folder of results) {
            txt += `# ${folder.name}\n`;
            if (!folder.items.length) { txt += '(empty folder)\n'; }
            else { folder.items.forEach((item, i) => { txt += `${i + 1}. ${item.name} : ${item.url}\n`; }); }
            txt += '\n';
        }
        return txt.trimEnd() + '\n';
    }

    function generateJson(results, failed) {
        return JSON.stringify({
            exportedAt: new Date().toISOString(),
            totalFolders: results.length,
            totalLinks: results.reduce((s, f) => s + f.items.length, 0),
            failedCount: failed.length,
            folders: results.map(f => ({
                name: f.name,
                folderId: f.folderId,
                transcripts: f.items.map(i => ({ name: i.name, shareUrl: i.url }))
            })),
            failed: failed.map(f => ({
                folder: f.folderName,
                transcript: f.transcriptName,
                url: f.href,
                attempts: f.attempts
            }))
        }, null, 2);
    }

    function generateHtml(results, failed) {
        const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const totalLinks = results.reduce((s, f) => s + f.items.length, 0);
        const date = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

        let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TurboScribe Share Links</title>
<style>
  :root { --bg: #0f0f1a; --card: #1a1a2e; --border: #2a2a3e; --accent: #7c6af7; --accent2: #4ade80;
          --fg: #e0e0f0; --dim: #888899; --red: #e06c75; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: var(--bg); color: var(--fg); padding: 2rem; line-height: 1.6; }
  .header { text-align: center; margin-bottom: 2.5rem; }
  .header h1 { font-size: 1.8rem; color: var(--accent); margin-bottom: 0.3rem; }
  .header .meta { color: var(--dim); font-size: 0.85rem; }
  .stats { display: flex; gap: 1rem; justify-content: center; margin: 1rem 0 2rem; flex-wrap: wrap; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 10px;
          padding: 0.7rem 1.4rem; text-align: center; min-width: 120px; }
  .stat .num { font-size: 1.5rem; font-weight: 700; color: var(--accent2); }
  .stat .label { font-size: 0.75rem; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; }
  .folder { background: var(--card); border: 1px solid var(--border); border-radius: 12px;
            margin-bottom: 1.2rem; overflow: hidden; }
  .folder-header { padding: 0.9rem 1.2rem; font-weight: 700; font-size: 1.05rem;
                   border-bottom: 1px solid var(--border); display: flex; justify-content: space-between;
                   align-items: center; cursor: pointer; user-select: none; }
  .folder-header:hover { background: rgba(124,106,247,0.08); }
  .folder-header .count { font-size: 0.8rem; color: var(--dim); font-weight: 400; }
  .folder-body { padding: 0; }
  .folder-body.collapsed { display: none; }
  .item { display: flex; justify-content: space-between; align-items: center;
          padding: 0.55rem 1.2rem; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
  .item:last-child { border-bottom: none; }
  .item:hover { background: rgba(124,106,247,0.04); }
  .item-name { flex: 1; margin-right: 1rem; word-break: break-word; }
  .item a { color: var(--accent); text-decoration: none; white-space: nowrap; font-size: 0.82rem; }
  .item a:hover { text-decoration: underline; }
  .empty { color: var(--dim); font-style: italic; padding: 0.8rem 1.2rem; }
  .failed-section { margin-top: 2rem; }
  .failed-section h2 { color: var(--red); margin-bottom: 0.8rem; }
  .failed-item { background: var(--card); border: 1px solid var(--red); border-radius: 8px;
                 padding: 0.6rem 1rem; margin-bottom: 0.5rem; font-size: 0.85rem; }
  .search-bar { width: 100%; max-width: 400px; margin: 0 auto 1.5rem; display: block;
                padding: 0.6rem 1rem; border-radius: 8px; border: 1px solid var(--border);
                background: var(--card); color: var(--fg); font-size: 0.9rem; outline: none; }
  .search-bar:focus { border-color: var(--accent); }
  .search-bar::placeholder { color: var(--dim); }
  .hidden { display: none !important; }
</style>
</head>
<body>
<div class="header">
  <h1>TurboScribe Share Links</h1>
  <div class="meta">Exported on ${esc(date)}</div>
</div>
<div class="stats">
  <div class="stat"><div class="num">${results.length}</div><div class="label">Folders</div></div>
  <div class="stat"><div class="num">${totalLinks}</div><div class="label">Transcripts</div></div>
  ${failed.length ? `<div class="stat"><div class="num" style="color:var(--red)">${failed.length}</div><div class="label">Failed</div></div>` : ''}
</div>
<input type="text" class="search-bar" placeholder="Search transcripts..." id="searchInput">
<div id="folders">`;

        for (const folder of results) {
            html += `\n<div class="folder" data-folder>
  <div class="folder-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">
    <span>${esc(folder.name)}</span>
    <span class="count">${folder.items.length} transcript${folder.items.length !== 1 ? 's' : ''}</span>
  </div>
  <div class="folder-body">`;
            if (!folder.items.length) {
                html += `\n    <div class="empty">(empty folder)</div>`;
            } else {
                for (const item of folder.items) {
                    html += `\n    <div class="item" data-search="${esc(item.name.toLowerCase())}">
      <span class="item-name">${esc(item.name)}</span>
      <a href="${esc(item.url)}" target="_blank" rel="noopener">Open ↗</a>
    </div>`;
                }
            }
            html += `\n  </div>\n</div>`;
        }

        if (failed.length) {
            html += `\n<div class="failed-section"><h2>⚠ Failed (${failed.length})</h2>`;
            for (const f of failed) {
                html += `\n<div class="failed-item">${esc(f.folderName)} → ${esc(f.transcriptName)} (${f.attempts} attempts)
  <a href="${esc(f.href)}" target="_blank" style="color:var(--accent);margin-left:8px;">Try manually ↗</a></div>`;
            }
            html += `\n</div>`;
        }

        html += `
</div>
<script>
document.getElementById('searchInput').addEventListener('input', function() {
  const q = this.value.toLowerCase();
  document.querySelectorAll('.folder').forEach(f => {
    if (!q) { f.classList.remove('hidden'); f.querySelectorAll('.item').forEach(i => i.classList.remove('hidden'));
              f.querySelector('.folder-body')?.classList.remove('collapsed'); return; }
    const items = f.querySelectorAll('.item');
    let anyMatch = false;
    items.forEach(i => { const match = i.dataset.search.includes(q); i.classList.toggle('hidden', !match); if (match) anyMatch = true; });
    f.classList.toggle('hidden', !anyMatch);
    if (anyMatch) f.querySelector('.folder-body')?.classList.remove('collapsed');
  });
});
</script>
</body></html>`;
        return html;
    }

    function downloadAll(state) {
        const results = buildResults(state);
        const failed  = state.failed || [];
        const stamp   = new Date().toISOString().slice(0, 10);

        downloadBlob(generateTxt(results),             `turboscribe-links-${stamp}.txt`,  'text/plain;charset=utf-8');
        setTimeout(() => {
            downloadBlob(generateJson(results, failed), `turboscribe-links-${stamp}.json`, 'application/json;charset=utf-8');
        }, 500);
        setTimeout(() => {
            downloadBlob(generateHtml(results, failed), `turboscribe-links-${stamp}.html`, 'text/html;charset=utf-8');
        }, 1000);

        log('  → Downloaded .txt + .json + .html');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  UI — FLOATING PANEL WITH PROGRESS BAR & ETA
    // ═══════════════════════════════════════════════════════════════════

    function createUI() {
        if (document.getElementById('ts-share-ui-v2')) return;

        const container = document.createElement('div');
        container.id = 'ts-share-ui-v2';
        container.innerHTML = `
<style>
  #ts-share-ui-v2 {
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
  }
  #ts-share-panel {
    background: #1a1a2e; border: 1px solid #333; border-radius: 12px;
    padding: 14px 18px; max-width: 480px; min-width: 320px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5); display: none;
  }
  #ts-share-status {
    color: #4ade80; font-size: 13px; font-family: monospace; line-height: 1.5;
    margin-bottom: 8px; word-break: break-word;
  }
  #ts-share-progress-wrap {
    background: #2a2a3e; border-radius: 6px; height: 8px; overflow: hidden; margin-bottom: 6px;
  }
  #ts-share-progress-bar {
    background: linear-gradient(90deg, #7c6af7, #4ade80); height: 100%; width: 0%;
    border-radius: 6px; transition: width 0.4s ease;
  }
  #ts-share-eta {
    color: #888; font-size: 11px; text-align: right; margin-bottom: 4px;
  }
  #ts-share-btns { display: flex; gap: 8px; justify-content: flex-end; }
  #ts-share-btns button {
    border: none; padding: 10px 20px; border-radius: 10px; cursor: pointer;
    font-weight: 700; font-size: 14px; transition: opacity 0.2s;
  }
  #ts-share-btns button:hover { opacity: 0.85; }
  .ts-btn-start {
    background: linear-gradient(135deg, #7c3aed, #6d28d9); color: white;
    box-shadow: 0 4px 16px rgba(124,58,237,0.5);
  }
  .ts-btn-stop  { background: #ef4444; color: white; box-shadow: 0 4px 12px rgba(239,68,68,0.4); display: none; }
  .ts-btn-dl    { background: #4ade80; color: #1a1a2e; box-shadow: 0 4px 12px rgba(74,222,128,0.4); display: none; }
  .ts-btn-merge { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; box-shadow: 0 4px 12px rgba(245,158,11,0.4); }

  /* Folder picker modal */
  #ts-folder-picker {
    display: none; position: fixed; inset: 0; z-index: 9999999;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
    justify-content: center; align-items: center;
  }
  #ts-folder-picker.visible { display: flex; }
  #ts-picker-box {
    background: #1a1a2e; border: 1px solid #333; border-radius: 16px;
    padding: 24px; width: 520px; max-height: 80vh; display: flex; flex-direction: column;
    box-shadow: 0 16px 64px rgba(0,0,0,0.6);
  }
  #ts-picker-box h2 { margin: 0 0 16px; color: #e0e0f0; font-size: 16px; }
  #ts-picker-list {
    overflow-y: auto; max-height: 50vh; margin-bottom: 12px;
    border: 1px solid #2a2a3e; border-radius: 8px; padding: 8px;
  }
  .ts-folder-row {
    display: flex; align-items: center; gap: 10px; padding: 6px 8px;
    border-radius: 6px; cursor: pointer; user-select: none; font-size: 13px; color: #e0e0f0;
  }
  .ts-folder-row:hover { background: rgba(124,106,247,0.1); }
  .ts-folder-row input { accent-color: #7c6af7; width: 16px; height: 16px; cursor: pointer; }
  .ts-folder-row .ts-fname { flex: 1; }
  .ts-folder-row .ts-fid { color: #666; font-size: 10px; font-family: monospace; }
  #ts-picker-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  #ts-picker-actions button {
    border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer;
    font-weight: 600; font-size: 13px;
  }
  .ts-pick-toggle { background: #2a2a3e; color: #e0e0f0; }
  .ts-pick-go { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: white; }
  .ts-pick-cancel { background: #333; color: #999; }
  .ts-pick-merge { background: #2a2a3e; color: #f59e0b; font-size: 11px; }
  #ts-merge-input { display: none; }
  .ts-picker-info { color: #888; font-size: 11px; margin: 8px 0; }
</style>
<div id="ts-share-panel">
  <div id="ts-share-status"></div>
  <div id="ts-share-progress-wrap"><div id="ts-share-progress-bar"></div></div>
  <div id="ts-share-eta"></div>
</div>
<div id="ts-share-btns">
  <button class="ts-btn-dl"    id="ts-share-dl">📥 Download Results</button>
  <button class="ts-btn-stop"  id="ts-share-stop">⏹ Stop</button>
  <button class="ts-btn-merge" id="ts-share-merge">🔀 Merge JSON</button>
  <button class="ts-btn-start" id="ts-share-start">🔗 Export Share Links</button>
</div>
<div id="ts-folder-picker">
  <div id="ts-picker-box">
    <h2>📁 Select folders to export</h2>
    <div id="ts-picker-list"></div>
    <div class="ts-picker-info" id="ts-picker-info"></div>
    <div id="ts-picker-actions">
      <button class="ts-pick-toggle" id="ts-pick-all">Select All</button>
      <button class="ts-pick-toggle" id="ts-pick-none">Deselect All</button>
      <span style="flex:1"></span>
      <button class="ts-pick-cancel" id="ts-pick-cancel">Cancel</button>
      <button class="ts-pick-go" id="ts-pick-go">▶ Start Export</button>
    </div>
  </div>
</div>
<input type="file" id="ts-merge-input" accept=".json">`;

        document.body.appendChild(container);

        document.getElementById('ts-share-start').onclick = onStartClick;
        document.getElementById('ts-share-stop').onclick  = onStopClick;
        document.getElementById('ts-share-dl').onclick    = onDownloadClick;
        document.getElementById('ts-share-merge').onclick = onMergeClick;
        document.getElementById('ts-pick-cancel').onclick = () => closePicker();
        document.getElementById('ts-pick-all').onclick    = () => toggleAllPicker(true);
        document.getElementById('ts-pick-none').onclick   = () => toggleAllPicker(false);
        document.getElementById('ts-pick-go').onclick     = onPickerGo;
        document.getElementById('ts-merge-input').onchange = onMergeFileSelected;
    }

    function updateUI(msg) {
        const panel  = document.getElementById('ts-share-panel');
        const status = document.getElementById('ts-share-status');
        if (panel) panel.style.display = 'block';
        if (status) status.textContent = msg;
        log(msg);
    }

    function updateProgress(completed, total) {
        const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
        const bar = document.getElementById('ts-share-progress-bar');
        if (bar) bar.style.width = `${pct}%`;

        const state = getState();
        const eta   = document.getElementById('ts-share-eta');
        if (eta && state?.startedAt && completed > 0) {
            const elapsed  = now() - state.startedAt;
            const perOp    = elapsed / completed;
            const remaining = Math.round((perOp * (total - completed)) / 1000);
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            eta.textContent = `${pct}% · ~${mins}m ${secs}s remaining · ${completed}/${total} transcripts`;
        } else if (eta) {
            eta.textContent = `${pct}% · ${completed}/${total} transcripts`;
        }
    }

    function showButtons(start, stop, dl) {
        const s1 = document.getElementById('ts-share-start');
        const s2 = document.getElementById('ts-share-stop');
        const s3 = document.getElementById('ts-share-dl');
        if (s1) s1.style.display = start ? 'block' : 'none';
        if (s2) s2.style.display = stop  ? 'block' : 'none';
        if (s3) s3.style.display = dl    ? 'block' : 'none';
    }

    // ═══════════════════════════════════════════════════════════════════
    //  BUTTON HANDLERS
    // ═══════════════════════════════════════════════════════════════════

    function onStartClick() {
        const folders = collectFolders();
        if (!folders.length) {
            alert('No folders found in the sidebar!\nMake sure you are on the dashboard with folders visible.');
            return;
        }
        showFolderPicker(folders);
    }

    // ── FOLDER PICKER ────────────────────────────────────────────────

    let _pickerFolders = [];

    function showFolderPicker(folders) {
        _pickerFolders = folders;
        const list = document.getElementById('ts-picker-list');
        list.innerHTML = '';

        for (let i = 0; i < folders.length; i++) {
            const f = folders[i];
            const row = document.createElement('label');
            row.className = 'ts-folder-row';
            row.innerHTML = `
                <input type="checkbox" checked data-idx="${i}">
                <span class="ts-fname">${f.name}</span>
                <span class="ts-fid">${f.folderId}</span>`;
            list.appendChild(row);
        }

        updatePickerInfo();
        list.querySelectorAll('input').forEach(cb => {
            cb.addEventListener('change', updatePickerInfo);
        });

        document.getElementById('ts-folder-picker').classList.add('visible');
    }

    function closePicker() {
        document.getElementById('ts-folder-picker').classList.remove('visible');
    }

    function toggleAllPicker(checked) {
        document.querySelectorAll('#ts-picker-list input[type="checkbox"]').forEach(cb => {
            cb.checked = checked;
        });
        updatePickerInfo();
    }

    function updatePickerInfo() {
        const checked = document.querySelectorAll('#ts-picker-list input:checked').length;
        const total = _pickerFolders.length;
        const info = document.getElementById('ts-picker-info');
        if (info) info.textContent = `${checked} of ${total} folders selected`;
    }

    function onPickerGo() {
        const checkboxes = document.querySelectorAll('#ts-picker-list input:checked');
        const selectedFolders = [];
        checkboxes.forEach(cb => {
            const idx = parseInt(cb.dataset.idx);
            selectedFolders.push(_pickerFolders[idx]);
        });

        if (!selectedFolders.length) {
            alert('Please select at least one folder.');
            return;
        }

        closePicker();

        const state = {
            active: true,
            startedAt: now(),
            completedOps: 0,
            totalOps: 0,
            folders: selectedFolders,
            currentFolder: 0,
            transcripts: [],
            currentTranscript: 0,
            collectedLinks: {},
            failed: [],
            step: 'collect_transcripts'
        };
        setState(state);
        showButtons(false, true, false);
        updateUI(`Navigating to folder 1/${selectedFolders.length}: "${selectedFolders[0].name}"...`);
        setTimeout(() => { location.href = selectedFolders[0].href; }, 500);
    }

    // ── MERGE WITH EXISTING JSON ─────────────────────────────────────

    function onMergeClick() {
        document.getElementById('ts-merge-input').click();
    }

    function onMergeFileSelected(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const existing = JSON.parse(ev.target.result);
                // Get current state or partial state
                const current = getState() || window._tsPartialState;
                if (!current) {
                    // No current run — just use the existing JSON as base for a new export
                    alert(`Loaded ${existing.totalLinks} links from ${existing.totalFolders} folders.\n\nNow click "Export Share Links" and select only the missing folders.\nThe final download will merge both.`);
                    window._mergeBase = existing;
                    return;
                }
                // Merge existing into current collectedLinks
                mergeExistingIntoState(existing, current);
            } catch (err) {
                alert('Error parsing JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
        // Reset so same file can be selected again
        e.target.value = '';
    }

    function mergeExistingIntoState(existing, state) {
        let added = 0;
        for (const folder of existing.folders) {
            if (!state.collectedLinks[folder.folderId]) {
                state.collectedLinks[folder.folderId] = {
                    name: folder.name,
                    items: folder.transcripts.map(t => ({
                        name: t.name,
                        url: t.shareUrl,
                        sourceHref: ''
                    }))
                };
                added += folder.transcripts.length;
            } else {
                // Merge transcripts that don't exist yet (by URL)
                const existingUrls = new Set(state.collectedLinks[folder.folderId].items.map(i => i.url));
                for (const t of folder.transcripts) {
                    if (!existingUrls.has(t.shareUrl)) {
                        state.collectedLinks[folder.folderId].items.push({
                            name: t.name,
                            url: t.shareUrl,
                            sourceHref: ''
                        });
                        added++;
                    }
                }
            }
        }

        // Also merge the folder list so buildResults can find all folders
        const existingIds = new Set(state.folders.map(f => f.folderId));
        for (const folder of existing.folders) {
            if (!existingIds.has(folder.folderId)) {
                state.folders.push({
                    name: folder.name,
                    folderId: folder.folderId,
                    href: `${location.origin}/dashboard/folder/${folder.folderId}`
                });
            }
        }

        if (state === window._tsPartialState) {
            window._tsPartialState = state;
        } else {
            setState(state);
        }

        updateUI(`✅ Merged ${added} links from existing JSON. Total folders: ${state.folders.length}`);
        showButtons(true, false, true);
        window._tsPartialState = state;
        log(`Merge complete: +${added} links`);
    }

    function onStopClick() {
        const state = getState();
        clearState();
        updateUI('⏹ Stopped.');
        showButtons(true, false, false);

        if (state?.collectedLinks && Object.keys(state.collectedLinks).length > 0) {
            // Show download button for partial results
            showButtons(true, false, true);
            // Store results temporarily for download
            window._tsPartialState = state;
        }
    }

    function onDownloadClick() {
        const state = getState() || window._tsPartialState;
        if (state) downloadAll(state);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  MAIN PROCESSING — ONE OPERATION PER PAGE LOAD
    // ═══════════════════════════════════════════════════════════════════

    async function process() {
        const state = getState();
        if (!state?.active) return;

        const path   = location.pathname;
        const folder = state.folders[state.currentFolder];
        const fIdx   = state.currentFolder + 1;
        const fTotal = state.folders.length;

        // ── STEP: COLLECT TRANSCRIPTS FROM FOLDER PAGE ──────────────
        if (state.step === 'collect_transcripts') {
            // Verify correct page
            if (!path.includes(`/dashboard/folder/${folder.folderId}`)) {
                log(`Wrong page for folder, navigating to ${folder.href}`);
                location.href = folder.href;
                return;
            }

            updateUI(`[${fIdx}/${fTotal}] "${folder.name}" — scanning transcripts...`);
            await sleep(3000);
            await scrollToLoadAll();

            const transcripts = collectTranscripts();

            if (!transcripts.length) {
                log(`Folder "${folder.name}" is empty`);
                updateUI(`[${fIdx}/${fTotal}] "${folder.name}" is empty — skipping`);
                state.collectedLinks[folder.folderId] = { name: folder.name, items: [] };
                advanceFolder(state);
                return;
            }

            // Filter out already-collected transcripts (dedup on resume)
            const existing = state.collectedLinks[folder.folderId];
            const alreadyDone = new Set((existing?.items || []).map(i => i.url));
            const remaining = transcripts.filter(t => {
                // We can't dedup by URL since we don't have share URLs yet — dedup by transcript href
                const doneHrefs = new Set((existing?.items || []).map(i => i.sourceHref).filter(Boolean));
                return !doneHrefs.has(t.href);
            });

            log(`${transcripts.length} total, ${remaining.length} remaining after dedup`);

            // Update total estimate
            state.totalOps = state.completedOps + remaining.length;
            // Count remaining transcripts in future folders (rough estimate)
            // We don't know yet, but this gets refined as we go

            state.transcripts = remaining;
            state.currentTranscript = 0;

            if (!state.collectedLinks[folder.folderId]) {
                state.collectedLinks[folder.folderId] = { name: folder.name, items: [] };
            }

            if (!remaining.length) {
                log(`All transcripts in "${folder.name}" already collected`);
                advanceFolder(state);
                return;
            }

            // Navigate to first transcript — ONE per page load
            state.step = 'get_share_url';
            setState(state);

            const t = remaining[0];
            updateUI(`[${fIdx}/${fTotal}] "${folder.name}" — [1/${remaining.length}] "${t.name}"...`);
            updateProgress(state.completedOps, state.totalOps);
            await sleep(DELAY.navigation);
            location.href = t.href;
            return;
        }

        // ── STEP: EXTRACT SHARE URL FROM TRANSCRIPT PAGE ────────────
        if (state.step === 'get_share_url') {
            const transcript = state.transcripts[state.currentTranscript];
            if (!transcript) { advanceFolder(state); return; }

            const tIdx   = state.currentTranscript + 1;
            const tTotal = state.transcripts.length;

            // Verify we're on a transcript page
            if (!path.startsWith('/transcript/') && !path.includes('/transcript/')) {
                log(`Not on transcript page, navigating...`);
                location.href = transcript.href;
                return;
            }

            updateUI(`[${fIdx}/${fTotal}] "${folder.name}" — [${tIdx}/${tTotal}] "${transcript.name}"...`);
            updateProgress(state.completedOps, state.totalOps);

            try {
                await clickShareTranscript();
                const shareUrl = await extractShareUrl();
                await closeModal();

                // ── INCREMENTAL SAVE ──
                state.collectedLinks[folder.folderId].items.push({
                    name: transcript.name,
                    url:  shareUrl,
                    sourceHref: transcript.href
                });
                state.completedOps++;
                state.currentTranscript++;

                log(`  → ✅ "${transcript.name}" (${state.completedOps} total)`);

                if (state.currentTranscript < state.transcripts.length) {
                    // Navigate to NEXT transcript (one per page load)
                    setState(state);
                    const next    = state.transcripts[state.currentTranscript];
                    const nextIdx = state.currentTranscript + 1;
                    updateUI(`[${fIdx}/${fTotal}] "${folder.name}" — [${nextIdx}/${tTotal}] "${next.name}"...`);
                    updateProgress(state.completedOps, state.totalOps);
                    await sleep(DELAY.navigation);
                    location.href = next.href;
                } else {
                    // Folder complete
                    log(`  → Folder "${folder.name}" done (${state.collectedLinks[folder.folderId].items.length} links)`);
                    advanceFolder(state);
                }

            } catch (err) {
                console.error('[TS-Share-v2] Error:', err);

                // Track retry
                const failKey = transcript.href;
                if (!state._retryCount) state._retryCount = {};
                state._retryCount[failKey] = (state._retryCount[failKey] || 0) + 1;

                if (state._retryCount[failKey] < MAX_RETRIES) {
                    updateUI(`⚠ Error on "${transcript.name}" (attempt ${state._retryCount[failKey]}/${MAX_RETRIES}): ${err.message} — retrying...`);
                    setState(state);
                    try { await closeModal(); } catch {}
                    await sleep(DELAY.retryPause);
                    location.reload();
                } else {
                    // Max retries reached — record failure, move on
                    log(`  → ✗ FAILED after ${MAX_RETRIES} attempts: "${transcript.name}"`);
                    state.failed.push({
                        folderName: folder.name,
                        folderId: folder.folderId,
                        transcriptName: transcript.name,
                        href: transcript.href,
                        attempts: MAX_RETRIES
                    });
                    state.completedOps++;
                    state.currentTranscript++;
                    delete state._retryCount[failKey];

                    if (state.currentTranscript < state.transcripts.length) {
                        setState(state);
                        const next = state.transcripts[state.currentTranscript];
                        updateUI(`⚠ Skipped "${transcript.name}" — moving to next...`);
                        await sleep(DELAY.navigation);
                        location.href = next.href;
                    } else {
                        advanceFolder(state);
                    }
                }
            }
            return;
        }

        // ── STEP: RETRY FAILED TRANSCRIPTS ──────────────────────────
        if (state.step === 'retry_failed') {
            if (!state.retryQueue || !state.retryQueue.length) {
                finishExport(state);
                return;
            }

            const item = state.retryQueue[0];

            // Verify page
            if (!path.includes('/transcript/')) {
                location.href = item.href;
                return;
            }

            const rIdx = state.retryOriginalCount - state.retryQueue.length + 1;
            updateUI(`🔄 Retry ${rIdx}/${state.retryOriginalCount}: "${item.transcriptName}"...`);

            try {
                await clickShareTranscript();
                const shareUrl = await extractShareUrl();
                await closeModal();

                // Save to correct folder
                if (!state.collectedLinks[item.folderId]) {
                    state.collectedLinks[item.folderId] = { name: item.folderName, items: [] };
                }
                state.collectedLinks[item.folderId].items.push({
                    name: item.transcriptName,
                    url:  shareUrl,
                    sourceHref: item.href
                });

                // Remove from failed
                state.failed = state.failed.filter(f => f.href !== item.href);
                state.retryQueue.shift();
                state.completedOps++;
                log(`  → ✅ Retry succeeded for "${item.transcriptName}"`);

                setState(state);

                if (state.retryQueue.length) {
                    const next = state.retryQueue[0];
                    await sleep(DELAY.navigation);
                    location.href = next.href;
                } else {
                    finishExport(state);
                }

            } catch (err) {
                log(`  → ✗ Retry failed again for "${item.transcriptName}": ${err.message}`);
                item.attempts++;
                state.retryQueue.shift();
                setState(state);

                try { await closeModal(); } catch {}
                await sleep(DELAY.retryPause);

                if (state.retryQueue.length) {
                    location.href = state.retryQueue[0].href;
                } else {
                    finishExport(state);
                }
            }
            return;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  NAVIGATION HELPERS
    // ═══════════════════════════════════════════════════════════════════

    function advanceFolder(state) {
        state.currentFolder++;
        state.transcripts = [];
        state.currentTranscript = 0;

        if (state.currentFolder < state.folders.length) {
            state.step = 'collect_transcripts';
            setState(state);
            const next = state.folders[state.currentFolder];
            const idx  = state.currentFolder + 1;
            updateUI(`→ Folder ${idx}/${state.folders.length}: "${next.name}"...`);
            setTimeout(() => { location.href = next.href; }, DELAY.navigation);
        } else if (state.failed.length > 0) {
            // Auto-retry failed transcripts
            log(`All folders done. ${state.failed.length} failed — starting retry pass...`);
            state.step = 'retry_failed';
            state.retryQueue = [...state.failed];
            state.retryOriginalCount = state.retryQueue.length;
            setState(state);
            updateUI(`🔄 Retrying ${state.failed.length} failed transcript(s)...`);
            setTimeout(() => { location.href = state.retryQueue[0].href; }, DELAY.navigation);
        } else {
            finishExport(state);
        }
    }

    function finishExport(state) {
        downloadAll(state);
        const results    = buildResults(state);
        const totalLinks = results.reduce((s, f) => s + f.items.length, 0);
        const failCount  = state.failed.length;

        clearState();
        updateProgress(state.completedOps, state.completedOps); // 100%

        const msg = failCount
            ? `✅ Done! ${totalLinks} links from ${results.length} folders. ${failCount} failed (see .html).`
            : `✅ Done! ${totalLinks} links from ${results.length} folders.`;
        updateUI(msg);
        showButtons(true, false, false);

        alert(`Export complete!\n\n` +
            `${results.length} folders\n${totalLinks} share links\n${failCount} failed\n\n` +
            `3 files downloaded: .txt, .json, .html`);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  INIT & RESUME
    // ═══════════════════════════════════════════════════════════════════

    function resumeIfActive() {
        const state = getState();
        if (!state?.active) return;

        showButtons(false, true, true);

        const folder = state.folders[state.currentFolder];
        const fIdx   = state.currentFolder + 1;
        updateUI(`Resuming [${fIdx}/${state.folders.length}]: "${folder?.name}" (${state.step})...`);
        updateProgress(state.completedOps, state.totalOps);

        setTimeout(() => process(), DELAY.pageLoad);
    }

    function init() {
        createUI();
        resumeIfActive();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 1500);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(init, 1500));
    }
})();
