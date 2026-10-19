# Parts Interpreter Toolkit

A Chrome extension (Manifest V3) that injects a read-only sidebar into
PartsCheck RFQ pages — surfacing customer, vehicle, and requested-part
details — and a passive VIN → part-number catalogue for ASA CAPS
(Mitsubishi's Aftersales Support Application), so a Parts Interpreter
doesn't have to re-read, re-type, or re-look-up the same information by
hand while quoting in Pentana ERA.

The extension never modifies either page, and it does not automate
quoting, ERA, CSV upload, or part lookups. It is a read-only productivity
layer.

## Tech stack

- Chrome Extension Manifest V3
- React + TypeScript
- Vite + [`@crxjs/vite-plugin`](https://crxjs.dev/vite-plugin) (MV3-aware bundling, HMR)
- Tailwind CSS
- IndexedDB (two separate databases — see "Why two databases" below)
- SheetJS / `xlsx` (customer spreadsheet import/export)
- Fuse.js (fuzzy customer matching)
- Vitest + fake-indexeddb (unit tests for the ASA CAPS parsing/session logic)
- ESLint + Prettier

## Project structure

```
manifest.config.ts       MV3 manifest, defined with @crxjs/vite-plugin's defineManifest
vite.config.ts            Vite build config
vitest.config.ts          Vitest config (node environment + fake-indexeddb)
src/
  background/             MV3 service worker: relays both databases to content scripts,
                           handles ASA CAPS clipboard captures, auto-backup alarm/orchestration
  content/
    index.tsx              PartsCheck content script: detects the RFQ page, mounts the sidebar
    asacaps.tsx             ASA CAPS content script: clipboard/DOM capture paths, mounts its sidebar
  sidebar/
    Sidebar.tsx             PartsCheck sidebar (Customer, Customer Match, Quote Details, Vehicle, Parts)
    AsaCapsSidebar.tsx      ASA CAPS sidebar (Active Vehicle, Recent Parts, Controls)
    sections/               Section components for both sidebars
  components/              Shared UI primitives (FieldRow, SectionCard)
  services/
    extractors/             PartsCheck RFQ field extractors
    rfqDetection.ts         isRfqPage() — URL + DOM marker check
    customerMatching.ts     Fuse.js matching against the imported customer database
    spreadsheetImport.ts    SheetJS parsing + validation for the customer spreadsheet
    spreadsheetExport.ts    Rebuilds an .xlsx from the current customer database
    messaging.ts            Typed runtime-message contract between content scripts and background
    asacaps/                vin.ts, vehicle-extract.ts, part-parser.ts, clipboard-parser.ts,
                             vehicle-session.ts, catalogueExport.ts, coverage.ts — pure logic,
                             unit-tested, no UI dependencies
  storage/
    customerDb.ts           IndexedDB wrapper for the customer database
    customerDbMeta.ts       Import metadata (chrome.storage.local)
    asacapsDb.ts             IndexedDB wrapper for vehicles/sessions/fitments/events/settings/backup
  popup/                    Extension popup: Customer Database tab + ASA CAPS settings/debug tab
  catalogue/                Full-page searchable catalogue: export/import, coverage, auto-backup
  offscreen/                Hidden document that performs the auto-backup file write
                            (File System Access API needs a DOM, which the service worker lacks)
  types/                    Shared TypeScript types
  styles/                   Tailwind entry points (one per Shadow-DOM-injected surface)
  assets/icons/             Extension icons (16/32/48/128)
tests/                      Vitest unit tests for the ASA CAPS logic (57 tests)
  fixtures/                 Sample clipboard text, including a real ASA CAPS breadcrumb capture
```

## Why a Shadow DOM

Both content scripts mount their sidebar inside a Shadow DOM attached to
`document.documentElement`. This is what makes "read-only" actually true
at the CSS level: the host page's stylesheets cannot bleed into the
sidebar, and Tailwind's base reset cannot bleed out and change the host
page's own layout or typography. Each sidebar is a self-contained overlay,
not a modification of the host page.

## Why two databases

The customer database (`customerDb.ts`) and the ASA CAPS catalogue
(`asacapsDb.ts`) are separate IndexedDB databases rather than one merged
schema. They're logically unrelated — one is an imported spreadsheet of
trade accounts, the other is a passively-built VIN/part catalogue — and
merging them would add migration risk for no real benefit. A future
feature could join them in memory by VIN if that turns out to be useful.

Both are IndexedDB, which is origin-scoped: content scripts run in the
*host page's* origin (`partscheck.com.au` or `myasaweb.com`/`asacaps.com`),
not the extension's `chrome-extension://` origin, so they can't open
either database directly. They go through the background service worker
instead, which shares the extension's origin with the popup and catalogue
page (see `services/messaging.ts` and `background/index.ts`).

## Getting started

```bash
npm install
npm run dev      # starts Vite in watch mode with HMR
```

Then load the extension in Chrome:

1. Go to `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder produced by `npm run dev` (CRXJS writes a live-reloading build there — leave the dev server running).
4. Visit a page on `https://*.partscheck.com.au/*` (a `price-quote.php` RFQ) or `*://*.myasaweb.com/*` / `*://*.asacaps.com/*` — the matching sidebar appears on the right edge of the page.

For a one-off production build (no HMR):

```bash
npm run build     # outputs to dist/
```

Other scripts:

```bash
npm run typecheck  # tsc project-references build, no emit of JS
npm run lint       # ESLint, zero warnings allowed
npm run format     # Prettier, writes in place
npm test           # Vitest, runs the ASA CAPS logic test suite once
npm run test:watch # Vitest in watch mode
```

## Using it

**PartsCheck**: open an RFQ (`price-quote.php`). The sidebar shows the
extracted Customer, an automatic Customer Match against your imported
spreadsheet (only shown when it's an exact match — a close-but-not-exact
guess is worse than no suggestion), Quote Details, Vehicle (VIN and
Registration are click-to-copy), and a Requested Parts checklist. If no
exact customer match is found, you can add a new customer directly from
the sidebar (pre-filled with the extracted name/address) — it's saved to
the extension's database immediately, and you can export an updated
spreadsheet from the popup whenever you want your master file back in
sync (see "Customer database" below).

**ASA CAPS**: browse normally and copy vehicle/part details as you always
would. The sidebar shows the Active Vehicle, Recent Parts (click-to-copy
part numbers), and manual controls (set vehicle manually, close session,
pause capture). The toolbar popup's ASA CAPS tab has debug mode, the
"log unknown events" privacy toggle, and a link to the full Catalogue page
(search every VIN/part pairing ever captured, export CSV/JSON, connect an
auto-backup folder).

### Customer database (popup)

Click the toolbar icon → **Customer Database** tab to import your trade
customer spreadsheet (3 columns, in order: Customer #, Name, Address — a
header row is optional, auto-detected). You won't need to re-import
unless you choose to replace it. **Export Updated Spreadsheet** downloads
a fresh `.xlsx` with everything currently in the database, including any
customers added from the sidebar — save it over your original file
whenever you want them back in sync.

## A note on the `xlsx` package

`npm audit` flags the published `xlsx` (SheetJS) package for a prototype
pollution / ReDoS advisory with no npm-side fix yet. The files it parses
are always ones the user deliberately imports (their own spreadsheet),
not untrusted input from the network, which limits the practical risk —
but it's worth revisiting SheetJS's officially patched CDN build at some
point rather than treating this as settled.
