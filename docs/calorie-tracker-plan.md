# Plan: calorie tracking

**Status:** BUILT, on branch `claude/food-logging`. Steps 1 to 6 are implemented and
merged; 835 tests pass with typecheck, lint and prettier clean. Untested by a human, and
step 0 below is still outstanding.

**The one thing still genuinely unverified:** `getUserMedia` inside an iOS home-screen PWA
(§8.1). The scanner is written and unit-tested, but nobody has pointed a real iPhone at a
barcode. Until that happens, treat step 6 as complete-but-unproven rather than done.

**Original status:** decisions locked, nothing built. This is the build plan.

**Companion document:** `calorie-tracker-feasibility.md`. That one asked whether this is
possible and what the options are. This one records what was chosen. Where the two
disagree, this document wins, and §10 below lists every place it supersedes the other.

**Date:** 2026-08-23.

**Named `calorie-tracker-plan.md`, not `plan.md`,** because `plan.tsx` and `plan.ts` already
belong to the workout planning feature and a bare `plan.md` would read as theirs.

---

## 1. What v1 is

**Full MyFitnessPal replacement.** Search, log, meals, recipes, barcode scanning, Open Food
Facts and USDA FoodData Central. The version where MFP gets deleted, not a stepping stone
toward it.

This is a long runway before anything is usable, and that is a known and accepted cost. The
build order in §7 is arranged so the app becomes dogfoodable at step three, well before the
network and camera work lands.

**Not in v1:** micronutrients, favourites, nutrition-label OCR, recipe nesting.

---

## 2. Decisions

Eighteen decisions, settled deliberately. Revisit them on purpose, not by drift.

### Data

| #   | Decision                                                                                                                                                                                                       | Why                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Scope is full MFP replacement                                                                                                                                                                                  | Half a tracker still means opening MFP                                                                                                                                                   |
| 2   | A food carries **calories, protein, carbs, fat**. Nothing else                                                                                                                                                 | Exactly what `DailyLog`, `targets.ts`, `charts.tsx` and `EDITABLE_DAILY_FIELDS` already handle, so nothing existing changes shape. Widening later is an easy migration; narrowing is not |
| 3   | An entry stores a **frozen copy of the food's basis**: name, the basis macros and the unit they describe, serving weight, package weight, plus quantity and unit. `foodId` is a soft link, never a foreign key | History must not mutate when a food is corrected or deleted. Storing the basis rather than the resolved total means an old entry's quantity is still editable                            |
| 4   | **Meals are user-defined**: a real table with name, time window and rank, plus a management screen                                                                                                             | Chosen over fixed slots for flexibility                                                                                                                                                  |
| 5   | Meal time windows **preselect the meal** when adding, always overridable                                                                                                                                       | PRD §5: one tap for what is already known. The clock is known. FoodYou stores these windows and never reads them for selection; this ships the half they left out                        |
| 6   | **Per-day mode.** A day with at least one entry is entry-based: derived totals win and the stored `DailyLog` macros are ignored. A day with none behaves exactly as it does today                              | Years of hand-typed totals already exist. A bug in this feature must not be able to corrupt them                                                                                         |
| 18  | Logging a recipe freezes **resolved per-serving macros only**                                                                                                                                                  | One snapshot mechanism covers foods and recipes both. Avoids FoodYou's two extra tables and the duplicated ingredient list on every log                                                  |

### Behaviour

| #   | Decision                                                                                                                                              | Why                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | New **push-only `Food Log` sheet tab**, one row per entry. The daily tab keeps carrying derived totals                                                | Per-food detail is what makes PRD §5.1's LLM rationale pay off. Push-only follows the existing cardio and habits precedent, so no new merge surface                                               |
| 8   | **Local-first.** Your foods are always searchable offline and are the default. OFF and USDA are separate chips that need network and degrade honestly | Narrows PRD §5 to "first-time lookup of a food never eaten before" and nothing more                                                                                                               |
| 9   | **Meals render on Today**, below the calorie ring                                                                                                     | One tap from app open to adding food. Matches both MFP's diary and FoodYou's home screen, so the muscle memory transfers                                                                          |
| 10  | Quantity input is **free-text number plus unit dropdown**, offering **g, ml, oz, fl oz, serving, package** on every food                              | Taken directly from FoodYou. Full set always, not filtered per food                                                                                                                               |
| 11  | Picking a unit the food cannot resolve **prompts for the missing weight and saves it to the food**                                                    | Consequence of 10. Measured: 75 of 133 real MFP foods (56%) land on a per-serving basis with no gram weight (§6.1), so this is the common case, not an edge. Turns a dead end into a one-time fix |
| 14  | Search **never reaches for the network on its own**. Remote chips fire on tap                                                                         | Keeps the §5 narrowing as small as decision 8 scoped it. FoodYou's 100ms auto-switch is fast but makes the network part of the ordinary logging path                                              |
| 15  | An unrecognised barcode **opens the new-food form with the code prefilled**                                                                           | Same shape as 11. You are holding the packet; the label is right there                                                                                                                            |

