# HANDOFF.md — Parts Interpreter Toolkit

**Read this entire file before touching anything.** It exists because this project's git
history was lost once already (see "The repo history, in full" below) and because the
reasoning behind several non-obvious decisions is not visible from the code alone. If you
are an agent picking this up cold: clone the repo, read this file end to end, then verify
the current state yourself (`npm install && npm run build && npm run lint && npm test`)
before making changes.

---

## 1. What this project is

A Chrome extension (Manifest V3) for a **Parts Interpreter** at a car dealership — a
real person, not a hypothetical persona, who works with this tool daily. It is explicitly
**not** an automation tool. It does not quote parts, does not drive Pentana ERA, does not
automate PartsCheck or ASA CAPS. It is a read-only productivity layer: it extracts and
surfaces information that the interpreter would otherwise have to read, remember, and
retype by hand.

The user's real workflow:
1. Receives an RFQ (request for quote) through **PartsCheck** (`partscheck.com.au`), an
   Australian repairer/supplier marketplace.
2. Needs the customer's company name, address, phone, their internal customer number
   (from their own trade-customer spreadsheet, not on the page), the vehicle's VIN/make/
   model/variant/registration, and the list of requested parts.
3. Separately, uses **ASA CAPS** (`myasaweb.com` / `asacaps.com`), Mitsubishi's own
   Aftersales Support Application, to look up genuine OEM part numbers for a vehicle by
   VIN, while quoting in Pentana ERA (not part of this extension).
4. Exports a CSV and uploads it back into PartsCheck (not part of this extension either).

The extension's job is steps 2 and 3: surface what's already on the page faster, and
remember what's been looked up in ASA CAPS so it isn't re-looked-up.

**Two independent capabilities, one extension:**
- A **PartsCheck sidebar**: reads the RFQ page, shows Customer / Customer Match (fuzzy
  lookup against an imported spreadsheet) / Quote Details / Vehicle / Requested Parts.
- An **ASA CAPS popup + catalogue**: passively watches clipboard copy events on ASA CAPS
  pages (no page-injected UI — see §5.7), builds a local VIN → part-number catalogue, shows
  the active vehicle and recently captured parts in the toolbar popup.

These two halves do **not** currently talk to each other (e.g. there is no "parts seen for
this VIN in ASA CAPS" shown inside the PartsCheck sidebar). That cross-reference was
explicitly scoped out as a "phase 2" feature — see §7.

---

## 2. The repo history, in full (read this before you panic about anything)

This matters because the git history looks short (4 commits) for what is actually a large,
multi-week effort, and because a past agent (me, in an earlier session) nearly reported
data loss that didn't actually happen. Future agents should not repeat that confusion.

**What actually happened, in order:**

1. An earlier agent session built the entire Parts Interpreter Toolkit (PartsCheck sidebar,
   customer database import/matching, etc.) from scratch, iterating heavily based on live
   user feedback and bug reports (see §4 for the full list of bugs found and fixed).
2. **That agent could never get `git push` or GitHub API writes to work.** Every attempt
   returned either a raw 403 or `"403 Resource not accessible by integration"`. The agent
   worked around this by building the extension locally in its (ephemeral, cloud-sandboxed)
   session container and sending the user zipped `dist/` builds directly via file transfer,
   which the user loaded as unpacked extensions in Chrome to test. **This worked fine for
   testing, but it meant the actual source code was never pushed to GitHub.**
3. That session's container was later discarded (sessions are ephemeral; nothing persists
   except what's pushed to git). All of that source code is **gone** — not recoverable,
   not sitting in some other branch. It only ever existed in that container and in the
   conversation transcript.
4. Separately, at some point, **the user (or someone with repo access) uploaded an
   unrelated project to this same repo via GitHub's web UI** ("Add files via upload",
   commit `2f20c6b`) — a different Chrome extension called **"ASA CAPS VIN → Part Number
   Catalogue"** (`asacapscatalogue/`), built independently, with its own working test suite
   (vitest + fake-indexeddb, 40+ tests) and no relation to the Parts Interpreter Toolkit
   codebase. This became the *only* commit on both `main` and
   `claude/parts-interpreter-toolkit-mvp-wib3qm`.
