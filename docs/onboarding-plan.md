# Onboarding: sheet first, then a tutorial workout

Written 2026-09-20. What happens to a client after the
`{coach} invited you to Trakt` screen (`src/routes/join.tsx`).

Planning is not covered anywhere in here. The coach writes the plan, the Plan
tab is locked for a client, so there is nothing on it for them to learn.

## Status

**Designed, not built.** None of this is in the code yet.

---

## The flow, screen by screen

Four steps, in this order, and each one has to be done before the next is
offered. The sheet is connected **before** the tutorial workout, so that by the
time they are logging practice sets their coach is already hooked up and the
real thing works the moment the tutorial ends.

### 1. They open the invite link

`/join`, which already exists. Currently it prints three instructions and a
button that dumps them in Settings.

It becomes a checklist that knows what is done:

```
Sam, your coach Dave invited you to Trakt

 1  Add Trakt to your home screen          >
    From your browser's share menu

 2  Connect a Google Sheet                 >
    It creates one for you, in your own Drive

 3  Share it with Dave                     >
    One tap, once your sheet exists

 4  Try a tutorial workout                 (locked until 2 and 3 are done)

                [ Continue ]
```

Steps 2 and 3 tick themselves off. The app already knows:

- **2 is done** when a sheet is connected (`syncConfig` exists in the database)
- **3 is done** when it has been shared (`pendingCoach.sharedAt` is set)

**Step 1 never ticks.** The app cannot tell whether it is installed to the home
screen from inside the browser tab where they are reading the instruction. A
tick that never appears is worse than no tick, so step 1 is an instruction with
no box, and the other two are a checklist. Do not try to be clever about this
later.

`Continue` goes to whichever step is next, not always to Settings.

### 2. They connect the sheet

Settings, `Connect Google Sheet`, the Google account picker, one consent
screen. About twenty seconds. This already works and needs no changes.

### 3. They share it with the coach

Settings, one tap, because the invite link carried the coach's email address.
This already works too.

### 4. The tutorial workout unlocks

Step 4 stops being greyed out. Tapping it starts the tutorial.

If they closed the app somewhere in the middle, the same four rows appear as a
**`Getting started` card on Today** until they are all done. That is the only
way a client who got distracted after step 2 ever finds their way back.

---

## Tutorial mode

### What it looks like

The whole time the tutorial is running, there is a bar across the top of the
screen:

```
┌───────────────────────────────────────────────┐
│  Tutorial mode                       Skip  →  │
└───────────────────────────────────────────────┘
```