### Scope and sequence

| #   | Decision                                                                                                                              | Why                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 12  | USDA API key lives in a **device-local Dexie meta row, excluded from `BackupData`**                                                   | Mirrors `SyncConfigMeta`. Weaker case than the sync secret, since a data.gov key grants quota rather than write access, but keys do not belong in exportable files |
| 13  | MFP importer brings in **foods only**, ranked by how often you ate them. Historical entries are read for that ranking, then discarded | Decision 6 protects hand-typed history. Backfilling entries would flip every imported day to entry-based and silently replace your numbers with MFP's              |
| 17  | v1 includes **quick add**, **copy a previous day or meal**, and **recipes with servings**. Not favourites                             | Frequency ranking from the import is favouriting inferred from behaviour rather than asked for                                                                     |
| 16  | Build order: model, import, logging, sync, remote, barcode. Preceded by an iOS camera spike                                           | Dogfoodable at step three. Riskiest work last, but its single unknown is answered first                                                                            |

**Recipe nesting is out of v1.** A recipe's ingredients are foods. Sub-recipes need a
self-referencing key and cycle detection, which is real work for a rare case. FoodYou allows
nesting; this does not, and the ingredient table is shaped so it could later.

---

## 3. What this touches in the existing codebase

Six integration points, all found by reading the code rather than assumed.

### 3.1 One resolver, or the screens will disagree

Decision 6 means "the macros for day D" is now a computed question. Three places answer it
today and they must not each answer it differently:

- `aggregateDailyLogs` (`src/lib/daily-log.ts:137`), which averages per field over logged
  days only
- `charts.tsx:76`, which reads `dailyLogs` directly
- the daily tab push in `sync.ts`

**Build one `resolveDayMacros(date)` and route all three through it.** Its rule is the whole
of decision 6: entries exist for this day, so sum them; otherwise return the stored
`DailyLog` values.

`aggregateDailyLogs` also needs its "logged" predicate widened. A day is now logged if it has
entries **or** typed macros, and the existing per-field counting stays as it is.

### 3.2 Sync's dirty signal

`SYNC_SOURCE_KEYS` (`src/lib/sync.ts`) is the app's only dirty signal, and the comment beside
it is explicit that there are "31 independent `safeWrite` call sites, no funnel. Anything
that ever writes to IndexedDB without going through the store will be invisible to sync."

Every new store key has to be added there: `foods`, `foodEntries`, `meals`, `recipes`,
`recipeIngredients`. Miss one and food changes silently stop triggering a sync.

### 3.3 `upsertDailyLog` is safer than feared

The feasibility doc worried that `isDailyLogEmpty` (`store.ts:1424`) would delete a day that
had entries but no typed numbers. Because entries live in their own table, that day simply
has no `DailyLog` row to delete, and nothing breaks. `DailyLog` keeps its current job:
manually typed macros plus steps, bodyweight and cheat-day.

No change needed here. The risk only appears if derived totals are ever written back into
`DailyLog`, which decision 6 forbids.

### 3.4 `BackupData` will refuse to compile, by design

`BackupData` (`store.ts:194`) spells optional fields `| undefined` rather than `?:`
deliberately, so that adding one is a compile error at every construction site until handled.
Adding the five new collections will trip this. That is the mechanism working.

### 3.5 Feature flag and nav gate

`targetsEnabled`, `habitsEnabled`, `toolsEnabled` and `planEnabled` already exist, and
`AppShell` tabs support a `requires:` gate. Add `foodEnabled` to both and the whole feature
can be built behind it.

### 3.6 Grams are converted, and that is a divergence

`store.ts:120` records that weights are "stored as typed, not converted", deliberately.