5. A new agent session (me, this one) started with **zero files on disk** except that
   unrelated `asacapscatalogue/` project and `.git`. The user asked "what's in the repo,"
   got an honest answer, then asked to **integrate the two** — rebuild the Parts
   Interpreter Toolkit from scratch (from the conversation transcript's memory of exactly
   what was built and every bug fix applied) and merge the ASA CAPS catalogue into it,
   "keeping the interface of our toolkit" (i.e. the Tailwind/React/Shadow-DOM sidebar
   design, not ASA CAPS's original vanilla-DOM popup/pages).
6. That rebuild + merge is **commits `087e138`, `8caefdd`, `7db0ff7`** — the three commits
   currently on top of `2f20c6b`. The old `asacapscatalogue/` folder was deleted in the
   last of these three, once every piece of its functionality had a verified Tailwind/React
   equivalent integrated into the toolkit.
7. **GitHub push access was broken for the entire rebuild effort** (same "Resource not
   accessible by integration" / "Claude doesn't have GitHub access ... for your
   organization" error as before) until literally the message after the rebuild was
   reported complete, at which point a retried `git push` succeeded with no code changes
   on my end — the org's GitHub App connection was fixed on the user's/org's side between
   those two messages. **As of this writing, push access works.** Do not assume it's
   permanently broken, but also don't be surprised if it breaks again — it's an
   organization-level GitHub App installation/connection issue, not something fixable from
   within a session.

**Current ground truth:** `claude/parts-interpreter-toolkit-mvp-wib3qm` on
`clyd-benj/partscheck-copilot` has 4 commits and is fully pushed. There is no uncommitted
work anywhere. `main` still only has commit `2f20c6b` (the unrelated upload) — nobody has
merged the feature branch into `main` yet; that's presumably still pending the user's own
review/decision, not something to do unprompted.

**If push ever fails again** with a 403/"Resource not accessible by integration": this is
not something you can fix by retrying forever or by finding a workaround (don't try GitHub
API writes as a substitute — same permission boundary). Report it plainly, once, with the
exact error text, and keep working locally (commit normally; just don't assume the push
succeeded until you've confirmed it). If the user says "try again" later, retry exactly
once and report the outcome — don't loop.

---

## 3. Tech stack and why

- **Vite + `@crxjs/vite-plugin` + React + TypeScript + Tailwind CSS.** Chosen at the very
  start of the project for a production-quality MV3 extension with HMR during development.
- **Fuse.js** for fuzzy customer-name matching.
- **`idb`** (tiny promise wrapper around IndexedDB) for the customer database. Chosen
  deliberately over hand-rolled raw IndexedDB for that one store, for readability.
- **Raw IndexedDB** (no `idb` wrapper) for the ASA CAPS catalogue database — this was
  inherited as-is from the original `asacapscatalogue` project during the port, and left
  alone rather than rewritten to use `idb`, since it was already solid, tested code. (This
  is a deliberate inconsistency — two different IndexedDB access styles in one project —
  that was judged not worth "fixing" purely for uniformity.)
- **SheetJS (`xlsx`)** for customer spreadsheet import/export. **Known issue:** `npm audit`
  flags this package for a prototype-pollution/ReDoS advisory with no npm-side fix. Risk is
  judged low in practice because the files parsed are always ones the user deliberately
  imports, never untrusted network input — but this hasn't been "fixed," just accepted and
  documented in the README. Worth revisiting SheetJS's patched CDN build at some point.
- **Vitest + fake-indexeddb** for the ASA CAPS logic test suite (57 tests). This is new as
  of the rebuild — the original Parts Interpreter Toolkit build had no test runner at all;
  instead that agent verified things with disposable Node scripts (bundled via `esbuild`,
  run directly, deleted after) that exercised the real logic against real sample data. That
  approach is *why* several of the bugs in §4 were caught at all — the agent's practice was
  to never trust that code "looks right," always run it against a real or realistic
  payload before calling something done. **Keep doing this** for any new non-trivial logic,
  even logic in files that aren't part of the formal vitest suite.
- **No state management library, no routing library, no UI component library.** Everything
  is hand-rolled, deliberately, to keep the bundle small and the code legible. Don't
  introduce one without a concrete need.

---

## 4. The PartsCheck side — detailed history, every bug and why

### 4.1 Architecture

- `src/content/index.tsx` — content script. Checks `isRfqPage()` (from
  `src/services/rfqDetection.ts`), and if true, mounts `src/sidebar/Sidebar.tsx` inside a
  **closed(`'open'`) Shadow DOM** attached to a host `<div>` on `document.documentElement`.
  The Shadow DOM is the single most important architectural decision in this half of the
  project: it's what makes "read-only" literally true at the CSS level — PartsCheck's
  styles can never bleed into the sidebar, and Tailwind's base reset can never bleed out
  and change PartsCheck's own page.
- `isRfqPage()` checks **both** the URL path (`/price-quote\.php/i` against
  `location.pathname`) **and** two DOM markers (`#lineTable` present, a `.quoteTitleBar`
  whose text is exactly `"Vehicle Info"`) — not either alone, to avoid false positives on
  other PartsCheck pages that might incidentally have one of these.
- `src/services/extractors/` — one file per concern: `dom.ts` (shared `.quoteTitle` /
  `.quoteTitleContent` label→value lookup helper), `customer.ts`, `vehicle.ts`, `parts.ts`,
  `metadata.ts`, composed by `index.ts`'s `extractRfqData()`.

### 4.2 PartsCheck's actual DOM structure (confirmed against a real page export)

PartsCheck renders RFQ fields as repeated
`<div class="quoteTitle">Label</div><div class="quoteTitleContent">Value</div>` pairs.
There is no per-field `id` or `data-*` attribute — **label text is the only stable
selector**, which is why `findQuoteFieldContent(label)` does a linear scan over
`.quoteTitle` elements matching on exact (whitespace-collapsed) text.

Confirmed real field labels and what they map to:
| PartsCheck label | Extracted as | Notes |
|---|---|---|
| `Purchaser` | Customer company/address/phone | Single block, `<br>`-separated lines: company, then address line(s), then a `Ph: ...` line. No separate contact-name or email field exists anywhere on this page. |
| `Make` | `vehicle.make` | |
| `Model` | `vehicle.model` | |
| `Series` | `vehicle.variant` | PartsCheck's own term for trim level |
| `VIN` | `vehicle.vin` | **Rendered as an `<input type="text">` value, not plain text** — `readQuoteField()` checks for an input first, falls back to `textContent` |
| `Veh Reg` | `vehicle.registration` | PartsCheck's own term |
| `Reference` | `reference` | The **repairer's own job/reference number**, not something the supplier generates — the field is deliberately *not* called "Supplier Reference" in code/UI even though the original spec used that phrase, because it would have mislabeled what the field actually is |
| `Required By` | `requiredBy` | Due date/time for the quote, e.g. "06/08/2026 11:30am" |
| (requested parts) | `requestedParts[]` | Each is a `tr.lineRow[data-parttext]`; see 4.3 below |

**Fields that do not exist on this page and were deliberately left unimplemented, not
faked:** Contact Name, Email, Customer Notes, Urgency. The user initially asked for these
(they were in the original spec), got shown they don't exist in the real markup, and
explicitly confirmed to leave them out rather than guess at a different page/quote type
that might have them.

### 4.3 Requested parts extraction

Each requested part is a `<tr class="lineRow" data-parttext="..." data-draft_item_id="...">`.
**Bug found and fixed:** `row.dataset.draftItemId` was used initially (camelCase, matching
normal `dataset` conversion rules), but `data-draft_item_id` has an **underscore**, and
`HTMLElement.dataset` only camelCases **hyphens**, not underscores — so
`dataset.draftItemId` was silently `undefined` for every row, and the parts list came back
empty. **Fixed** by using `row.getAttribute('data-draft_item_id')` directly for both that
and `data-parttext`, rather than relying on `dataset` at all. This was caught by a
throwaway jsdom-based verification script run against the real uploaded HTML export, not
by inspection — the bug was invisible by just reading the code.

Rows hidden via inline `style="display:none"` (the interpreter has deleted them
client-side) are filtered out.

### 4.4 Customer name/address extraction — the HTML-entity bug

**Bug reported by user:** "it's extracting names such as J&M Prestige Accident Centre as
J&amp;M Prestige Accident Centre" — breaking exact-match customer lookup for any company
name containing `&` (or any other HTML entity).

**Root cause:** the original implementation read the `Purchaser` block's `innerHTML` as a
string and used a regex to strip tags (needed to preserve the `<br>`-separated lines).
Regex tag-stripping never decodes HTML entities, so `&amp;` stayed literal.

**Fix:** walk the content div's **child nodes** directly instead of regex-parsing the HTML
string. Each text node's `.textContent` is already entity-decoded by the browser; splitting
on actual `<br>` **element nodes** (checking `node.nodeType === Node.ELEMENT_NODE &&
node.tagName === 'BR'`) preserves the same line boundaries the regex approach was there
for, without the entity bug. Verified with a synthetic `J&amp;M Prestige Accident Centre`
fixture before and after the fix.

### 4.5 Customer database import, matching, and the confidence-threshold decision

- `src/storage/customerDb.ts` — IndexedDB (via `idb`), store `customers` keyed by
  `customerNumber`. Database name `parts-interpreter-toolkit`.
- `src/services/spreadsheetImport.ts` — parses a 3-column spreadsheet (Customer #, Name,
  Address) via SheetJS.
- `src/services/customerMatching.ts` — Fuse.js fuzzy match.

**Bug found and fixed (via the same disposable-script-verification habit):** the matching
query was originally built by **concatenating** `company + ' ' + address` into a single
Fuse.js search string, searched against two weighted keys (`name` weight 0.7, `address`
weight 0.3). This is wrong: Fuse.js matches **one query string against each key
independently**, so a combined "company + address" string matches *neither* field fully,
and even a textbook-exact match on both fields scored only ~23% confidence. **Fixed** by
querying with the **company name alone** (falling back to address only if there's no
company), while still benefiting from the address field via the weighted keys. After the
fix, an exact match scores 100%, a similar-but-different company scores proportionally
lower, and an unrelated company returns no match at all. Verified with synthetic customer
records including one intentionally near-duplicate name/address.

**User feedback that changed the design:** after testing, the user reported "NONE of the
other matches show up if there's no 100% match, so make that only the exact match shows
up." The original design (matching the written project spec almost verbatim) showed the
**top 3** matches with confidence ≥80%. The user's direct, tested feedback overrode that
spec: **`CONFIDENCE_THRESHOLD` is now `100`**, and the UI shows **only the single best
match**, never a list of "maybe" candidates. Rationale documented in the code comment:
"Only an exact (or near-as-good-as-exact) match is trustworthy enough to hand a customer
number off — a wrong guess bills the wrong account." **Do not revert this to multi-result
or lower the threshold without the user explicitly asking for it again** — it was a
deliberate, tested override of the original spec.

**Spreadsheet import — two real-file bugs found from actual user-supplied spreadsheets:**

1. **Stale `!ref` range.** `XLSX.utils.sheet_to_json()` trusts the worksheet's declared
   `!ref` cell range by default. A file from a non-Excel tool (older LibreOffice/Google
   Sheets export, a CSV→XLSX converter, etc.) can have a `!ref` that doesn't cover all the
   actual populated cells — e.g. one that only spans the header row — which makes
   `sheet_to_json` silently return just that one row even with hundreds of real rows
   present. **Fixed** by `computeActualRange()`, which recomputes the true bounds by
   scanning every actual cell key in the worksheet object (`Object.keys(sheet)`, decoding
   each via `XLSX.utils.decode_cell`), ignoring `!ref` entirely, and passing that computed
   range explicitly to `sheet_to_json`. (This specific bug turned out **not** to be the
   cause of the user's reported failure that prompted the investigation — that was
   actually a stale unpacked-extension build the user hadn't reloaded — but the fix is real
   defense-in-depth for a documented, reproducible failure mode, verified by simulating a
   corrupted `!ref` against real data, and was kept.)
2. **First-row-is-data, not header.** A real user spreadsheet (`Trade_Customers.xlsx`) had
   **no header row at all** — data started immediately at row 1. The importer
   unconditionally treated row 0 as a header and skipped it (`rows.slice(1)`), silently
   discarding the very first customer in every such file. Confirmed by the user reporting a
   specific missing customer ("5 Star Panels Airport West", 5005537) that was provably the
   literal first row of their source file. **Fixed** by `rowLooksLikeHeader()`: only skip
   row 0 when its first cell does **not** start with a digit (a header label like
   "Customer #" is text; a real customer number is numeric). Verified against both the
   user's real broken file and a synthetic genuinely-header-only file (still correctly
   reports "no customer data").

### 4.6 "Add New Customer" flow — a deliberate architecture decision, not a default

The user asked for the tool to **modify the Excel document** by inserting a new row when no
match is found, prompting for the customer number, then "saving and updating."

This was **not** implemented literally, because it isn't really possible safely: MV3
extensions have no background filesystem access. Writing to an arbitrary existing file on
disk requires either (a) the File System Access API, which needs a real file-picker
interaction and per-session permission, and can only run from an extension page (popup),
never reliably from a content script/background — or (b) a browser-triggered download,
which always creates a *new* file, never edits one in place.

**This was explicitly surfaced to the user as a genuine two-option fork** (not guessed
silently), and the user picked the simpler, more reliable option:
- **Chosen:** new customers save instantly to the extension's own IndexedDB (works from the
  sidebar, no permission dance), and the popup has an **"Export Updated Spreadsheet"**
  button that rebuilds a fresh `.xlsx` from the current database on demand, which the user
  manually saves over their master file whenever they want the two back in sync.
- **Not chosen:** true live file sync via a remembered `FileSystemFileHandle`, which would
  need Chrome's file picker at import time and recurring permission re-grants.

Don't revisit this without the user asking — it was deliberated, not defaulted into.

Implementation: `src/storage/customerDb.ts`'s `addCustomer()` **checks for an existing
record with the same customer number first**, since `customerNumber` is the IndexedDB
keypath and a plain `put()` would silently overwrite an existing customer's name/address on
a typo'd number — this returns a `duplicate-customer-number` error instead, surfaced in the
sidebar's `AddCustomerForm.tsx`.

### 4.7 Sidebar section order

Current order (as of the last reorder request): **Customer → Customer Match → Quote
Details → Vehicle → Requested Parts**. This was changed once already by direct user
request ("swap quote details and vehicle such that quote details comes after customer
match") — don't assume the original spec's ordering is still correct; the code in
`src/sidebar/Sidebar.tsx` is the source of truth.

### 4.8 Click-to-copy

Implemented as: click the **value itself** (not a separate icon button) to copy, with the
text transiently replaced by "Copied" for ~1.5s (`useCopyToClipboard` hook). Currently
applied to: VIN, Reference, and the matched Customer Number. This was an explicit user
request ("VIN, Customer number and reference number must be click to copy") — scoped to
exactly those three fields, not applied extension-wide to avoid scope creep beyond what was
asked.

---

## 5. The ASA CAPS side — detailed history

### 5.1 What ASA CAPS is and how the original project worked

ASA CAPS (`myasaweb.com` / `asacaps.com`) is Mitsubishi's own VIN→part-number lookup
system. The original standalone `asacapscatalogue` project (built independently, uploaded
via GitHub web UI — see §2) watches copy/cut events on ASA CAPS pages, classifies clipboard
text as `VEHICLE` / `PART` / `UNKNOWN`, and maintains a single **active vehicle session**:
copying a VIN starts/switches the active vehicle; copying a recognized part number files it
under whichever vehicle is currently active. Switching vehicles closes the previous session
(its data is preserved, never lost or reassigned) and opens a new one, with a desktop
notification.

This logic was **ported essentially unchanged** into this project, because it was already
solid, already had its own test suite, and there was no reason to rewrite working logic.
What changed was **only** the UI layer (vanilla DOM/CSS → Tailwind/React, to match "the
toolkit's interface" per the user's explicit integration request) and the storage-access
pattern (see 5.3).

### 5.2 Ported files, with their original source noted

All of these came from the deleted `asacapscatalogue/src/` tree, moved into
`src/services/asacaps/` with **only** import-path and (where noted) naming changes — no
logic changes:
- `vin.ts` — `extractVIN()`, VIN candidate scoring by proximity to labels like "VIN",
  "Chassis No", "Vehicle Identification Number"; excludes I/O/Q; rejects all-digit/all-letter
  17-char strings.
- `vehicle-extract.ts` — `extractVehicleFields()`. Has a **dedicated parser for the real ASA
  CAPS breadcrumb format**, confirmed from an actual capture:
  `ASX(MMAL) 2000 | LS(2WD),S-CVT   VIN: JMFXTGA2WBZ003283   Model: GA2W  Classification:
  XTSHR8  Option: M09  Exterior: X42A  Interior: 22X  From: 2010.12.3  To: 2010.12.3`
  — parsed into model/chassisCode/variant (kept verbatim rather than over-parsed, since its
  internal shape varies wildly per vehicle) plus modelCode/classification/option/colors/
  production dates/year from the separate stable tech-info line. `make` is only ever filled
  in as `"Mitsubishi"` when this ASA-CAPS-specific signature is present — a known constant
  of the source system, not a per-vehicle guess. A generic fallback parser handles other
  formats.
- `part-parser.ts` — `extractPart()` / `extractParts()`. Configurable regex pattern list
  (Mitsubishi-style `5253AN28`, `MR`/`MN`-prefixed, plain numeric, two-letter-prefix
  formats). Handles single parts, labelled `Part No:`/`Description:` format, a `PNC:` (parts
  diagram position code — distinct from the part number) label, and **bulk tabular
  copies** (multi-row quote/order screen selections) via `extractParts()`, which recognizes
  multiple rows and dedupes by part number. Never infers a part number from a description
  alone.
- `clipboard-parser.ts` — `classifyClipboardText()`. **VIN detection always runs before
  part detection** — this ordering is the core invariant of the whole pipeline and is
  explicitly tested.
- `vehicle-session.ts` — `processClipboardText()`, `setActiveVehicleManually()`,
  `closeActiveSession()`. The session state machine.
- `catalogueExport.ts` (renamed from `shared/export.ts`) — `buildCatalogueRows()`,
  CSV/JSON export, and **CSV import with upsert-not-duplicate merge semantics**
  (re-importing the same or an overlapping CSV doesn't create duplicate fitments; existing
  values win where the import is missing them; `timesCopied` takes the max; first/last
  captured dates take the widest range).
- `coverage.ts` (renamed from `shared/coverage.ts`) — `buildCoverageSummary()`: groups
  vehicles by `classification` (trim), flags a group "ready for matching" at ≥20 vehicles.
  This is forward-looking infrastructure for a **future parts-recommendation feature**
  (suggest likely part numbers based on similar vehicles) that does **not exist yet** — the
  coverage stats are currently just informational.

**Renamed during the port:** `Database` (the original project's IndexedDB wrapper object)
→ **`AsaCapsDatabase`**, specifically to stay unambiguous alongside this project's own
`customerDb.ts` (which has no equivalently-named export, but "Database" alone would have
been a confusing, generic name once both existed in one codebase).

### 5.3 Storage architecture — two separate IndexedDB databases, by design

- `src/storage/customerDb.ts` — database `parts-interpreter-toolkit`, store `customers`.
- `src/storage/asacapsDb.ts` — database `asa-caps-catalogue` (name unchanged from the
  original project), stores `vehicles` / `sessions` / `fitments` / `events` / `settings` /
  `backup`.

**Deliberately not merged into one schema.** They're logically unrelated — one is an
imported spreadsheet of trade accounts, the other is a passively-built VIN/part catalogue —
and merging would add migration risk for no benefit. A future cross-reference feature (see
§7) can join them in memory by VIN without needing a shared schema.

**The origin-boundary problem (the single most important architectural fact in this
project):** IndexedDB is scoped per-origin. Content scripts run in the **host page's**
origin (`partscheck.com.au` or `myasaweb.com`/`asacaps.com`), not the extension's
`chrome-extension://` origin — so a content script opening "the same" IndexedDB database
name actually opens a different, page-scoped, empty database. **Neither `customerDb.ts`
nor `asacapsDb.ts` may ever be imported from a content script.** Both are only safe to
import from the background service worker, the popup, and the catalogue page — all of
which genuinely share the extension's origin. Content scripts reach both databases
exclusively through `chrome.runtime.sendMessage` round-trips to the background worker (see
`src/services/messaging.ts` and `src/background/index.ts`). If you ever see a content
script importing from `@/storage/*` directly, that's a bug — it will silently "work" in the
sense of not throwing, while reading/writing an empty database nobody else ever sees.

One deliberate exception to "everything through a message": `Settings` (the
captureEnabled/debugMode/logUnknownEvents triple controlling ASA CAPS capture) **stayed in
IndexedDB** rather than being migrated to `chrome.storage.local` (which *is* directly
readable from content scripts, unlike IndexedDB) — considered during the sidebar build,
decided against, because it would have introduced a second storage mechanism for just one
small piece of state, for no real benefit over two more message types
(`GET_SETTINGS`/`SET_CAPTURE_ENABLED`). `customerDbMeta.ts` (import timestamp/filename for
the customer database) *does* use `chrome.storage.local` directly — but that's only ever
read by the popup, never by a content script, so there was no origin problem to solve
there in the first place.

### 5.4 Message protocol (`src/services/messaging.ts`)

All content-script/popup ↔ background communication goes through one typed `RuntimeMessage`
union, each variant with an `is*Message()` type guard and a paired `request*()` /
`send*()` helper for the calling side. Current message types:
- `GET_CUSTOMERS`, `ADD_CUSTOMER` — customer database (PartsCheck sidebar, content-script
  origin, genuinely needs the relay).
- `CLIPBOARD_CAPTURE` — fire-and-forget, ASA CAPS content script → background, triggers
  `processClipboardText()`.
- `GET_ACTIVE_VEHICLE_STATE` — returns `{ session, vehicle, recentFitments }`, called from
  the **popup's** `AsaCapsTab.tsx` (see §5.7 — there's no ASA CAPS content-script UI, so
  this is popup-origin, not content-script-origin like the customer ones above; kept as a
  message purely for reuse/consistency, not because the popup has an origin problem).
- `SET_VEHICLE_MANUALLY`, `CLOSE_ACTIVE_SESSION` — same, popup's manual controls section.
- `GET_SETTINGS`, `SET_CAPTURE_ENABLED` — same, popup's pause-capture toggle (though
  `AsaCapsTab.tsx` also reads/writes `debugMode`/`logUnknownEvents` via direct
  `AsaCapsDatabase` calls — see §5.7 for why that inconsistency exists and was kept).
- `RUN_BACKUP_NOW` — catalogue page's manual backup trigger (relayed to the offscreen
  document; see 5.6).

