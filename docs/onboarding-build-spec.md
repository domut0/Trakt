# Feature: client onboarding and tutorial workout — build spec

Written 2026-09-20. This is the implementation handoff for
`docs/onboarding-plan.md`. That document is the **why**; this one is the
**what and how**. Where they disagree, this one wins.

Branch: `claude/client-onboarding-tutorial-3xllkw`.

---

## 0. Read first

**Read these before writing any code.** They are short and each one contains a
decision you would otherwise undo by accident:

| File                                | Why                                                                |
| ----------------------------------- | ------------------------------------------------------------------ |
| `docs/onboarding-plan.md`           | The design and the reasoning behind every decision below           |
| `src/lib/coach-store.ts`            | The sandbox mechanism you are about to copy. Read the doc comment  |
| `src/lib/db.ts` around line 720-790 | `setDbReadOnly`, `assertWritable`, `safeWrite`. The whole latch    |
| `src/components/ClientBanner.tsx`   | The banner you are about to copy, including the "never fixed" note |
| `PRODUCT.md` Brand Commitments      | Copy rules. Sentence case, no em dashes, no manufactured praise    |

**House rules that apply to everything here:**

- No component library. Hand-written Tailwind against the tokens in `src/styles.css`.
- 44px minimum hit area on everything interactive.
- Every icon-only button gets an `aria-label`.
- Sentence case in all UI copy. **No em dashes in UI copy** (hyphen, or reword).
- State is carried by mark, never by hue alone.
- `prefers-reduced-motion` is handled globally in `styles.css`, not per component.
- Behaviour changes come with tests. The suite is 677 tests and dense.

**Verify with:** `npm test`, `npm run typecheck`, `npm run lint`, and
`npm run screenshots` (the best instrument in the repo; it fails loudly on a
blank page or a Vite error overlay).

---

## 1. Scope

A person is invited by a coach, opens the invite link, and ends up able to use
the app. Covers: adding to the home screen, connecting a Google Sheet, sharing
it with the coach, and a tutorial workout that teaches logging.

**Out of scope, deliberately:** anything about planning. The Plan tab is locked
for a coached client (`usePlanLocked`), the store refuses plan edits while
`coachManaged` is set, and `CoachManagedBanner` already explains who owns it. Do
not add tutorial content for the Plan tab.

---

## 2. Decisions already made

Do not relitigate these. They were argued and settled.

| Decision                              | Value                                                            |
| ------------------------------------- | ---------------------------------------------------------------- |
| The tutorial workout runs on          | **A fixture card, always.** Never the client's real coach card   |
| Number of steps                       | **9**, and every one is an action. No "tap Next", no "read this" |
| How the tutorial starts               | **A tap** on a checklist row. It never auto-starts               |
| Order                                 | Sheet connected and shared **before** the tutorial unlocks       |
| Sandbox mechanism                     | Coach mode's read-only latch plus a store swap                   |
| Demo inside the app                   | A dot over the **live** screen. No screenshots, no assets        |
| Demo for the iPhone home-screen steps | Four **drawn SVG** frames                                        |
| Cursor shape                          | A translucent circle, not an arrow                               |
| Where tutorial progress is stored     | **localStorage**, never Dexie                                    |

---

## 3. Architecture in one page

```
                    ┌─────────────────────────────────────┐
  /join  ─────────► │  GettingStartedCard (4 rows)        │
                    │   1 home screen   2 sheet           │
                    │   3 share         4 tutorial        │
                    └──────────────┬──────────────────────┘
                                   │ tap row 4
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  tutorial-store.start()             │
                    │   setDbReadOnly("tutorial")         │  ← latch FIRST
                    │   save real state in memory         │
                    │   useStore.setState(fixture)        │
                    └──────────────┬──────────────────────┘
                                   ▼
   ┌───────────────────────────────────────────────────────┐
   │  Tutorial mode                              Skip  →   │  TutorialBanner
   ├───────────────────────────────────────────────────────┤
   │                                                       │
   │        the REAL app, running on fixture data          │
   │                                                       │
   │                        ◉  ← TutorialCursor (dot)      │  z-[56]
   ├───────────────────────────────────────────────────────┤
   │  Tap Workout at the bottom.            Show me        │  TutorialRail z-[55]
   └───────────────────────────────────────────────────────┘
                                   │ step 9 done, or Skip
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  tutorial-store.finish()            │
                    │   restore real state                │
                    │   setDbReadOnly(undefined)          │  ← unlatch LAST
                    └─────────────────────────────────────┘
```