Food has to break that rule. OFF and USDA both express nutrition per 100g, so grams are the
internal basis and every other unit in decision 10 is a conversion. Ounces and fluid ounces
convert on entry and on display; servings and packages resolve through the food's stored
weights.

This is a knowing divergence, not an oversight, and it is confined to food.

---

## 4. Data model

Dexie **`version(4)`**. v3 exists for habits, and the reasoning at `db.ts:161` applies
directly: these are new tables needing real indexes, so unlike cardio and session notes this
is a genuine bump.

```
foods:             id, barcode, name
foodEntries:       id, date, mealId
meals:             id
recipes:           id
recipeIngredients: id, recipeId
```

**`foods`** carries name, brand, barcode, `sourceType` (`user` | `mfp` | `off` | `usda`),
`sourceUrl`, `isLiquid`, `servingWeight`, `packageWeight`, and macros. One enum column
distinguishes provenance rather than separate tables, which is FoodYou's approach and it holds
up.

**The macro basis is not fixed at per-100g.** See §6.1: 46% of real logged portions use a
count unit with no gram equivalent, and 56% of distinct foods land there, so a rule of
"always per-100g" cannot represent much of the catalogue. A food instead carries:

- `basisQuantity` and `basisUnit`, the amount its macros describe. Open Food Facts and USDA
  foods are `100` and `g`. A food known only as "1 cake" is `1` and `serving`.
- `servingLabel`, the user-facing noun for one serving: "cake", "cup dry", "leg and thigh".
  Optional, and only set when it is something other than "serving". Showing "3 cake" rather
  than "3 servings" is what preserves the MFP muscle memory exactly.
- `servingWeight` stays, and stays **nullable**. It is what decision 11 fills in on demand, and
  filling it is what upgrades a count-based food into one that can also be logged in grams.

**`foodEntries`** carries `date`, `mealId`, `quantity`, `unit`, the soft `foodId` or
`recipeId`, and the frozen basis from decision 3: `name`, the basis macros, `basisQuantity`,
`basisUnit`, `servingLabel`, `servingWeight`, `packageWeight`. Indexed on `date` because Today
reads a whole day at once, and on `mealId` for grouping.

For a recipe entry the frozen basis is the resolved per-serving macros and the servings count,
per decision 18.

**`meals`** carries name, `fromHour`, `fromMinute`, `toHour`, `toMinute`, `rank`. Seeded with
sensible defaults on first run, then fully user-owned.

**Quick add** is a `foodEntry` with a name, typed macros, and no `foodId`. It needs no table
of its own here because entries already carry their own macros; FoodYou needed `ManualDiaryEntry`
only because its entries pointed at products instead.

### Search has no FTS

FoodYou uses SQLite FTS4 virtual tables. **Dexie has no equivalent.** For a personal
catalogue of hundreds to low thousands of foods, filtering in memory over the loaded `foods`
collection is fast enough and far simpler. Revisit only if the catalogue grows past the point
where that stutters.

---

## 5. Screens

All of it obeys `DESIGN.md`: grouped lists rather than floating cards, the seven type roles,
no `text-[NNpx]` literals, 44px minimum hit areas, sentence case, no em dashes, and empty
states that do not share a shape.

- **Today.** Gains a meal section per meal below the calorie ring. Each is a `group-list` of
  its entries with a per-meal add control. The ring stays the screen's single subject; meals
  read as its parts. Entry rows show name, then macros in the existing `--protein`,
  `--carbs` and `--fat` tokens, then the portion.
- **Search.** Meal and date bound before you arrive, shown in the header, so there is no
  "which meal" step afterwards. Source chips with per-source counts. Local is default and
  offline; remote chips fire on tap and state plainly when there is no network.
- **Add entry.** One screen. Free-text quantity, unit dropdown, meal chips preselected from
  the clock, date chips. Suggested portions as one-tap chips beneath the input.
- **Meal settings.** Add, rename, reorder, delete, and edit time windows.
- **Recipe create and edit.** Name, servings, note, liquid flag, and a flat ingredient list.
- **Settings.** USDA API key, MFP import, and the `foodEnabled` flag.

Colour rule worth restating because it is easy to break here: `--destructive` is for
destruction and errors only. Being over a calorie ceiling is `--warning`, and state must
never be carried by hue alone.

---

## 6. External APIs, as measured

