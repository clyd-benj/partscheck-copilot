import { classifyClipboardText } from "../clipboard/clipboard-parser";
import { triggerDownload } from "../shared/export";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  rawInput: $<HTMLTextAreaElement>("rawInput"),
  classification: $<HTMLSpanElement>("classification"),
  detectedVin: $<HTMLSpanElement>("detectedVin"),
  detectedPart: $<HTMLSpanElement>("detectedPart"),
  detectedDesc: $<HTMLSpanElement>("detectedDesc"),
  detectedPnc: $<HTMLSpanElement>("detectedPnc"),
  fixtureName: $<HTMLInputElement>("fixtureName"),
  btnSaveFixture: $<HTMLButtonElement>("btnSaveFixture"),
};

function analyse(): void {
  const text = els.rawInput.value;
  const result = classifyClipboardText(text);
  els.classification.textContent = result.classification;
  els.detectedVin.textContent = result.vin ?? "—";
  els.detectedPart.textContent =
    result.parts.length > 0 ? result.parts.map((p) => p.partNumber).join(", ") : "—";
  els.detectedDesc.textContent =
    result.parts.length > 0
      ? result.parts.map((p) => p.description ?? "—").join(" | ")
      : "—";
  els.detectedPnc.textContent =
    result.parts.length > 0 ? result.parts.map((p) => p.pnc ?? "—").join(", ") : "—";
}

els.rawInput.addEventListener("input", analyse);

els.btnSaveFixture.addEventListener("click", () => {
  const name = els.fixtureName.value.trim() || `fixture-${Date.now()}.txt`;
  const filename = name.endsWith(".txt") ? name : `${name}.txt`;
  triggerDownload(filename, els.rawInput.value, "text/plain");
});

analyse();