**The single most important invariant:** the latch goes on **before** the swap
and comes off **after** the restore. There must be no instant where a store
write could land on the wrong data. Both the restore and the unlatch go in a
`finally`.

**The one unrecoverable bug:** leaving the latch on with the user's real data
back in the store. The app would then silently stop saving anything for the rest
of the session, with no error. Guard it with the `finally` and with a test.

---

## 4. Build order

Nine phases. Each one ends somewhere committable.

| #   | Phase                                            | Depends on | Independently useful?                      |
| --- | ------------------------------------------------ | ---------- | ------------------------------------------ |
| 1   | Tutorial state + install detection               | —          | Yes. `install-prompt` alone is a win       |
| 2   | Extract `store-swap.ts`                          | —          | Yes. Pure refactor, no behaviour change    |
| 3   | The sandbox (`tutorial-store`)                   | 2          | No                                         |
| 4   | The fixture                                      | —          | No                                         |
| 5   | The banner                                       | 3          | No                                         |
| 6   | The rail + the cursor                            | 3          | No                                         |
| 7   | The 9 steps + markers                            | 4, 6       | No. This is when it first works end to end |
| 8   | `/join` + `GettingStartedCard`                   | 1          | Yes                                        |
| 9   | iOS install frames + settings row + closing card | 8          | Yes                                        |

**Suggested commit boundaries:** after 2, after 3+4+5 (the sandbox works and you
can see you are in it), after 7 (the tutorial runs), after 9.

---

## 5. File-by-file

### Phase 1 — `src/lib/tutorial-state.ts`

localStorage, wrapped in try/catch. Model it directly on
`src/lib/pending-coach.ts`, including the doc comment explaining why it is not
in Dexie.

```ts
const KEY = "trakt.tutorial";

export interface TutorialState {
  /** First /join open. Anchors nothing yet, but dates the record. */
  joinedAt: number;
  /** Set when step 9 completes, or when Skip is tapped. */
  doneAt?: number;
  /** Set when the Getting started card is dismissed. */
  cardDismissedAt?: number;
  /** True once navigator.standalone or display-mode:standalone was ever seen. */
  installedSeen?: boolean;
}

export function loadTutorialState(): TutorialState | undefined;
export function saveTutorialState(next: TutorialState): void;
export function markTutorialDone(): void;
export function markInstalledSeen(): void;
```

**Must not** be written into Dexie `settings`. That row is mirrored to the
Google Sheet, and a coach has no business seeing which tutorial steps their
client skipped. Put that sentence in the file as a comment.

### Phase 1 — `src/lib/install-prompt.ts`

Detects and drives home-screen installation. This is genuinely new capability:
nothing in the repo handles `beforeinstallprompt` today.

```ts
export type InstallMode =
  | { kind: "installed" } // already running from the home screen
  | { kind: "prompt" } // Android: we hold a deferred prompt
  | { kind: "manual-ios" } // iOS Safari: show the drawn frames
  | { kind: "unavailable" }; // desktop, or a browser that cannot install

/** Call once at app start (client only). Registers the listeners. */
export function initInstallPrompt(): void;

/** Current mode. Re-read after the events below fire. */
export function installMode(): InstallMode;

/** Android only. Fires the held native prompt. Resolves true if accepted. */
export function promptInstall(): Promise<boolean>;

/** React hook wrapping the above, re-rendering on the events. */
export function useInstallMode(): InstallMode;
```

Implementation notes:

- `beforeinstallprompt`: `e.preventDefault()`, stash the event, mode becomes
  `"prompt"`. Chrome only fires this once per page load.
- `appinstalled`: call `markInstalledSeen()`, mode becomes `"installed"`.
- Already installed is
  `window.matchMedia("(display-mode: standalone)").matches` **or**
  `(navigator as { standalone?: boolean }).standalone === true` (iOS). When
  either is true, call `markInstalledSeen()`.
