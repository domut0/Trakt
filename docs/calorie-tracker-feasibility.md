# Feasibility: making this app the primary calorie tracker (replacing MyFitnessPal)

**Status:** research only. No code was written for this. Nothing below has been implemented.

**Date of research:** 2026-08-23. External API facts have a shelf life — the MFP, Open Food
Facts, USDA and FatSecret terms below should be re-checked before anything is built on them.

**Decisions already taken are recorded in §10.** Read that before §6 and §7 — it constrains both.

This document exists so the investigation does not have to be repeated. It records what was
found in the codebase, what was found externally, which claims were verified and which were
not, and the two design decisions that have to be made before any of it can be built.

---

## 1. Verdict

Feasible. The app is further along than it looks, because the _output_ half of nutrition
tracking — targets, rings, trends, export, sync — is already built and is in places better
than MFP's. What is missing is the _input_ half: there is no food, no meal, no portion.

The hard part is not the food database and not the barcode scanner. It is the logging UX,
plus one PRD principle that has to be knowingly broken (§6.2).

---

## 2. What already exists

This is not a greenfield feature. Existing surface, with references:

| Thing                               | Where                                           | State                                                                                                            |
| ----------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Per-day nutrition record            | `src/lib/store.ts:112` (`DailyLog`)             | `calories`, `protein`, `carbs`, `fat`, `steps`, `bodyweight`, `isCheatDay`, keyed by local `yyyy-MM-dd`          |
| Day-key helpers, weekly aggregation | `src/lib/daily-log.ts`                          | Local-date keying, Monday-start weeks, per-field averaging over logged days only                                 |
| Targets                             | `src/lib/targets.ts`                            | Named profiles assigned per weekday; `cut`/`maintain`/`gain` mode resolving each field to floor / ceiling / band |
| Today screen rings                  | `src/routes/index.tsx:401`, `:681`              | Calorie target ring + macro split ring                                                                           |
| Manual day entry                    | `src/components/DayEditorSheet.tsx:12`          | Six numeric fields typed by hand                                                                                 |
| Charts                              | `src/routes/charts.tsx`                         | Plots calories / protein / carbs / fat / steps over time                                                         |
| Sheet sync                          | `src/lib/sync.ts:100` (`EDITABLE_DAILY_FIELDS`) | All six fields round-trip; editable from the spreadsheet                                                         |
| Backup                              | `src/lib/store.ts:194` (`BackupData`)           | `dailyLogs` already included in export/import                                                                    |
| Write path                          | `src/lib/store.ts:1421` (`upsertDailyLog`)      | Upsert with empty-record deletion                                                                                |

Two things worth calling out as genuinely good and worth preserving:

- **`targets.ts` beats MFP on semantics.** A stored target is a bare number and a number
  cannot say whether exceeding it is a success. The `floor` / `ceiling` / `band` model driven
  off one `goalMode` dial means protein overshoot reads as a win and calorie overshoot on a
  cut reads as a miss. MFP does not make this distinction.
- **`daily-log.ts` averages over logged days only.** A week tracked on three days does not
  read as a crash diet. This matters more once entries get finer-grained.

**The gap:** because there is no food model, `DayEditorSheet` makes you type the day's totals
in by hand. That means the app today _assumes MFP_ (or something like it) computed those
numbers for you. Closing that assumption is the whole project.

---

## 3. Accessing the MyFitnessPal database

### 3.1 The API: no

- MFP deprecated its public API in **2019**, without an announcement, cutting off developers
  who had built against it.
- What remains is **partner-only and closed to new applicants**. The stated route is emailing
  `API@myfitnesspal.com` with company details and intended use. Expect nothing.
- Unofficial scraping libraries exist (e.g. `marcosav/myfitnesspal-api`). They violate ToS and
  break whenever MFP changes anything. Not a foundation to build on.

### 3.2 Your own data: yes, and free

This is the useful finding.

