// Runs in the ASA CAPS page (and its iframes, in case the parts list is
// framed). Several independent capture paths feed the same pipeline in the
// background service worker, since ASA CAPS's exact UI behaviour can't be
// assumed — different pages/dealer instances may copy text differently:
//
// 1. Copy/cut DOM events: captures exactly what's selected when a native
//    copy happens (Ctrl+C, right-click Copy), enriched with the row's
//    description/PNC (same scrape as path 2) when the selection sits inside
//    a recognisable row. Never blocks or alters the native copy — the
//    normal ASA CAPS workflow is untouched.
// 2. Part-number button clicks (top frame only): ASA WEB's part number is a
//    <button id="copyPartNoBtn" class="part-no">5702A010</button> that
//    copies via a programmatic clipboard write (no copy event at all) and
//    doesn't include the description. This listens for clicks on that
//    button directly and scrapes both the part number AND its description
//    from the surrounding row in the DOM, so the description isn't lost.
// 3. Clipboard polling: a fallback for any other "click to copy" control
//    that writes to the clipboard programmatically. Polling the system
//    clipboard (requires the "clipboardRead" permission) catches those
//    regardless of how the text got there, though without a description.
// 4. Page watch (top frame only): ASA WEB is a single-page app — switching
//    vehicles updates the URL hash and re-renders via Angular without any
//    copy at all. This reads the VIN button/breadcrumb/tech-info DOM
//    directly so a vehicle switch is detected without requiring a copy.
// 5. "/" and "*" shortcuts: "/" focuses the current group's search box when
//    it's already on the page (a group's list view). "*" is for a diagram/
//    PNC detail page instead — clicks the existing "Group selection" button
//    (same as a manual click would) to jump back to that diagram's owning
//    group, then the "All" tab to land on the full combined list rather
//    than that one group, then focuses the resulting search box. Neither
//    fires with focus in an editable field.
//
// Every path logs to the console (prefixed "[Parts Interpreter Toolkit:ASA CAPS]")
// so you can open DevTools on the ASA CAPS tab and see exactly what's happening.

import { sendClipboardCapture } from '@/services/messaging';

const LOG_PREFIX = '[Parts Interpreter Toolkit:ASA CAPS]';

console.log(LOG_PREFIX, 'content script loaded on', location.href, 'top frame:', window.top === window);

function sendCapturedText(text: string, source: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  console.log(LOG_PREFIX, `captured via ${source}:`, trimmed);
  sendClipboardCapture(trimmed);
}

// --- Shared row-scraping helpers (used by both the copy-event path and the
// part-number button click path below, so a native select-and-copy of the
// part number gets the same description/PNC enrichment as clicking the
// dedicated copy button does). ---

const ROW_SELECTOR = ".flex-list-content, [class*='flex-list'], li, tr";
const DESCRIPTION_SELECTOR = '.break-word, .white-space, .flex-list-content .break-word';
const PNC_SELECTOR = '.pnc-col > div, .pnc-col';
const PNC_PATTERN = /^\d{4,6}[A-Z]{0,2}$/;

function findRowDescription(row: Element): string | null {
  const descEl = row.querySelector(DESCRIPTION_SELECTOR);
  const text = descEl?.textContent?.trim();
  return text || null;
}

// The PNC (parts diagram position code, e.g. "62070F") is distinct from the
// part number itself. ASA WEB puts it both as the row element's own id and
// in a dedicated .pnc-col cell, so either works — id is checked first since
// it needs no DOM traversal.
function findRowPnc(row: Element): string | null {
  if (row.id && PNC_PATTERN.test(row.id)) return row.id;
  const pncEl = row.querySelector(PNC_SELECTOR);
  const text = pncEl?.textContent?.trim();
  return text && PNC_PATTERN.test(text) ? text : null;
}

// --- 1. Copy/cut DOM events ---