- iOS Safari detection: no `beforeinstallprompt`, and the UA is iPhone/iPad
  Safari. Be generous; a false `"manual-ios"` shows instructions that are merely
  unnecessary, a false `"unavailable"` hides the step from somebody who needed it.
- **SSR:** every one of these touches `window` or `navigator`. Follow the
  `PwaUpdatePrompt.tsx` pattern: nothing runs during the server render.

**The iOS row ticks late, not never.** In the browser tab where the instruction
is read, `navigator.standalone` is false and nothing can confirm the install.
The next time the app is opened from the home screen it is true, `installedSeen`
is written, and the row is ticked from then on. This is correct behaviour, not a
bug to fix.

### Phase 2 — `src/lib/store-swap.ts`

Pure refactor, no behaviour change. Move `SWAPPED_KEYS`, `Swapped`,
`captureOwnState` out of `src/lib/coach-store.ts` and export them. Keep the
existing comment verbatim — it explains that the list is written out longhand so
that a field added to the store later is a compile error here if it should
travel.

`coach-store.ts` imports them back. Its behaviour must not change; the existing
coach tests are the proof.

### Phase 3 — `src/lib/tutorial-store.ts`

A Zustand store, modelled on `coach-store.ts`. Separate from the main store for
the same reason coach state is: sync subscribes to the main store, and tutorial
state living there would look like a local edit.

```ts
export interface TutorialStoreState {
  /** True while the sandbox is on. */
  active: boolean;
  /** 0-based index into the 9 steps. */
  step: number;

  start: () => boolean; // false if refused
  skip: () => void;
  finish: () => void;
  advance: () => void;
}
```

`start()` in exact order:

```ts
// 1. Refuse, before touching anything
const main = useStore.getState();
if (!main.hydrated) return false;
if (main.activeSessionId) return false;
if (useCoachStore.getState().viewing) return false;
if (get().active) return false;

// 2. Latch FIRST
setDbReadOnly("tutorial");
try {
  // 3. Capture
  ownState = captureOwnState();
  // 4. Swap
  useStore.setState(tutorialStoreState(main.unit));
  set({ active: true, step: 0 });
  return true;
} catch {
  // Never leave the latch on with their own data back in the store
  if (ownState) {
    useStore.setState(ownState);
    ownState = undefined;
  }
  setDbReadOnly(undefined);
  set({ active: false, step: 0 });
  return false;
}
```

`skip()` and `finish()` are the same teardown; only the bookkeeping differs.
Teardown, in exact order:

```ts
try {
  if (ownState) {
    useStore.setState(ownState);
    ownState = undefined;
  }
} finally {
  setDbReadOnly(undefined); // AFTER the restore, always
  set({ active: false, step: 0 });
  markTutorialDone();
}
```

`ownState` is module-level, not in the store, for the reason `coach-store.ts`
gives: putting it in the store would publish the user's whole log to every
subscriber for the duration and invite a component to read the wrong one.

**What the latch already does for you, with no extra code:**

- `safeWrite` (`db.ts:772`) returns early, so no store action reaches IndexedDB.
- `sync-store.ts:374` already refuses to push while the latch is set. The
  `pending` flag survives and flushes after teardown, which is correct.
- Because the arrays are restored, prefill (`lastSessionFor`), record detection,
  `predictedNextSlotName` and the rotation cursor are all untouched.

### Phase 4 — `src/lib/tutorial-fixture.ts`

```ts
export const TUTORIAL_SLOT_ID = "tut_slot";

/** The card, its three lifts, and the exercises they name. Unit-aware. */
export function tutorialFixture(unit: "lbs" | "kg"): {
  exercises: Exercise[];
  slots: SplitSlot[];
};

/** The full swapped-state object handed to useStore.setState. */
export function tutorialStoreState(unit: "lbs" | "kg"): Swapped;
```

The card:

| Exercise        | id             | type        | sets | reps | load                |
| --------------- | -------------- | ----------- | ---- | ---- | ------------------- |
| Bench Press     | `tut_bench`    | `main`      | 3    | `8`  | `60 kg` / `135 lbs` |
| Lat Pulldown    | `tut_pulldown` | `accessory` | 3    | `10` | `45 kg` / `100 lbs` |
| Incline DB Curl | `tut_curl`     | `accessory` | 2    | `12` | _(none)_            |