- **"Download My Data"** (the GDPR/privacy request) is **free on every account**. Settings →
  Account → Download Your Data, **desktop web only — the mobile app has no such feature**. A
  ZIP arrives by email within ~24h containing: food diary, **custom foods**, **recipes**,
  weight history, exercise logs, as CSVs.
- **Premium "Export"** gives a date-ranged nutrition export with meal-level detail, plus
  exercise and progress files.

**Why this reframes the problem:** you do not eat 14 million foods. You eat perhaps 200–400,
repeatedly. Your own diary export _is_ a personal food database, and it arrives pre-ranked by
how often you actually eat each item. A one-time importer that mines that CSV into a local
`foods` table covers the overwhelming majority of day-to-day logging immediately — offline,
with no third-party API involved at all.

Also relevant: MFP's 14M entries are heavily duplicated with conflicting values, and
crowdsourced entries are the least consistently accurate of the major sources. Size is not the
advantage it appears to be.

### 3.3 Third-party food databases, for genuinely new foods

| Source                    | License / cost                                               | Usable from a no-backend PWA? | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open Food Facts**       | Free, **ODbL** (attribution + share-alike on the database)   | **Yes** — CORS, no key        | 3M+ products, barcode lookup by EAN-13 / UPC-A. Rate limits ~**15 req/min** product reads, **10 req/min** search, **2 req/min** facets, per IP; exceeding risks an IP ban. Asks apps to send a custom `User-Agent`, which a browser cannot set — needs checking how they want browser apps to identify themselves. US branded coverage patchier than EU.                                                                                                                  |
| **USDA FoodData Central** | Free `data.gov` key, **CC0 public domain**                   | **Yes**                       | ~456k branded rows with GTIN/UPC. ~1,000 req/hour per IP, raisable on request. Also bulk-downloadable: CSV 427MB zipped / 2.9GB unzipped, JSON 195MB zipped / 3.1GB unzipped, regenerated ~every 6 months. Too big to ship whole in a PWA; subsettable. CC0 means you may embed and redistribute freely.                                                                                                                                                                  |
| **FatSecret**             | Free tier ("Premier Free" for students/non-profits/startups) | **No**                        | Closest to MFP in size and quality, has barcode (>90% hit rate), autocomplete, categories. But OAuth 2.0 tokens **must** be fetched via a server-side proxy from **whitelisted IPs** (up to 15, CIDR ranges on Premier). Incompatible with this architecture. Proxying via the existing Apps Script was considered — but Apps Script egress IPs are Google's and not stable, so whitelisting likely fails. Unverified; only worth chasing if OFF+USDA prove insufficient. |
| **Nutritionix**           | Key-based, paid tiers                                        | Needs a key                   | Has UPC lookup and a natural-language endpoint. Not investigated in depth.                                                                                                                                                                                                                                                                                                                                                                                                |

**Recommendation:** Open Food Facts first (no key, zero friction), USDA FoodData Central as the
fallback for US branded gaps. Both are compatible with the no-backend constraint.

---

### 3.4 Open-source prior art worth reading

Several open-source trackers already solve most of this, and reading them is far cheaper than
rediscovering the same decisions. Ranked by usefulness **to this project specifically**:

