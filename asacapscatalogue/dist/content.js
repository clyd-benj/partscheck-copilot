"use strict";
(() => {
  // src/content/content.ts
  var LOG_PREFIX = "[ASA CAPS Catalogue]";
  console.log(LOG_PREFIX, "content script loaded on", location.href, "top frame:", window.top === window);
  function sendCapturedText(text, source) {
    const trimmed = text.trim();
    if (!trimmed) return;
    console.log(LOG_PREFIX, `captured via ${source}:`, trimmed);
    const message = { type: "CLIPBOARD_CAPTURE", text: trimmed };
    chrome.runtime.sendMessage(message).catch((err) => {
      console.log(LOG_PREFIX, "sendMessage failed (background not ready?)", err);
    });
  }
  var ROW_SELECTOR = ".flex-list-content, [class*='flex-list'], li, tr";
  var DESCRIPTION_SELECTOR = ".break-word, .white-space, .flex-list-content .break-word";
  var PNC_SELECTOR = ".pnc-col > div, .pnc-col";
  var PNC_PATTERN = /^\d{4,6}[A-Z]{0,2}$/;
  function findRowDescription(row) {
    const descEl = row.querySelector(DESCRIPTION_SELECTOR);
    const text = descEl?.textContent?.trim();
    return text || null;
  }
  function findRowPnc(row) {
    if (row.id && PNC_PATTERN.test(row.id)) return row.id;
    const pncEl = row.querySelector(PNC_SELECTOR);
    const text = pncEl?.textContent?.trim();
    return text && PNC_PATTERN.test(text) ? text : null;
  }
  function captureSelection() {
    try {
      const selection = window.getSelection();
      const text = selection?.toString() ?? "";
      if (!text.trim()) return;
      const anchorNode = selection?.anchorNode ?? null;
      const anchorEl = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null;
      const row = anchorEl?.closest(ROW_SELECTOR) ?? null;
      const description = row ? findRowDescription(row) : null;
      const pnc = row ? findRowPnc(row) : null;
      const lines = [text];
      if (pnc && !text.includes(pnc)) lines.push(`PNC: ${pnc}`);
      if (description && !text.includes(description)) lines.push(description);
      sendCapturedText(lines.join("\n"), "copy event");
    } catch {
    }
  }
  document.addEventListener("copy", captureSelection, true);
  document.addEventListener("cut", captureSelection, true);
  var PART_BUTTON_SELECTOR = "#copyPartNoBtn, .part-no, [id^='copyPartNoBtn']";
  document.addEventListener(
    "click",
    (event) => {
      try {
        const target = event.target;
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
        sendCapturedText(lines.join("\n"), "part button click");
      } catch (err) {
        console.log(LOG_PREFIX, "part button click handler error", err);
      }
    },
    true
  );
  var lastPolledClipboard = "";
  async function pollClipboard() {
    try {
      if (!document.hasFocus()) return;
      const text = await navigator.clipboard.readText();
      if (!text || text === lastPolledClipboard) return;
      lastPolledClipboard = text;
      sendCapturedText(text, "clipboard poll");
    } catch (err) {
    }
  }
  setInterval(pollClipboard, 1200);
  if (window.top === window) {
    const VIN_IN_URL = /[?;&]vin=([A-HJ-NPR-Z0-9]{17})/i;
    const scrapeVehicleText = () => {
      try {
        const vinFromUrl = location.href.match(VIN_IN_URL)?.[1];
        const vinContainer = document.querySelector(".vin-container");
        const vinButton = vinContainer?.querySelector(".vin-button, button, #vinBtn");
        const vinFromButton = vinButton?.textContent?.trim();
        const modelLine = vinContainer?.closest(".breadcrumb-item")?.querySelector("a")?.textContent?.trim() ?? document.querySelector(".breadcrumb-item a:not(#link-breadcrumb-home)")?.textContent?.trim();
        const techInfo = document.querySelector(".tech-info")?.textContent?.trim();
        const vin = vinFromButton || vinFromUrl;
        if (!vin) return null;
        const parts = [modelLine, `VIN: ${vin}`, techInfo].filter(Boolean);
        return parts.join(" ");
      } catch {
        return null;
      }
    };
    let lastSentVehicleText = null;
    const checkForVehicleChange = () => {
      const text = scrapeVehicleText();
      if (!text) {
        console.log(LOG_PREFIX, "page watch: no VIN found in URL/DOM on this page");
        return;
      }
      if (text === lastSentVehicleText) return;
      lastSentVehicleText = text;
      sendCapturedText(text, "page watch");
    };
    let debounceTimer;
    const scheduleCheck = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkForVehicleChange, 500);
    };
    window.addEventListener("hashchange", scheduleCheck);
    const observer = new MutationObserver(scheduleCheck);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setInterval(checkForVehicleChange, 1500);
    scheduleCheck();
  }
  {
    let findSearchBox = function() {
      for (const selector of SEARCH_BOX_SELECTORS) {
        const el = document.querySelector(selector);
        if (el instanceof HTMLInputElement) return el;
      }
      return null;
    }, focusSearchBoxSoon = function() {
      const deadline = Date.now() + 3e3;
      const attempt = () => {
        const el = findSearchBox();
        if (el) {
          el.focus();
          el.select();
          return;
        }
        if (Date.now() < deadline) setTimeout(attempt, 150);
      };
      attempt();
    }, clickWhenPresentThen = function(selector, logLabel, onDone) {
      const deadline = Date.now() + 3e3;
      const attempt = () => {
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
    findSearchBox2 = findSearchBox, focusSearchBoxSoon2 = focusSearchBoxSoon, clickWhenPresentThen2 = clickWhenPresentThen;
    const SEARCH_BOX_SELECTORS = [
      "#search-input-field",
      'input[name="searchInput"]',
      "#pnc-search-input",
      'input[type="search"]',
      'input[placeholder*="Search" i]'
    ];
    const GROUP_SELECTION_BUTTON_SELECTOR = "#button-model-bom-large";
    const ALL_TAB_SELECTOR = 'div[role="tab"].ALL';
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "/" && event.key !== "*" || event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target;
        const tag = target?.tagName;
        const isEditable = target?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
        if (isEditable) return;
        if (event.key === "/") {
          const searchBox = findSearchBox();
          if (!searchBox) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          searchBox.focus();
          searchBox.select();
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        const groupSelectionButton = document.querySelector(GROUP_SELECTION_BUTTON_SELECTOR);
        if (groupSelectionButton instanceof HTMLElement) {
          console.log(LOG_PREFIX, "* shortcut: clicking group selection button");
          groupSelectionButton.click();
        } else {
          console.log(LOG_PREFIX, "* shortcut: no group selection button found");
        }
        clickWhenPresentThen(ALL_TAB_SELECTOR, "All tab", focusSearchBoxSoon);
      },
      true
    );
  }
  var findSearchBox2;
  var focusSearchBoxSoon2;
  var clickWhenPresentThen2;
})();
//# sourceMappingURL=content.js.map
