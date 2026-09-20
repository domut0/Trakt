# Onboarding: sheet first, then a tutorial workout

Written 2026-09-20. What happens to a client after the
`{coach} invited you to Trakt` screen (`src/routes/join.tsx`).

Planning is not covered anywhere in here. The coach writes the plan, the Plan
tab is locked for a client, so there is nothing on it for them to learn.

## Status

**Designed, not built.** None of this is in the code yet.

## Decided

| Question                                         | Answer                               |
| ------------------------------------------------ | ------------------------------------ |
| Practise on their real coach card, or a fixture? | **Always the fixture**               |
| How many steps in the tutorial workout?          | **9**, and every one is an action    |
| Does the tutorial start itself?                  | **No.** They tap a row to start it   |
| Does adding to the home screen get a tutorial?   | **Yes**, and it needs its own design |
| Does every step get a visual demo?               | **Yes**. See [The demos](#the-demos) |

Because the card is always a fixture, no step can say "the numbers your coach
asked for". The fixture's numbers are the app's, and the copy says so.

---

## The flow, screen by screen

Four steps, in order. The sheet is connected **before** the tutorial workout, so
that by the time they finish practising, their coach is already hooked up and
the real thing works immediately.

### Step 0. They open the invite link

`/join`, which already exists. It becomes a checklist that knows what is done:

```
Sam, your coach Dave invited you to Trakt

 1  Add Trakt to your home screen          >
 2  Connect a Google Sheet                 >
 3  Share it with Dave                     >
 4  Try a tutorial workout                       (locked until 2 and 3 are done)

                [ Continue ]
```

`Continue` goes to whichever step is next, not always to Settings.

If they close the app halfway through, the same four rows appear as a
**`Getting started` card on Today** until they are done. That is the only way
somebody who got distracted after step 2 finds their way back.

### Step 1. Add to home screen

This one splits by platform, and the split is not cosmetic. **On Android the app
can install itself in one tap. On iPhone it cannot, and that is the only place
the drawn walkthrough is actually needed.**

| Platform                          | What they get                                     | Does the step tick itself?           |
| --------------------------------- | ------------------------------------------------- | ------------------------------------ |
| **Android / Chrome**              | An `Install` button. One tap, native prompt, done | **Yes**, on the `appinstalled` event |
| **iPhone / Safari**               | A four-frame drawn walkthrough                    | **Yes, but late.** See below         |
| **Desktop, or already installed** | The row is not shown at all                       | n/a                                  |

**Android.** Chrome fires a `beforeinstallprompt` event, which the app can
catch, hold onto, and fire later when they tap `Install`. There is no
walkthrough to build, because there is nothing to walk through. The app has no
handler for this event today, so this is new code, but it is about fifteen
lines and it makes the single most-skipped onboarding step into one tap.

**iPhone.** Safari has no install API at all. The Share button and the share
sheet are browser furniture, outside the web page, and **no web app can
screenshot them, point at them, or detect a tap on them.** This is the hard
constraint that shapes the whole demo design below. So iPhone gets four drawn
frames:

```
 1   Tap the Share button          (the square with the up arrow, bottom bar)
 2   Scroll down the list
 3   Tap "Add to Home Screen"
 4   Tap "Add", top right
```

**The iPhone step ticks itself, just late.** I said in the last draft that it
could never tick. That was wrong, and the correction matters: Safari sets
`navigator.standalone` to `true` when the app is running from the home screen.
It is always `false` in the tab where they are reading the instruction, so it
cannot confirm anything at the time. But the **next** time they open the app
from the home screen, it is true, and the step ticks retroactively. So the row
is unticked while they are in the browser, and ticked forever after, which is
the honest reading of the situation.

### Step 2. Connect the sheet

Settings, `Connect Google Sheet`, the Google account picker, one consent screen.
About twenty seconds. Already works, no changes. Ticks when `syncConfig` exists.

### Step 3. Share it with the coach

Settings, one tap, because the invite link carried the coach's email. Already
works. Ticks when `pendingCoach.sharedAt` is set.

### Step 4. The tutorial workout

Step 4 stops being greyed out. They tap it and the tutorial starts.

---

## The demos

Every step shows you where to tap. A soft dot travels to the right control,
presses it, and a ripple goes out.

### Two kinds, because there are two kinds of step

| Kind                       | Used for                               | Built from                            |
| -------------------------- | -------------------------------------- | ------------------------------------- |
| **A. Cursor over the app** | Everything inside Trakt                | Nothing. It points at the real screen |
| **B. A drawn phone**       | Adding to the home screen, iPhone only | Four small SVG drawings               |

There is only one kind B because there is only one place the app cannot reach:
Safari's own chrome.

### Kind A: the cursor over the live app

**No screenshots, no recordings, no assets at all.** The dot moves over the real
screen and points at the real button.

How it finds the button: each target gets a marker attribute in the markup, and
the demo looks it up and asks the browser where it currently is.

```
  <button data-tutorial="nav-workout" ...>       in BottomNav

  demo:  find [data-tutorial="nav-workout"]
         ask it for its position on screen
         animate the dot from wherever it is, to there
         ripple
```

Four things this buys, and they are the reason to do it this way:

- **It can never go stale.** Move the Workout button, restyle it, rename the
  card, switch to kilos: the demo still points at the right thing, because it
  asks the live screen rather than replaying a picture of an old one.
- **It weighs nothing.** No images to download, and this app is offline-first
  with everything precached.
- **It works through the overlays.** Position is measured against the viewport,
  so it does not care that the exercise screen is a full-screen layer on top of
  everything else.
- **It survives the keyboard.** The position is read when the demo plays, not
  when the app was built, so a screen pushed up by the soft keyboard is still
  pointed at correctly.

The nine markers it needs:

| Step | Marker             | Lives in                  |
| ---- | ------------------ | ------------------------- |
| 1    | `nav-workout`      | `AppShell.tsx`            |
| 2    | `chooser-strength` | `WorkoutChooserSheet.tsx` |
| 3    | `start-confirm`    | `StartWorkoutSheet.tsx`   |
| 4    | `lift-row-first`   | `WorkoutLog.tsx`          |
| 5    | `set-row-1`        | `ExerciseScreen.tsx`      |
| 6    | `set-save`         | `ExerciseScreen.tsx`      |
| 7    | `set-row-2`        | `ExerciseScreen.tsx`      |
| 8    | `exercise-back`    | `ExerciseScreen.tsx`      |
| 9    | `workout-end`      | `workout.tsx`             |

If the target is not on screen yet, no demo plays and the written line stands on
its own. That is not a failure case to code around; it is what should happen
when the thing being pointed at does not exist yet.

### A dot, not an arrow pointer

You said mouse pointers. I have drawn it as a **translucent grey circle** rather
than an arrow, for one reason: this app is phone-only, with no desktop layout
and no breakpoints, and the person watching is holding a phone and about to use
a finger. A circle is what iOS and Android both use in their own screen
recordings to mean "a finger went here".

It is a one-line swap if you want the arrow instead, and nothing else in the
design depends on which it is.

### Kind B: the drawn phone, for the iPhone home screen steps

Four SVG drawings of a phone showing Safari, with the same dot animating inside
them. They are **schematic drawings, not photographs**: a rounded rectangle for
the phone, a bar for Safari's toolbar, a panel for the share sheet, grey bars
for the rows you are not tapping and a real label on the row you are.

Drawn, rather than real screenshots, for three reasons:

1. **Weight.** `vite.config.ts` precaches `**/*.{js,css,svg,ico,png,woff2}`, so
   every image in the build is downloaded on install by every user and kept
   forever. Four real screenshots at phone resolution is most of a megabyte. The
   same four as SVG is a few kilobytes.
2. **They would look wrong.** Trakt is one theme, true black, no light mode. A
   real iOS screenshot is a bright grey-and-blue rectangle pasted into a black
   app. A drawing uses the app's own colours and reads as part of it.
3. **A drawing ages better than a fake.** iOS moves things. A schematic drawing
   that obviously is a diagram stays useful when the real share sheet shifts. A
   screenshot that is nearly right is worse than a diagram, because it tells
   somebody to look for something that is not there any more.

**If you want real screenshots anyway**, that is a fair call and here is what it
costs: take them by hand on a real iPhone, save them as WebP at 1x (not 2x or
3x), and narrow the precache pattern in `vite.config.ts` so they are fetched on
demand instead of shipped to everybody. Budget about 40 KB each that way, and
plan to retake them every time iOS changes the share sheet. The demo player
itself does not change: it composites the same dot over an image instead of over
a drawing.

### When a demo plays

- **Automatically, once, after 8 seconds** stuck on the same step. This replaces
  the text nudge from the previous draft. You only ever see it if you needed it.
- **On demand**, from a `Show me` button on the instruction line, always.
- **Never while they are typing.** If a text field has focus, the demo waits.
  Playing an animation over somebody entering a weight is the app talking over
  them.

The demo is a loop of about 1.5 seconds and plays twice, then stops. It never
blocks: taps go straight through the dot to the app underneath, so somebody who
sees where to go can just go there mid-animation.

### Reduced motion

`src/styles.css` already kills every animation globally under
`prefers-reduced-motion`, with `!important`, so a travelling dot would simply
teleport. That is not good enough, so the demo has a real alternative rather
than a broken one: **under reduced motion there is no dot and no travel.** The
target gets a static ring around it and the instruction line stays put. Same
information, no movement.

---

## Tutorial mode

### The bar

The whole time the tutorial is running:

```
┌───────────────────────────────────────────────┐
│  Tutorial mode                       Skip  →  │
└───────────────────────────────────────────────┘
```

Same bar as coach mode's `Bob's Trakt`, same slot, same build. Copy
`src/components/ClientBanner.tsx` nearly line for line:

| Property     | Value                                  | Why                                                           |
| ------------ | -------------------------------------- | ------------------------------------------------------------- |
| Background   | `bg-accent` (white)                    | Same as coach mode. An inverted bar means "you are in a mode" |
| Text         | `text-accent-foreground` (black)       | Same                                                          |
| Height       | `min-h-[44px]`                         | Same, and the minimum tap target                              |
| Position     | In flow, first child, never `fixed`    | Not a style choice. See below                                 |
| Top padding  | `paddingTop: env(safe-area-inset-top)` | Clears the phone's status bar                                 |
| Left text    | `Tutorial mode`                        |                                                               |
| Right button | `Skip →`                               |                                                               |

**Never `fixed`.** Both existing banners carry a comment about this and it is a
bug they already hit: the app runs under a translucent status bar, so a bar
pinned to `top: 0` sits under the phone's clock and **its button cannot be
tapped**. If somebody later "fixes" this by making it fixed, Skip stops working
on a real phone and nobody will reproduce it on a desktop browser.

### It has to be mounted in three places

The tutorial crosses three full-screen layouts that do not share a parent:

| Screen              | What it is                                | Banner goes                    |
| ------------------- | ----------------------------------------- | ------------------------------ |
| Today, Plan, etc.   | `AppShell`                                | The banner slot it already has |
| The workout screen  | `/workout`, its own layout, no `AppShell` | First child of its flex column |
| The exercise screen | A full-screen overlay over everything     | First child of its flex column |

One `TutorialBanner` component, three mounts, returns `null` when the tutorial
is off. The exercise screen mount matters most: that is where six of the nine
steps happen, and without its own copy the way out would disappear for the
longest stretch of the tutorial.

### What Skip does

Immediately, no confirmation: throw the tutorial workout away, put their real
data back, go to Today, mark the tutorial done so it stops offering itself.

No "are you sure". The workout is fake, so skipping loses nothing, and a
confirmation on a Skip button is the app arguing with somebody who has already
decided.

Not permanent: `Settings → Tutorial workout` runs it again, forever. That row is
also how you test this by hand.

---

## The tutorial workout

They do a real workout in the real screens. Real Workout button, real chooser,
real exercise screen, real grey suggested numbers, real prefill, real clock,
real summary. None of it is saved: not to the phone, not to the Google Sheet,
not into their history, not into the numbers the app suggests next time.

### The card they practise on

Always the fixture, never their coach's real card:

```
Tutorial
  Bench Press       3 × 8     60 kg  (or 135 lbs)
  Lat Pulldown      3 × 10    45 kg  (or 100 lbs)
  Incline DB Curl   2 × 12    no weight given
```

The weights follow whichever unit they picked. The third lift deliberately has
none, so they see what a row with nothing suggested looks like.

### The nine steps

Every one is an action. **The tutorial never asks you to tap Next and never asks
you to just read something.** It advances because you did the thing, so it can
never claim you did something you did not do.

| #   | The line                                                                               | Demo points at     | Advances when          |
| --- | -------------------------------------------------------------------------------------- | ------------------ | ---------------------- |
| 1   | `Tap Workout at the bottom.`                                                           | `nav-workout`      | chooser opens          |
| 2   | `Pick Strength.`                                                                       | `chooser-strength` | start sheet opens      |
| 3   | `Start Tutorial.`                                                                      | `start-confirm`    | workout starts         |
| 4   | `These are your lifts, in order. Open Bench Press.`                                    | `lift-row-first`   | exercise screen opens  |
| 5   | `Set 1 is already filled in. Tap it.`                                                  | `set-row-1`        | row 1 opens            |
| 6   | `Save takes those numbers as they are. Change one first if you lifted something else.` | `set-save`         | a set is logged        |
| 7   | `Set 2 copied what you just did. Log it too.`                                          | `set-row-2`        | a second set is logged |
| 8   | `Tap Back. Finishing a lift moves you on to the next one.`                             | `exercise-back`    | current lift changes   |
| 9   | `Tap End, top right.`                                                                  | `workout-end`      | summary appears        |

Cut from the twelve: the setup-note step, the clock step, and the summary step.
The summary explains itself, since it is a real summary of what they just
logged.

**Step 7 is the one that justifies the whole tutorial.** The app copying set 1
into set 2 is its single biggest advantage over writing sets in a notes app, it
is invisible until it happens to you, and somebody who never notices it will
retype every number forever.

**Step 8 cannot be cut.** The app moving you to the next lift on its own is its
own idea of what you are doing, and somebody who does not know that will think
the highlight moved by itself.

### When it ends

Tutorial exits, real data comes back, and Today shows:

```
Tutorial done

Nothing you just logged was saved. Your first real one will be.

Every morning      Bodyweight, on Today.
Every night        Calories, protein, carbs, fat, and steps if you count them.
When it arrives    A plan from Dave shows up as a card. Read it, then accept it.
```

No congratulation. The app does not thank people for tapping through a tutorial.

---

## How the sandbox works

The technical half. Skip it if you only want the flow.

### It is coach mode, pointed at a fixture

Coach mode already solved this in the other direction. When a coach opens a
client, there is no second copy of every screen for client data: the app swaps
the arrays in the store for the client's, and every screen renders somebody
else's data unchanged. What makes that safe is a **read-only latch**, one switch
that makes every write to the database do nothing.

The tutorial is the same machinery pointed at a fake card:

```
Start
  1. Check     no workout running, not in coach mode, data loaded
  2. Latch     setDbReadOnly("tutorial")        <- FIRST, before anything else
  3. Save      keep a copy of their real data in memory
  4. Swap      put the fixture card in the store

  ... they log sets. Every write stops at the latch.

End, or Skip
  5. Restore   put their real data back
  6. Unlatch   setDbReadOnly(undefined)         <- LAST, after the restore
```

Four things fall out of that latch with no extra code:

- **Nothing is written to the phone.** Every write in the app goes through one
  function, and it returns early while the latch is on.
- **Nothing is pushed to the Google Sheet.** The sync code already refuses to
  push while the latch is on, for coach mode's reason, which applies here word
  for word. The "needs syncing" flag survives and flushes normally afterwards.
- **Their real numbers stay clean.** Suggestions, records and split rotation all
  read those same arrays, and the arrays get put back. A tutorial bench press
  cannot become the suggested weight on their first real one.
- **Force-quitting mid-tutorial is clean.** Nothing was written and the latch
  only exists in memory, so reopening is just their own empty app.

Order matters at both ends: latch on **before** the swap, off **after** the
restore, so there is no instant where a write could land on the wrong data. The
restore goes in a `finally`. The one unrecoverable bug is leaving the latch on
with their real data back in the store, because the app would then silently stop
saving for the rest of the session.

### Three cases that must refuse to start

| Refuse when                     | Because                                                 |
| ------------------------------- | ------------------------------------------------------- |
| A real workout is already going | Swapping it out would look like losing it               |
| They are in coach mode          | The latch is already taken and exiting would clobber it |
| The app has not loaded its data | Saving empty arrays and restoring them is data loss     |

### The instruction line at the bottom

A portal at `z-[55]`: above the full-screen overlays at `z-50` it must sit on,
below `Toast` at `z-[60]` so a toast never hides behind it.

It is **not** registered as a sheet, so Escape closes the exercise screen rather
than the tutorial.

It reserves its own height with a `--rail-h` variable on the root element, `0px`
when off. The workout screen and the exercise screen both scroll to the bottom
edge, so without that the line would cover `+ Add set`.

The dot is a separate layer above it, at `z-[56]`, with pointer events off so
taps pass straight through to the app.

---

## The one risk in "sheet first"

Connecting a sheet needs a Google account, a consent screen and a connection. A
client whose sign-in fails is now blocked from the tutorial as well as from
syncing.

The escape is the `Settings → Tutorial workout` row, which exists anyway. It is
not advertised on the checklist, so it does not undermine the order, but a coach
can tell a stuck client to go and run it.

---

## Files

New:

```
src/lib/tutorial.ts                  the 9 steps, plain functions, no React
src/lib/tutorial-state.ts            how far they got (localStorage)
src/lib/tutorial-fixture.ts          the Tutorial card and its three lifts
src/lib/tutorial-store.ts            start / skip / finish  (copy of coach-store.ts)
src/lib/install-prompt.ts            beforeinstallprompt, appinstalled, navigator.standalone
src/components/TutorialBanner.tsx    "Tutorial mode   Skip →"
src/components/TutorialRail.tsx      the instruction line, and Show me
src/components/TutorialCursor.tsx    the dot, the travel, the ripple
src/components/InstallWalkthrough.tsx    the four iPhone frames
src/components/GettingStartedCard.tsx    the four rows, on Today
public/install/ios-1..4.svg          the drawn Safari frames
```

Changed:

```
src/routes/join.tsx                four live rows
src/routes/index.tsx               show GettingStartedCard
src/routes/settings.tsx            a Tutorial workout row
src/routes/workout.tsx             TutorialBanner, room for the rail, one marker
src/components/ExerciseScreen.tsx  TutorialBanner, room for the rail, four markers
src/components/AppShell.tsx        TutorialBanner, TutorialRail, TutorialCursor, one marker
src/components/WorkoutChooserSheet.tsx   one marker
src/components/StartWorkoutSheet.tsx     one marker
src/components/WorkoutLog.tsx            one marker
src/lib/coach-store.ts             move the "which fields to swap" list to its own
                                   file so the tutorial can use it too
```

**Where progress is remembered:** localStorage, same as `pending-coach.ts`, for
the reason that file already gives: it is onboarding bookkeeping, not the
person's data, and must not ride along in a backup. It must specifically not go
in the app's settings row, because that row is mirrored to the Google Sheet and
a coach has no business seeing which tutorial steps their client skipped.

## Tests

- `tutorial.test.ts` — each of the 9 steps advances on the right change and not
  the wrong one; none is already satisfied at the start.
- `tutorial-store.test.ts` — the three refusals; latch before swap; skip and
  finish both restore exactly and drop the latch; a crash partway still
  restores; a full logged tutorial writes nothing to the database.
- `install-prompt.test.ts` — Android path holds the event and fires it on tap;
  `appinstalled` ticks the row; iOS path shows the walkthrough; an already
  installed app shows no row at all.
- `TutorialCursor.test.tsx` — finds its target by marker; plays nothing when the
  target is absent; waits while an input has focus; under reduced motion draws a
  ring and never moves.
- `TutorialBanner.test.tsx` — nothing when the tutorial is off; Skip exits with
  no confirmation; present on all three screens.
- `GettingStartedCard.test.tsx` — rows 2 and 3 read their real sources; row 4 is
  locked until they are done.

`npm run screenshots` gains: the live `/join`, `Getting started` on Today, the
four iPhone frames, **the tutorial banner over the exercise screen**, and **the
dot mid-travel**. The last two matter most, because they are the only places
where tutorial chrome sits on top of a full-screen overlay.

---

## Still to decide

1. **Drawn frames or real screenshots** for the iPhone home screen steps. Drawn
   is what is written above, and the reasons are in
   [Kind B](#kind-b-the-drawn-phone-for-the-iphone-home-screen-steps). Real
   screenshots are a fair call and the costs are listed there too.
2. **A dot or an arrow pointer.** Dot is written above. One-line swap.
3. **Does the demo auto-play after 8 seconds, or only when asked?** Auto-play is
   written above, once per step. Never auto-playing is quieter but means
   somebody genuinely stuck has to work out that `Show me` exists.
