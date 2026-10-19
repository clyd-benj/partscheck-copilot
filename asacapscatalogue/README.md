# ASA CAPS VIN → Part Number Catalogue

A Chrome/Edge (Manifest V3) extension that passively builds a local VIN → part
number catalogue while you work normally in ASA CAPS. It watches what you
copy, recognises vehicle VINs and part numbers, keeps track of a single
**active vehicle session**, and files every copied part under the vehicle
that was active when it was copied.

Everything is stored locally in IndexedDB. There is no backend, no
authentication, no analytics, and no external network calls — the extension
works completely offline after installation.

## How it works

1. A content script runs on the ASA CAPS pages (`myasaweb.com` by default)
   and listens for `copy`/`cut` events. It reads exactly what you selected
   (`window.getSelection()`) and forwards that text to the background
   service worker. It never blocks or alters the native copy behaviour.
2. The background service worker classifies the text as `VEHICLE`, `PART`,
   or `UNKNOWN`:
   - **VIN detection always runs first.** If a valid VIN is found, it either
     starts a new vehicle session, switches to a new vehicle (closing the
     previous session — its data is never lost or reassigned), or just
     refreshes the current session if the VIN is unchanged.
   - Only if no VIN is found does the text get checked for a part number
     pattern. Parts are only ever stored against the **currently active**
     vehicle session.
   - Anything that's neither a VIN nor a recognised part number is ignored
     (optionally logged, off by default, for privacy).
3. All data (vehicles, sessions, part fitments) lives in IndexedDB, shared
   by the popup, the catalogue page, and the background service worker
   (they're all the same `chrome-extension://` origin).

### Data model

```
vehicles   — one record per VIN (make/model/variant/year + ASA-specific fields)
sessions   — one record per "active vehicle" period (start/end, part count)
fitments   — one record per (VIN, part number) pair, with timesCopied
events     — optional debug log of ignored/unknown clipboard events
settings   — capture enabled, debug mode, log-unknown-events toggle
```

A **fitment** (`vehicles/sessions/fitments`) is the VIN ↔ part number
relationship — the core of the future parts-recommendation catalogue.
Re-copying the same part just increments `timesCopied`; it never creates a
duplicate record, and it never gets reassigned if you later switch vehicles.

## Project structure

```
manifest.json                 MV3 manifest
build.mjs                     esbuild bundler (no framework, just TS → JS)
src/
  shared/types.ts             Vehicle / VehicleSession / PartFitment / Settings ...
  shared/messages.ts          content-script ↔ background message contract
  shared/export.ts            CSV/JSON export helpers (used by popup + catalogue)
  vehicle/vin.ts               extractVIN() — VIN detection + confidence scoring
  vehicle/vehicle-extract.ts   extractVehicleFields() — make/model/variant/... incl. ASA CAPS format
  vehicle/vehicle-session.ts   processClipboardText() — the VIN-before-part pipeline, session lifecycle
  parts/part-parser.ts         extractPart() — configurable part-number patterns
  clipboard/clipboard-parser.ts classifyClipboardText() — VEHICLE / PART / UNKNOWN
  database/database.ts         IndexedDB wrapper (vehicles/sessions/fitments/events/settings)
  content/content.ts            copy/cut listener → sends text to background
  background/service-worker.ts  classifies, updates DB, fires VIN-change notifications
  popup/                        popup UI (active vehicle, recent parts, manual controls, debug panel)
  catalogue/                    full-page searchable catalogue + CSV/JSON export
  inspector/                    Clipboard Inspector — paste ASA CAPS text, see exactly what's detected
tests/
  fixtures/                     sample clipboard text (incl. a real ASA CAPS breadcrumb capture)
  *.test.ts                     vitest unit tests (40 tests covering the 9 spec scenarios)
```

## Install (load unpacked)

1. `npm install`
2. `npm run build` (generates `icons/*.png` from `icons-src/*.b64`, then
   bundles everything into `dist/`)
3. Open `chrome://extensions` (or `edge://extensions`)
4. Enable **Developer mode**
5. Click **Load unpacked** and select this project's root folder (the one
   containing `manifest.json`)
6. The extension icon appears in the toolbar. Pin it for easy access.

After editing source files, re-run `npm run build` (or `npm run watch` for
continuous rebuilding) and click the refresh icon on the extension card in
`chrome://extensions`.

## Using it

- Browse to ASA CAPS and copy vehicle details as you normally would (e.g.
  selecting the VIN/model breadcrumb). The popup will show it as the
  **Active Vehicle**.
- Copy part numbers/descriptions as usual — they're filed under the active
  vehicle automatically.
- When you navigate to a different vehicle and copy its details, the
  extension detects the new VIN, closes the previous session (its data is
  preserved), switches the active vehicle, and shows a desktop notification
  confirming the switch.