Background also **broadcasts** a bare `{ type: 'STATE_UPDATED' }` message (not part of the
typed union, matches the original project's pattern) after any clipboard capture or manual
session change — the popup's `AsaCapsTab.tsx` listens for this via a raw
`chrome.runtime.onMessage` listener (while open) to refresh reactively instead of polling.

### 5.5 ASA CAPS content script (`src/content/asacaps.ts`)

Five independent capture paths, all feeding the same `sendClipboardCapture()` → background
pipeline, because ASA CAPS's exact UI behavior can't be assumed across dealer instances.
**This file has no UI of any kind** — see §5.7 for why, and don't reintroduce any:
1. **Copy/cut DOM events** — reads `window.getSelection()`, enriched with the row's
   description/PNC if the selection sits inside a recognizable row. Never blocks/alters the
   native copy.
2. **Part-number button clicks** (top frame only) — ASA WEB's part number button
   (`#copyPartNoBtn`) writes to the clipboard programmatically with no `copy` event at all,
   so this listens for clicks on it directly and scrapes the row's description/PNC
   separately.
3. **Clipboard polling** (every 1200ms, requires `clipboardRead` permission) — fallback for
   any other click-to-copy control; catches text regardless of how it got there, without
   enrichment.
4. **Page watch** (top frame only) — ASA WEB is an Angular SPA; switching vehicles updates
   the URL hash and re-renders without any copy at all, so this reads the VIN
   button/breadcrumb/tech-info DOM directly (debounced via `MutationObserver` +
   `hashchange` + a 1500ms fallback poll) to detect a vehicle switch without requiring a
   copy.
5. **`/` and `*` keyboard shortcuts** — `/` focuses the current group's search box (only
   when already on a group's list view, so it never fights the browser's own quick-find
   elsewhere). `*` (on a diagram/PNC detail page) clicks through the same "Group selection"
   → "All" tab sequence a manual return-to-list would, then focuses the resulting search
   box — this was a documented dead-end-turned-workaround in the original project
   (reconstructing the destination URL by hand didn't work because this app's hash-routing
   shapes are inconsistent across views).