function captureSelection(): void {
  try {
    const selection = window.getSelection();
    const text = selection?.toString() ?? '';
    if (!text.trim()) return;

    // The selection may be a bare part number selected directly off the
    // page (rather than clicked via the copy button below), in which case
    // it'd otherwise carry none of the row's description/PNC. Enrich it the
    // same way, anchored on wherever the selection actually starts.
    const anchorNode = selection?.anchorNode ?? null;
    const anchorEl = anchorNode instanceof Element ? anchorNode : (anchorNode?.parentElement ?? null);
    const row = anchorEl?.closest(ROW_SELECTOR) ?? null;
    const description = row ? findRowDescription(row) : null;
    const pnc = row ? findRowPnc(row) : null;

    const lines = [text];
    if (pnc && !text.includes(pnc)) lines.push(`PNC: ${pnc}`);
    if (description && !text.includes(description)) lines.push(description);
    sendCapturedText(lines.join('\n'), 'copy event');
  } catch {
    // Never let capture errors interfere with the page's own copy handling.
  }
}

document.addEventListener('copy', captureSelection, true);
document.addEventListener('cut', captureSelection, true);

// --- 2. Part-number button clicks ---

const PART_BUTTON_SELECTOR = "#copyPartNoBtn, .part-no, [id^='copyPartNoBtn']";

document.addEventListener(
  'click',
  (event) => {
    try {
      const target = event.target as Element | null;
      const button = target?.closest?.(PART_BUTTON_SELECTOR);
      if (!button) return;

      const partNumber = button.textContent?.trim();
      if (!partNumber) return;

      const row = button.closest(ROW_SELECTOR);
      const description = row ? findRowDescription(row) : null;
      const pnc = row ? findRowPnc(row) : null;

      const lines = [partNumber];
      if (pnc) lines.push(`PNC: ${pnc}`);
      if (description) lines.push(description);
      sendCapturedText(lines.join('\n'), 'part button click');
    } catch (err) {
      console.log(LOG_PREFIX, 'part button click handler error', err);
    }
  },
  true,
);

// --- 3. Clipboard polling (fallback for other click-to-copy controls) ---

let lastPolledClipboard = '';

async function pollClipboard(): Promise<void> {
  try {
    if (!document.hasFocus()) return;
    const text = await navigator.clipboard.readText();
    if (!text || text === lastPolledClipboard) return;
    lastPolledClipboard = text;
    sendCapturedText(text, 'clipboard poll');
  } catch {
    // Clipboard read can fail (no focus, no permission yet, empty clipboard
    // format, etc.) — nothing actionable to do about it here.
  }
}

setInterval(pollClipboard, 1200);

// --- 4. Page watch: detect vehicle switches that happen without a copy ---
// Only the top frame has the breadcrumb/VIN button, so skip this in iframes.

if (window.top === window) {
  const VIN_IN_URL = /[?;&]vin=([A-HJ-NPR-Z0-9]{17})/i;

  const scrapeVehicleText = (): string | null => {
    try {
      const vinFromUrl = location.href.match(VIN_IN_URL)?.[1];

      const vinContainer = document.querySelector('.vin-container');
      const vinButton = vinContainer?.querySelector('.vin-button, button, #vinBtn');
      const vinFromButton = vinButton?.textContent?.trim();

      // The model link and the VIN badge live in the same breadcrumb item.
      // Anchoring off the VIN container (rather than just ".breadcrumb-item a",
      // which also matches the unrelated "Home" breadcrumb link that comes
      // first in the DOM) reliably finds the model text next to it.
      const modelLine =
        vinContainer?.closest('.breadcrumb-item')?.querySelector('a')?.textContent?.trim() ??
        document.querySelector(".breadcrumb-item a:not(#link-breadcrumb-home)")?.textContent?.trim();

      const techInfo = document.querySelector('.tech-info')?.textContent?.trim();

      const vin = vinFromButton || vinFromUrl;
      if (!vin) return null;

      const parts = [modelLine, `VIN: ${vin}`, techInfo].filter(Boolean);
      return parts.join(' ');
    } catch {
      return null;
    }
  };

  let lastSentVehicleText: string | null = null;

  const checkForVehicleChange = (): void => {
    const text = scrapeVehicleText();
    if (!text) {
      console.log(LOG_PREFIX, 'page watch: no VIN found in URL/DOM on this page');
      return;
    }
    if (text === lastSentVehicleText) return;
    lastSentVehicleText = text;
    sendCapturedText(text, 'page watch');
  };

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleCheck = (): void => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkForVehicleChange, 500);
  };

  window.addEventListener('hashchange', scheduleCheck);

  const observer = new MutationObserver(scheduleCheck);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // Fallback in case continuous DOM mutations keep resetting the debounce above.
  setInterval(checkForVehicleChange, 1500);

  scheduleCheck();
}

