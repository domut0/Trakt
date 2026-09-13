# Trakt: the overhaul plan

**BUILT. All six phases are done and merged to `main`.** Read section "Where the
plan was wrong" at the bottom before trusting any specific claim in here: four
of them turned out to be false, and two of those were false in the direction of
"this is dangerous" when it was not.

Written 2026-09-12, out of a full grilling session. Supersedes the visual half of
`DESIGN.md` and the product half of `PRD.md`. Where this document and those
disagree, this one wins.

## What the app is

Four things, and nothing else:

1. Morning bodyweight.
2. Calories and macros, entered once at the end of the day.
3. A workout tracker and a weekly workout planner.
4. A Google Sheet that mirrors all of it.

**It is not a food tracker.** It never asks what you ate. It asks for numbers you
already know.

## The decisions this plan rests on

Each was put to the user during the grilling and answered. These are the
expensive ones to reverse.

1. **Dark, and a full repaint.** Not an inversion of the paper theme.
2. **`DESIGN.md` splits in two. The style layer dies; the system layer lives.**
   Dead: paper ground, Archivo, uppercase type roles, 0.1em tracking, ruling as
   the ranking device. Alive: state carried by mark not hue, dashed = planned /
   solid = happened, 44px minimum hit targets, phone-only with no breakpoints,
   tabular numerals on anything compared, no dark-mode toggle (there is one
   theme and it is this one).
3. **The reference is the soft-card system, dark, at logging density.** Rounded
   cards on a near-black ground, separated by space rather than rules. Take the
   geometry, leave the ornament: no circular arrow buttons, no emoji
   illustration, no congratulatory copy, no pill bars with floating dots, no
   pastel multi-colour tiles, no floating pill nav.
4. **Feature toggles are the biggest "AI generated" tell in the app** and they
   all die. The Features and Tabs sections of Settings go. Every toggle becomes
   a decision.
5. **Cut:** food logging entirely, habits, both calculators, the day timeline,
   per-weekday target profiles, the History view switcher, the protein/carbs/fat
   charts.
6. **Keep:** `DailyLog`, workout logging, the weekly plan, Sheets sync, JSON
   backup, the lbs/kg toggle, single-profile targets.
7. **`isCheatDay` becomes `isUntracked`**, and starts meaning something. A day
   you chose not to log is not a day you forgot.
8. **Sheets sync stays two-way as built.** The three-way merge survives.
9. **Today is the daily-numbers card**, and that card is the centre of
   attention. No workouts list on it.
10. **All six numbers always render**, placeholder when unlogged.
11. **One font**, `ui-rounded` (SF Pro Rounded on iOS). Sentence case everywhere.
12. **The app is called Trakt.**

---

## Phase 0 - hygiene

Zero risk. Everything here was verified merged and clean before deletion.

- Delete merged local branches (`w/*`, `b/*`, `slice/*`, `claude/*`, `feat/*`).
- Remove 14 registered worktrees, all clean.
- Remove 5 orphaned directories: `abtn-d-{meal,plan,stats,tl,week}`.
- Delete 11 remote branches. 10 are merged into `origin/main`; the 11th,
  `claude/myfitnesspal-sync-automation-dqmjtz`, is a single commit adding a
  MyFitnessPal sync action that Phase 1 deletes the reason for.
- Rename to Trakt: `package.json`, PWA manifest `name`/`short_name`, `<title>`,
  README. **The GitHub repo rename needs the web UI** - there is no `gh` on this
  machine.
- Rewrite the README. The current one advertises PR detection, setup notes and
  food logging as headline features.

## Phase 1 - delete

Delete first, repaint second. The paper redesign already restyled the food
sheets once; repainting screens that are about to be deleted is work paid for
twice, and deleting first shrinks the repaint surface by about 40%.

Files removed outright:

    lib/food.ts  lib/food-sources.ts  lib/mfp-import.ts  lib/barcode.ts
    lib/timeline.ts  lib/onerm.ts  lib/plates.ts
    components/AddFoodSheet  BarcodeScannerSheet  MealSheet  MealsEditorSheet
    components/RecipeEditorSheet  CopyMealSheet  ImportMfpSheet
    components/HabitsCard  HabitEditorSheet
    components/OneRmCalculatorSheet  PlateCalculatorSheet
    components/DayTimeline
    plus every matching __tests__ file

