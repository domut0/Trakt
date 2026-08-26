# Home screen: the day view

**Status: planned, nothing built.** Every decision below is settled. Where a decision
overrides something already written down, the override is named explicitly in section 8.

This document assumes you have read:

- `DESIGN.md`, which this plan amends in two places (section 7).
- `docs/calorie-tracker-plan.md`, whose meal model this plan depends on and does not repeat.
- `src/routes/README.md`, for the routing conventions the date param has to obey.

## 1. What the screen becomes

Today is a fixed list of cards describing the current date, hardcoded to `new Date()`
at `src/routes/index.tsx:82`. It becomes a **day view**: a date you can move, with three
cards that all follow it.

The three cards, top to bottom:

1. **Week strip.** A calendar week, Sunday first. Pure navigation.
2. **Stats.** Calories and macros against targets, modelled on Food You.
3. **Timeline.** A 24 hour canvas showing what you intended and what you actually did.

Card 3 is the reason the screen exists. Cards 1 and 2 are the controller and the summary.

## 2. The idea

**Intent versus actual.** The app already stores intentions and never shows them next to
outcomes. Meal windows carry `fromMinutes`/`toMinutes` and are used only to guess which
meal you are adding to. The weekly plan says what you will train and is visible only on
its own screen. Neither has ever appeared beside the thing that actually happened.

The timeline puts them on one axis. Intent draws as a **dashed outline**. Actual draws as
a **solid fill**. The now line moves down the day, and an empty dashed band above it is
the whole feature in one glance.

## 3. Locked decisions

1. **The timeline is intent versus actual**, not a chart of logged events. It is the
   subject of the screen.
2. **The week strip navigates**, past and future. Tapping Friday shows Friday. Future days
   render intent only.
3. **Food is positioned by its meal window, not by a timestamp.** `FoodEntry.loggedAt` is
   the moment you tapped log, and `copyMealFrom` plus the MFP importer both stamp it as a
   batch (`loggedAt: now + idx`, `store.ts:1892`). The timeline never reads it. No `ateAt`
   field is added. A meal is a band at its own window and its entries live inside it.
4. **Planned workouts gain a time.** `PlannedWorkout` becomes
   `{ name, exerciseIds, atMinutes?, durationMinutes? }`. Without a time, a planned workout
   does not draw and behaves exactly as it does today.
5. **Dashed means planned, filled means actual.** One rule, applied identically to meal
   zones and training blocks. This is the only encoding on the card.
6. **The timeline is a full 24 hours with internal scroll**, auto scrolled to the now line
   on mount. The nested scroll is contained (section 5.3).
7. **Habits stay off the timeline.** `HabitEntry` is `{ id, date, habitId }` with no time
   at all, and adding one would record the tap rather than the act, which is the exact
   defect that ruled out `loggedAt` for food. `Habit` and `HabitEntry` are untouched and
   the habits card is unchanged.
8. **The timeline replaces the meal list and the workouts list.** Both are removed from the
   screen. `MealSection`'s contents move into a sheet opened by tapping a meal zone.
9. **Neither card 2 nor card 3 is elevated.** Both sit at `--surface`. Rank comes from size.
   This amends DESIGN.md (section 7.1).
10. **Bands are grey.** `--muted` fill for actual, dashed `--muted` stroke for planned.
    Identity comes from an icon and a label. No new colour token is added.
11. **The week strip carries no status dots.** Numbers only, selected day filled, exactly
    like the Apple Calendar reference. The consistency readout is not replaced anywhere,
    because `CalendarView` in History already shows the same workout and nutrition dots on
    a month grid (`CalendarView.tsx:212`).
12. **Card 2 drops the calorie ring** for the Food You layout: hero calories over target,
    the remaining line, three vertical bar glyphs, three macro rows. Steps is a fourth row,
    bodyweight a fifth.
13. **The remaining line respects `goalMode`.** "left" on a cut or a maintain, "to go" on a
    gain. `directionFor` in `targets.ts` already knows which is which.
14. **Bodyweight shows a bare value with no target.** No `bodyweight` field is added to
    `TargetProfile`.
15. **Overlaps are solved with two layers, not two columns.** Meal windows are full width
    background zones. Training draws on top, inset from the left. No column packing exists.
16. **The date lives in the URL as `/?date=yyyy-MM-dd`**, bare `/` meaning today, navigated
    with `replace` rather than `push`.
17. **Future days flip card 2 into intent mode**: every row states its target alone, with
    no value and no bodyweight row.
18. **One branch, all of it.** No phasing.

## 4. Schema and model changes

Small. Only one type changes shape.

### 4.1 `PlannedWorkout` (`src/lib/plan.ts:41`)