| Project                                                               | License  | Stack                     | Why it matters here                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | -------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Waistline** (`davidhealey/waistline`)                               | GPL-3.0  | **Cordova — HTML/CSS/JS** | The standout. It is a _web app_, so its logging flows are built from the same primitives this project uses. Uses Open Food Facts + USDA, has barcode scanning. Answers not just "what is the flow" but "how does that flow feel when built out of DOM."                                   |
| **FoodYou** (`maksimowiczm/FoodYou`)                                  | GPL-3.0  | Kotlin / Jetpack Compose  | Actively maintained, on F-Droid. Integrates Open Food Facts **+ USDA FoodData Central** + Swiss Food Composition DB — which independently validates the source stack recommended in §3.3. Best modern reference for food-search and portion-picker UX.                                    |
| **OpenNutriTracker** (`simonoppowa/OpenNutriTracker`)                 | GPL-3.0  | Flutter, cross-platform   | Most frequently cited "best open-source MFP alternative." Open Food Facts backed, privacy/offline focused — same posture as this app.                                                                                                                                                     |
| **wger** (`wger-project/wger`)                                        | AGPL-3.0 | Django                    | Workout **and** nutrition in one app, which is exactly the shape this project is becoming. Read it for the data model: how ingredients, nutrition plans, meals and logs relate, and how that coexists with workout tracking. Its REST API schema is effectively a published domain model. |
| **python-myfitnesspal** (`coddingtonbear/python-myfitnesspal`)        | —        | Python                    | Not a clone, but its scraping models document MFP's **exact** data structures (`Day` → `meals` → `entries`, `get_food_item_details` returning servings/calories/macros/`mfp_id`). Useful as a schema reference even though scraping itself is off the table (§3.1).                       |
| **awesome-nutrition-tracking** (`jrhizor/awesome-nutrition-tracking`) | —        | list                      | Index of the wider space, for when a specific problem needs prior art.                                                                                                                                                                                                                    |

Existing MFP CSV parsers worth reading before writing the importer (§6.4): `myFitnessPal-Converter`
(PyPI), `andrewzey/freemydiary`, `leaherb/myfitnesspal-diary-parser`, and the
MyFitnessPal-to-Nutritrace exporter gist. They document the export's column format.

**License constraint — read carefully.** Every clone above is GPL-3.0 or AGPL-3.0. This repo is
"Private / unlicensed. All rights reserved." **Copying code from any of them into this project
would force it open source under GPL terms.** Reading them to understand UX flows, portion
math, API integration shape and data-model structure is fine — interaction sequences and schema
concepts are not what copyright protects. Keep the line clean: read, understand, close the tab,
write your own. Do not paste.

**What this prior art does and does not replace.** It substantially replaces screenshot-gathering
for _data model and mechanics_. It does **not** replace it for _muscle memory_, because these
apps deliberately diverge from MFP — that divergence is why they exist. Both inputs are needed:
open-source clones for how to build it, MFP screenshots for which taps the user's hands already
know.

---

## 4. Barcode scanning

**Verdict: yes, with one iOS-shaped catch.**

- The clean native path is the **`BarcodeDetector`** API (part of the Shape Detection spec).
  Chrome/Android has supported it for years.
- **Safari does not implement it — and because every iOS browser is WebKit underneath, no iOS
  browser does.** Web apps relying on it fail silently on iPhone and iPad.
- This lands badly here specifically: the PRD targets "installed via Safari Add to Home
  Screen," so the primary platform is exactly the one without the nice API.

**The fix:** a WebAssembly decoder.

- Use **`zxing-wasm`** (`Sec-ant/zxing-wasm`) directly, with a `BarcodeDetector` fast path
  where available. ZBar-compiled-to-WASM is the other credible option.
- **Avoid `html5-qrcode`** despite its popularity and its genuinely better handling of iOS
  quirks (orientation, permission re-prompts, PiP stalls). It is built on `zxing-js`, which is
  unmaintained, and `html5-qrcode` is now unmaintained itself. ~230KB min+gzip, 10–30 FPS.
- `getUserMedia` **does** work inside an iOS home-screen PWA (broken until iOS 14.3, fine
  since). **Verify on the actual target device early** — cheap to test, expensive to discover
  late.

**Shape of the slice:** scanner sheet → decode barcode → OFF lookup → cache the food locally →
portion picker → entry. Roughly a couple of days including device testing. Contained.

---

## 5. Nutrition-label OCR

**Verdict: much weaker. Defer it.**

The framing matters: this is **not** an OCR problem. Tesseract.js reads characters off a clean
printed panel fine (>95% character accuracy on clean 300 DPI print, degrading on angles, glare
and stylised fonts). It is a **structured-extraction** problem — per-serving vs. per-container,
servings-per-container multipliers, inconsistent label layouts. Tesseract gives you text; it
does not give you that mapping.

A vision model handles the extraction well, but needs an API key, which means network access
and a secret on the logging path.

