# Handoff: Orchestrate the full build of "Anything But The Notes App"

You are the **project orchestrator** for this repo. Your job is to take it from "Lovable UI prototype" to "all 5 scoped issues implemented, tested, and committed" — autonomously, using subagents for the actual coding, across as many 5-hour usage windows as it takes. Read this entire file before doing anything else.

## 1. What this project is

A mobile-first, offline-first workout tracker for powerlifters/powerbuilders who fail to track consistently — the core bet is that logging *friction*, not motivation or lack of structure, is the #1 reason tracking habits die. Every feature decision optimizes for fewer taps/less typing during an active set.

**Read `PRD.md` in this repo root in full before making any product-behavior judgment call.** It is the authoritative spec — 13 sections covering problem statement, every feature's exact interaction design, data model, and explicit non-goals. If a subagent's implementation choice conflicts with something the PRD locked in, the PRD wins.

## 2. Current repo state (verify this yourself before trusting it — it may have drifted)

- **Location:** `C:\dev\AnythingButTheNotesApp`
- **Origin:** a Lovable-generated UI prototype (TanStack Start + React + TypeScript + Tailwind v4 + Zustand + shadcn/radix components), copied in wholesale. It already implements almost the entire interaction model from the PRD — sticky-exercise logging, the declare-once/tap-per-set block flow, per-split-slot prefill/suggestion matching, the "time between sets" stopwatch, the persistent active-session banner, swipe-edit/delete (reused for live and historical sessions), split rotation reorder, units toggle, and a working e1RM chart. **Read the actual code before assuming a feature is missing — most of the PRD is already built.**
- **Package manager:** npm (converted from bun — `bun.lock`/`bunfig.toml` removed, `package-lock.json` present). `npm run dev`, `npm run dev:device` (binds `--host` for LAN/phone testing), `npm run build`, `npm run lint`.
- **Git:** repo is initialized, remote `origin` points to `https://github.com/domut0/AnythingButTheNotesApp.git`. **There may be uncommitted changes sitting in the working tree** (the Lovable copy, package.json edits, new `docs/agents/*.md` files, an edited `AGENTS.md`) — run `git status` first. If so, make one clean baseline commit capturing "Lovable prototype + project setup" *before* any issue work starts, so each issue's diff is reviewable independently.
- **Do not push to `origin` or open PRs.** The user is handling PRs themselves. Commit locally only; stop there.
- **`gh` CLI is installed** at `%LOCALAPPDATA%\Programs\gh-cli\bin` (on PATH) but **authentication status is unknown** — check `gh auth status` before assuming you can use it. If unauthenticated, skip publishing to GitHub Issues and just work from the issue list in Section 4 below directly (still track progress in `PROGRESS.md` per Section 6).
- **Issue tracker conventions** (if `gh` is authenticated): see `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md`, and the `## Agent skills` block in `AGENTS.md`.

## 3. One open architecture question you need to resolve early

The PRD (§10) specifies a plain Vite+React SPA with zero backend, hosted statically on Vercel. The Lovable scaffold instead uses **TanStack Start**, which includes a real server (`src/server.ts`, `src/start.ts`, nitro build). This wasn't a deliberate product decision — it's just Lovable's default template.