This script also runs in iframes (`all_frames: true` in the manifest, needed for capture
paths 2 and 4 potentially being framed) — since there's no UI to worry about mounting twice,
`all_frames: true` is just there so the capture paths work regardless of which frame the
action happens in.

**Lint issues found porting this file** (the original project had no ESLint configured at
all, so these never surfaced there): three inner `function` declarations inside block
scopes (in the `/`/`*` shortcut handling) tripped `no-inner-declarations` — fixed by
converting to `const name = () => {}` arrow expressions. Two files had unnecessary regex
escapes (`\-` inside character classes where the hyphen was already unambiguous at that
position) tripping `no-useless-escape`. Four test files directly reassigned the global
`indexedDB` (`indexedDB = new IDBFactory()`), tripping `no-global-assign` — fixed by using
`vi.stubGlobal('indexedDB', new IDBFactory())` instead, which is also the more correct
vitest-idiomatic way to do it.

### 5.6 Auto-backup (File System Access API)

Ported unchanged: an hourly `chrome.alarms` alarm triggers `runAutoBackup()` in the
background worker, which — because the MV3 service worker has no `window`/DOM and can't use
the File System Access API itself — creates a hidden **offscreen document**
(`src/offscreen/index.html` + `main.ts`, via `chrome.offscreen.createDocument`) and relays a
`PERFORM_AUTO_BACKUP` message to it, which does the actual
`folderHandle.getFileHandle(...).createWritable()` write. The folder handle
(`FileSystemDirectoryHandle`) is itself stored directly in IndexedDB (it's
structured-cloneable), connected via the catalogue page's "Connect Backup Folder" button
(`window.showDirectoryPicker()`, which needs a user gesture and can only run on an extension
page). If the stored permission has been revoked (can happen silently, e.g. across browser
restarts), the alarm-triggered write can't re-prompt (no user gesture available), so it
records a `lastError` for the catalogue page to surface instead of failing silently.

