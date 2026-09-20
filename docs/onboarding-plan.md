# Onboarding: a practice workout, not a tour

Written 2026-09-20. Covers what happens to a client after the
`{coach} invited you to Trakt` screen in `src/routes/join.tsx`, and nothing
about planning, which is the coach's.

## Status

**Designed, not built.** Nothing in this document exists in the code yet. The
mechanism the centrepiece depends on does exist and is proven: coach mode's
read-only latch and store swap, shipped 2026-09-19.

## The diagnosis

`PRODUCT.md` opens with "One user: the person who built it... nobody else has
installed it. There is no user base to avoid disrupting and no onboarding
debt." Coaching made that false. A client now arrives through a link, from
somebody else's recommendation, with no idea what the app is and no stake in
finding out.

What they currently get is `/join`: a title, two sentences, three numbered
instructions, and a button that drops them in Settings. Then the app, cold.

The three instructions on that screen are **setup**, not learning. Add to home
screen, connect a sheet, share it. They are necessary, they are already
written, and they teach nothing about using the app, because none of them is
using the app.

The gap is everything after. Specifically:

| They have to learn                                           | Where it is taught today           |
| ------------------------------------------------------------ | ---------------------------------- |
| Bodyweight in the morning, macros at night                   | nowhere                            |
| That the Workout button starts from a card their coach wrote | nowhere                            |
| That a grey number is an offer and Save takes it             | nowhere                            |
| That set 2 copies set 1                                      | nowhere                            |
| That the clock counts between sets and starts itself         | nowhere                            |
| That finishing a lift moves them to the next one             | nowhere                            |
| That a setup note comes back next time                       | nowhere                            |
| That a plan arriving is a card they have to accept           | `CoachPlanPrompt`, when it happens |
| That the Plan tab is not theirs                              | `CoachManagedBanner`               |

Two of those nine are already answered by something that shipped. The other
seven are the job.

## The shape: why not a tour

The obvious build is a spotlight tour. A dark scrim, a cutout over the Workout
button, a tooltip, `Next (1/7)`. Three reasons it is the wrong thing here, in
ascending order of how much they matter:

1. **It fights the layout.** Every overlay in this app portals to the body at
   `z-50` over a `100dvh` shell. A cutout has to track a target through a
   portal boundary, a soft keyboard, and a scroller that moves under it. That
   is a category of bug this codebase has no other instance of.
2. **It teaches the chrome.** A tooltip pointing at a button teaches where the
   button is. Nobody forgets where the button is. What they forget is that the
   grey `60 kg × 8` on set 2 is already what they are about to lift, so they
   retype it, and the app's one real advantage over a notes app is lost in the
   first session.
3. **It is the house style this app was explicitly built to avoid.**
   `PRODUCT.md`, Brand Commitments: "The interface must not read as default
   AI-generated UI." `DESIGN.md` records a whole visual system being abandoned
   for exactly this reason. A scrim-and-pill coachmark tour is the most
   recognisable generated-app pattern there is, and it would be the first
   screen a client ever sees.

So: **the client does a real workout instead.** Every set they will ever log
goes through one screen, they will log four numbers a day beside it, and the
only honest way to teach a screen used one-handed between sets is to have them
use it one-handed.

## Three layers

Escalating cost, and each is useful without the ones after it.

| Layer                       | What it is                                                                  | When                      |
| --------------------------- | --------------------------------------------------------------------------- | ------------------------- |
| **1. The setup checklist**  | `/join`'s three steps, made live, and repeated on Today until they are done | Immediately               |
| **2. The practice workout** | A real workout in the real screens, on data that is thrown away             | Whenever they tap it      |
| **3. First-time lines**     | One line, once, on the screen where a thing actually happens                | The morning and the night |

Layer 2 is the substance. Layers 1 and 3 exist so that layer 2 does not have to
teach things that are better taught by the clock.

---

## Layer 1: the setup checklist