- Slot: `{ id: TUTORIAL_SLOT_ID, name: "Tutorial", rotationOrder: 0 }`. No
  `kind`, which reads as `workout`.
- **Ids are literal strings, not `uid()`.** They must be stable so the demo
  markers and the tests can name them. `uid` is private to `store.ts` anyway.
- The third lift has **no load on purpose**, so the user sees a row with nothing
  suggested. Do not "fix" this by giving it a weight.
- `load` is free text and `parseLoad` reads the number out of it, so `"60 kg"`
  ghosts 60 into the weight field. Check `src/lib/set-rows.ts` if unsure.

`tutorialStoreState` must return **every** key in `SWAPPED_KEYS`. Empty arrays
for `sessions`, `sets`, `dailyLogs`, `nutritionPhases`, `plannedDays`.
`activeSessionId`, `currentExerciseId`, `nextSlotId`, `restSince`,
`lastAcceptedPlanAt` all `undefined`. `coachManaged: false`. `unit` passed
through, so a kg user practises in kg.

### Phase 5 — `src/components/TutorialBanner.tsx`

Copy `src/components/ClientBanner.tsx` nearly line for line.

```
┌───────────────────────────────────────────────┐
│  Tutorial mode                       Skip  →  │
└───────────────────────────────────────────────┘
```

| Property     | Value                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Container    | `relative z-40 flex min-h-[44px] w-full shrink-0 items-center justify-between gap-3 bg-accent px-4 py-2.5 text-accent-foreground` |
| Inline style | `paddingTop: "env(safe-area-inset-top, 0px)"`                                                                                     |
| Left         | `Tutorial mode`, `t-label font-medium`                                                                                            |
| Right        | `Skip →`, `t-label font-medium opacity-90`, calls `skip()`                                                                        |

Returns `null` when `active` is false.

**Never `fixed`.** Both existing banners carry a comment explaining this and it
is a bug they already hit: the app runs under a translucent status bar
(`apple-mobile-web-app-status-bar-style`), so a bar pinned to `top: 0` sits
under the phone's clock and **its button cannot be tapped**. Copy that comment
across. Anybody who later "fixes" this to `fixed` breaks Skip on a real phone in
a way no desktop browser will reproduce.

**Mount it in three places.** The tutorial crosses three full-screen layouts
that do not share a parent:

| Mount point                         | Where exactly                                               |
| ----------------------------------- | ----------------------------------------------------------- |
| `src/components/AppShell.tsx`       | The existing banner slot. Takes priority over the other two |
| `src/routes/workout.tsx`            | First child of the outer flex column, before the top bar    |
| `src/components/ExerciseScreen.tsx` | First child of the inner `flex h-full max-w-md flex-col`    |

The exercise screen mount is the one that matters most: six of the nine steps
happen there, it covers the whole display, and without its own copy the way out
disappears for the longest stretch of the tutorial.

In `AppShell`, the priority order becomes: tutorial banner, then client banner,
then active-session banner. Only one is ever shown.

**Skip does not confirm.** The workout is fake, so skipping loses nothing, and a
confirmation on a Skip button is the app arguing with somebody who has already
decided. Skip calls `skip()` and navigates to `/`.

### Phase 6 — `src/components/TutorialRail.tsx`

One line of instruction, pinned to the bottom, portalled to `document.body`.

| Property | Value                                                                     |
| -------- | ------------------------------------------------------------------------- |
| z-index  | `z-[55]`. Above the `z-50` overlays it sits on, below `Toast` at `z-[60]` |
| Position | `fixed inset-x-0 bottom-0`                                                |
| Padding  | `paddingBottom: "max(env(safe-area-inset-bottom), 16px)"`                 |
| Content  | The step's line on the left, a `Show me` button on the right              |

**It is not a sheet.** Do not call `useSheetDismiss`. Escape must keep peeling
off the exercise screen rather than closing the teacher.

**It reserves its own height.** Set `--rail-h` on `document.documentElement`
(its measured height while active, `0px` when not). Then in both
`src/routes/workout.tsx` and `src/components/ExerciseScreen.tsx`, add it to the
existing bottom padding:

```
paddingBottom: "calc(max(env(safe-area-inset-bottom), 24px) + var(--rail-h, 0px))"
```

Both of those screens scroll to the bottom edge, so without this the rail covers
`+ Add set`. Nothing else in the app needs to know the tutorial exists.

### Phase 6 — `src/components/TutorialCursor.tsx`

The dot. A separate layer above the rail at `z-[56]`, `pointer-events: none` so
taps pass straight through to the app underneath.

```ts
export function TutorialCursor({ target }: { target: string }): JSX.Element | null;
```

How it works:

1. `document.querySelector(`[data-tutorial="${target}"]`)`
2. `el.getBoundingClientRect()` — **read at play time, not at build time.** This
   is what makes it survive the soft keyboard, the overlays, and any restyle.
3. Animate the dot from wherever it is to the centre of that rect.
4. Ripple on arrival.
5. Loop, about 1.5s, twice, then stop.

| Rule                     | Behaviour                                                                         |
| ------------------------ | --------------------------------------------------------------------------------- |
| Target not found         | Render nothing. The written line stands alone. Not an error                       |
| A text input has focus   | Do not play. Animating over somebody typing a weight is the app talking over them |
| `prefers-reduced-motion` | **No dot, no travel.** Draw a static ring on the target instead                   |
| Taps                     | Pass through. Somebody who sees where to go can go mid-animation                  |

The reduced-motion branch is not optional. `src/styles.css` kills every
animation globally with `!important` under that media query, so a travelling dot
would simply teleport, which is worse than nothing. Check the query in JS and
render the ring variant.

**Shape: a translucent circle, not an arrow.** The app is phone-only with no
desktop layout, the person is about to use a finger, and a circle is what iOS
and Android both use in their own screen recordings. Roughly 28px, `bg-ink` at
low opacity with a soft ring.

### Phase 7 — `src/lib/tutorial.ts`

The 9 steps as pure data and pure functions. No React, no DOM.

```ts
/** What a step can see. Assembled per render from the store. */
export interface TutorialSeen {
  chooserOpen: boolean;
  startSheetOpen: boolean;
  activeSessionId?: string;
  exerciseScreenOpen: boolean;
  currentExerciseId?: string;
  /** Sets logged in the tutorial session, oldest first. */
  sets: readonly WorkoutSet[];
  /** Which set row has its editor open, 1-based, or undefined. */
  editingRow?: number;
  summaryShown: boolean;
}

export interface TutorialStep {
  id: string;
  say: string;
  /** data-tutorial value the demo points at. */
  target: string;
  done: (seen: TutorialSeen) => boolean;
}

export const TUTORIAL_STEPS: readonly TutorialStep[];
```

The nine, in order:

| #   | id              | Line                                                                                   | target             | done when                           |
| --- | --------------- | -------------------------------------------------------------------------------------- | ------------------ | ----------------------------------- |
| 1   | `open-chooser`  | `Tap Workout at the bottom.`                                                           | `nav-workout`      | `chooserOpen`                       |
| 2   | `pick-strength` | `Pick Strength.`                                                                       | `chooser-strength` | `startSheetOpen`                    |
| 3   | `start`         | `Start Tutorial.`                                                                      | `start-confirm`    | `activeSessionId !== undefined`     |
| 4   | `open-lift`     | `These are your lifts, in order. Open Bench Press.`                                    | `lift-row-first`   | `exerciseScreenOpen`                |
| 5   | `tap-set-1`     | `Set 1 is already filled in. Tap it.`                                                  | `set-row-1`        | `editingRow === 1`                  |
| 6   | `save-set-1`    | `Save takes those numbers as they are. Change one first if you lifted something else.` | `set-save`         | `sets.length >= 1`                  |
| 7   | `save-set-2`    | `Set 2 copied what you just did. Log it too.`                                          | `set-row-2`        | `sets.length >= 2`                  |
| 8   | `back`          | `Tap Back. Finishing a lift moves you on to the next one.`                             | `exercise-back`    | `currentExerciseId !== "tut_bench"` |
| 9   | `end`           | `Tap End, top right.`                                                                  | `workout-end`      | `summaryShown`                      |

When step 9 completes, call `finish()`.

