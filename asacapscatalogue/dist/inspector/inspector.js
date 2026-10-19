"use strict";
(() => {
  // src/vehicle/vin.ts
  var VIN_CHARS = "A-HJ-NPR-Z0-9";
  var VIN_REGEX = new RegExp(`\\b[${VIN_CHARS}]{17}\\b`, "gi");
  var LABEL_PATTERNS = [
    { pattern: /vehicle identification number/i, score: 5 },
    { pattern: /\bv\.?i\.?n\.?\b/i, score: 4 },
    { pattern: /\bchassis\s*(no\.?|number)?\b/i, score: 3 }
  ];
  var RECENCY_BOOST = /\bnew\b|\bcurrent\b/i;
  var RECENCY_PENALTY = /\bprevious\b|\bold\b|\bprior\b|\bformer\b/i;
  function looksLikeVin(candidate) {
    const hasLetter = /[A-Z]/i.test(candidate);
    const hasDigit = /[0-9]/.test(candidate);
    if (!hasLetter || !hasDigit) return false;
    if (/^(.)\1+$/.test(candidate)) return false;
    return true;
  }
  function findVinCandidates(text) {
    const candidates = [];
    let match;
    VIN_REGEX.lastIndex = 0;
    while ((match = VIN_REGEX.exec(text)) !== null) {
      const raw = match[0].toUpperCase();
      if (!looksLikeVin(raw)) continue;
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      const lineEnd = text.indexOf("\n", match.index);
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      const windowStart = Math.max(0, match.index - 60);
      const before = text.slice(windowStart, match.index);
      const contextForLabel = line + " " + before;
      let score = 0;
      for (const { pattern, score: labelScore } of LABEL_PATTERNS) {
        if (pattern.test(contextForLabel)) {
          score = Math.max(score, labelScore);
        }
      }
      const wideWindow = text.slice(Math.max(0, match.index - 80), match.index);
      if (RECENCY_BOOST.test(wideWindow)) score += 1;
      if (RECENCY_PENALTY.test(wideWindow)) score -= 1;
      candidates.push({ vin: raw, index: match.index, score });
    }
    return candidates;
  }
  function extractVIN(text) {
    if (!text || typeof text !== "string") return null;
    const candidates = findVinCandidates(text);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.index - a.index;
    });
    return candidates[0].vin;
  }

  // src/parts/part-parser.ts
  var PART_NUMBER_PATTERNS = [
    // e.g. 5253AN28, 5301J910, 6400A123, 6400BW040P, 7410A708XA, 6512A954XA,
    // 82821W070P — 4-5 digits, 1-2 letters, 2-4 digits, and an optional 0-2
    // letter colour/option suffix code.
    /^\d{4,5}[A-Z]{1,2}\d{2,4}[A-Z]{0,2}$/,
    /^M[RN]\d{5,7}$/,
    // e.g. MR123456, MN123456
    /^\d{6,8}$/,
    // plain numeric part numbers (6-8 digits)
    /^[A-Z]{2}\d{5,8}$/
    // two-letter prefix + digits
  ];
  var PART_LABEL = /part\s*(no\.?|number)?\s*[:\-]\s*(.+)/i;
  var DESCRIPTION_LABEL = /description\s*[:\-]\s*(.+)/i;
  var PNC_LABEL = /^pnc\s*[:\-]\s*(.+)$/i;
  function normalisePartNumber(raw) {
    return raw.trim().toUpperCase().replace(/\s+/g, "");
  }
  function matchesPartPattern(token) {
    const normalised = normalisePartNumber(token);
    return PART_NUMBER_PATTERNS.some((pattern) => pattern.test(normalised));
  }
  function findPartToken(line) {
    const tokens = line.split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const cleaned = tokens[i].replace(/[.,;]+$/, "");
      if (matchesPartPattern(cleaned)) {
        const rest = tokens.filter((_, idx) => idx !== i).join(" ").trim();
        return { partNumber: normalisePartNumber(cleaned), rest };
      }
    }
    return null;
  }
  function extractPnc(text) {
    for (const line of text.split(/\r?\n/)) {
      const match = line.trim().match(PNC_LABEL);
      if (match) return match[1].trim().toUpperCase();
    }
    return void 0;
  }
  function stripPncLines(text) {
    return text.split(/\r?\n/).filter((line) => !PNC_LABEL.test(line.trim())).join("\n");
  }
  function extractPart(text) {
    if (!text || typeof text !== "string") return null;
    const pnc = extractPnc(text);
    const withoutPnc = pnc ? stripPncLines(text) : text;
    const labeledPartMatch = withoutPnc.match(PART_LABEL);
    if (labeledPartMatch) {
      const candidate = labeledPartMatch[2].trim().split(/\r?\n/)[0].trim();
      if (matchesPartPattern(candidate)) {
        const result = { partNumber: normalisePartNumber(candidate) };
        const descMatch = withoutPnc.match(DESCRIPTION_LABEL);
        if (descMatch) {
          const desc = descMatch[1].trim().split(/\r?\n/)[0].trim();
          if (desc) result.description = desc;
        }
        if (pnc) result.pnc = pnc;
        return result;
      }
    }
    const lines = withoutPnc.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) return null;
    if (lines.length === 1) {
      const found = findPartToken(lines[0]);
      if (!found) return null;
      const result = { partNumber: found.partNumber };
      if (found.rest) result.description = found.rest;
      if (pnc) result.pnc = pnc;
      return result;
    }
    for (let i = 0; i < lines.length; i++) {
      const cleaned = lines[i].replace(/[.,;]+$/, "");
      if (matchesPartPattern(cleaned)) {
        const partNumber = normalisePartNumber(cleaned);
        const descriptionLine = lines.find((l, idx) => idx !== i);
        const result = { partNumber };
        if (descriptionLine) result.description = descriptionLine;
        if (pnc) result.pnc = pnc;
        return result;
      }
    }
    for (const line of lines.slice(0, 2)) {
      const found = findPartToken(line);
      if (found) {
        const result = { partNumber: found.partNumber };
        const otherLine = lines.find((l) => l !== line);
        const description = [found.rest, otherLine].filter(Boolean).join(" ").trim();
        if (description) result.description = description;
        if (pnc) result.pnc = pnc;
        return result;
      }
    }
    return null;
  }
  function parseTabularRow(line) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return null;
    const startIdx = /^\d{1,3}$/.test(tokens[0]) && tokens.length > 1 ? 1 : 0;
    const candidate = tokens[startIdx]?.replace(/[.,;]+$/, "");
    if (!candidate || !matchesPartPattern(candidate)) return null;
    const descriptionTokens = [];
    for (const token of tokens.slice(startIdx + 1)) {
      if (/^[\d.,]+$/.test(token)) break;
      descriptionTokens.push(token);
    }
    const result = { partNumber: normalisePartNumber(candidate) };
    const description = descriptionTokens.join(" ").trim();
    if (description) result.description = description;
    return result;
  }
  function extractParts(text) {
    if (!text || typeof text !== "string") return [];
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const tabularMatches = lines.map(parseTabularRow).filter((p) => p !== null);
    if (tabularMatches.length > 1) {
      const seen = /* @__PURE__ */ new Map();
      for (const part of tabularMatches) {
        if (!seen.has(part.partNumber)) seen.set(part.partNumber, part);
      }
      return Array.from(seen.values());
    }
    const single = extractPart(text);
    return single ? [single] : [];
  }

  // src/clipboard/clipboard-parser.ts
  function classifyClipboardText(text) {
    const trimmed = (text ?? "").trim();
    if (!trimmed) {
      return { classification: "UNKNOWN", vin: null, parts: [] };
    }
    const vin = extractVIN(trimmed);
    if (vin) {
      return { classification: "VEHICLE", vin, parts: [] };
    }
    const parts = extractParts(trimmed);
    if (parts.length > 0) {
      return { classification: "PART", vin: null, parts };
    }
    return { classification: "UNKNOWN", vin: null, parts: [] };
  }

  // src/shared/export.ts
  function triggerDownload(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 5e3);
  }

  // src/inspector/inspector.ts
  var $ = (id) => document.getElementById(id);
  var els = {
    rawInput: $("rawInput"),
    classification: $("classification"),
    detectedVin: $("detectedVin"),
    detectedPart: $("detectedPart"),
    detectedDesc: $("detectedDesc"),
    detectedPnc: $("detectedPnc"),
    fixtureName: $("fixtureName"),
    btnSaveFixture: $("btnSaveFixture")
  };
  function analyse() {
    const text = els.rawInput.value;
    const result = classifyClipboardText(text);
    els.classification.textContent = result.classification;
    els.detectedVin.textContent = result.vin ?? "\u2014";
    els.detectedPart.textContent = result.parts.length > 0 ? result.parts.map((p) => p.partNumber).join(", ") : "\u2014";
    els.detectedDesc.textContent = result.parts.length > 0 ? result.parts.map((p) => p.description ?? "\u2014").join(" | ") : "\u2014";
    els.detectedPnc.textContent = result.parts.length > 0 ? result.parts.map((p) => p.pnc ?? "\u2014").join(", ") : "\u2014";
  }
  els.rawInput.addEventListener("input", analyse);
  els.btnSaveFixture.addEventListener("click", () => {
    const name = els.fixtureName.value.trim() || `fixture-${Date.now()}.txt`;
    const filename = name.endsWith(".txt") ? name : `${name}.txt`;
    triggerDownload(filename, els.rawInput.value, "text/plain");
  });
  analyse();
})();
//# sourceMappingURL=inspector.js.map