Verified live on 2026-08-23, not taken from documentation. This closes §8.1 and §8.2 of the
feasibility doc.

- **Open Food Facts CORS works.** `Access-Control-Allow-Origin: *` on `/api/v2/product` and
  `/api/v2/search`; preflight `OPTIONS` returns 204 with full CORS headers.
- **Use `X-User-Agent` to identify the app.** OFF's `Access-Control-Allow-Headers` explicitly
  whitelists it. Browsers cannot set `User-Agent`, and OFF has deliberately allowed this
  custom header through CORS for exactly this case.
- **Use `/api/v2/search`. Do not use `cgi/search.pl`.** The legacy endpoint returned 200 then
  503 on back-to-back calls. `/api/v2/search` was solid and returns per-100g and per-serving
  values in one response.
- **`search.openfoodfacts.org` (Search-a-licious) is unusable from a browser.** It returns
  JSON but sends no `Access-Control-Allow-Origin`.
- **USDA CORS works**, `Access-Control-Allow-Origin: *`.
- **A registered USDA key is mandatory.** `DEMO_KEY` is throttled to 10 requests per hour, not
  the documented ~1000.
- **Barcode:** `zxing-wasm` with a `BarcodeDetector` fast path where available. Safari
  implements no `BarcodeDetector`, and every iOS browser is WebKit, so iOS always takes the
  WASM path.

### 6.1 The MFP source data, as measured

**"Download My Data" turned out to be unavailable.** The source is instead MFP's **printable
diary** report, at `myfitnesspal.com/reports/printable-diary/<user>?from=<date>&to=<date>`.
This is a different feature, it is free, and it is reachable now.

**These figures come from a working parser run against a real capture** of 2026-06-16 to
2026-08-23, not from estimation. A prototype exists and produced every number below.

| Fact                     | Value                                                   | Consequence                                                                                                                                  |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Parse completeness       | **873 of 873 rows, 0 failures**                         | No missing macros, no unmatched meals, no undated tables. The markup is regular enough to parse positionally                                 |
| Distinct foods           | **133** over 65 days                                    | Inside the feasibility doc's "200 to 400" estimate and comfortably inside the in-memory search budget in §4                                  |
| Total logged portions    | 873, about 13 a day                                     | Higher than expected, which makes copy-a-meal (decision 17) worth more                                                                       |
| Foods eaten 5+ times     | 48 of 133                                               | A third of the catalogue is most of the logging                                                                                              |
| Foods eaten once         | 42                                                      | Long tail is real but smaller than the PDF suggested                                                                                         |
| Branded foods            | **102 of 133**                                          | Over three quarters carry a brand. Brand is a first-class search field, not decoration                                                       |
| Meals in use             | **Dinner, Desert, Lunch, Breakfast, snack, Preworkout** | **Six**, half of them custom, one lowercase. Decision 4 is vindicated; fixed slots would have failed on the first import                     |
| Portions in a mass unit  | **53.8%**                                               | These yield a per-100g or per-100ml basis directly                                                                                           |
| Portions in a count unit | 46.2%                                                   | egg, tbsp, cup, slice, cake, cookie, tortilla, bowl, string, "leg and thigh"                                                                 |
| Distinct unit strings    | **53**                                                  | Including `gram(s)`, `grams`, `gramme`, `oz(s)`, `ml(s)`. The importer must normalise before unit lookup or it silently mis-classifies foods |

**Three things follow.**

First, the count-unit share is why the macro basis in §4 is flexible rather than fixed at
per-100g. "Rice Cake, 3 cake" gives 34.7 kcal per cake and no way to know what a cake weighs.
That imports as `basisQuantity: 1`, `basisUnit: serving`, `servingLabel: "cake"`,
`servingWeight: null`, and decision 11 fills the weight in later if it is ever needed.

Second, the report gives **macros for the portion eaten, not a basis**. The importer divides
through by the logged quantity. Spot-checked against reality and correct: honey resolves to
305 kcal per 100g, jasmine rice to 365, russet potato to 97, egg to 72 each.

Third, **some unit strings carry the serving weight inline** and should be mined for it:
`Cake (13 g)`, `pack (120g)`, `slices/64 grams`, `container (7 oz ea.)`. Four foods in this
sample get a `servingWeight` for free that decision 11 would otherwise have to ask for. Cheap
to extract, and every one avoids a prompt.

