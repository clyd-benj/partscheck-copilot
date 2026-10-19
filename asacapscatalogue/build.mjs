import { build, context } from "esbuild";
import { mkdirSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";

const watch = process.argv.includes("--watch");

execFileSync(process.execPath, ["scripts/generate-icons.mjs"], { stdio: "inherit" });

mkdirSync("dist", { recursive: true });
mkdirSync("dist/popup", { recursive: true });
mkdirSync("dist/catalogue", { recursive: true });
mkdirSync("dist/inspector", { recursive: true });
mkdirSync("dist/offscreen", { recursive: true });

cpSync("src/popup/popup.html", "dist/popup/popup.html");
cpSync("src/popup/popup.css", "dist/popup/popup.css");
cpSync("src/catalogue/catalogue.html", "dist/catalogue/catalogue.html");
cpSync("src/catalogue/catalogue.css", "dist/catalogue/catalogue.css");
cpSync("src/inspector/inspector.html", "dist/inspector/inspector.html");
cpSync("src/inspector/inspector.css", "dist/inspector/inspector.css");
cpSync("src/offscreen/offscreen.html", "dist/offscreen/offscreen.html");

const entries = {
  "dist/service-worker.js": { entry: "src/background/service-worker.ts", format: "esm" },
  "dist/content.js": { entry: "src/content/content.ts", format: "iife" },
  "dist/popup/popup.js": { entry: "src/popup/popup.ts", format: "iife" },
  "dist/catalogue/catalogue.js": { entry: "src/catalogue/catalogue.ts", format: "iife" },
  "dist/inspector/inspector.js": { entry: "src/inspector/inspector.ts", format: "iife" },
  "dist/offscreen/offscreen.js": { entry: "src/offscreen/offscreen.ts", format: "iife" },
};

const commonOptions = {
  bundle: true,
  sourcemap: true,
  target: "chrome110",
  logLevel: "info",
};

async function run() {
  for (const [outfile, { entry, format }] of Object.entries(entries)) {
    const options = { ...commonOptions, entryPoints: [entry], outfile, format };
    if (watch) {
      const ctx = await context(options);
      await ctx.watch();
    } else {
      await build(options);
    }
  }
  if (watch) {
    console.log("Watching for changes...");
  } else {
    console.log("Build complete.");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
