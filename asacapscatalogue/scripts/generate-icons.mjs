// Generates the extension's PNG icons from base64 source files at build
// time, so no binary files need to be committed/pushed directly.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

mkdirSync("icons", { recursive: true });
for (const size of [16, 48, 128]) {
  const base64 = readFileSync(`icons-src/icon${size}.b64`, "utf-8").trim();
  writeFileSync(`icons/icon${size}.png`, Buffer.from(base64, "base64"));
}
console.log("Icons generated.");