**Your call:** keep TanStack Start (it's already working, ripping it out is itself a large, risky rewrite with no user-visible benefit) as long as you don't end up *depending* on its server features (no server-side data fetching, no server functions holding state — everything must still work fully offline, client-side-only, per the PRD's non-negotiables in §5). If at any point implementing PWA/offline support (issue #2) turns out to fight the TanStack Start server model, stop and reconsider rather than fighting the framework — but default to keeping it.

## 4. The 5 issues, in dependency order

**File-overlap warning:** issues #1 and #4 both make substantial changes to `src/lib/store.ts`. Even though #4 has no *behavioral* dependency on #1, running them as literal-parallel subagents risks a real merge conflict. Sequence accordingly (see Section 5).

---

### Issue 5: Expand exercise preset library
*(Do this one first — trivial, isolated, unblocks nothing but gets it out of the way before store.ts gets rewritten twice.)*

**What to build:** Replace/expand the current 7-exercise seed list in `store.ts` with a curated preset library of roughly 100-150 common exercises, so the exercise autocomplete in "Log Set" is actually useful out of the box. Cover barbell compounds (squat/bench/deadlift variations), machine exercises, cable exercises, dumbbell exercises, and common accessory/isolation movements. Presets are additive — don't remove the ability to freely add fully custom exercises (e.g. nicknamed movements like "Keenan Flaps").

**Acceptance criteria:**
- [ ] ~100-150 distinct common exercises spanning barbell, dumbbell, machine, and cable movements across major muscle groups
- [ ] Each preset has a reasonable default Main Lift/Accessory tag (squat/bench/deadlift and close variations default "Main," everything else "Accessory," per PRD §7.10)
- [ ] No duplicates with existing seed data (Bench Press, Back Squat, Deadlift, Keenan Flaps, Tricep Pushdown, Incline DB Curl, Chest-Supported Row)
- [ ] Adding a fully custom exercise still works exactly as before
- [ ] Data-only change — no exercise-picker logic/UI changes

**Blocked by:** None.

---

### Issue 1: Persist workout data locally (IndexedDB via Dexie)

**What to build:** Replace the in-memory-only Zustand store (`src/lib/store.ts`) with real persistence via IndexedDB (Dexie), so a page reload, app close, or reinstall retains all previously logged exercises, split slots, sessions, and sets. Also introduce test tooling this project currently lacks entirely (vitest + fake-indexeddb + @testing-library/react — mirror the sibling `LiftLensPWA` project's stack at `C:\dev\LiftLensPWA\package.json` for reference on versions/config if useful), and add a first test suite covering the store's non-trivial pure logic: `predictedNextSlotName`, `startWorkout`'s case-insensitive/whitespace-trimmed slot matching, `suggestedNextExerciseFor`, and `prefillFor`'s per-slot distinct-weight-block matching. Remove the hardcoded seed data as a permanent default — it should only appear on a genuinely first-ever run (empty database).

**Acceptance criteria:**
- [ ] All entities (Exercise, SplitSlot, WorkoutSession, WorkoutSet, Settings) are read from/written to IndexedDB via Dexie, not just in-memory state
- [ ] Logging a set, ending a workout, reordering rotation, toggling settings, etc. all persist immediately — reloading shows identical state
- [ ] Seed/demo data inserted only on a first-ever run with an empty database, never re-inserted over existing data
- [ ] vitest + fake-indexeddb + @testing-library/react added as dev dependencies, runnable via `npm test`
- [ ] Unit tests cover: rotation round-robin, case-insensitive slot matching, per-slot suggestion scoping, distinct-weight-block prefill matching (including the self-correcting block-transition behavior in PRD §7.5)
- [ ] All existing UI flows continue to work unchanged from the user's perspective

**Blocked by:** #5 (sequencing only, to avoid touching the seed data twice — not a hard product dependency).

---

### Issue 2: PWA installability & offline capability

**What to build:** Add a web app manifest and service worker (`vite-plugin-pwa`) so the app is installable via "Add to Home Screen" on iOS Safari and continues to work fully offline (including all data from #1) with no network connection. Use a controlled-update pattern — new versions wait for an in-app "update available" prompt rather than silently reloading mid-session underneath the user (see `C:\dev\LiftLensPWA\vite.config.ts` for a working reference of this exact pattern, though that project's COOP/COEP/WASM-specific config doesn't apply here — this app needs none of that).

**Acceptance criteria:**
- [ ] `vite-plugin-pwa` configured with a manifest (app name, theme/background colors matching the current Apple-Notes-inspired palette, standalone display, icon)
- [ ] Installable via "Add to Home Screen" on iOS Safari and the browser install prompt on desktop/Android
- [ ] With network disabled, a previously-loaded app still loads and all IndexedDB data (from #1) is fully readable/writable
- [ ] Service worker updates use a "waiting" registration strategy with an in-app prompt to activate — no silent `skipWaiting`
- [ ] `vite preview` still works locally as a production-build smoke test

**Blocked by:** #1.

---

### Issue 3: Real backup import

**What to build:** Wire up the existing (currently non-functional) "Import backup" file picker in Settings to actually parse and restore a previously-exported JSON backup (the "Export backup" button already works) into the persisted store. This is the app's only data-recovery path given the deliberate no-accounts/no-backend architecture.

**Acceptance criteria:**
- [ ] Selecting a valid exported JSON file restores all entities (exercises, split slots, sessions, sets, unit, motivationEnabled) into IndexedDB
- [ ] Import warns the user before overwriting/merging existing data — no silent unannounced data loss (replace vs. merge UX is your call)
- [ ] A malformed/non-matching JSON file fails gracefully with a visible error, without corrupting existing data
- [ ] A round-trip test (export → wipe/reset → import) restores an equivalent state
- [ ] Works within an installed iOS PWA's file-picker constraints (no desktop-only file APIs)

**Blocked by:** #1.

---

### Issue 4: Real motivational PR/progress detection

**What to build:** Replace the hardcoded stub in `workout.tsx`'s `handleEnd` (currently fires a fixed message whenever a session has >3 sets, regardless of whether anything was actually a PR) with real detection per PRD §7.7: is a logged set a new estimated-1RM best (Epley formula — already implemented as `estimated1RM` in `store.ts`) for its exercise within the current week or month? Or a new rep-at-this-exact-weight best within the same window? Show an in-app toast (reuse the existing toast UI) naming the exercise and which kind of best was hit. Respect the existing `motivationEnabled` toggle. In-app only — no push notifications, no background checks, ever.

**Acceptance criteria:**
- [ ] A set that sets a new estimated-1RM best (week/month window) triggers a toast naming the exercise and window
- [ ] A set that sets a new rep-at-this-weight best triggers the same kind of toast
- [ ] A non-qualifying set triggers no message
- [ ] `motivationEnabled` fully suppresses all messages when off
- [ ] The hardcoded ">3 sets" stub is removed
- [ ] Unit tests cover the detection logic directly, including week/month window boundaries

**Blocked by:** #1 (file-overlap sequencing, not a product dependency).

## 5. Execution plan

1. **You (Opus 4.8) are the orchestrator.** Don't implement issues yourself — spawn a subagent per issue via the `Agent` tool with `model: "sonnet"`. These issues were written to be fully spec'd with no ambiguous judgment calls, which is exactly Sonnet's sweet spot, and it burns usage far slower than Opus across 5 tickets plus fix-up cycles. Only escalate a specific subagent to `model: "opus"` if it visibly struggles or produces something that fails review twice.
2. **Order:** #5 alone → #1 alone (foreground/reviewed before continuing — this one's foundational, verify it carefully) → then #2, #3, #4 **in parallel**, each with `isolation: "worktree"` so they don't clobber each other's working tree.
3. After the parallel batch, **you** (the orchestrator) merge/reconcile the three worktrees back into the main branch, resolving any overlap in `store.ts`/`workout.tsx` yourself — don't delegate conflict resolution to a subagent that doesn't have visibility into the other two branches.
4. **Commit after every completed, verified issue** — small, reviewable commits, one per issue (or per merge of the parallel batch). Never leave a completed issue's work uncommitted going into a new usage window.
5. **Verify before moving on:** after each issue, actually run `npm run build` and (where the issue added tests) `npm test`. Don't trust a subagent's self-report — check the diff and run the commands yourself.

## 6. Surviving 5-hour usage windows

This will very likely take longer than one usage window. Treat every window as possibly your last for a while:

- Maintain a `PROGRESS.md` at the repo root: which issues are done/in-progress/not-started, current branch/worktree state, and the very next action to take. Update it after every meaningful step, not just at the end.
- Never leave work mid-issue uncommitted if you're about to lose the window — commit to a WIP state with a clear message, note it in `PROGRESS.md`, and pick it back up next window.
- When a new window starts (or a fresh session resumes this handoff), **read `PROGRESS.md` first**, then `git log --oneline -20` and `git status`, before doing anything else — don't re-derive state from scratch or re-ask the user questions already answered in this file or the PRD.
- Don't wait on user input to keep moving between issues — this is meant to run unattended. Only stop and surface a question if something is genuinely ambiguous *and not resolvable from the PRD*.

## 7. Definition of done

- All 5 issues' acceptance criteria are met.
- `npm run build` succeeds with no errors.
- `npm run dev:device` boots and the app is reachable/usable on a phone over LAN.
- Every UI flow that worked in the original Lovable prototype still works identically from the user's perspective (nothing regressed while adding persistence/PWA/backup/PR-detection underneath it).
- The Apple-Notes-inspired visual identity is untouched: no em dashes introduced into UI copy, no glow/gradient effects, no orange accent tabs — subagents implementing infrastructure features should not incidentally touch visual design at all.
- Everything is committed locally, nothing pushed to `origin`, no PRs opened.