Edited, not deleted: `store.ts`, `db.ts`, `csv.ts`, `sync.ts`, `settings.tsx`,
`index.tsx`, `charts.tsx`, `history.tsx`, `use-day-macros.ts`.

Also in this phase, because it is a one-class fix and it is visible today:

**The `group-row` overlap bug.** `SessionView.tsx:47` renders "Edit" and
"Delete" as swipe-reveal underlays inside a `relative overflow-hidden`
container; the foreground row translates over them. But `@utility group-row`
(`styles.css:402`) sets display, align, gap, min-height and padding and **no
background**. The row is transparent, so the underlays print through it at rest,
and "Edit" at `pl-5` lands on the same left gutter as the set-index span at
`w-5`. Fix: give the row an explicit ground.

This is the locked lesson from the paper redesign - _deleting a fill is right
for a panel on the page and fatal for anything over it_ - and it will re-appear
across the repaint. **22 components use a portal, `fixed inset` or
`absolute inset`** (about 13 survive Phase 1). Every one needs an explicit
ground in Phase 4.

## Phase 2 - data

Not delegated. Data model and merge logic.

- **Dexie v5**: drop the food and habit tables; rename `isCheatDay` to
  `isUntracked` on `DailyLog`.
- **Untracked days start counting.** Today they are decorative: `isCheatDay` is
  read by `CalendarView` and `WeeklyView` to draw a mark, by `csv.ts` to export a
  column, and by nothing else. Not by `chart-math.ts`, not by the weekly
  averages. So an untracked Tuesday and a forgotten Tuesday are identical to
  every aggregate in the app, which throws away the only fact the flag exists to
  record. After this phase: weekly counts read "5 logged, 1 untracked, 1 missed",
  and a chart draws an untracked day as a deliberate break in the line rather
  than as absence.
- **Sheet migration.** `isCheatDay` lives in `EDITABLE_DAILY_FIELDS` keyed by the
  header string `"Cheat Day"`. In a three-way merge, changing that header means
  the parser stops finding the column in a sheet that still has the old one and
  reads it as absent - and absent is a legitimate value here, so a naive rename
  can silently clear real data on the next sync. The Apps Script renames the
  header in place; the app never merges across the rename. `SYNC_FORMAT_VERSION`
  bumps to 2. The `habits` and `Food Log` tabs are orphaned and deleted by hand,
  once - not worth code.
- **Backup tolerance.** There is a pre-overhaul JSON export. `parseBackup` must
  still read `isCheatDay` and tolerate food and habit keys, or restoring that
  file silently drops every untracked day.

## Phase 3 - the new DESIGN.md

Written before any repaint, because the parallel workers in Phase 4 all apply it
and without a contract they produce dialects. This is exactly how the `b/*`
branches worked - six worktrees, each commit `style(X): apply DESIGN.md` - and
all six merged cleanly.

Contents: ground and surface tokens, card radius and elevation, the spacing
scale that replaces the ruling, the `ui-rounded` type scale in sentence case,
the accent and where it is allowed, and the rule that every overlay declares its
own ground.

Hard constraints carried in from the grilling:

- **No uppercase type role exists.** Three do today (`t-title`, `t-heading`,
  `t-caption`), and `t-caption` - 10px, weight 700, `letter-spacing: 0.1em`,
  75% width - is used **109 times**. Condensed grotesque plus wide-tracked
  all-caps micro-labels plus heavy ruling is the house style of every AI design
  tool of the last two years. It is the single biggest tell in the app.
- **Space replaces rules.** There are **76 `group-row-sep` hairlines** and 14
  `group-header` rules today. Most become spacing or a card edge.
- **Delete the six `font-stretch` declarations.** They exist for Archivo's width
  axis. `ui-rounded` has no addressable width axis, so they would silently do
  nothing - the worst failure mode, because the type just quietly gets wider.
- **`npm run screenshots` runs Playwright on Windows, where SF does not exist.**
  Every screenshot falls back to a system face. The repo's best QA instrument
  stops showing real type, and that needs either a bundled stand-in or a loud
  note in the script.

## Phase 4 - repaint

`gem --model gemini-3.5-flash-high`, one worktree per screen, the pattern that
already worked. Every diff reviewed here. Screens: Today, Plan, History,
Charts, Settings, Workout, plus the surviving sheets.

## Phase 5 - Today

One card, six rows, in this order: **bodyweight** (separated above by a stronger
division, because it is a different visit), then calories, protein, carbs, fat,
steps.