// --- 5. "/" and "*" shortcuts ---
// "/" focuses the current group's "Groups or PNCs" search box directly —
// only does anything when that box is already on the page (a group's list
// view), so it never fights the browser's own "/" quick-find when it isn't.
// "*" is for when you're on a diagram/PNC detail page instead: there's no
// universal "tab 1" to jump back to from a diagram — reconstructing the
// destination URL by hand turned out to be a dead end (this app's
// hash-routing shapes are inconsistent across views, and even a
// byte-identical hash sometimes isn't navigable) — so it clicks through the
// same two controls a manual return-to-list does: the existing "Group
// selection" button (<button id="button-model-bom-large">), which takes you
// back to whichever specific group the current diagram belongs to (e.g.
// front bumper -> Body, suspension -> Powertrain), then the "All" tab
// (<div role="tab" class="... ALL ...">) to land on the full combined list
// rather than that one group, then focuses the search box once it renders.
{
  const SEARCH_BOX_SELECTORS = [
    '#search-input-field',
    'input[name="searchInput"]',
    '#pnc-search-input',
    'input[type="search"]',
    'input[placeholder*="Search" i]',
  ];
  const GROUP_SELECTION_BUTTON_SELECTOR = '#button-model-bom-large';
  const ALL_TAB_SELECTOR = 'div[role="tab"].ALL';

  const findSearchBox = (): HTMLInputElement | null => {
    for (const selector of SEARCH_BOX_SELECTORS) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLInputElement) return el;
    }
    return null;
  };

  const focusSearchBoxSoon = (): void => {
    const deadline = Date.now() + 3000;
    const attempt = (): void => {
      const el = findSearchBox();
      if (el) {
        el.focus();
        el.select();
        return;
      }
      if (Date.now() < deadline) setTimeout(attempt, 150);
    };
    attempt();
  };

  // Polls for `selector` (up to 3s, for Angular to finish re-rendering
  // after a click) and clicks it once found, then calls `onDone` regardless
  // of whether it was found — so a chain of these degrades gracefully
  // (e.g. still ends by trying to focus the search box) if a step's
  // element never shows up.
  const clickWhenPresentThen = (selector: string, logLabel: string, onDone: () => void): void => {
    const deadline = Date.now() + 3000;
    const attempt = (): void => {
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement) {
        console.log(LOG_PREFIX, `* shortcut: clicking ${logLabel}`);
        el.click();
        onDone();
        return;
      }
      if (Date.now() < deadline) {
        setTimeout(attempt, 150);
        return;
      }
      console.log(LOG_PREFIX, `* shortcut: ${logLabel} never appeared`);
      onDone();
    };
    attempt();
  };

  document.addEventListener(
    'keydown',
    (event) => {
      if ((event.key !== '/' && event.key !== '*') || event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable = target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (isEditable) return; // don't hijack typing in search boxes etc.

      if (event.key === '/') {
        const searchBox = findSearchBox();
        if (!searchBox) return; // not on a group's list view — let "/" do whatever it normally does
        event.preventDefault();
        event.stopImmediatePropagation();
        searchBox.focus();
        searchBox.select();
        return;
      }

      // "*"
      event.preventDefault();
      event.stopImmediatePropagation();

      const groupSelectionButton = document.querySelector(GROUP_SELECTION_BUTTON_SELECTOR);
      if (groupSelectionButton instanceof HTMLElement) {
        console.log(LOG_PREFIX, '* shortcut: clicking group selection button');
        groupSelectionButton.click();
      } else {
        console.log(LOG_PREFIX, '* shortcut: no group selection button found');
      }
      clickWhenPresentThen(ALL_TAB_SELECTOR, 'All tab', focusSearchBoxSoon);
    },
    true,
  );
}
