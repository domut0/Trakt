# "Anything But The Notes App" — Workout Tracker PRD (Draft v1)

> Working title only — literally a placeholder because the visual direction is "Apple Notes-inspired," not because anyone's attached to the name. Rename freely.

**Status:** Draft — intended for a first UI pass. Expect a round of feedback and revision after seeing the generated UI before this becomes final.

---

## 1. Overview

A mobile-first, offline-first workout tracker for lifters who already know how to train but consistently fail to _log_ their training. The product's central bet is that logging friction — not lack of motivation, not lack of a program — is the #1 reason tracking habits die. Every design decision in this document optimizes for reducing taps, typing, and decisions during an active set, in that order.

This is a **standalone product**, deliberately separate from LiftLens (the user's existing on-device video bar-velocity app). The two solve different problems — LiftLens is a deliberate, occasional-use video analysis tool; this is a high-frequency, every-set logging tool — and merging them would blur both identities.

## 2. Problem Statement

Powerlifters, "powerbuilders" (modern bodybuilders who also chase strength on a few key lifts), and teen lifters all fail to track consistently, ranked by root cause:

1. **Logging friction** — no dominant app in this space has genuinely fast, frictionless logging; existing apps break the user's set-to-set rhythm.
2. **No feedback loop** — even when people do log, they see no near-term payoff, so the habit dies within weeks.
3. **Lack of structure** — real but minor for this audience; the target user typically already has a split from a coach or experience. The app should support structure, not impose it.

## 3. Target Users

- **Primary (v1):** the builder and a small group of "powerbuilder" friends — lifters who run a few main lifts they're actively trying to get stronger on (bench/squat/deadlift or similar), surrounded by higher-rep accessory work taken to failure for hypertrophy.
- **Secondary (future, if this ever goes to market):** powerlifters, physique-focused bodybuilders, teen lifters. The domain model should not structurally exclude them, but v1 features are not built around their specific needs.

## 4. Scope & Phasing

- **Phase 1 (this PRD):** Pure PWA. Installed via Safari "Add to Home Screen." No App Store, no native wrapper, no developer account needed. Distributed by sending a URL to friends.
- **Phase 2 (only if there's real signal — friends keep using it, or a decision to go to market):** Wrap the same codebase with Capacitor to ship on the App Store. This is a mechanical step _because_ the architecture below was chosen to make it one — not a rewrite.
- **Out of scope indefinitely unless Phase 2 happens:** accounts, monetization, App Store presence, marketing.

## 5. Product Principles (non-negotiable)

- **Weight + reps are the only mandatory fields.** Everything else is optional or hidden.
- **No screen should ask the user to plan before they lift.** The app follows the workout; it never blocks on a plan the user hasn't made yet.
- **One tap, not several, for anything that's already known** (repeated sets, repeated exercises, repeated weights).
- **No feature that requires a backend.** Zero accounts, zero sync, zero server-triggered notifications. If a feature needs a server, it's out of scope for this app's architecture, full stop.
- **Mobile-only design.** No responsive/desktop layout considerations — this is a phone-in-hand-at-the-gym tool.

## 6. Core Concepts (glossary)

| Term                  | Definition                                                                                                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exercise**          | A named movement (e.g., "Bench Press," or a fully custom/nicknamed lift like "Keenan Flaps"). Tagged **Main Lift** or **Accessory** (default: Accessory). Carries one optional free-text **Setup Note** (e.g., "seat: 4, pins: 12").                                    |
| **Set**               | One logged instance of an exercise: weight (mandatory), reps (mandatory), RPE/RIR (optional), dropset/partial-reps flag (optional). Warm-up sets are never logged — by design, not by omission.                                                                         |
| **Split Slot**        | A named, recurring workout type in the user's rotation (e.g., "Heavy Bench," "Volume Bench," "Arms," or shorthand like "D2"). Created inline, on the fly, the first time it's typed — no separate management screen.                                                    |
| **Workout Session**   | One instance of a Split Slot being trained on a given day: a collection of logged Sets across one or more Exercises.                                                                                                                                                    |
| **Time Between Sets** | A passive, count-up stopwatch value captured per set — literally the elapsed time since the previous set was logged. Explicitly **not** called "rest time" because it also includes the time spent performing the next set — an honest label, not a precise rest-timer. |

## 7. Feature Specification

### 7.1 Starting a Workout

- Home screen shows one large **"Start Workout"** button.
- Tapping it reveals a single text field, prefilled with a **predicted Split Slot name** (see 7.2), placeholder text like _"Heavy Bench, D2, Arms…"_.
- The field autocompletes against existing Split Slot names as the user types. Matching is **case-insensitive and whitespace-trimmed** ("Heavy Bench" = "heavy bench" = " Heavy Bench ") so typos never silently fork a slot's history into two disconnected threads.
- Accepting the prefilled name, picking an autocomplete match, or typing something entirely new are all one motion — no separate "create a split" flow exists anywhere in the app.
- Tapping confirm enters **Workout Mode**.

### 7.2 Split Slot Rotation Prediction

- Split Slots have an implicit rotation order (the order they were first created in, reorderable — see 7.9).
- "Start Workout" prefills the _next slot in rotation order after whichever slot was logged most recently_, pure round-robin. It has no concept of calendar days or training blocks — it just advances the list.
- The user can always override the prefilled name.

### 7.3 Workout Mode (the core screen)

Inspired by Strava's minimal in-activity screen. Shown only while a workout is active. Contains, and _only_ contains:

- **A big "Log Set" button** (primary, center of screen).
- **The current exercise name**, sticky until changed — the first set of any exercise requires picking it from the exercise autocomplete/recents; every subsequent set defaults to the same exercise.
- **A "Next Exercise" button** — advances the "current exercise" context. Pulls an incrementally-suggested next exercise from the _last time this same Split Slot occurred_, one at a time (not a bulk pre-loaded plan). The suggestion includes that exercise's last-logged weight/reps as a starting prefill. Always overridable via search.
- **The "time between sets" stopwatch**, small, passive, count-up, no alarms, no targets, resets every time a set is logged.
- **A "View Workout" button** — opens the full session breakdown (7.6).
- **An "End Workout" button.**
- **A "Home" button** — backing out to Home while a workout is still active shows a **persistent banner at the top of the screen** (FaceTime/Zoom-style "return to call" bar) so the user can jump straight back into the active session from anywhere in the app.

### 7.4 Logging a Set

Tapping "Log Set" opens a lightweight entry sheet:

- **Weight** (mandatory) — prefilled from the relevant history (see 7.5 for the matching logic).
- **Reps** (mandatory) — prefilled the same way.
- **RPE/RIR** (optional).
- **Dropset / partial-reps flag** (optional).
- **A "Sets" stepper**, defaulting to 1.

Confirming logs the set, starts/resets the "time between sets" stopwatch, and returns to Workout Mode.

**Straight-set blocks (e.g., 4×5 @190):** the user declares the set once — enters weight/reps/RPE and bumps the Sets stepper to the target count (e.g., 4) — and confirms. This logs set 1 of the block and puts Workout Mode into a "N of target" state where the primary button becomes **"Log Next Set (2 of 4)"** — a single blank tap, no re-entry, logs the next set with the same parameters (editable if a rep count differs, e.g., failing early). Each tap captures its own accurate "time between sets" value and creates its own independent Set record — never one blob covering the whole block. The block auto-completes at the target count but can be extended (bump the counter again) if the user does an extra set.

### 7.5 Weight/Rep Prefill & Suggestion Engine

Two related but distinct matching rules, both scoped **per Split Slot**, never globally per-exercise (a lifter who trains the same exercise across multiple differently-structured days — e.g., "Heavy Bench" top-single+backdowns vs. "Volume Bench" straight sets of 6 — must not have these threads cross-contaminate each other):

1. **"Next Exercise" suggestion:** pulls from the last occurrence of the _same Split Slot_, advancing one exercise at a time in the order they were logged that day.
2. **Distinct-weight block matching (within one exercise, one session):** the _first_ distinct weight/rep-scheme logged for an exercise in today's session prefills from the _first_ distinct weight/rep-scheme logged for that exercise **the last time this same Split Slot occurred**; the second distinct one prefills from the second, and so on. This is how a top single (block 1) and backdown triples (block 2) each get correctly prefilled from history, without a formal "training block" data model.

**Self-correcting block transitions:** when a training block changes (e.g., moving from heavy singles+backdown triples to heavy doubles+backdown 4s), the prefill will initially suggest the old rep scheme — the user manually corrects it once, that day. The next time this Split Slot occurs, "most recent occurrence" is now the corrected version, so it prefills correctly from then on with zero explicit block-versioning logic required.

### 7.6 View Workout

- A holistic, chronological list of every exercise and set logged in a session.
- **Swipe left** on a set to delete it.
- **Swipe right** on a set to edit it.
- This exact screen (same component, same gestures) is reused for viewing/editing **past** workouts, opened by tapping any entry in the History feed — live and historical editing are never two separate UIs. The only difference: past-session views omit the live Workout Mode chrome (no Log Set/Next Exercise/stopwatch, since there's no active session).

### 7.7 Feedback & Motivation

- After logging a qualifying set, an in-app toast/banner surfaces a **time-windowed motivational message** — e.g., _"Heaviest squat triple this month"_ or _"Tricep pushdown progressed this week."_
- Detection is based on **estimated 1RM** (Epley/Brzycki formula applied to any logged set, not just true maximal singles) and **rep-at-a-given-weight** bests, computed within rolling weekly/monthly windows — deliberately _not_ a rigid "all-time PR" system, since powerlifters rarely hit true maximal efforts outside of a meet.
- **Toggleable off entirely in Settings.**
- **In-app only.** No push notifications of any kind — no streak reminders, no "you haven't logged in a while" nudges. This is an architectural constraint, not just a scope cut: real push notifications require a server to trigger sends, which breaks the zero-backend design.
- No streaks, no gamification mascot, no badges in v1 — considered and explicitly deferred, not because they're bad ideas, but because a personal app validating basic feedback-loop mechanics doesn't need them yet.

### 7.8 Charts

- A standalone **Charts** tab (not folded into a per-exercise history view — a full top-level tab).
- Per-exercise view. **Primary/default metric: estimated 1RM trend over time** (Epley/Brzycki, best set per session), shown as a single line graph.
- No volume/tonnage tracking in v1 — considered and rejected as a second, competing "number that matters" that muddies the one clear signal (getting stronger) the chart should communicate.

### 7.9 Split Slot Management

- No dedicated settings screen for this. Split Slots are created entirely inline at "Start Workout" (7.1).
- Reordering the rotation (7.2) can live in Settings as a simple drag-to-reorder list, but creation/renaming/deletion is not a separate flow — it happens by typing at the point of starting a workout.

### 7.10 Exercise Library

- Small curated preset library (~100-150 common barbell/machine/cable movements) with autocomplete, to save typing on common exercises.
- Freely add fully custom exercises (e.g., nicknamed movements) with the same ease — just a name and a Main Lift/Accessory toggle. No required category or muscle-group tagging in v1.

### 7.11 Setup Notes

- One free-text field per exercise (not structured fields like "seat height" — every gym's equipment differs too much for a fixed schema).
- Editable inline, shown prominently the moment that exercise is selected during logging.

### 7.12 History

- A scrollable feed on the Home screen of past sessions (date, Split Slot name, exercises done).
- Tapping any entry opens View Workout (7.6) for that session.

### 7.13 Settings

- Units: global **lbs/kg toggle** (store canonically in one unit, convert for display).
- Motivational messages: on/off toggle.
- Data export/import (7.14).
- Split rotation reorder (7.9).

### 7.14 Data Backup

- **Export:** one button dumps all data (exercises, sets, split slots, setup notes) to a JSON file via the OS share sheet (save to Files/iCloud/email to self).
- **Import:** reads a previously-exported JSON file back into a fresh install.
- This is the _only_ backup mechanism, given the deliberate no-backend/no-accounts architecture — a phone loss or reinstall without an export is unrecoverable data loss. Non-negotiable for v1 given that real training history is going into this.

## 8. Explicit Non-Goals for v1

Considered and deliberately deferred — not oversights:

- Accounts, login, cloud sync, multi-device support
- Push notifications of any kind (streak reminders, etc.)
- Rest timer with countdown/targets/alarms (only the passive "time between sets" stopwatch exists)
- Warm-up set logging
- Superset pairing as a first-class feature (manual exercise switching covers it)
- Split templates/presets (e.g., "PPL," "Upper/Lower") — slots are always user-named, blank-slate
- Bodyweight tracking, Wilks/DOTS relative-strength scoring
- Streaks, gamification mascot, badges, social/friend comparison features
- Monetization, App Store presence (Phase 2 only, contingent on signal)

## 9. Data Model (conceptual)

- **Exercise**: id, name, type (main | accessory), setupNote (text, nullable)
- **SplitSlot**: id, name (unique, case-insensitive), rotationOrder (int), lastLoggedAt
- **WorkoutSession**: id, splitSlotId, startedAt, endedAt
- **Set**: id, sessionId, exerciseId, weight, reps, rpe (nullable), isDropsetOrPartial (bool, nullable), timeBetweenSetsSeconds (nullable — null for the first set of a session), blockGroupId (nullable — groups a straight-set block together), loggedAt
- **Settings**: unit (lbs | kg), motivationalMessagesEnabled (bool)

No user/account entity — a fresh install has no identity beyond its local data.

## 10. Technical Architecture

- **Stack:** React + Vite + TypeScript, Dexie (IndexedDB) for storage, Zustand for state, Tailwind for styling — the same core stack as LiftLens PWA, minus everything CV/video-specific (no onnxruntime-web, no WebCodecs, no Web Workers, no COOP/COEP cross-origin isolation requirement).
- **Hosting:** Vercel.
- **No backend.** No auth, no server, no database beyond on-device IndexedDB.
- **PWA:** installable via "Add to Home Screen," offline-capable via service worker.
- **Phase 2 path:** Capacitor wraps the same codebase for App Store distribution, if/when pursued.

## 11. Visual Design Direction

- **Font:** Space Grotesk (shared with LiftLens, for the builder's own visual consistency across apps).
- **Aesthetic:** Apple Notes-inspired minimalism — clean, restrained, native-feeling. Flat list rows, thin dividers, no heavy shadows, no gradient buttons.
- **Explicitly avoid:** em dashes in UI copy, glow/gradient effects, orange accent tabs, or any other visual signature typical of default AI-generated ("vibe-coded") UI. This should not look or read like a generated template — it should look hand-considered.
- **Distinct from LiftLens:** same font, different accent color and overall visual identity, so the two apps are clearly not the same product when installed side by side. LiftLens is dark-only with an orange AWP-inspired accent — this app should not reuse that palette.
- **Mobile-only.** No desktop/responsive layout work.

## 12. Worked Example (for reference during UI design)

A single powerbuilding "Heavy Bench" session, illustrating the flow end to end:

1. User taps **Start Workout** → field prefilled with "Heavy Bench" (predicted next in rotation) → confirms.
2. Enters Workout Mode. Taps **Log Set** → picks "Bench Press" (Main Lift) → weight 225, reps 3, RPE 7, sets stepper left at 1 → confirms. Logged: _Bench Press, 225×3 @7_.
3. Taps **Log Set** again (exercise still sticky as "Bench Press") → adjusts weight down to 190, reps to 5, RPE 6, bumps **Sets stepper to 4** (declaring the backdown block) → confirms. Logged: _Bench Press, 190×5 @6_ (set 1 of 4). Button now reads **"Log Next Set (2 of 4)."** Stopwatch starts.
4. User rests, performs backdown set 2, immediately taps the single button (no re-entry) → logged with its own accurate "time between sets." Repeats for sets 3 and 4.
5. Taps **Next Exercise** → app suggests "Keenan Flaps" (from last "Heavy Bench" session, in sequence) at its last-logged weight/reps → user confirms or adjusts → logs 2×6 @57.5, RPE 10 each (accessory, always near-failure, no block-matching ambiguity since it's a single distinct weight).
6. Continues through remaining accessories the same way.
7. Taps **End Workout**. A motivational toast may appear if any set qualified (e.g., "Bench Press estimated 1RM progressed this month").
8. Later, taps into **History** → this session → **View Workout** → swipes to correct a mistyped rep count on one set.

## 13. Open Questions / Next Steps

1. Prototype the screens above (Home, Start Workout, Workout Mode, Log Set sheet, View Workout, History, Charts, Settings) to validate the visual direction (Section 11).
2. Review the generated UI against Section 11's explicit "avoid" list before treating any screen as final.
3. Revise this PRD based on what does/doesn't work once real screens exist, then treat that revision as final v1.