`src/types/file-system-access.d.ts` — hand-written ambient types for this API, since it's
not yet in TypeScript's bundled `lib.dom.d.ts`. Ported unchanged.

### 5.7 ASA CAPS UI lives in the popup only — no page-injected sidebar

**Correction made after initial integration, worth reading carefully if you're about to
"improve" this again.** The first pass at this integration mounted a full page-injected
sidebar on ASA CAPS pages (Shadow DOM, same visual pattern as the PartsCheck sidebar),
reasoning "same design language, same mechanism." **This was wrong and was reverted** —
the user caught it immediately (a screenshot showing the ASA CAPS sidebar covering an
unrelated page/tab) and said the sidebar must only appear on the PartsCheck side, "put
this similar to where it was when they were separate." The original standalone
`asacapscatalogue` project's content script had **zero UI** — no DOM injection at all; its
entire "Active Vehicle / Recent Parts / Controls" interface lived in the **toolbar popup**,
opened on click, not an always-present page overlay. Re-adding a page sidebar for it was an
unrequested product decision that didn't match either the original project's actual
behavior or what the user wanted post-merge.

**Current (correct) state:**
- `src/content/asacaps.ts` (note: **plain `.ts`, not `.tsx`** — it has zero React/JSX
  again; it was briefly `.tsx` during the reverted sidebar experiment) contains **only**
  the five capture paths from §5.5. No DOM injection, no Shadow DOM, no `createRoot()`
  call anywhere in it.
- `src/popup/sections/ActiveVehicleSection.tsx`, `RecentPartsSection.tsx`,
  `ManualControlsSection.tsx` (moved here from `src/sidebar/sections/` — they were
  originally written for the reverted sidebar; the components themselves needed no change,
  since they were always just `SectionCard`-wrapped content blocks with no
  fixed/absolute positioning of their own, only the deleted outer `AsaCapsSidebar.tsx`
  shell had that) are composed directly inside **`src/popup/AsaCapsTab.tsx`**, in the same
  order the original project's `popup.html` used: Active Vehicle, Recent Parts, Controls
  (pause/set-vehicle/close-session), then the "Open Catalogue" button, then
  debug-mode/log-unknown-events settings and the debug panel at the bottom.
- `AsaCapsTab.tsx` fetches active-vehicle state via the same `requestActiveVehicleState()`
  message used before (still correct and necessary — the popup is extension-origin, but
  reusing the existing message-based helper was simpler and lower-risk than also adding a
  direct-`AsaCapsDatabase`-call code path for just this one case), and listens for the
  background's `STATE_UPDATED` broadcast while the popup is open, exactly like the original
  project's `popup.ts` did. `settings` (debugMode/logUnknownEvents/captureEnabled) are read
  via direct `AsaCapsDatabase.getSettings()`/`putSettings()` calls (fine from the popup —
  no origin problem there), and `captureEnabled` is handed down as a prop to
  `ManualControlsSection`, which still persists toggles via `requestSetCaptureEnabled()` —
  two different access paths for the same `Settings` object (one direct, one message-based)
  that both work correctly; this inconsistency was judged not worth unifying for the risk
  of touching working code.
- The popup content for this tab is wrapped in `max-h-[520px] overflow-y-auto` since it's
  now considerably taller than the Customer Database tab (active vehicle + recent parts +
  controls + catalogue button + debug section, all in one scrollable tab) — Chrome popups
  don't handle arbitrarily tall content gracefully otherwise.
- `src/sidebar/AsaCapsSidebar.tsx` **no longer exists** — it was deleted, not kept around
  disabled/unused. If you see any reference to it anywhere, that reference is stale.

**If someone asks for "a sidebar on ASA CAPS pages too" in the future:** that may be a
legitimate ask, but confirm it explicitly first — it directly contradicts a correction the
user already made once. Don't silently reintroduce it by analogy with the PartsCheck side.

What follows below (catalogue page, popup tab switcher) is still accurate and wasn't
touched by this correction — only the "always-on sidebar" piece was wrong.

- `src/popup/AsaCapsTab.tsx` — debug mode toggle, "log unknown clipboard events" privacy
  toggle (off by default — the original project's own privacy rationale, preserved
  verbatim: unknown clipboard content may contain customer names/addresses/phone numbers;
  even when on, only a short preview + classification is logged, never used to build
  catalogue records), last-clipboard-event debug panel with a "Copy Debug Information"
  button, and a button to open the catalogue page in a new tab.
- `src/popup/Popup.tsx` — now a thin tab switcher between `CustomerDatabaseTab` (the
  original popup content, moved unchanged into its own file) and `AsaCapsTab`.