**Step 7 is the point of the whole feature.** The app copying set 1 into set 2
is its single biggest advantage over writing sets in a notes app, it is
invisible until it happens to you, and somebody who never notices it will retype
every number forever. Do not cut it.

**Step 8 cannot be cut either.** The app moving you to the next lift on its own
is its own model of what you are doing, and somebody who does not know that will
think the highlight moved by itself.

**Nothing blocks and nothing scolds.** Tapping something else just does that
thing and the step waits. There is no wrong move and no error state.

### Phase 7 — the nine markers

Add `data-tutorial="..."` to these existing elements. Nothing else changes in
these files except the attribute and the rail padding noted above.

| Marker             | File                                     | Element                                      |
| ------------------ | ---------------------------------------- | -------------------------------------------- |
| `nav-workout`      | `src/components/AppShell.tsx`            | The Workout button in `BottomNav`            |
| `chooser-strength` | `src/components/WorkoutChooserSheet.tsx` | The Strength button                          |
| `start-confirm`    | `src/components/StartWorkoutSheet.tsx`   | The row or button that starts the named slot |
| `lift-row-first`   | `src/components/WorkoutLog.tsx`          | The first row's button (`idx === 0`)         |
| `set-row-1`        | `src/components/ExerciseScreen.tsx`      | The row button where `row.index === 1`       |
| `set-save`         | `src/components/ExerciseScreen.tsx`      | The editor's Save button                     |
| `set-row-2`        | `src/components/ExerciseScreen.tsx`      | The row button where `row.index === 2`       |
| `exercise-back`    | `src/components/ExerciseScreen.tsx`      | The Back button                              |
| `workout-end`      | `src/routes/workout.tsx`                 | The End button                               |

`chooserOpen` and `startSheetOpen` currently live as local `useState` in
`AppShell`. Lift them into `tutorial-store` reads, or pass them down — either is
fine, but the step predicates must be able to see them.

### Phase 8 — `src/components/GettingStartedCard.tsx` and `src/routes/join.tsx`

Four rows, shared by both surfaces. One component, rendered inside `Frame` on
`/join` and as a card on Today.

```
 1  Add Trakt to your home screen          >
 2  Connect a Google Sheet                 >
 3  Share it with Dave                     >
 4  Try a tutorial workout                       (locked until 2 and 3 are done)
```

| Row | Done when                                                                | Tap goes to                                             |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| 1   | `installMode().kind === "installed"` or `installedSeen` is set           | Android: fires the native prompt. iOS: the drawn frames |
| 2   | `useSyncStore(s => s.config)` is `kind: "google"` with a `spreadsheetId` | `/settings`                                             |
| 3   | `loadPendingCoach()?.sharedAt !== undefined`                             | `/settings`                                             |
| 4   | `loadTutorialState()?.doneAt !== undefined`                              | `tutorial-store.start()`, then `/`                      |

- Row 4 is **disabled** until rows 2 and 3 are both done. Muted, not hidden: a
  hidden row does not tell anybody what is coming.
- Row 1 is hidden entirely when `installMode().kind === "unavailable"`.
- `Continue` on `/join` goes to the first row that is not done, rather than
  always to Settings.
- On Today, the whole card disappears once all rows are done, or when dismissed.
  Dismissing does not remove the offer: Settings keeps it forever.
- Done rows are marked with the same filled square `DayStatsCard` uses for a met
  target. **Mark, not hue.**

Use `loadPendingCoach()?.name` for the coach's name in row 3, falling back to
`your coach`.

### Phase 9 — `src/components/InstallWalkthrough.tsx` + `public/install/ios-{1..4}.svg`

iPhone only. Four schematic SVG frames with the dot animating inside them:

```
 1   Tap the Share button          (the square with the up arrow, bottom bar)
 2   Scroll down the list
 3   Tap "Add to Home Screen"
 4   Tap "Add", top right
```

**Drawn, not photographed.** A rounded rectangle for the phone, a bar for
Safari's toolbar, a panel for the share sheet, grey bars for the rows you are
not tapping and a real label on the one you are. In the app's own tokens, so it
reads as part of the app.

Three reasons, all of which matter:

1. `vite.config.ts` precaches `**/*.{js,css,svg,ico,png,woff2}`, so every image
   in the build is downloaded on install by every user and kept forever. Four
   real screenshots at phone resolution is most of a megabyte; four SVGs is a
   few kilobytes.