**Unit normalisation is not optional.** Before normalising, `Russet Potato` imported as "per 1
gram(s)" at 0.97 kcal, because `gram(s)` missed the lookup table and fell through to the count
branch. The value was arithmetically right and structurally wrong, which is exactly the kind of
error nothing downstream would catch. Normalising lifted mass-basis coverage from 47.8% to
53.8%.

### 6.2 Parse the HTML, not the PDF

The report was captured as a print-to-PDF. **Do not build the importer against that.**
Measured on the actual file: only **79% of food rows survive text extraction intact**. The
print is two-column, and roughly 160 rows have their name and their macros separated onto
different lines in an order that cannot be reliably re-paired.

This is not a theoretical risk. The extracted top-15 food list contains **"Breakfast Honey",
17 times**: the meal heading `Breakfast` fused onto the food `Honey`. A mis-paired row is
worse than a dropped one, because it produces a food with confidently wrong macros that
nothing downstream will ever flag.

The same page is HTML with a real table, so parsing that removes the entire class of problem.
**PDF text is not a supported input.**

The gap is now quantified. The PDF extraction reported **224 distinct foods**; the HTML parse
of an overlapping window reports **133**, with zero parse failures. Most of that difference is
phantom foods invented by the layout collapse, "Breakfast Honey" among them. The PDF did not
merely lose rows, it manufactured roughly ninety foods that do not exist.

**But capturing that HTML has one trap, and it has already caught us once.** The printable
diary is a Next.js single-page app. Chrome's "Save as, Webpage HTML only" saves the original
server response, which is the empty shell: 824KB of Material UI markup, a `__NEXT_DATA__`
payload of 752KB containing **zero food names**, and a React Query cache holding only `user`,
`notifications`, `subscription`, `consent-status` and `profile`. The diary is fetched after
hydration and its endpoint lives inside the JS chunks. A naive save captures none of it.

Two captures that do work, best first:

1. **The JSON response.** DevTools, Network tab, filter to Fetch/XHR, reload, and copy the
   response of the request that returns the diary. This is MFP's own structured data, so the
   importer needs no heuristics at all. Prefer this if it is available.
2. **The rendered DOM.** DevTools, Elements tab, right-click the root `<html>` node, Copy
   outerHTML, save that. Serializes the live DOM including the tables. "Save as, Webpage
   Complete" does the same re-serialization if DevTools is unavailable.

**The importer should accept whichever of those two shapes it is given**, and reject the shell
loudly rather than silently importing nothing. A quick guard: if the input contains no food
rows, say so, rather than reporting a successful import of zero foods.

### 6.3 The markup, and how to parse it

Confirmed against a real capture. The structure is regular and needs no heuristics:

- **One `<table>` per day.** The date is plain text immediately before the table, in
  `Mon D, YYYY` form.
- **One `<tbody>` per meal**, in the order the user has them.
- **A meal heading** is the first `<tr>` of a `<tbody>`: two cells, the meal name and an empty
  one.
- **A food row** is a `<tr>` of nine cells: `FOODS`, `Calories`, `Carbs`, `Fat`, `Protein`,
  `Cholest`, `Sodium`, `Sugar`, `Fiber`. Only the first five matter, per decision 2.
- **A totals row** starts with the literal `TOTALS` and is skipped, because decision 6 derives
  totals rather than importing them.

Two parsing details that are easy to get wrong:

- **Rows use `<th>`, not `<td>`,** for food data. Meal headings use `<td>`. Selecting only
  `td` returns nothing but meal names.
