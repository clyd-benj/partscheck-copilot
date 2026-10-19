import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function fixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", name), "utf-8").trim();
}