It is the **same bar as coach mode's** `Bob's Trakt`, in the same slot, built
the same way. Copy `src/components/ClientBanner.tsx` almost line for line:

| Property     | Value                                  | Why                                                        |
| ------------ | -------------------------------------- | ---------------------------------------------------------- |
| Background   | `bg-accent` (white)                    | Same as coach mode. Inverted bar means "you are in a mode" |
| Text         | `text-accent-foreground` (black)       | Same                                                       |
| Height       | `min-h-[44px]`                         | Same, and it is the minimum tap target                     |
| Position     | In flow, first child, not `fixed`      | See below. This is not a style choice                      |
| Top padding  | `paddingTop: env(safe-area-inset-top)` | Clears the phone's status bar                              |
| Left text    | `Tutorial mode`                        | What you asked for                                         |
| Right button | `Skip →`                               | What you asked for                                         |

**The bar is in flow, never `fixed`.** Both existing banners carry a comment
explaining why, and it is a real bug they already hit: this app runs under a
translucent status bar, so a bar pinned to `top: 0` sits underneath the phone's
clock and **its button cannot be tapped**. In flow it also needs no reserved
gap underneath it. If somebody later "fixes" this by making it fixed, Skip
stops working on a real phone and nobody will be able to reproduce it on a
desktop browser.

### Where it has to be mounted

This is the one genuinely fiddly part, and it is worth getting right up front.

The tutorial happens across three screens, and they are three separate
full-screen things that do not share a parent:

| Screen              | What it is                                 | Banner goes                    |
| ------------------- | ------------------------------------------ | ------------------------------ |
| Today, Plan, etc.   | `AppShell`                                 | The banner slot it already has |
| The workout screen  | `/workout`, its own layout, no `AppShell`  | First child of its flex column |
| The exercise screen | A full-screen overlay on top of everything | First child of its flex column |

So: **one `TutorialBanner` component, mounted in three places.** It returns
`null` when the tutorial is off, so the two extra mounts cost nothing the rest
of the time.

The exercise screen mount is the one that matters most. That screen is where
most of the tutorial happens, and it covers the whole display. Without its own
copy of the banner, `Skip` would vanish for the longest stretch of the
tutorial, which is exactly when somebody is most likely to want it.

### What Skip does

Immediately, with no confirmation:

1. Throws away the tutorial workout
2. Puts their real (empty) data back
3. Sends them to Today
4. Marks the tutorial as done, so it stops offering itself

No "are you sure". The tutorial workout is fake, so skipping loses nothing, and
a confirmation on a Skip button is the app arguing with somebody who has
already decided.

Skipping is not permanent. `Settings → Tutorial workout` runs it again, forever.
That row is also how you test this by hand after the first run.

---

## The tutorial workout itself

### The idea

They do a **real workout in the real screens**. Real Workout button, real
chooser, real start sheet, real exercise screen, real grey suggested numbers,
real prefill, real clock, real end-of-workout summary.

None of it is saved. Not to the phone, not to the Google Sheet, not into their
history, not into the numbers the app suggests next time.

This is instead of the usual thing, which would be a dark overlay with a
spotlight hole cut over each button and a `Next (1/7)` tooltip. Three reasons
not to do that:

1. **It teaches the wrong thing.** A tooltip pointing at a button teaches where
   the button is. Nobody forgets where the button is. What they never work out
   on their own is that the grey `60 kg × 8` on set 2 is already what they are
   about to lift, so they retype it every set for a year.
2. **It fights this app's layout.** Every overlay here is a full-screen portal
   over a locked `100dvh` shell, with a soft keyboard that moves things. A
   spotlight hole has to track a moving target through all of that.
3. **It is the look this app was built to avoid.** `PRODUCT.md` says the
   interface must not read as default AI-generated UI, and `DESIGN.md` records
   an entire visual system being thrown out for that reason. A scrim-and-pill
   coachmark tour is the most recognisable version of that look, and it would
   be the first screen a client ever sees.

### What they practise on

**Their own coach's card, if one has arrived.** They rehearse Monday's actual
bench press at the actual weight Dave prescribed. The app already shows grey
suggested numbers from a prescription alone, with no history needed, so the
tutorial looks exactly like their first real workout will look.

**A fixture card otherwise**, for someone who opens the app before their coach
has sent anything:

```
Tutorial
  Bench Press       3 × 8     60 kg  (or 135 lbs)
  Lat Pulldown      3 × 10    45 kg  (or 100 lbs)
  Incline DB Curl   2 × 12    no weight given