- Open the popup to see the active vehicle and recent parts, or click
  **View Catalogue** for the full searchable catalogue and CSV/JSON export.

### Manual controls (popup)

- **Set Vehicle Manually** — type a 17-character VIN to force it active.
- **Close Current Vehicle** / **Clear Session** — close the active session
  without waiting for a new VIN.
- **Pause capture** — temporarily stop processing clipboard events (nothing
  is captured or stored while paused).
- **Debug mode** — shows the last clipboard event's classification, detected
  VIN/part, and the action taken. **Copy Debug Information** copies it as
  JSON for bug reports.
- **Log unknown clipboard events** — off by default (privacy: unknown
  clipboard content may contain customer names/addresses). When on, only a
  short preview and classification are logged, never used to create catalogue
  records.

### Clipboard Inspector

Because every ASA CAPS install can present slightly different clipboard
text, use **Open Clipboard Inspector** in the popup (or `dist/inspector/inspector.html`)
to paste in real copied text and see exactly what's detected — classification,
VIN, part number, description — live as you type. **Save Test Fixture**
downloads the pasted text as a `.txt` file you can drop into
`tests/fixtures/` to extend the parser's test coverage with real formats.

## ASA CAPS-specific parsing

The vehicle extractor has a dedicated parser for the real ASA CAPS
(myasaweb.com) breadcrumb, confirmed from an actual capture:

```
ASX(MMAL) 2000 | LS(2WD),S-CVT   VIN: JMFXTGA2WBZ003283
Model: GA2W  Classification: XTSHR8  Option: M09  Exterior: X42A
Interior: 22X  From: 2010.12.3  To: 2010.12.3
```

which is parsed into `model=ASX`, `chassisCode=MMAL`, `variant=LS(2WD),S-CVT`,
`modelCode=GA2W`, `classification`, `option`, `exteriorColor`, `interiorColor`,
`productionFrom/To`, and `year` (from the production date). `make` is filled
in as "Mitsubishi" only when this ASA CAPS-specific signature is present,
since ASA CAPS is a Mitsubishi-only system — not guessed per vehicle.

A generic fallback parser (make/model/variant/year/engine/transmission) also
runs for other formats (e.g. plain "Mitsubishi Triton GLX-R / 2019 / 2.4L
Diesel / Automatic" text), so the extension keeps working if your ASA CAPS
instance copies text differently. If you find a clipboard format that isn't
parsed well, use the Clipboard Inspector to capture it and extend
`vehicle-extract.ts` / `part-parser.ts` / `tests/fixtures/`.

## Part number recognition

`PART_NUMBER_PATTERNS` in `src/parts/part-parser.ts` is a configurable list
of regexes (Mitsubishi-style `5253AN28`, `MR`/`MN`-prefixed, plain numeric,
etc.) — extend it as you observe more real part number formats. The parser
never infers a part number from a description alone; if no pattern matches,
nothing is stored.

## Privacy

- No analytics, telemetry, external API calls, or cloud storage of any kind.
- Only the fields needed for the catalogue (VIN, vehicle info, part number,
  description, timestamps) are stored.
- Unknown clipboard content (which could include customer names, addresses,
  phone numbers) is **never** stored unless you explicitly opt in via
  "Log unknown clipboard events" — and even then only a short preview and
  classification are kept, never used to build catalogue records.

## Testing

```
npm test
```

Runs the vitest suite (`fake-indexeddb` provides a real IndexedDB
implementation in Node) covering:

- VIN extraction: labelled/unlabelled VINs, exclusion of I/O/Q, false-positive
  rejection, multi-candidate disambiguation, the real ASA CAPS format.
- Part number extraction: bare numbers, number+description in either order,
  labelled `Part No:`/`Description:` format, never guessing from a
  description alone.
- Clipboard classification (VEHICLE/PART/UNKNOWN) and VIN-before-part
  ordering.
- Vehicle field extraction, including the real ASA CAPS breadcrumb.
- The full session pipeline — the 9 scenarios from the spec: first VIN,
  part after VIN, multiple parts, repeated VIN (no new session), VIN change
  (session closed/created, notification), part after VIN change, invalid VIN
  (no change), unknown clipboard (ignored), duplicate part (timesCopied
  increments, no duplicate fitment) — plus a check that no data is lost or
  reassigned across a VIN change.

## Known limitations (MVP)

- Content script currently targets `myasaweb.com`/`asacaps.com`; add your
  dealer's ASA CAPS domain to `content_scripts.matches` and
  `host_permissions` in `manifest.json` if it differs, then rebuild.
- Part number patterns and the generic vehicle-field parser are heuristic —
  use the Clipboard Inspector to validate against your real ASA CAPS
  clipboard output and extend the patterns/fixtures as needed.
- VIN validation is character-set/length/label-based (no ISO 3779 check-digit
  validation), by design favouring "don't switch on a weak candidate" over
  cleverness.