```ts
export interface PlannedWorkout {
  name: string;
  exerciseIds: string[];
  /** Minutes past local midnight. Absent means unscheduled: it does not draw. */
  atMinutes?: number;
  /** Absent falls back to a shared default duration. */
  durationMinutes?: number;
}
```

Both fields are optional and both must survive `plannedWorkoutOf`, which currently strips
unknown keys on purpose. **That normaliser is the thing most likely to silently eat these
fields**, so it is the first place to change and the first place to test.

No Dexie version bump. The plan is stored inside an existing meta row, not an indexed
table, and the note in `db.ts` covers why a non indexed field needs no bump.

The backup format gains these fields implicitly. `parseBackup` must keep tolerating plans
written before they existed, which is what `plannedWorkoutOf` returning a normalised copy
already buys.

### 4.2 Nothing else changes

`FoodEntry`, `Meal`, `Habit`, `HabitEntry`, `DailyLog`, `TargetProfile`, `WorkoutSession`
are all untouched. No migration, no version bump, no backfill.

## 5. The three cards

### 5.1 Card 1: week strip

Replaces `ConsistencyStrip` (`index.tsx:354`), which is deleted.

- A calendar week, Sunday first, seven cells.
- Weekday initial above, date number below. Selected day is a filled accent disc. Today,
  when not selected, is marked but not filled.
- Paging left and right moves a whole week. The month name sits above as a label, matching
  the reference.
- No dots. No status. Tapping a cell navigates.
- A "Today" affordance returns to the current date, and is hidden when already there.

Accent is correct here and is not decoration: DESIGN.md reserves it for things that are
actionable or currently selected, and the selected day is exactly that.

### 5.2 Card 2: stats

- Hero calories at `t-hero`, target beside it at `t-label`.
- Remaining line: "992 calories left" on a cut or maintain, "992 calories to go" on a gain.
- Three vertical bar glyphs, right aligned, in `--protein`, `--fat`, `--carbs`. Each is a
  filled portion over a track. The track goes **down** toward `--background`, per DESIGN.md.
- Three macro rows: colour swatch, name, `89 / 125 g`.
- A separator, then steps as a fourth row. No bar glyph, so the three bars keep matching
  the three macros.
- Bodyweight as a fifth row, value only.
- Any target that is unset renders no row. That is existing `TargetProfile` behaviour and
  is not changed.

**Absent is not zero.** A macro with no value shows "Not recorded", never `0`. This bug has
already shipped twice in this codebase and been fixed twice.

**Future day mode.** Every row states the target alone. No hero value, no remaining line,
no bodyweight row. The card keeps its shape and its heading.

### 5.3 Card 3: timeline

**Geometry.** 24 hours, midnight to midnight, at a fixed pixels per hour. Hour rules and
labels down the left, matching the reference. The card has a fixed height and scrolls
internally.

**Scroll containment.** The scroll container carries `overscroll-behavior-y: contain`.
Without it the card's scroll chains into the page at its top and bottom edges, which is the
single most common way a nested scroll region feels broken on touch. This is not optional
and it is not a nice to have.

**Auto scroll.** On mount, and only when the selected date is today, the container scrolls
so the now line sits around a third of the way down. On any other date it opens at the
first band of the day.

**Now line.** A thin accent rule with a time pill on the left, exactly like the reference.
It renders **only on today**. It updates on a timer, and the timer is cleared on unmount.

**Layer 1, meal zones.** Full width. One per meal, at `fromMinutes` to `toMinutes`.

- Dashed `--muted` outline, no fill, when the window holds no entries.
- Solid `--muted` fill when it does.
- Label and entry count inside. Tapping opens the meal sheet (section 5.4).

**Layer 2, training blocks.** Inset from the left so the zone beneath stays readable.

- A planned workout with `atMinutes` draws dashed at that time for its duration.
- A logged workout draws filled from `startedAt` to `endedAt`.
- Cardio draws filled from its back computed `startedAt`. The comment at `store.ts:334`
  already says this back computation exists so the bout lands on the timeline where it
  happened, so this is the use it was written for.
- A workout in progress has no `endedAt` and draws open ended, from `startedAt` to now,
  with no bottom edge.
- Tapping a logged block navigates to `/session/$id`. Tapping a planned block opens the
  plan editor.

**Identity.** A small icon and a label inside each band. Not hue. There is no strength
colour token and none is being added.

**Empty day.** A day with no bands at all still renders the canvas and the hour rules, and
says so once. It does not render six dashed meal zones as its empty state, because the
default meal set would make every untouched day look identically busy.

### 5.4 The meal sheet

`MealSection` currently owns the per meal add and copy actions
(`MealSection.tsx:147` and `:161`). Its contents move into a sheet:

- The meal's entries, each deletable, as today.
- "Add food to {meal}", opening `AddFoodSheet`.
- "Copy {meal} from another day", opening `CopyMealSheet`.

Tap count does not get worse. Today you scroll to the meal section and press plus. Here the
timeline is already scrolled to now, so the meal zone you want is on screen before you
touch anything.

`MealSection.tsx` is deleted. Its tests move with its contents.

## 6. Routing and the screen title

- `/?date=yyyy-MM-dd`, validated as a search param. Bare `/` is today.
- An unparseable or absent date resolves to today rather than throwing.
- Navigation between days uses `replace: true`. The back gesture leaves the screen instead
  of walking back through every day you tapped.
- The title is the selected date. When the selected date is today the title is "Today", so
  the common case reads exactly as it does now and DESIGN.md's one `t-title` per screen
  rule is untouched.
- The route meta description in `index.tsx` currently says "A frictionless workout logger
  for lifters", which stops being true when the home screen is a whole day view including
  food. It needs rewriting.

## 7. DESIGN.md amendments

Two, both required by decisions above. Neither touches the fixed identity in lines 5 to 8.

### 7.1 Rank may come from size instead of fill

The hierarchy section says one elevated surface per screen, at most one, and names Today's
calorie ring as the example. Both halves stop being true.

Amendment, to be written into the hierarchy section:

> Rank may come from **size** instead of fill. Where two cards are co-equal subjects of a
> screen, neither takes `--muted`: they both sit at `--surface`, and the taller one leads.
> This is the day view, where the stats card and the timeline are one subject seen twice.
> Leaving both at `--surface` is also what frees `--muted` for the bands inside the
> timeline, which is the only fill step they have.

The sentence naming the calorie ring as Today's subject is rewritten, since the ring is
being removed.

### 7.2 A stroke may carry state

The layout section says no border on containers, and the hierarchy section says elevation
is fill and never stroke.

Amendment:

> A stroke may encode **state**, never elevation. On the timeline, a dashed outline means
> planned and a solid fill means happened. That is a semantic distinction carried by a
> non-hue channel, which is what the colour section asks for. It is not a container border
> and it is not a substitute for a fill step.

This exists so that a reader six months from now does not delete the dashed bands as
decoration, which is precisely what the existing rule would tell them to do.

## 8. What this supersedes

- **`ConsistencyStrip` is deleted.** Its job moves to History, which already does it.
- **`MealSection` is deleted.** Its contents move to a sheet.
- **The workouts list on Today is deleted.** The timeline shows the same sessions and
  navigates to the same place.
- **The calorie ring is deleted.**
- **DESIGN.md's "on Today that is the calorie ring"** is no longer true.
- **`docs/calorie-tracker-plan.md` decision 5**, which put meal windows in service of
  guessing the current meal, is unchanged but gains a second consumer. Nothing in that
  document is overridden.

## 9. Risks and things not yet proven

1. **Nested scroll on a real phone.** `overscroll-behavior` is well supported and the
   containment rule is correct in principle, but the feel of a tall scrolling card inside a
   scrolling page has not been tested on device. This is the one thing most likely to send
   the design back, and it can only be judged by holding it.
2. **24 hours is mostly empty.** At a readable pixels per hour the canvas is long, and a
   day with three bands is a lot of scrolling past nothing. If it feels wrong on device the
   fix is an adaptive range, which was considered and rejected in favour of the reference.
3. **`plannedWorkoutOf` stripping the new fields.** Called out in 4.1 because it is a silent
   failure: the plan saves, the timeline draws nothing, and no error appears anywhere.
4. **Two render modes for card 2** doubles its test surface, and the future mode is the one
   nobody will look at until it is wrong.
5. **The index.tsx refactor is the risky part**, and decision 18 puts it in the same diff as
   the timeline. That was chosen deliberately. It means a bisect during review is bisecting
   two changes at once.

## 10. Test obligations

- `plannedWorkoutOf` round trips `atMinutes` and `durationMinutes`, and still normalises a
  plan that has neither.
- A plan written before these fields existed still resolves.
- Band geometry: a meal zone at 06:00 to 10:00 lands at the right offset and height for the
  chosen pixels per hour.
- A workout with no `endedAt` draws open ended and does not throw.
- The now line renders on today and on no other date.
- Card 2 renders "left" on a cut and "to go" on a gain.
- Card 2's future mode renders targets and no values, and no bodyweight row.
- A macro with no value renders "Not recorded", not `0`.
- `/?date=` with a malformed value resolves to today.
- Navigating days does not grow the history stack.
- The existing food, habit and workout suites still pass unchanged, since no data model
  they touch has moved.