```

The weights follow whichever unit they picked. The third lift deliberately has
no prescribed weight, so they see what a row with nothing suggested looks like.

### How they are told what to do

**One line at a time, along the bottom of the screen**, above the thumb, where
the buttons it is talking about actually are.

The instruction is at the **bottom** and the mode bar is at the **top**, and
they are two different things doing two different jobs:

- The top bar says _what mode you are in_ and gives you the way out. It never
  changes.
- The bottom line says _what to do next_. It changes constantly.

Putting the instruction in the top bar instead would mean reading the
instruction at one end of the phone and doing it at the other, and it would
mean the `Skip` button moving around as the text length changes.

**The line advances because they did the thing, not because they tapped Next.**
Each step watches for a real change: the chooser opened, a set exists, the
current lift changed. So the tutorial cannot claim they did something they did
not do.

**Nothing is blocked and nothing scolds.** Tapping something else just does
that thing, and the line waits. After eight seconds on the same step it adds a
short nudge naming the control.

### The script

12 steps. `do` advances on what they did. `read` is a fact with nothing to do,
and advances on a tap anywhere on the line.

| #   | Kind | The line                                                                                | Advances when          |
| --- | ---- | --------------------------------------------------------------------------------------- | ---------------------- |
| 1   | do   | `Tap Workout at the bottom.`<br>_after 8s:_ `The flame in the middle of the bar.`       | chooser opens          |
| 2   | do   | `Pick Strength.`                                                                        | start sheet opens      |
| 3   | do   | `Start {card}.`                                                                         | workout starts         |
| 4   | do   | `These are your lifts, in order. Open {first lift}.`                                    | exercise screen opens  |
| 5   | do   | `Set 1 already has the numbers {coach} asked for. Tap it.`                              | row 1 opens            |
| 6   | do   | `Save takes them as they are. Change a number first if you lifted something else.`      | a set is logged        |
| 7   | do   | `Set 2 copied what you just did. Log it too.`                                           | a second set is logged |
| 8   | read | `Seat, pins, grip: write the setup once and it comes back every time you do this lift.` | tap                    |
| 9   | do   | `Tap Back. Finishing a lift moves you on to the next one.`                              | current lift changes   |
| 10  | read | `The clock counts from your last saved set. Nothing to start, nothing to stop.`         | tap                    |
| 11  | do   | `Tap End, top right.`                                                                   | summary appears        |
| 12  | read | `That is the summary. Records only appear when you set one.`                            | tap, then it exits     |

**Step 7 is the one that justifies the whole tutorial.** The app copying set 1
into set 2 is its single biggest advantage over writing sets in a notes app, it
is invisible until it happens to you, and somebody who never notices it will
retype every number forever.

**Step 9 cannot be cut.** The app moving you to the next lift by itself is its
own idea of what you are doing, and somebody who does not know it exists will
think the highlight moved on its own.

Steps 8, 10 and 12 are the ones to cut if it feels long in the hand. That takes
it from about two and a half minutes to about ninety seconds.

### When it ends

The tutorial exits, their real data comes back, and Today shows:

```
Tutorial done

Nothing you just logged was saved. Your first real one will be.

Every morning      Bodyweight, on Today.
Every night        Calories, protein, carbs, fat, and steps if you count them.
When it arrives    A plan from Dave shows up as a card. Read it, then accept it.
```

No congratulation. The app does not thank people for tapping through a
tutorial.

---

## How the sandbox works

This is the technical half. Skip it if you just want the flow.

### It is coach mode, pointed at a fixture

Coach mode already solved this exact problem in the other direction. When a
coach opens a client, the app does **not** have a second copy of every screen
for client data. It swaps the arrays in the store for the client's, and every
screen renders someone else's data unchanged. The thing that makes that safe is
a **read-only latch**: one switch that makes every write to the database do
nothing.

The tutorial is that same machinery pointed at a fake card instead of a real
client:

```
Start the tutorial
  1. Check     no workout already running, not in coach mode, data loaded
  2. Latch     setDbReadOnly("tutorial")          <- FIRST, before anything else
  3. Save      keep a copy of their real data in memory
  4. Swap      put the tutorial card in the store

  ... they log sets. Every write stops at the latch and goes nowhere.

End the tutorial (or Skip)
  5. Restore   put their real data back
  6. Unlatch   setDbReadOnly(undefined)           <- LAST, after the restore