- **The food cell is `Name, <qty> <unit>`, and names contain commas** ("Blueberries, frozen, 1
  cup"). Split on the last comma followed by a number, not the first. Brand is split off the
  name on the first `" - "`.

Missing values arrive as `--` and must become null rather than zero.

---

## 7. Build order

**Step 0. iOS camera spike.** Confirm `getUserMedia` works inside an iOS home-screen PWA on
the actual target iPhone. Roughly an hour. It gates step 6 entirely and it is the only
unknown in this plan that could force a redesign, so it happens first even though the code
that needs it comes last.

**Step 1. Model.** Dexie `version(4)`, the five tables, the `foodEnabled` flag and nav gate,
`SYNC_SOURCE_KEYS` additions, `BackupData` additions, meal seeding and the meal settings
screen.

**Step 2. Import.** A parser for the MFP **printable diary HTML** (§6.1, §6.2), foods only,
frequency-ranked. Not CSV: "Download My Data" is unavailable on this account. `src/lib/csv.ts`
is the wrong starting point for the same reason; this is HTML table parsing.

Recover each food's basis by dividing the reported portion macros by the logged quantity, and
set `basisUnit` to `g` where the unit is a mass and `serving` otherwise, carrying the original
noun into `servingLabel`. Measured on a 10-week capture: 133 foods, 873 rows, zero parse failures. A longer pull scales proportionally. Markup spec in §6.3. After
this the catalogue holds real data and the app is worth opening.

**Step 3. Logging.** Search, the two-part quantity input, add and edit entry, meals on Today,
quick add, copy day and meal, recipes. This is the bulk of the work and where MFP's real moat
lives. **The app is dogfoodable at the end of this step**, entirely offline, with no network
code written yet.

**Step 4. Sync and backup.** `resolveDayMacros`, the three call sites in §3.1, the push-only
`Food Log` tab, backup round-trip.

**Step 5. Remote sources.** OFF and USDA as explicit chips, the USDA key in settings, offline
states, and caching anything logged into `foods` so the second lookup is local.

**Step 6. Barcode.** Scanner sheet, decode, lookup, the create-on-miss flow from decision 15.

---

## 8. Still unverified

Carried forward honestly. Everything here is load-bearing somewhere above.

1. **`getUserMedia` in an iOS home-screen PWA.** Documented as fixed since iOS 14.3, never
   tested on the target device. This is step 0.
2. ~~The MFP export's exact columns.~~ **Closed.** The source changed to the printable
   diary report and a working parser has been run against a real capture: 873 of 873 rows, zero
   failures. Shape is in §6.1, capture method in §6.2, markup spec in §6.3. Nothing here blocks
   step 2 any more.
3. **The ODbL "Produced Work" versus "Derivative Database" reading.** Now much lower stakes,
   see §10. A live lookup producing a logged entry is a Produced Work, needing attribution and
   nothing more. Confirm before shipping, and put OFF attribution in the UI.
4. **OFF rate limits** (roughly 15/min product, 10/min search) come from a GitHub issue rather
   than official documentation. Decision 14 makes this mostly moot, since remote queries only
   fire on a deliberate tap.

---

## 9. Reading FoodYou

Three cautions on the reference implementation, from reading the source at tag 3.4.9.

**The public source is the deprecated line.** Their own decision log deprecates 3.x and moves
all development to v4, and stops publishing development history entirely. The repository has
one branch and tops out at 3.4.9. What is readable is the version its author calls
architecturally suboptimal.

**Their ADR 0003 is a direct warning about decision 8.** FoodYou originally cached fetched
foods in one local table searched with their own logic, found the results diverged from what
OFF actually returns, and rewrote it to mirror remote search semantics, accepting worse
offline behaviour as the stated cost. That divergence came from blending local and remote into
one ranked list, which creates an expectation that the two agree. Decision 8 keeps sources in
separate chips, so no such expectation is ever set. This is why that trap does not apply here,
and it is worth not forgetting.

**Licence discipline.** FoodYou is GPL-3.0 and this repository is not. Everything above is
interaction design, schema concepts and API behaviour, which is not what copyright protects.
No code was copied and none should be.

---

## 10. What this supersedes in the feasibility doc

- **§10.3, "bundle CC0, query ODbL", is superseded.** Decision 8 makes USDA a live-queried
  chip like OFF, so no dataset is bundled at all. The 400MB subsetting problem disappears, and
  so does most of the ODbL exposure, since nothing is ever redistributed.
- **§6.1's recommendation (b), a manual override field, is superseded** by decision 6.
  Per-day mode plus quick-add entries covers the same escape hatch without an override that
  can silently disagree with the entries.
- **§7's first slice is superseded** by the build order in §7 above. It proposed the importer
  plus the data model and no scanner, which contained no way to log anything and so could not
  be dogfooded.
- **§8.1 and §8.2 are closed.** See §6 above, measured rather than documented.
- **§8.6 is closed.** FoodYou's screenshots ship in its repository under
  `metadata/en-US/images/phoneScreenshots/` and have been read.
- **§5, nutrition-label OCR, stays deferred** and is not in v1. The prediction there still
  holds: packaged food has barcodes, and unpackaged food has no label to scan.