**If it is ever built,** the honest design is: the user pastes their own API key in Settings,
stored device-local and excluded from backups — exactly the pattern `SyncConfigMeta` already
establishes for the sync secret (`src/lib/db.ts:109`, deliberately absent from `BackupData`
because a URL+secret pair is a bearer capability, so exporting it would hand over write access).

**But build barcode and quick-add first and see whether OCR is ever missed.** Prediction: it is
not, because packaged food has barcodes and unpackaged food has no label to scan.

---

## 6. What would have to be built

Ordered by real effort, not by sequence.

1. **New data model.** `Food` (name, brand, barcode, per-100g and/or per-serving macros,
   serving options) and `FoodEntry` (date, meal slot, foodId, quantity, resolved macros).
   This needs a genuine **Dexie `version(4)`** bump. Unlike cardio and session notes — which
   deliberately skipped a bump because they only added _non-indexed_ fields to existing records
   (see the reasoning at `src/lib/db.ts:161`) — these are new tables needing real indexes:
   `foodEntries` by `date`, `foods` by `barcode`.
2. **The logging UX.** Search, recents, frequents, favourites, portion math, meal slots,
   edit/delete, copy-yesterday, copy-a-meal, quick-add-macros. **This is the bulk of the work,
   and it is where MFP's actual moat lives — not in the database.** It is also squarely
   on-mission: the PRD's central bet is that logging friction kills tracking habits, and that
   thesis transfers from sets to meals unchanged.
3. **Barcode scanner + lookup + local cache** (§4).
4. **MFP importer.** One-time CSV parser over the "Download My Data" export. Contained, high
   payoff, no external dependency.
5. **Sync / backup / charts updates.** Modest — except for the collision in §6.1.
6. **OCR.** Expensive, lowest certainty, deferred (§5).

### 6.1 Decision one: day totals become derived, which breaks a sheet assumption

Today `calories` is a **stored, user-editable** field. `sync.ts` three-way-merges it against a
base snapshot (`buildBase`, `EDITABLE_DAILY_FIELDS` at `src/lib/sync.ts:100`), so a number typed
into the spreadsheet flows back into the app.

Once totals are computed from food entries, **a sheet edit to "Calories" has nowhere coherent
to land.** Two options:

- **(a)** Food entries become the sole source; those columns go read-only in the sheet.
- **(b)** Keep an explicit **manual-override** field that wins over the computed total.

**Recommendation: (b).** It preserves the "ate out, no idea of the macros, just log 900"
escape hatch, which is what keeps a tracker alive on bad days. But it must be a **deliberate
second field**, never a silent overwrite of a derived value — otherwise the override and the
entries disagree with no way to tell which the user meant.

Note this also touches `isDailyLogEmpty` / `upsertDailyLog` (`src/lib/store.ts:1421`): a day
with food entries but no typed numbers must not be deleted as an "empty shell."

### 6.2 Decision two: barcode lookup violates a stated PRD principle

PRD §5: _"nothing on the logging path may depend on a network."_ A first-time barcode lookup
does.

This is **the same shape as the §5.1 amendment already written for sheet sync**, and deserves
the same treatment: an honest, written narrowing in the PRD, not a quiet erosion.

Mitigating design that keeps the spirit intact:

- The local food cache serves everything eaten before — offline, instant. This is the ~95% case.
- Network is touched **only** for a barcode never scanned before.
- An offline scan **queues** rather than blocks.

---

## 7. Recommended first slice

**The MFP importer plus the foods/entries data model. No scanner.**

Rationale: it is the shortest path to actually eating your own dog food. Import the real diary,
and you are logging from your own food list on day one with zero API dependency. If the logging
UX feels good with a keyboard, the scanner is a genuine upgrade on top. If it does not, that is
learned cheaply — and no amount of barcode scanning would have rescued it.

---

## 8. Claims NOT verified — check these locally

Flagged honestly, because several are load-bearing:

1. **CORS behaviour of Open Food Facts and USDA FDC was never tested.** The research
   environment's egress proxy blocked direct calls to both hosts
   (`world.openfoodfacts.org:443` → 403 at the CONNECT). Everything in §3.3 about browser
   usability comes from documentation, not from a request that was actually made. **Run a curl
   and a real cross-origin fetch before committing to either.**
2. **How Open Food Facts wants browser apps to identify themselves.** They mandate a custom
   `User-Agent`; browsers cannot set that header. There may be an `app_name` / `app_uuid` query
   parameter convention — this could not be confirmed (their docs domain was also blocked).
3. **The OFF rate limits** (15/10/2 per min) come from a GitHub issue and secondary sources, not
   from the official docs page directly.
4. **FatSecret via Apps Script.** The claim that Apps Script's egress IPs are unstable and would
   defeat IP whitelisting is reasoning, not a tested result.
5. **`getUserMedia` in an iOS home-screen PWA.** Documented as fixed since iOS 14.3; not tested
   on the target device.
6. **FoodYou's actual screens have never been seen.** Its README supplied the feature list
   quoted in §3.4 and §10, but F-Droid (which hosts the screenshots) was blocked from the
   research environment. Every statement about its _information architecture_ is inferred from
   prose, not observed. **Clone it or view the F-Droid listing before designing against it.**
7. **The ODbL "Produced Work" vs "Derivative Database" reading in §10.3** is an interpretation
   of the licence, not a checked ruling. It drives a real architectural choice (bundle USDA,
   query OFF live), so confirm it against the ODbL text and Open Food Facts' own reuse guidance
   before shipping any bundled food data.
8. **The exact column set of the MFP "Download My Data" CSV.** Partially resolved: the export
   is documented as three files (Nutrition, Exercise, Progress), with the nutrition file
   containing calories, macronutrients, micronutrients and timestamps **for individual logged
   foods, summarised by meal**, plus food notes. That is per-food rows with macros, which is
   what the recommended first slice (§7) needs. Still worth confirming against a real export,
   and the existing parsers listed in §3.4 are the fastest way to learn the headers. **Request
   the export early — it takes up to 24h to arrive.**

---

## 9. Sources

- MFP API status — https://myfitnesspalapi.com/faq/
- MFP data export (official help) —
  https://support.myfitnesspal.com/hc/en-us/articles/360032273352-Export-your-nutrition-progress-and-exercise-data
- MFP export/email diary (official help) —
  https://support.myfitnesspal.com/hc/en-us/articles/360032623371-Can-I-export-my-data-or-email-my-diary-to-my-trainer-doctor-or-nutritionist
- Open Food Facts API docs — https://openfoodfacts.github.io/openfoodfacts-server/api/
- Open Food Facts reuse conditions —
  https://support.openfoodfacts.org/help/en-gb/12-api-data-reuse/94-are-there-conditions-to-use-the-api
- Open Food Facts rate-limit policy issue —
  https://github.com/openfoodfacts/openfoodfacts-server/issues/8818
- USDA FoodData Central downloads — https://fdc.nal.usda.gov/download-datasets.html
- USDA Global Branded Food Products Database guide —
  https://fdc.nal.usda.gov/docs/GBFPD_Documentation_and_Download_User_Guide_Apr2023.pdf
- FatSecret OAuth 2.0 (proxy + IP whitelist requirements) —
  https://platform.fatsecret.com/docs/guides/authentication/oauth2
- FatSecret editions — https://platform.fatsecret.com/api-editions
- BarcodeDetector on iOS / WASM workaround —
  https://dev.to/ilhannegis/barcode-scanning-on-ios-the-missing-web-api-and-a-webassembly-solution-2in2
- MDN BarcodeDetector — https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
- Open-source JS barcode scanners compared (html5-qrcode maintenance status) —
  https://scanbot.io/blog/popular-open-source-javascript-barcode-scanners/