- `src/catalogue/Catalogue.tsx` (+ `index.html`, `main.tsx`) — full-page searchable
  catalogue: search across every field, a grouped-by-exact-part-number view when the search
  term matches a part number exactly (shows every vehicle that part's been seen on),
  coverage stats card, CSV/JSON export, CSV import, and the backup folder connect/
  enable-toggle/backup-now controls. **Not referenced by any manifest field** (it's only
  ever opened via `chrome.tabs.create`), so it had to be added to
  `vite.config.ts`'s `build.rollupOptions.input` manually — CRXJS's automatic manifest-scan
  input detection doesn't find it otherwise. Same applies to the offscreen document.

**Explicitly not ported / not built, and why:** the original project's **Clipboard
Inspector** page (paste raw ASA CAPS clipboard text, see live classification/VIN/part/
description/PNC detection, save as a test fixture) was **not** rebuilt. This was a scope
decision at the start of the popup/catalogue task, not an oversight — it wasn't part of
what was explicitly promised for that task ("popup's ASA CAPS settings/debug panel, and the
catalogue search/export page"), and was mentioned to the user as an omission they could ask
for later. If asked to add it, it's a straightforward Tailwind/React page following the
exact same `catalogueExport`/`clipboard-parser` imports the Catalogue page already uses.

---

## 6. Build, lint, test — exact commands and current status

```bash
npm install
npm run build      # tsc -b && vite build -> dist/
npm run dev        # Vite watch mode with HMR; load dist/ as unpacked, refresh on changes
npm run lint       # eslint . --max-warnings 0
npm run typecheck  # tsc -b only
npm test           # vitest run — 18 files, 203 tests, all currently passing
npm run test:watch
npm run format     # prettier --write .
```

**As of the last commit on this branch (`7db0ff7`), all four of the above (build, lint,
test, typecheck) are clean with zero errors/warnings.** If you find otherwise immediately
after cloning, something is wrong with your environment (Node version, stale
`node_modules`), not the code — verify before assuming regressions.

**Icon generation:** the four PNG icons in `src/assets/icons/` were generated with a
Python/Pillow script (solid accent-blue rounded square, white "P" glyph, DejaVu Sans Bold)
and are committed as binary files — there is no build step that regenerates them. If you
ever need to regenerate them (e.g. a different mark), note that this sandbox's system
Python `PIL` install was broken (`ImportError: cannot import name '_imaging'`) in a way a
plain `pip install Pillow` didn't fix — a **fresh venv** (`python3 -m venv ... && ./bin/pip
install Pillow`) was needed to get a working Pillow. This may or may not reproduce in a
different environment; don't assume it will.

**Manifest merge summary** (`manifest.config.ts`): two `content_scripts` entries — one for
`https://*.partscheck.com.au/*` (`src/content/index.tsx`), one for
`*://*.myasaweb.com/*` + `*://*.asacaps.com/*` (`src/content/asacaps.ts`,
`all_frames: true`). Permissions: `storage` (original toolkit) + `notifications`,
`clipboardRead`, `alarms`, `offscreen` (ASA CAPS). `action.default_popup` →
`src/popup/index.html`. Background: `src/background/index.ts`, `type: "module"`.

---

## 7. Known gaps / explicitly deferred work (not bugs — things not asked for yet)

- **No cross-reference between the two halves** *(being addressed — see §9)*. The PartsCheck sidebar extracts a VIN; the
  ASA CAPS catalogue is keyed by VIN. Nothing currently looks up "has this VIN been seen in
  ASA CAPS, and if so what parts were captured for it" from within the PartsCheck sidebar.
  This was explicitly named as a "phase 2" feature during the integration planning and
  intentionally not built — raised again, pending a decision on what it should look like
  (likely a new section in `Sidebar.tsx` that calls the same message relay pattern ASA CAPS
  uses, querying `asacapsDb` by the extracted VIN).
- **No Clipboard Inspector page** (see §5.7) — straightforward to add if asked.
- **`xlsx` package vulnerability** — documented, accepted risk, not fixed (see §3).
- **The parts-recommendation feature** the `coverage.ts` groupings exist to support
  (suggesting likely part numbers for a vehicle based on similar vehicles' captured
  fitments) does not exist — only the "is there enough data yet" coverage stats do.
- **`main` branch is stale** (still just commit `2f20c6b`) — merging the feature branch
  into `main` has not been done and should not be done without the user asking for it.
- **No CI/CD, no GitHub Actions.** Builds/lints/tests are run manually, locally, every time.

## 8. How to interact with the user (tone/process notes for continuity)

- The user tests by loading `dist/` as an unpacked extension in their own Chrome, on real
  PartsCheck/ASA CAPS pages — not something achievable from inside a sandboxed agent
  session. **The user does not have admin rights on their Windows machine and cannot
  install Node.js/npm** (the standard Node installer requires admin; they tried and
  confirmed it fails). This means `git pull && npm install && npm run build` on their end
  is **not** a usable workflow for them — don't default to suggesting it. Git itself *is*
  installed and working for them (they have a working clone and can `git pull`), so for
  reading/reference that's fine, but **the actual build must happen in the agent's own
  sandboxed session, every time**: build it, zip `dist/` (excluding `.map` files), send it
  as a file, and give the exact reload steps (unzip over the old `dist/`, refresh the
  extension card on `chrome://extensions`). If they ever mention getting Node working
  (e.g. a portable no-install zip distribution added to their *user* PATH, which doesn't
  need admin rights — this was offered once, unconfirmed whether they did it), re-check
  before assuming the zip workflow is still required.
- The user reports real bugs with real evidence (screenshots, actual exported/source
  spreadsheet files, specific customer names/numbers that proved a row was dropped). **Take
  every such report at face value and reproduce it with the actual provided file/data
  before fixing anything** — guessing at a fix without reproducing first is how the
  `!ref`-range fix almost got credited for a bug it didn't actually cause (the real cause
  that time was a stale unpacked-extension build). Be honest when a fix you made wasn't
  actually the fix for the reported symptom, and keep the unrelated fix anyway if it's still
  correct, rather than hiding that it didn't match the report.
- The user has pushed back on scope more than once (e.g. explicit answers to multi-option
  questions like the File System Access vs. in-app-database choice in §4.6, or direct
  "make it only show the exact match" feedback in §4.5) — these were genuine decisions, not
  defaults, and should not be silently reverted or "corrected" back toward the original
  written spec without the user asking again.
- This file itself should be kept up to date. If you make a non-trivial architecture
  decision, fix a non-obvious bug, or have the user override a previous decision, add it
  here in the same level of detail as the existing entries, don't just rely on commit
  messages (which the next agent may not read as carefully as this file).

---

## 9. Quote mappings — learning part numbers from PartsCheck quotes and suggesting them

The "cross-reference" gap from §7 is being built as **learning from DMS Upload**: the user
enters ASA CAPS part numbers into Pentana ERA *in the same order as the PartsCheck lines*,
exports ERA's CSV (`12A-PARTS-QUOTE-RPT_Data.csv`, no header: quote no, initials, `MI`-prefixed
part no, description, qty, list, buy, notes) and uploads it with PartsCheck's "DMS Upload".
PartsCheck fills rows **by position**. The extension reads the filled rows and stores each
(repairer description → part number) pair. Phase 2 uses them to suggest part
numbers on new quotes (§9.3).

### 9.1 What a filled PartsCheck row looks like (confirmed from a real save)