`/join` currently prints three instructions as static text and then forgets
them. It should print three **states**.

```
1  Add Trakt to your home screen        (unverifiable, see below)
2  Connect a Google Sheet               done when syncConfig exists
3  Share it with {coach}                done when pendingCoach.sharedAt is set
```

Two changes, both small:

- **The steps know whether they are done.** 2 and 3 are already answerable from
  state the app holds: `SyncConfigMeta` and `loadPendingCoach().sharedAt`. A
  done step is struck and marked; an undone one is tappable and goes to the
  place it happens.
- **`Get started` routes by what is missing**, rather than always landing on
  Settings. All three done, and it goes to Today.

Step 1 cannot be verified. `display-mode: standalone` says the app is installed
_now_, which is false on the browser tab where they are reading the
instruction, and a step that stays unticked forever is worse than one nobody
checks. So step 1 carries no mark and no state: it is an instruction, and the
other two are a checklist. That asymmetry is deliberate and should not be
tidied away by inventing a heuristic.

**The same three rows appear on Today**, in a `Getting started` card, until all
the verifiable ones are done. Reason: a client who taps `Get started`, connects
a sheet, gets distracted and comes back tomorrow has otherwise lost the thread
entirely. The card is also where the practice workout is offered.

The card is dismissible, and dismissing it does not remove the offer: the
practice workout stays in Settings forever (see
[Re-entry](#re-entry)).

---

## Layer 2: the practice workout

### What it is

They tap `Try a practice workout` and the app hands them a real session. Real
Workout button, real chooser, real start sheet, real workout screen, real
exercise screen, real ghosts, real prefill, real clock, real summary. They log
maybe five sets. None of it is saved.

Along the bottom is **one line of instruction at a time**, and it advances
because they did the thing, never because they tapped `Next`.

### The sandbox, and why it is already built

Coach mode solved this exact problem in the other direction. From
`src/lib/coach-store.ts`:

> Today, Charts and History are not reimplemented for a client. They read the
> arrays on the main store, so coach mode swaps those arrays for a client's and
> every screen renders their data unmodified.
>
> That trick is only safe because of the read-only latch. [...] every durable
> write is refused at the chokepoint.

The practice workout is that mechanism pointed at a fixture instead of a
client:

```
enterPractice()
  1. guard      no active session, not viewing a client, store hydrated
  2. latch      setDbReadOnly("practice workout")      <- before anything else
  3. capture    ownState = captureOwnState()
  4. swap       useStore.setState(practiceState(unit, card))

...the user logs sets. Every write goes into Zustand and stops at safeWrite().

exitPractice()
  5. restore    useStore.setState(ownState)
  6. unlatch    setDbReadOnly(undefined)               <- after, never before
```

What this buys, for free, because the latch already means all of it:

- **Nothing reaches IndexedDB.** `safeWrite` returns early while the latch is
  set (`db.ts:772`). Every store action mirrors through it.
- **Nothing syncs.** `sync-store.ts:374` already refuses to push while the
  latch is set, for the coach-mode reason, which applies here word for word:
  what the store holds is not this device's data. The `pending` flag survives
  and flushes after exit, which is correct.
- **Nothing is polluted.** Prefill (`lastSessionFor`), record detection, the
  rotation cursor and `predictedNextSlotName` all read the store arrays, and
  the arrays are put back. A practice bench press cannot become the ghost on
  their first real one.
- **Killing the app mid-practice is clean.** Nothing was written, the latch is
  module state, and a reload is their own empty app. This is the property that
  makes the whole thing safe to ship: the failure mode of a crash is that the
  practice never happened.

Three guards, each a real case:

| Guard                                 | Why                                                             |
| ------------------------------------- | --------------------------------------------------------------- |
| Refuse while `activeSessionId` is set | Swapping out a live workout would look like losing it           |
| Refuse while `useCoachStore.viewing`  | The latch is already taken and exit would clobber their restore |
| Refuse until `hydrated`               | Capturing empty arrays and restoring them is data loss          |

Restore goes in a `finally`. The one unrecoverable bug in this design is
leaving the latch on with their own data back in the store: the app would
silently stop saving. `coach-store.ts` already has that `catch`, and the same
shape is mandatory here.

### What they practise on

**Their own card, when they have one.** If a coach plan has arrived and been
accepted, the practice runs on the first `kind: "workout"` slot that has at
least one planned lift. They rehearse Monday's actual bench press at the actual
prescribed load, because `buildSetRows` ghosts from the prescription alone
(`set-rows.ts`: `prescribed.weight ?? soFar?.weight ?? back?.weight`). No
history is fabricated, and none is needed. The practice looks exactly like
their first real workout will look, which is the entire point.

**A fixture otherwise**, for the client who opens the app before their coach
has sent anything:

```ts
// src/lib/practice-fixture.ts — never persisted, never seeded
card: "Practice"
  Bench Press       3 × 8      60 kg / 135 lbs
  Lat Pulldown      3 × 10     45 kg / 100 lbs
  Incline DB Curl   2 × 12
```

The loads are unit-aware, read off their real `unit` before the swap. The third
lift carries no prescription on purpose, so they see what an unprescribed row
looks like: a ghost from nothing, which is blank.

### The rail

One line, pinned to the bottom, portalled to the body at `z-[55]`. Above the
`z-50` overlays it has to be legible on top of, below `Toast`'s `z-[60]` so a
toast is never hidden behind instruction text.

**It is not a sheet.** It does not register with `useSheetDismiss`, because
Escape must keep peeling off the exercise screen rather than the teacher.

**It reserves its own height.** `ExerciseScreen` and `/workout` both scroll to
the bottom edge of the screen, and the rail would sit on top of `+ Add set`.
The rail sets `--rail-h` on the root element, `0px` when off, and those two
scrollers add it to their existing bottom padding. Two lines, two files, and
nothing else in the app needs to know the rail exists.

**It advances on state, not on taps.** A step is a predicate:

```ts
interface Beat {
  id: string;
  say: string; // the line, one sentence, sentence case
  nudge?: string; // added after 8s on the same beat
  done: (s: Seen) => boolean;
}
```

`Seen` is a small snapshot assembled per render: the active session, the sets
in it, `currentExerciseId`, whether the exercise screen is open, which row is
being edited. The predicate is a pure function over it, so the script is
unit-testable without rendering anything, and the rail cannot claim they did
something they did not do.

**There is no wrong move.** Nothing blocks, nothing scolds, nothing is
disabled. Tapping something else just does that thing, and the beat waits. The
nudge after eight seconds is the only escalation, and it names the control
rather than repeating the instruction louder.

### The script

Twelve beats. `do` advances on what they did; `read` advances on a tap anywhere
on the rail, because some of these are facts rather than actions and pretending
otherwise would mean inventing busywork.

| #   | Kind | Line                                                                                    | Advances when               |
| --- | ---- | --------------------------------------------------------------------------------------- | --------------------------- |
| 1   | do   | `Tap Workout at the bottom.`<br>_nudge:_ `The flame in the middle of the bar.`          | chooser opens               |
| 2   | do   | `Pick Strength.`                                                                        | start sheet opens           |
| 3   | do   | `Start {card}.`                                                                         | `activeSessionId` set       |
| 4   | do   | `These are your lifts, in order. Open {first}.`                                         | exercise screen opens       |
| 5   | do   | `Set 1 already has the numbers {coach} asked for. Tap it.`                              | row 1 editing               |
| 6   | do   | `Save takes them as they are. Change a number first if you lifted something else.`      | a set exists                |
| 7   | do   | `Set 2 copied what you just did. Log it too.`                                           | a second set exists         |
| 8   | read | `Seat, pins, grip: write the setup once and it comes back every time you do this lift.` | tap                         |
| 9   | do   | `Tap Back. Finishing a lift moves you on to the next one.`                              | `currentExerciseId` changed |
| 10  | read | `The clock counts from your last saved set. Nothing to start, nothing to stop.`         | tap                         |
| 11  | do   | `Tap End, top right.`                                                                   | summary shown               |
| 12  | read | `That is the summary. Records only appear when you set one.`                            | tap, and exit               |

Beat 7 is the one that justifies the whole layer. Prefill is this app's actual
positioning (`PRODUCT.md`: "Suggestions keyed to named split-slot rotation, not
the calendar"), it is invisible until it happens to you, and a client who never
notices it will retype every number for a year and conclude the app is a notes
app with extra steps.

Beats 8, 10 and 12 are the ones to cut first if this reads long in the hand.
Beat 9 is not cuttable: the current-lift advance is the app's own model of what
you are doing, and a client who does not know it exists will think the ink moved
by itself.

### Leaving

A banner in the top slot for the whole practice, in the same vocabulary as
`ActiveSessionBanner` and `ClientBanner`, because it says the same kind of
thing: the app is in a mode, and this is the way out.

```
Practice workout · nothing is saved                          Leave
```

`/workout` renders no banner from `AppShell` (`BottomNav` and the shell both
bail on that path), so the practice banner mounts from the same portal as the
rail rather than from the shell. One component owns both, which also keeps them
from disagreeing about whether practice is on.

Leaving early exits cleanly and does not mark the practice done. Reaching beat
12 marks it.

### After

A closing card, on Today, replacing `Getting started` once practice is done:

```
Practice done

Nothing you just logged was saved. Your first real one will be.

Every morning      Bodyweight, on Today.
Every night        Calories, protein, carbs, fat, and steps if you count them.
When it arrives    A plan from {coach} shows up as a card. Read it, then accept it.
```

Three lines, three different shapes, per `PRODUCT.md`'s rule that empty states
must not share a template. No congratulation: `Practice done` is a statement of
fact and the app does not thank anyone for tapping through a tutorial.

---

## Layer 3: first-time lines

Everything left is on a clock, and a tour cannot teach a clock. Three lines,
each shown once, each on the screen where the thing happens:

| Where                   | When                                    | Line                                               |
| ----------------------- | --------------------------------------- | -------------------------------------------------- |
| Today, bodyweight row   | First launch before 11:00 after joining | `Weigh yourself before breakfast and put it here.` |
| Today, the macro rows   | First launch after 19:00 after joining  | `Fill these in once, when the day is done.`        |
| Today, the corner icons | Once, after the first workout is logged | `History and charts are up here.`                  |

Each is dismissed by being acted on or by a tap, and never returns. Stored as
ids in the walkthrough record.

**Cardio gets no line.** It is one card behind the Workout button, it is
self-explanatory once they have seen the chooser in beat 2, and a client whose
coach programmes cardio will be told to log it.

**The Plan tab gets no line.** `CoachManagedBanner` already says
`{coach} manages your plan` at the top of it. That is the whole lesson, it
already shipped, and repeating it would be the second thing on that screen
saying the same sentence.

**Settings gets no line.** Backup, units and unlinking are not day-one
knowledge, and a client who needs them has a coach to ask.

---

## What is deliberately not taught

Planning, entirely. No phase editing, no card reordering, no templates, no
weekday assignment, no prescriptions. The Plan tab is `inert` for a coached
client and the store refuses every plan-editing action while `coachManaged` is
set, so there is nothing there for them to learn.

The cliff is `Unlink`. A client who unlinks gets the full Plan tab with no
preparation whatsoever. That is accepted, not overlooked: unlinking is two taps
behind a confirmation that explains itself, it is rare, and building a second
tutorial for the case where somebody fires their coach is spending the budget
in the wrong place.

---

## State

localStorage, `trakt.walkthrough`, wrapped in try/catch, exactly like
`pending-coach.ts` and for its stated reason: "it is a one-off onboarding hint,
not the person's data, and must not ride along in a backup."

```ts
interface Walkthrough {
  joinedAt: number; // first /join open, anchors the "after joining" lines
  practiceDoneAt?: number; // beat 12 reached
  cardDismissedAt?: number;
  seen: string[]; // ids of the layer-3 lines
}
```

It must not go in Dexie `settings`. That row is backed up and mirrored to the
sheet, and a coach reading a client's sheet has no business seeing which
tutorial hints they have dismissed.

## Re-entry

`Settings → Practice workout`, a row under `Coaching`, available forever. Three
reasons: the card on Today can then be dismissed without regret, a coach can
tell a confused client to run it again, and it is the only way to test the
thing by hand after the first run.

---

## Files

New:

```
src/lib/walkthrough.ts            the twelve beats as predicates, pure, no React
src/lib/walkthrough-state.ts      localStorage record  (mirrors pending-coach.ts)
src/lib/practice-fixture.ts       the card and lifts, unit-aware
src/lib/practice-store.ts         enter/exit  (mirrors coach-store.ts)
src/components/PracticeRail.tsx   the rail and the banner, one portal
src/components/GettingStartedCard.tsx   Today's card, and the closing card
```

Changed:

```
src/lib/coach-store.ts    SWAPPED_KEYS and captureOwnState move to src/lib/store-swap.ts
src/routes/join.tsx       the three steps become live; Get started routes by what is missing
src/routes/index.tsx      mount GettingStartedCard under CoachPlanCard
src/routes/settings.tsx   a Practice workout row under Coaching
src/routes/workout.tsx    bottom padding picks up --rail-h
src/components/ExerciseScreen.tsx   same
src/components/AppShell.tsx         mount PracticeRail once, above CoachPlanPrompt
```

The one refactor is `SWAPPED_KEYS`. It is currently private to `coach-store.ts`
with a comment explaining that it is listed explicitly so a new store field is a
compile error if it should travel. Two callers need that list and both need that
property, so it moves to its own module rather than being copied.

## Tests

The script is pure functions over a snapshot, so most of this is cheap:

- `src/lib/__tests__/walkthrough.test.ts` — every beat's predicate against a
  snapshot that satisfies it and one that does not; the beats are ordered; no
  beat is satisfied by the empty snapshot.
- `src/lib/__tests__/practice-store.test.ts` — the three guards refuse; enter
  sets the latch before swapping; exit restores byte-identical state and drops
  the latch; a throw inside enter restores and unlatches; `db` sees no writes
  across a full logged practice session.
- `src/components/__tests__/PracticeRail.test.tsx` — advances on a store change
  rather than a click; the nudge appears on a timer; Escape reaches the sheet
  underneath and not the rail.
- `src/components/__tests__/GettingStartedCard.test.tsx` — step 2 and 3 read
  their real sources; step 1 is never marked.
- Extend `src/routes/__tests__/` for `/join` routing by what is missing.

`npm run screenshots` gains four: the live `/join`, `Getting started` on Today,
the rail over the exercise screen, and the closing card. The rail over the
exercise screen is the one that matters, because it is the only place in the
app where two full-screen portals stack.

---

## Open questions

Three things worth deciding before building, none of which block the rest:

1. **Does the practice run on their real card, or always on the fixture?**
   Designed above as their real card when they have one. The case against: a
   client who practises on Monday's bench and then does Monday's bench for real
   may not be sure which one the app kept. The banner says `nothing is saved`
   throughout, and the closing card says it again, which is judged enough.
2. **Twelve beats or nine?** Beats 8, 10 and 12 are facts rather than actions.
   Cutting them makes the practice about ninety seconds instead of two and a
   half minutes, at the cost of the setup note never being mentioned.
3. **Does the practice workout offer itself, or wait to be tapped?** Designed
   as an offer on a card. Auto-starting it the first time they reach Today is
   more certain to happen and is also the single most annoying thing an app can
   do to somebody who just wanted to look around.