2. Trakt is one theme, true black. A real iOS screenshot is a bright
   grey-and-blue rectangle pasted into a black app.
3. A schematic diagram ages better than a screenshot that is nearly right. When
   iOS moves the share sheet, a slightly-wrong screenshot tells people to look
   for something that is not there.

**Safari's share sheet is outside the web page.** No web app can screenshot it,
point at it, or detect a tap on it. That is why this one step needs authored
frames while every other step uses the live cursor. Do not try to detect
completion of these steps; the row ticks later via `navigator.standalone`.

### Phase 9 — settings row and closing card

`src/routes/settings.tsx`, a row inside the existing `<Section title="Coaching">`
(which currently holds `<CoachSettings />`):

```
Tutorial workout                                    >
```

Always available, forever. It is how somebody who skipped runs it again, how a
coach unblocks a confused client, and how you test this by hand after the first
run. It is also the escape hatch if a client's Google sign-in fails and they can
never tick row 2.

Closing card on Today, shown once `doneAt` is set and until dismissed:

```
Tutorial done

Nothing you just logged was saved. Your first real one will be.

Every morning      Bodyweight, on Today.
Every night        Calories, protein, carbs, fat, and steps if you count them.
When it arrives    A plan from Dave shows up as a card. Read it, then accept it.
```

The three lines are deliberately three different shapes. `PRODUCT.md`: empty
states built from one template are the signature of machine-written text even
when every sentence is defensible.

**No congratulation.** `PRODUCT.md`: "Do not manufacture praise." `Tutorial done`
is a statement of fact. The app does not thank anyone for tapping through a
tutorial.

---

## 6. All UI copy, in one place

Change it here and nowhere else. Sentence case. No em dashes.

| Where           | Copy                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| Banner left     | `Tutorial mode`                                                                        |
| Banner right    | `Skip →`                                                                               |
| Rail action     | `Show me`                                                                              |
| Checklist row 1 | `Add Trakt to your home screen`                                                        |
| Checklist row 2 | `Connect a Google Sheet`                                                               |
| Checklist row 3 | `Share it with {coach}`                                                                |
| Checklist row 4 | `Try a tutorial workout`                                                               |
| Join button     | `Continue`                                                                             |
| Settings row    | `Tutorial workout`                                                                     |
| Step 1          | `Tap Workout at the bottom.`                                                           |
| Step 2          | `Pick Strength.`                                                                       |
| Step 3          | `Start Tutorial.`                                                                      |
| Step 4          | `These are your lifts, in order. Open Bench Press.`                                    |
| Step 5          | `Set 1 is already filled in. Tap it.`                                                  |
| Step 6          | `Save takes those numbers as they are. Change one first if you lifted something else.` |
| Step 7          | `Set 2 copied what you just did. Log it too.`                                          |
| Step 8          | `Tap Back. Finishing a lift moves you on to the next one.`                             |
| Step 9          | `Tap End, top right.`                                                                  |
| Closing title   | `Tutorial done`                                                                        |
| Closing body    | `Nothing you just logged was saved. Your first real one will be.`                      |
| iOS frame 1     | `Tap the Share button`                                                                 |
| iOS frame 2     | `Scroll down the list`                                                                 |
| iOS frame 3     | `Tap Add to Home Screen`                                                               |
| iOS frame 4     | `Tap Add, top right`                                                                   |

No step says "the numbers your coach asked for". The card is a fixture, so the
numbers are the app's own, and step 5 says so.

---

## 7. Tests