```

Four things fall out of that latch for free, with no extra code:

- **Nothing is written to the phone.** Every database write in the app already
  goes through one function, and that function returns early while the latch is
  on.
- **Nothing is pushed to the Google Sheet.** The sync code already refuses to
  push while the latch is on, for coach mode's reason, which applies here word
  for word: what is in the store is not this device's data. The "needs syncing"
  flag survives and flushes normally afterwards.
- **Their real numbers are not polluted.** The app's suggestions, records,
  and split rotation all read those same arrays, and the arrays get put back. A
  tutorial bench press cannot show up as the suggested weight on their first
  real one.
- **Force-quitting mid-tutorial is clean.** Nothing was written, and the latch
  only exists in memory, so re-opening the app is just their own empty app.
  The worst case of a crash is that the tutorial never happened.

Order matters at both ends, and this is the one thing to get right: the latch
goes on **before** the swap and comes off **after** the restore, so there is no
instant where a write could land on the wrong data. The restore goes in a
`finally` block. The one unrecoverable bug here is leaving the latch on with
their real data back in the store, because the app would then silently stop
saving anything for the rest of the session.

### Three cases that must refuse to start

| Refuse when                     | Because                                                  |
| ------------------------------- | -------------------------------------------------------- |
| A real workout is already going | Swapping it out would look like losing it                |
| The user is in coach mode       | The latch is already taken and exiting would clobber it  |
| The app has not loaded its data | Saving empty arrays and restoring them is real data loss |

### The bottom instruction line

Rendered as a portal at `z-[55]`: above the full-screen overlays at `z-50` that
it has to sit on top of, below `Toast` at `z-[60]` so a toast never hides
behind it.

It is **not** registered as a sheet, so pressing Escape closes the exercise
screen rather than the tutorial.

It reserves its own height by setting a `--rail-h` variable on the root
element, `0px` when off. The workout screen and the exercise screen both scroll
all the way to the bottom edge, so without that the line would cover
`+ Add set`. Two lines of CSS in two files, and nothing else in the app needs
to know the tutorial exists.

---

## The one risk in "sheet first"

Gating the tutorial behind the Google Sheet is the right call, and it has one
failure mode worth naming: connecting a sheet needs a Google account, a consent
screen and a working connection. A client whose Google sign-in fails, or who
taps away from the consent screen, is now blocked from the tutorial as well as
from syncing.

The escape hatch is the `Settings → Tutorial workout` row, which is there
anyway. It is not advertised on the checklist, so it does not undermine the
order, but it means a client stuck on Google can still be told "go to Settings
and run the tutorial" by their coach.

---

## Files

New:

```
src/lib/tutorial.ts              the 12 steps, as plain functions, no React
src/lib/tutorial-state.ts        remembers how far they got (localStorage)
src/lib/tutorial-fixture.ts      the tutorial card and its lifts
src/lib/tutorial-store.ts        start / skip / finish  (copy of coach-store.ts)
src/components/TutorialBanner.tsx    the "Tutorial mode  Skip →" bar
src/components/TutorialRail.tsx      the instruction line at the bottom
src/components/GettingStartedCard.tsx    the four rows, on Today
```

Changed:

```
src/routes/join.tsx                the three steps become live, plus step 4
src/routes/index.tsx               show GettingStartedCard
src/routes/settings.tsx            a Tutorial workout row
src/routes/workout.tsx             mount TutorialBanner, make room for the rail
src/components/ExerciseScreen.tsx  same
src/components/AppShell.tsx        mount TutorialBanner and TutorialRail
src/lib/coach-store.ts             move the "which fields to swap" list into its
                                   own file so the tutorial can use it too
```

**Where the progress is remembered:** localStorage, same as
`src/lib/pending-coach.ts`, for the reason that file already gives: it is
onboarding bookkeeping, not the person's data, and it must not ride along in a
backup. It specifically must not go in the app's settings row, because that row
is mirrored to the Google Sheet and a coach has no business seeing which
tutorial steps their client skipped.

## Tests

- `tutorial.test.ts` — each of the 12 steps advances on the right change and
  not on the wrong one; none of them is already satisfied at the start.
- `tutorial-store.test.ts` — the three refusals; latch before swap; skip and
  finish both restore exactly and drop the latch; a crash partway through still
  restores; a full logged tutorial writes nothing to the database.
- `TutorialBanner.test.tsx` — renders nothing when the tutorial is off; Skip
  exits with no confirmation; it appears on all three screens.
- `TutorialRail.test.tsx` — advances on a state change, not on a click; the
  nudge appears after eight seconds; Escape reaches the screen underneath.
- `GettingStartedCard.test.tsx` — steps 2 and 3 read their real sources; step 1
  never ticks; step 4 is locked until 2 and 3 are done.

`npm run screenshots` gains four: the live `/join`, `Getting started` on Today,
**the tutorial banner over the exercise screen**, and the closing card. The
third is the one that matters, because it is the only place in the app where
the banner sits on a full-screen overlay.

---

## Still to decide

1. **Their real coach card, or always the fixture?** Written above as their real
   card when they have one. The worry: somebody who practises Monday's bench and
   then does Monday's bench for real might not be sure which one the app kept.
   The banner says `Tutorial mode` the whole time and the closing card says it
   again, which is judged enough.
2. **12 steps or 9?** Cutting 8, 10 and 12 takes it to about ninety seconds and
   loses the setup-note lesson.
3. **Does the tutorial start itself once the sheet is shared, or wait to be
   tapped?** Written above as a tap on step 4. Auto-starting is more certain to
   happen, and is also the most annoying thing an app can do to somebody who
   just finished a Google consent screen.