- zxing-wasm-based scanner — https://github.com/Sec-ant/zxing-wasm
- ZBar WASM reader for iOS — https://github.com/eringen/web-wasm-barcode-reader
- Vision models vs Tesseract for OCR —
  https://dev.to/gabrielanhaia/vision-models-for-ocr-when-they-beat-tesseract-and-when-they-dont-54a6
- Parsing nutrition labels with AI —
  https://dev.to/albert_nahas_cdc8469a6ae8/parsing-nutrition-labels-with-ai-from-image-to-structured-data-56b2
- Open nutrition datasets compared —
  https://nutrola.app/en/blog/open-nutrition-datasets-compared-usda-openfoodfacts-nutrola
- Waistline (Cordova calorie counter, GPL-3.0) — https://github.com/davidhealey/waistline
- FoodYou (Kotlin/Compose, GPL-3.0, OFF + USDA + Swiss FCD) —
  https://github.com/maksimowiczm/FoodYou
- OpenNutriTracker (Flutter, GPL-3.0) — https://github.com/simonoppowa/OpenNutriTracker
- wger (Django workout + nutrition, AGPL-3.0) — https://github.com/wger-project/wger
- python-myfitnesspal (MFP data-model reference) —
  https://github.com/coddingtonbear/python-myfitnesspal
- awesome-nutrition-tracking (index of the space) —
  https://github.com/jrhizor/awesome-nutrition-tracking
- freemydiary (MFP export parser) — https://github.com/andrewzey/freemydiary
- myfitnesspal-diary-parser (MFP export parser) —
  https://github.com/leaherb/myfitnesspal-diary-parser
- myFitnessPal-Converter (MFP export parser) — https://pypi.org/project/myFitnessPal-Converter/
- MFP Data Export FAQs (file/column breakdown) —
  https://support.myfitnesspal.com/hc/en-us/articles/360032273352-Data-Export-FAQs
- Open-source MyFitnessPal alternatives (survey) —
  https://alternativeto.net/software/myfitnesspal/?license=opensource

---

## 10. Decisions taken

Settled 2026-08-23. These constrain §6 and §7; revisit deliberately, not by drift.

### 10.1 Design: FoodYou's flows, this app's clothes

**Adopted from FoodYou:** its information architecture only — how food search works, portion
picking, recipe composition, the multi-source database strategy, micronutrient targets.

**Not adopted:** its Material You visual language. `DESIGN.md` is unchanged and still governs —
grouped lists rather than floating cards, one subject per screen, seven type roles, no literals.

Concretely, FoodYou's README describes "a modular home screen with customizable cards." That is
the direct negation of two DESIGN.md section headings and is **explicitly out of scope**. Every
new nutrition screen must read as this app, not as a port of an Android one.

The rule of thumb: take what makes logging _fast_, leave what makes it look _Material_.

### 10.2 Code licence: permissive, when the repo opens

MIT or Apache-2.0, with **Apache-2.0 preferred** for its explicit patent grant.

**Not yet applied** — the README still reads "Private / unlicensed. All rights reserved." This is
a one-commit change whenever wanted; nothing in the nutrition plan depends on it.

Note what this does _not_ change: a permissive licence on this repo grants no rights over the
GPL projects in §3.4. Their code stays uncopyable. GPL is a non-issue here for the reasons §3.4
gives — different language, different framework, and UX/IA is not what copyright protects — not
because of anything this repo's licence says.

### 10.3 Data licences: bundle CC0, query ODbL

This is an architectural constraint, not merely a legal one:

- **Bundle USDA FoodData Central.** CC0 / public domain, no obligations. This is the offline
  starter database that ships with the app.
- **Query Open Food Facts live.** ODbL, attribution required. This covers the barcode long tail.
- **Do NOT ship a bundled subset of Open Food Facts.** Distributing one is a Derivative Database
  under ODbL, which drags share-alike onto that data. A live lookup producing a logged entry is a
  Produced Work instead — attribution, and nothing more.

This split also happens to be the better engineering: CC0 for the thing embedded in the bundle,
live lookup for the thing that changes daily. See §8.7 — the licence reading behind it is
unconfirmed and worth checking before any bundled data ships.