| File                                                   | Covers                                                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/__tests__/tutorial.test.ts`                   | Each of the 9 predicates is true for a satisfying `Seen` and false for a near-miss; none is true for an empty `Seen`; ids and order are stable             |
| `src/lib/__tests__/tutorial-store.test.ts`             | **See the list below.** This is the important one                                                                                                          |
| `src/lib/__tests__/install-prompt.test.ts`             | Android holds and fires the prompt; `appinstalled` sets `installedSeen`; `navigator.standalone` sets it; iOS gets `manual-ios`; desktop gets `unavailable` |
| `src/lib/__tests__/tutorial-state.test.ts`             | Round-trips; a throwing localStorage does not throw out                                                                                                    |
| `src/components/__tests__/TutorialBanner.test.tsx`     | Renders nothing when inactive; Skip exits with no confirmation; present on all three mounts                                                                |
| `src/components/__tests__/TutorialCursor.test.tsx`     | Finds its target by marker; renders nothing when absent; does not play while an input has focus; draws a ring and never moves under reduced motion         |
| `src/components/__tests__/GettingStartedCard.test.tsx` | Rows 2 and 3 read their real sources; row 4 disabled until both are done; row 1 hidden when unavailable                                                    |

`tutorial-store.test.ts` must cover, at minimum:

1. Refuses when not hydrated.
2. Refuses when a real workout is active.
3. Refuses while viewing a client.
4. The latch is set **before** the store is swapped.
5. `finish()` restores state deeply equal to what was captured.
6. `skip()` does the same.
7. The latch is cleared **after** the restore, and is cleared in every path.
8. A throw during `start()` leaves the latch off and the real state intact.
9. **A full logged tutorial writes nothing to Dexie.** Log two sets, end, and
   assert the database is untouched. This is the test that protects the whole
   feature.

`npm run screenshots` gains: the live `/join`, `Getting started` on Today, the
four iOS frames, **the tutorial banner over the exercise screen**, and **the dot
mid-travel**. The last two matter most: they are the only places where tutorial
chrome sits on top of a full-screen overlay.

---

## 8. Acceptance checklist

- [ ] A fresh client opens `/join` and sees four rows, two of which tick themselves.
- [ ] Android: row 1 is an `Install` button, one tap, and it ticks on install.
- [ ] iPhone: row 1 shows four drawn frames, and ticks the next time the app is opened from the home screen.
- [ ] Row 4 is muted until rows 2 and 3 are done, then it starts the tutorial.
- [ ] `Tutorial mode  Skip →` is visible on Today, on `/workout`, and on the exercise screen.
- [ ] All 9 steps advance by doing the thing. None advances by tapping Next.
- [ ] The dot points at the right control on every step, including inside the exercise screen with the keyboard up.
- [ ] Under reduced motion there is no dot and no movement; the target gets a ring.
- [ ] `Show me` works on demand; the demo auto-plays once after 8 seconds stuck; neither plays while an input is focused.
- [ ] Skip exits at once, with no confirmation, and lands on Today.
- [ ] **After finishing or skipping, IndexedDB contains no tutorial session, no tutorial sets, and no `Tutorial` slot.**
- [ ] After finishing, the Google Sheet has no tutorial rows.
- [ ] Starting a real workout afterwards suggests nothing from the tutorial.
- [ ] Force-quitting mid-tutorial and reopening gives a clean, empty app.
- [ ] `Settings → Tutorial workout` runs it again.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` and `npm run screenshots` all pass.

---

## 9. Gotchas

**The latch order.** On before the swap, off after the restore, both in a
`finally`. Getting this wrong in the failure path leaves the app silently
unable to save anything, with no error anywhere.

**Three mount points for the banner, not one.** `/workout` and `ExerciseScreen`
never see `AppShell`. If you only mount it in the shell, the banner and the Skip
button vanish for most of the tutorial.

**Never make the banner `fixed`.** It sits under the phone's clock and becomes
untappable. Desktop browsers will not reproduce it.

**The rail is not a sheet.** No `useSheetDismiss`, or Escape closes the wrong
thing.

**Reserve the rail's height** or it covers `+ Add set` on the two screens that
scroll to the bottom edge.

**Do not put tutorial progress in Dexie `settings`.** That row is mirrored to
the coach's copy of the sheet.

**Do not give the third fixture lift a weight.** The blank row is teaching
something.

**Everything in `install-prompt.ts` touches `window`.** This is a server-rendered
app. Follow the `PwaUpdatePrompt.tsx` client-only pattern or hydration breaks.

**Read positions at play time.** `getBoundingClientRect()` when the demo runs,
never cached. That is the whole reason the cursor approach survives the keyboard
and the overlays.

**`prefers-reduced-motion` needs a real alternative**, not a degraded animation.
`styles.css` clamps every animation to 0.001ms with `!important`.
