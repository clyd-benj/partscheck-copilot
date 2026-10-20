import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "fixtures", "partscheck");

/**
 * Trimmed, anonymised saves of one real PartsCheck quote (draftID replaced
 * by 10000001), before and after DMS Upload of the ERA CSV below.
 */
export function loadQuotePage(name: "quote-filled" | "quote-empty"): Document {
  const html = readFileSync(join(DIR, `${name}.html`), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

/** The ERA CSV that was DMS-uploaded into quote-filled.html, one entry per line. */
export function loadEraCsvLines(): { partNumber: string; description: string; notes: string }[] {
  return readFileSync(join(DIR, "era-quote-1050894R.csv"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const fields = Array.from(line.matchAll(/("([^"]*)"|[^,]*)(,|$)/g), (m) => m[2] ?? m[1]).slice(0, 8);
      return { partNumber: fields[2].replace(/^MI/, ""), description: fields[3], notes: fields[7] ?? "" };
    });
}
