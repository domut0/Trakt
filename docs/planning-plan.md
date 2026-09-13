# Planning: two models, because there are two shapes

Written 2026-09-13. Supersedes the weekly-template planning in
`docs/trakt-plan.md` and the `plannedWeek` / `targetProfiles` / `weekdayTargets`
model it inherited.

## The diagnosis

The Plan tab was a seven-slot weekday array, and both of the things it needed to
hold refused to fit, for opposite reasons.

**Training is a rotation, not a calendar.** The user's split is UL×∞: Upper,
Lower, Upper, Lower, forever. It advances _when he trains_, not when the date
changes. Skip a day and nothing shifts. There is no week in it.

**Nutrition is a calendar, not a rotation.** "From Sunday onward I'm cutting" is
a date, and it holds until the next change.

One model cannot be both. So there are two, and the Plan tab shows each as what
it is.

## Nutrition: a timeline of change-points

```ts
interface NutritionPhase {
  id: string;
  startsOn: string; // yyyy-MM-dd
  name: string;
  kind: "targets" | "untracked";
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  steps?: number;
  goalMode?: GoalMode;
}
```

**There are no end dates.** A phase runs until the next one starts. Resolving any
date is: _the phase with the latest `startsOn` that is not after it_. That is the
entire algorithm, and it is why "easily replicated across weeks" needs no
replication feature — a phase already covers every future day until something
replaces it.

The user's stated case is three rows:

| From       | Phase       | Targets                 |
| ---------- | ----------- | ----------------------- |
| Sat 13 Sep | Maintenance | 20,000 steps            |
| Sat 19 Sep | Untracked   | none                    |
| Sun 20 Sep | Cut         | 3,000 cal, 24,000 steps |

A single untracked Saturday is not a special case: it is a phase with no targets
that happens to be superseded the next day.

**One set of numbers per phase.** Training-day / rest-day macro splitting was
offered and declined. Under a rotation the app cannot know whether a future day
is a training day, so the only honest implementation would flip a day's targets
the moment a set was logged, which is a moving goalpost. Exceptions are handled
by a one-day override instead.

**Planned-untracked is DERIVED, never written.** A day that falls in an untracked
phase reads as untracked without a `DailyLog` row being created for it. Writing
the flag on the user's behalf, for a day they never opened, would be the app
inventing a record of a decision rather than reflecting one. `isUntracked` stays
a fact the user sets; "is this day untracked" becomes `flag || phase.kind ===
"untracked"`.

## Training: the rotation, which already exists

`predictNextSlotName` (`store.ts:362`) sorts slots by `rotationOrder`, finds
whichever was logged most recently, and advances one with wraparound. **That is
already UL×∞.** Two slots named Upper and Lower, and it alternates forever.

Its best property is that **there is no cursor.** Nothing stores "where am I in
the cycle", so nothing can desynchronise:

- A rest day is a no-op. Nothing logged means the most-recent slot is unchanged,
  so tomorrow suggests what today suggested.
- Deviating self-corrects. Do Upper twice and the next suggestion is Lower.

What changes:

**Planned workouts lose their TIME.** `atMinutes` and `durationMinutes` existed for
exactly one reason: the day timeline drew a planned band at a time of day, and a
band needs a position and a height. The timeline is deleted, and a grep confirms
nothing else ever read either field - so the plan editor is still asking what
time you intend to train in order to feed a screen that no longer exists.

**Planned exercises move from the weekday onto the slot.** `SplitSlot` gains
`plannedExerciseIds`. `PlannedWeek`, `PlannedWorkout` and all of `plan.ts` are
deleted. UL×∞ is two slots, PPL is three, an Arnold split is six — any cycle
length, and rest days need no representation because the rotation has no dates.

**The choice between slots becomes visible.** Today the Start Workout sheet shows
an empty field and a grey `suggested: Upper` placeholder, and `suggestions` is
`trimmed ? … : []` — so with an empty input **nothing is listed at all** and
picking Lower means typing it from memory. The slots become taps, with the
suggested one marked. Free text stays, for creating a genuinely new slot.

This also reduces a real hazard the code already admits to ("quietly bending the
rotation"): a name that matches nothing creates a new slot, so one fat-finger
forks UL×∞ into three slots. Matching is case-insensitive and trimmed, so only a
true typo does it — but with two slots, one typo halves the app's hit rate.

## Dated pins, for when you do know

```ts
interface PlannedDay {
  date: string; // yyyy-MM-dd, primary key
  splitSlotId: string;
}
```

A pin is a fact about one day. The rotation fills every day without one, and
**the rotation is never projected forward** — a plan that is confidently wrong is
worse than no plan, and a free choice after a rest day makes the future genuinely
unknowable. Unpinned future days show nothing, honestly.

## What the Plan tab becomes

Two sections, each shaped like the thing it holds:

1. **Nutrition** — the phase list, newest change-point first, each editable. Plus
   a short strip resolving the next few days, so "individual days" is visible
   without pretending every day is an entry.
2. **Training** — the rotation in order, each slot with its planned exercises,
   "next up" at the top, and any dated pins.

## Migration

- `targetProfiles` + `weekdayTargets` → one `NutritionPhase` carrying the single
  profile's numbers, starting at the earliest date the user has any data for.
  Nothing is lost; the seven-entry array simply stops existing.
- `plannedWeek` → each non-null day's `exerciseIds` merge onto the slot matching
  its `name`, deduped. A planned day whose name matches no slot creates one.
- Dexie bump for the two new tables. Backup version bump; phases and pins are in
  the JSON export, because it is the only backup that exists.
- Sheet sync is **deferred**: the sheet mirrors what happened, and a plan is what
  is intended. Adding it means new tabs and new merge semantics for no current
  question the sheet is being asked.