`tests/fixtures/partscheck/quote-filled.html` / `quote-empty.html` are the same real quote
after/before DMS Upload, trimmed to the quote form + `#lineTable` and **anonymised** (customer,
estimator, reference, claim, rego, VIN serial, sales reps, competitor dealer replaced; draftID
→ 10000001). `era-quote-1050894R.csv` is the CSV that was uploaded. Keep any new fixtures
anonymised the same way.

- After upload the page is **server-rendered** with the values (they're in the `value`
  attributes), i.e. DMS Upload reloads the page rather than filling inputs by script.
- Description cell: before upload `<b>repairer text</b>`; after, `<b>ERA DESCRIPTION</b><br/><i>repairer text</i>`.
  ERA's **commas are stripped and words glue together** ("FENDERFR LH", "KNUCKLELH").
- Inputs per row: `input.partNr` (MI prefix already stripped), `input.qty` (pre-filled `1`
  even before upload), `input.listprice`, `input.buyprice`. Note: sibling
  `tr.notesRow[data-draft_item_id][data-iteration] input.notes`.
- `NA` / "NOT APPLICABLE" at 0.01 = no genuine part. `MZ…` = accessory.
- `tr.lineRowPriceMatch` (blue) and `tr.compRow` (competitor) rows have no `lineRow` class.
- Quote identity: hidden `form[name=frmSubmit] input[name=draftID]` (PartsCheck's own id) —
  used as the key instead of "Reference" (the repairer's job number, not unique across
  repairers; user agreed). `input[name=supplierRefNr]` ("Quote Nr") = ERA quote number.
  PartsCheck also has `Model Nr` (blank on the sample) and `Mth/Yr` fields.

### 9.2 Code

- `src/services/extractors/quoteRows.ts` — `extractQuoteRows()` / `extractQuoteContext()`.
  Read-only; every missing selector logs `[Parts Interpreter Toolkit] selector not found: …`
  once per page.
- `src/services/quoteCapture/synonyms.ts` — the growing vocabulary (side compounds like
  `L/H/F`, slashed shorthand like `B/BAR`, `W/ARCH`, token abbreviations). Add entries here.
  `L/R` is deliberately **not** a side (repairers use it for "left and right"); bare `BAR` is
  not mapped to BUMPER (Triton "sports bar").
- `src/services/quoteCapture/normalise.ts` — `parseSide()` (LH/RH/BOTH/NONE from repairer
  text), `normaliseDescription()` (side removed, word order kept), `parseEraSide()` (word
  *ending* in LH/RH, because of the glued ERA text).
- `src/services/quoteCapture/buildMappings.ts` — pure row → `QuoteMapping`; flags
  `noGenuinePart`, `isAccessory`, and `sideConflict` (repairer says LH, ERA line says RH —
  a likely ERA ordering slip, shown as a warning in the sidebar).
- `src/services/quoteCapture/captureQuote.ts` — background side: model code from the ASA
  CAPS `vehicles` record by VIN (blank if unknown; no VIN decoding), upsert.
- `asa-caps-catalogue` DB **v3** adds store `quoteMappings` (keyPath `id` =
  `${quoteKey}::${rowNo}`, `.iteration` suffix for non-primary rows; indexes quoteKey, vin,
  partNumber, repairerNormalised, modelCode, model). It lives in the ASA CAPS DB (not the
  customer DB) because suggestions join it with `vehicles`/`fitments` by VIN. NA rows are
  stored with `noGenuinePart: true` and must never be suggested.
- `src/content/quoteCaptureWatcher.ts` — MutationObserver + passive change/input listeners on
  `#lineTable`, 750ms debounce, fingerprint so unchanged tables aren't re-saved; reaches the
  DB only via the `SAVE_QUOTE_CAPTURE` message. `src/sidebar/sections/QuoteCaptureSection.tsx`
  shows "Captured N mappings", the filled-vs-requested mismatch warning, and side conflicts.
- Tests: `quote-rows`, `normalise`, `quote-mappings` (incl. fake-indexeddb upsert),
  `quote-capture-watcher`. They use `// @vitest-environment jsdom` (jsdom is a devDependency
  for this).

### 9.3 Suggestions on new quotes (phase 2)

- `src/services/quoteCapture/suggestions.ts` — pure `suggestForLines(vehicle, lines, mappings)`.
  A stored mapping is a candidate when:
  - **wording**: identical normalised word set, or Jaccard ≥ 0.75 with **identical position
    words** (FRONT/REAR/UPPER/LOWER/INNER/OUTER/CENTRE, `POSITION_TOKENS` in synonyms.ts).
    The position rule was added after an end-to-end check showed "GUARD LINER FRONT" being
    offered the rear liner at 0.75.
  - **side**: the part's hand comes from its **ERA description** (falls back to the repairer's
    side only when there's no ERA text). Handed parts must match the line's side (a line
    naming both sides accepts either); a handed part is never offered for a line with no side.
    Unhanded parts (e.g. "L/H/F HUB BEARING" → ERA "BEARINGFR WHEEL HUB") fit any side.
  - **vehicle tier**, best first: same VIN > same model code (ASA CAPS catalogue, by VIN) >
    same VIN pattern (first 8 chars = WMI + descriptor section; used because the model code
    is usually unknown for a new quote's VIN) > same PartsCheck model. Other models are never
    suggested.
  - NA rows, `sideConflict` rows and the open quote's own rows are excluded.
  Candidates are grouped by part number; sorted by tier, wording score, distinct vehicles,
  times used, recency; top 3 per line. Evidence strings like "used on 4 vehicles · KK1T
  Triton, last 2026-10-20".
- `suggestForQuote()` (captureQuote.ts) runs it in the background over all stored mappings
  (`GET_QUOTE_SUGGESTIONS` message). `src/content/quoteSuggestions.ts` asks once on page load
  for lines with no part number yet; `PartsChecklist.tsx` shows up to 3 suggestions under each
  requested line with a copy button, plus **"Copy all in order"** = top suggestion per line,
  newline-separated, blank line where none (keeps positions aligned with PartsCheck/ERA order).
  Nothing is ever written into PartsCheck inputs.
- Verified end to end by loading the built `dist/` into Playwright's Chromium with the fixture
  pages served at a `partscheck.com.au` URL (capture of the filled quote, then suggestions on a
  new quote). That harness lives outside the repo; it's ~40 lines of `launchPersistentContext`
  with `--load-extension` + `context.route()`.

### 9.4 The ASA CAPS catalogue as a second suggestion source, and quotes feeding it

User request: the catalogue (vehicles + fitments) must be a suggestion source, not just a
model-code lookup; captured quotes must add their parts to the catalogue; export/import must
carry the quote mappings.

- **Suggestions** (`suggestions.ts`) now rank `Candidate`s from two sources through one
  pipeline (same wording/position/side/tier rules as §9.3):
  1. `quotes` — quoteMappings (repairer wording).
  2. `catalogue` — **only for lines source 1 has nothing for**: fitments that have an
     ASA `description` (i.e. were copied in ASA CAPS), matched by
     `normaliseDescription(ASA description)` vs the line; the part's hand is
     `parseSide(ASA description)`; tier uses the fitment's vehicle record.
  Each `PartSuggestion` has `source`; the sidebar labels it "from your quotes" /
  "from ASA catalogue" and evidence reads "used on…" / "seen in ASA CAPS…".
  ASA's names don't always match repairer wording ("GUARD LINER" vs "SHIELD,FR WHEELHOUSE
  SPLASH") — grow `synonyms.ts` from real misses rather than guessing.
- **Quotes → catalogue** (`buildQuoteFitments`, `vehicleFromQuote` in buildMappings.ts, called
  from `captureQuote`): each non-NA, non-side-conflict row becomes a fitment
  `${vin}::${partNumber}` (same key as ASA CAPS fitments → no duplicates) with
  `sessionId: 'partscheck-quote'`, `timesCopied: 0`, the ERA text in **`eraDescription`**
  (never `description`, which stays ASA-only — PartsCheck's comma-stripped ERA text would
  pollute catalogue matching), and `sources` including `'partscheck-quote'`. A VIN not yet in
  `vehicles` gets a basic record (make/model/series/year from PartsCheck); an existing ASA
  vehicle record is never modified.
- `PartFitment.sources?: FitmentSource[]` (`'asacaps' | 'partscheck-quote' | 'imported'`);
  missing = legacy ASA CAPS fitment. `withFitmentSource()` in types/asacaps.ts.
  `vehicle-session.ts` (ported ASA pipeline) now also records `'asacaps'` — the only change
  to that file.
- **Export/import** (`catalogueExport.ts`): the original 17 CSV columns are unchanged and
  first; appended: `ERA Description`, `Sources` (`;`-separated), `Record Type`
  (`fitment` | `quote-mapping`) and the quote-mapping fields. Quote-mapping rows reuse
  VIN/Make/Model/Model Code/Part Number and put firstSeen/lastSeen in First/Last Captured.
  Import dispatches on Record Type (files without it import as fitments, sources
  `['imported']`), upserts mappings by id keeping the widest first/last seen, and now keeps a
  `Times Copied` of 0. JSON export is now `{ fitments, quoteMappings }` (was a bare array;
  there is no JSON import). The hourly auto-backup CSV includes the mappings too.

### 9.5 Only DMS-uploaded rows are answers; repairer-supplied numbers kept apart

User report: repairers often type into PartsCheck's Part Number boxes themselves before the
quote reaches the interpreter — usually a base-model or wrong number, sometimes free text
("triton bagde"). Treating any filled Part Number as an answer polluted quoteMappings and
suggestions. Rules now:

- **Verified = post-upload structure.** `QuoteRow.fromDmsUpload` is true only when the
  description cell is `<b>ERA DESCRIPTION</b><br/><i>repairer text</i>` (§9.1). A filled
  Part Number in a plain `<b>repairer text</b>` row is repairer-supplied. Only verified rows
  become quoteMappings (`isVerifiedRow` in buildMappings.ts), and so only they reach
  fitments and suggestions.
- **No hand-edit capture.** The change/input listeners on `#lineTable` were removed; capture
  runs on page load (DMS Upload reloads the page; reopened uploaded quotes are read the same
  way). The MutationObserver stays for structural changes, and every input is read via
  **`defaultValue`** (the server-rendered `value` attribute), so even an observer-triggered
  re-read can never pick up what's been typed into a box.
- **`repairerSupplied` store** (asa-caps-catalogue DB **v4**, keyPath `id` =
  `${quoteKey}::${rowNo}` like mappings; indexes quoteKey, vin). `updateRepairerSupplied()`
  upserts each repairer-filled row (`suppliedValue` uppercased, `looksLikePartNumber` via
  `looksLikePartNumber()` exported from the ASA `part-parser.ts` patterns) and, when the same
  quote is later read after DMS Upload, links the row's verified number
  (`verifiedPartNumber`, `verifiedEraDescription`, `verifiedNoGenuinePart`,
  `matchesVerified`, `linkedAt`). Links are never undone. These correction pairs are for a
  later feature — **nothing reads them for suggestions yet**, and they're not in the CSV
  export/backup yet.
- A page with only repairer-supplied rows creates no mappings, fitments or vehicle record.
- Suggestions are now requested for every line without a DMS-uploaded answer, including
  lines the repairer pre-filled.
- Sidebar "Part Number Capture": "N verified rows captured, M repairer-supplied rows
  ignored"; the row-count mismatch warning compares verified rows to requested lines.
- Fixture `tests/fixtures/partscheck/quote-prefilled.html` is **synthetic** (quote-empty
  with six repairer-style values: wrong number, correct number, lowercase correct number,
  free text ×2, a number on a line ERA later answers NA). Replace/add a real Ctrl+S save of
  a repairer-prefilled quote when the user provides one. Tests: `repairer-supplied.test.ts`
  plus updates in quote-rows / quote-capture-watcher.

### 9.6 Build dates in the data and in suggestion ranking

- `src/services/quoteCapture/buildDate.ts` (pure): a **build month** is `year * 12 + month`
  (1–12), so gaps are plain subtraction. `parseAsaProductionDate("2010.12.3")`,
  `parsePartsCheckMthYr("6/2022" | "06/2022")`, and `vehicleBuildMonth(vehicle, mthYr)` —
  ASA CAPS `productionFrom` first (vehicle record by VIN), PartsCheck Mth/Yr as fallback,
  `undefined` for missing/garbled values (years outside 1950–2100, month outside 1–12, other
  formats). `formatBuildMonth`/`parseBuildMonthText` use `YYYY-MM` for CSV.
- **Stored**: every captured QuoteMapping gets `buildMonth` + `buildMonthSource`
  (`'asacaps' | 'partscheck'`). Quote-only vehicle records (§9.4) have no `productionFrom`,
  so those fall back to Mth/Yr.
- **Export**: fitment rows carry `Production From` / `Production To` (ASA format, right after
  the original 17 columns); quote-mapping rows carry `Build Month` (`YYYY-MM`) and
  `Build Month Source`. Import reads them only when present — older CSVs still import, and a
  vehicle's stored dates aren't blanked by a CSV without the columns.
- **Ranking** (`suggestions.ts`): the quoted vehicle's build month comes from the ASA record by
  VIN, else the quote's Mth/Yr (the loader now sends `mthYr`; `QuoteVehicle` type). Each
  candidate has a build month (quote mappings: stored value, else their Mth/Yr for mappings
  captured before 9.6; catalogue fitments: their vehicle's `productionFrom`). Per suggested
  part, `buildGap` = smallest |gap| among its **winning-tier** records. Sort order is now:
  tier → buildGap (undated last) → wording score → vehicle count → times used → recency.
  It's a ranking factor only, never a filter (Mth/Yr is approximate). Note the user asked for
  gap *before* wording: a 0.75 "similar wording" match a few months closer will outrank an
  exact-wording match — revisit (e.g. bucket gaps by year) if that shows up in practice.
- **Evidence** adds the winning-tier build range after the model — `… · KK1T Triton built
  2021–2022, last …` (single year shown once) — and ` (older build)` / ` (newer build)` when
  the nearest build is **more than 24 months** away (possible facelift). The same-VIN tier
  shows no range (it's the same vehicle). Applies to both "from your quotes" and
  "from ASA catalogue" suggestions.
- Tests: `build-date.test.ts`, `build-date-ranking.test.ts`, plus capture/export cases in
  `quote-mappings.test.ts` and `catalogue-link.test.ts`.
