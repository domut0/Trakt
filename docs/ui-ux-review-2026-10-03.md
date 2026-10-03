# Trakt UI and UX review, 3 October 2026

Method: dual-agent (A: /root/trakt_ux_review · B: /root/trakt_layout_review), both GPT-6.1-sol, followed by Codex source review and fresh screenshot inspection.

Reviewed baseline: `7f436bc`. Implementation branch: `codex/workout-preview-ios`, in `C:\dev\trakt-workout-preview-ios`. The changes are local and have not been committed, pushed or deployed.

## Evidence and limits

The two reviewers independently examined the source. The Impeccable detector was attempted but could not load its missing engine, so deterministic scan findings and counts are unavailable. Native browser inspection was attempted but the available browser surface rejected new tabs. No detector overlay was produced.

Codex then ran the repository's Playwright screenshot harness against an isolated local development server. It captured 39 populated and empty screens across Today, History, Charts, Settings, workout logging and Plan. A bounded confirmation pass checked the revised workout overview and editor, including a 320 × 568 viewport and scrolling to the entire cardio finisher. These are Chromium mobile viewport checks, not real iOS or VoiceOver tests.

The screenshot run emitted seven SSR hydration warnings. The development-server log confirms at least one mismatch in the Home heading: the fixture's client clock rendered Thu 20 Aug while the server rendered Sat 3 Oct. Separate empty-page loads with both real and frozen browser clocks produced no console errors. The remaining warnings have not been classified; do not call the screenshot run console-clean or attribute every warning to the fixture clock.

## Overall assessment

Trakt has a coherent visual identity: black backgrounds, grouped gray rows, strong numerical hierarchy and restrained chrome suit quick use between sets. The biggest opportunity is to make each screen answer the person's immediate question before exposing editing controls. Coaching now matters enough to have its own workspace.

The design is specific to a phone training log. Preserve it while improving navigation and layout. The visible weaknesses are task hierarchy, crowded editing surfaces, ambiguous presence markers and uneven control accessibility.

## Baseline heuristic assessment

These are subjective source-based ratings from Assessment A, on a 0–4 scale. They describe the baseline, not measured usability or a certification of the finished changes.

| Heuristic               | Score | Main evidence                                                                                   |
| ----------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| Status visibility       | 3     | Save/sync feedback and client identity exist; freshness needs clearer meaning.                  |
| Real-world match        | 3     | Familiar workout and daily-number language; internal card concepts leak into editing.           |
| Control and freedom     | 2     | Reading was entangled with editing; several overlays lack consistent focus handling.            |
| Consistency             | 2     | Common visual tokens, uneven dialog semantics and touch targets.                                |
| Error prevention        | 2     | Coach locks exist; compressed editor fields make prescriptions harder to inspect.               |
| Recognition over recall | 2     | Calendar dots hide which values were recorded; placeholder-only prescription labels disappear.  |
| Efficiency              | 1     | Coaches must open clients individually and inspect one day at a time.                           |
| Minimalism              | 3     | Restrained visual language; Plan presents a large editing form before workouts.                 |
| Recovery                | 3     | Existing readable sync errors and recovery actions; launch sign-in interrupts the primary task. |
| Help                    | 3     | Tutorial and contextual explanation exist; no evidence of a mandatory tutorial gate.            |
| Total                   | 24/40 | Acceptable foundation with significant workflow improvements needed.                            |

## What works

- Daily numbers use a stable order and strong tabular values. Inline editing removes unnecessary navigation for routine logging.
- Workout screens keep the last prescription and set entry near the current lift, which supports the actual gym task.
- Client identity, save/send feedback and store-level plan locks support safe coaching. Reading a locked workout is already an authorized action.

## Priorities

### P1: Workout reading and editing lose usable space

Baseline `PlannedCardSheet.tsx` capped its sheet at 85vh, scrolled its Close control away and truncated long names. `SlotPlanSheet.tsx` split its space between fixed controls and a shrinking chosen-lifts pane. A finisher made that tradeoff worse.

**Implemented locally:** tap any existing card to read it first; a full-height overview wraps the actual prescription and finisher in one scroll area. Close remains reachable. Edit is separate and appears only when permitted. The full-height editor has one scrolling body and persistent Save/Cancel. Prescription labels remain visible. Relevant command: `/impeccable adapt`.

### P1: A coach's recurring workflow is buried in Settings

`settings.tsx` renders `CoachSettings`, which owns the client list. The same area handles setup and individual client opening. It offers no roster view for comparing logging across a period.

**Proposed:** a Clients tab, visible in coach mode, with Week / 2 weeks / Month. Keep Google connection and coach-mode configuration in Settings. Preserve the selected period when opening and leaving a client. Relevant command: `/impeccable shape`.

### P1: Calendar presence and trend charts cannot answer the coach's numerical question

History shows identical dots for different data categories, with nutrition presence aggregating calorie/macro entry. Charts show calories, steps or bodyweight over 7/30/90/all-day ranges. Neither offers a compact comparison of actual daily weight, steps, calories and all three macros across clients or a two-week period.

**Proposed:** a roster of logging counts or calendar field counts, followed by a per-client daily-numbers table. Keep missing values separate from recorded zero. Show units in the column headers and preserve readable type using horizontal scrolling with a pinned Date column. Relevant command: `/impeccable clarify`.

### P2: Plan is an editing form before it is a program overview