- **No calorie hero.** The 44px figure with a hatched measure bar is the most
  recognisable MyFitnessPal inheritance in the app, and it is a food-tracker
  idiom. It also contradicts the stated priority: bodyweight was named first and
  currently renders last, below four macros.
- **Every row always renders.** `MetricRow` already handles a null value by
  drawing "Not recorded" (`DayStatsCard.tsx:93`) - the placeholder exists. The
  bug is that Protein, Fat, Carbs and Steps are each wrapped in
  `{targetX !== undefined && ...}` (lines 318, 333, 348, 363), so the row is
  gated on whether a _target_ is set, not on whether a value is logged. On a day
  with no targets the card shows a calorie hero and bodyweight and nothing else,
  and no amount of logging makes protein appear. Deleting four conditionals is
  most of this phase.
- Above it, the week strip. Below it, nothing.

## Sequencing

Each phase merges to `main` when it is finished, and gets used on a real phone
before the next one starts. The last three big pieces of work in this repo sat
unmerged for weeks and two were thrown away; the fix is shipping in slices, not
picking better.

## The risk worth naming

This is the **third visual system in seven weeks** - MyFitnessPal dark, then the
paper timetable, now this. Both predecessors were chosen deliberately, documented
thoroughly, and abandoned inside a fortnight. That pattern says the design is
being chosen from candidate rolls and design documents rather than from living
with the app.

So this one is deliberately native and deliberately boring: a look with no thesis
to get tired of. **Ship it, then use it for a month before touching it again.**

---

## Where the plan was wrong

Written after the build. Kept rather than corrected in place, because the
mistakes are the useful part: each one is a thing that looked true from the
outside and was not.

**1. "The flag is read by nothing but the calendar and the CSV."** False, and it
was a truncated `grep | head -20`. `charts.tsx` already ringed untracked calorie
days rather than colouring them, and had since the paper redesign.

**2. "Renaming the sheet header can silently clear real data through the
three-way merge."** False, and the sync layer says so in its own comments:
`parseTable` treats a column it cannot find as _"no opinion, not cleared"_ and
leaves the field out of the merge entirely, while `writeTab_` rewrites the header
row on the next push. The rename needed no Apps Script migration at all.

What it DID need, which the plan did not mention, is a **data** migration. The
field is non-indexed, so it needs no schema change and is easy to miss — but
Dexie stores whole objects, so an untouched row keeps the old key forever and
every day already marked would have quietly reverted to ordinary.

**3. The plan asked for two incompatible things.** "Untracked days count
separately in weekly aggregates" and "History keeps calendar only" cannot both
hold, because the only weekly aggregate in the app lived in the view being
deleted. The explicit instruction won and `countUntrackedDays` went with
`WeeklyView`. The distinction survives where it is read: on the calendar cell,
in the day panel, and as a ring on the calorie chart.

**4. The file list said to delete `onerm.ts`.** It feeds `pr.ts` feeds
`workout-summary.ts`: the 1RM _maths_ is load-bearing even though the 1RM
_calculator_ is not. The compiler caught it; the list did not. Only
`percentageTable` and its two helpers were actually dead.

## What the plan did not anticipate

**Deleting the Features section stranded four flags.** `targetsEnabled` defaults
to FALSE, so for one commit the app shipped with daily targets permanently off
and no UI anywhere to switch them on. `TargetsEditor` was worse: still imported
by `settings.tsx`, rendered by nothing, because it lived _inside_ the section
that was deleted. Neither was caught by 700 tests. Both were caught by
`npm run screenshots` within a minute of it running again.

**The repaint was mostly a token swap, and that was luck.** Eight root values
feed everything, and `paper`/`ink` mean "ground" and "what is printed on it"
rather than "white" and "black", so inverting the values inverted the app. Five
components had to be genuinely rewritten because they were built on the
_metaphor_ rather than on the system: the week strip's inked column, the
calendar's ruled lattice, the chart's hatch fill, the Daily/avg ruled box, and
the nav's active rule.

**Two controls disappeared during the inversion**, both because two tokens
drifted onto the same value: the Untracked checkbox (filled with
`--color-border` against a list that became the same colour) and, in the same
class, the swipe row that let its own underlays print through it. Neither is a
logic error and no test can see either. The rule that prevents the whole class
is in DESIGN.md: anything that overlays or translates declares its own ground.