The fresh Plan capture starts with the nutrition ribbon and a large form for name, dates, calorie/step targets, macros and notes. Workout cards require scrolling farther down. The client arriving to see a prescription should be able to read the program immediately.

**Proposed:** start with concise training and nutrition summaries, with an explicit Edit action for authorized users. Give each section enough space to read its current prescription before showing its controls. Relevant command: `/impeccable distill`.

### P2: Touch targets and overlay behavior need a consistent pass

WeekStrip arrows remain 32px wide, chart mode controls remain small, and older picker/start/substitute/chooser overlays lack the same complete dialog/focus behavior. This affects one-handed use and assistive navigation.

**Implemented locally:** rotation rows are semantic buttons; Options and reorder controls have separate 44px targets. The workout overview and editor use modal semantics, contain keyboard focus and return it to the opener. Other overlays and controls are follow-up work. Relevant command: `/impeccable harden`.

## Cognitive load and emotional journey

The editor combines name, three day-kind toggles, finisher fields, chosen lifts, exercise search, library and templates. Grouping helps, but the user still has to scan several decisions before reading the program. The new overview removes those decisions from the reading task.

For a client, receiving a coach's prescription should lead directly to a legible workout. A squeezed pane and an unexpected Google prompt create uncertainty before any training starts. For a coach, repeated client switching and daily inspection make comparison expensive. The roster and numbers view should make gaps and actual values visible without reconstructing them from dots.

## Persona checks

- **Coach with many clients:** individual opening and day selection dominate the review task. A roster must show logging by metric, retain period selection and identify unavailable/stale data.
- **Distracted mobile user:** small arrows and cramped editors cost precision. The changed screens retain usable content and persistent actions on the small viewport; hardware keyboard/safe-area behavior still needs iPhone QA.
- **Assistive-navigation user:** the changed workout dialogs support keyboard focus and named controls. Other overlays and VoiceOver behavior still need review; this is not an app-wide accessibility sign-off.

## Minor observations and unresolved checks

- The client's banner freshness is based on when the coach fetched the snapshot, not proof of when the client last synced. Label those meanings separately in the new workspace.
- Several design/product documents describe earlier behavior. Current source and the user's active coaching workflow take precedence.
- Source review suggests the standalone privacy/join pages could have scrolling issues with the app's global overflow rules. This was not reproduced and should remain a hypothesis until checked on a device.
- The current client store keeps a temporary snapshot for the client being viewed. A roster will require a deliberate loading/cache/freshness design, and the current Google token flow must remain user-driven. That architecture has not been implemented or delegated.

## Google launch fix and tradeoff

Background sync previously reached `requestAccessToken()` through Google's dialog flow when the in-memory token was absent or expired. The updated noninteractive path uses only a valid cached token and otherwise returns `needs-consent` before loading or requesting Google authorization. The app shows **Google sync paused** with **Reconnect Google**, using the existing reauthorization action only after a tap.

Daily logging stays available offline. Because tokens still live only in memory, a fresh page session or expired token requires reconnection before Google sync resumes. This removes automatic launch sign-in; it does not promise silent renewal or remove browser prompts from an intentional sign-in. Google's token-model documentation specifies user-driven renewal: https://developers.google.com/identity/oauth2/web/guides/use-token-model.

## Validation and handoff

- Full suite: 77 files, 1,194 tests passed.
- TypeScript check, ESLint on changed source/test files, production build and `git diff --check` passed.
- Screenshot coverage includes an eight-lift workout, a long prescription, a 20-minute bike finisher, a small phone, and persistent Close/Save actions. The screenshot console caveat above remains open.
- Coach concept: sample data only. Both roster variants open a common numbers view with 7/14/30 actual rows, preserved period, missing values and a visible recorded zero. No client data or roster implementation was added to the app.
- Required user QA after deployment approval: iPhone Home Screen launch, intentional Google reconnect, coach-managed workout reading, editing and keyboard behavior with a finisher.

Provenance: Gemini 3.6 Flash High wrote the initial bounded workout layout changes. Codex reviewed and revised those changes, added the focus/accessibility adjustments and implemented the Google launch fix and reconnect notice. Two GPT-6.1-sol agents supplied independent read-only reviews. Copilot auto supplied an inventory; an initial empty timeout was reported, and unsupported inventory claims were discarded.

## Coach calendar follow-up after design approval

The user subsequently approved compact Mini Today cards with actual daily values, workout sets and cardio minutes, seven days across and one row per week. This supersedes the earlier logging-presence and Counts proposals and the proposal-only status above.

The `/clients` workspace is now implemented locally on `codex/coach-mini-today`. It provides the coach roster, a focused client calendar and readable day details, with shared periods, read-only bounded snapshot loading, fetched-age labels, retained-data warnings and deliberate Refresh/reconnect actions. Google reads never change the coach's main store. See [coach-progress-brief.md](coach-progress-brief.md) for the accepted scope and verification.

Full verification now passes 80 test files / 1,206 tests, typecheck, scoped ESLint and the production build. Running-app captures at 390px and 320px confirm the seven-column layout; a failed-refresh/recovery fixture verifies stale-day recovery and unchanged own data. Both approved GPT-6.1-sol reviewers scored the required fixes resolved. Codex documented the extension against the unchanged global visual system. Gemini 3.6 Flash High wrote only the bounded presentation components; Codex reviewed/fixed them and owns data, authorization and navigation. This remains local for user QA, with no push or deployment.
