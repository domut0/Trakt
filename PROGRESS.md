# Build Progress — Anything But The Notes App

Orchestrated build of the 5 scoped issues from `HANDOFF.md`. This file is the durable
source of truth across usage windows. **On resume: read this first, then `git log --oneline -20`
and `git status`, before anything else.**

## Orchestration model
- Opus 4.8 orchestrator (does not implement issues itself); Sonnet 5 subagents implement each issue.
- `gh` CLI is NOT available on PATH → working from the HANDOFF issue list directly, no GitHub Issues.
- Do NOT push to origin, do NOT open PRs. Commit locally only.
- Verify each issue with `npm run build` (and `npm test` where tests were added) BEFORE committing.

## Execution order (HANDOFF §5)
1. Baseline commit + verify green build
2. Issue #5 (preset library) — alone
3. Issue #1 (Dexie persistence + tests) — alone, foreground, reviewed carefully (foundational)
4. Issues #2 (PWA), #3 (backup import), #4 (PR detection) — parallel, each in its own git worktree
5. Merge/reconcile the 3 worktrees back to main (orchestrator resolves store.ts/workout.tsx overlap)
6. Final Definition-of-Done verification

## Status

| # | Issue | Status | Commit |
|---|-------|--------|--------|
| — | Baseline commit + green build | DONE | c6b9397 / c125e5f |
| 5 | Expand exercise preset library | DONE | c6c17c7 |
| 1 | Persist data via IndexedDB (Dexie) + tests | DONE | 9c14064 |
| 2 | PWA installability & offline | IN PROGRESS (worktree) | — |
| 3 | Real backup import | IN PROGRESS (worktree) | — |
| 4 | Real PR/progress detection | IN PROGRESS (worktree) | — |
| — | Merge batch + final DoD verify | NOT STARTED | — |

### Issue #1 result (DONE, 9c14064)
Dexie persistence via hydrate-then-write-through. New `src/lib/db.ts`; `store.ts` inits empty, seeds
only on empty DB, write-throughs every mutation; pure logic extracted+tested. 24 vitest tests pass, build
green. SSR-safe (client-only DB). Only store.ts + __root.tsx touched; all consuming components unchanged.
`npm test` now exists.

### Parallel batch plan (#2/#3/#4) — file lanes chosen to make merges conflict-free
- **#2 PWA**: `vite.config.ts`, `src/routes/__root.tsx` (SW registration/head), new `src/components/PwaUpdatePrompt.tsx`,
  `public/` icons, `package.json`/lock (adds vite-plugin-pwa). ONLY batch member touching these.
- **#3 backup import**: `src/routes/settings.tsx`, `src/lib/store.ts` (adds importData action), `src/lib/db.ts`
  (adds replaceAll helper), a test. ONLY batch member touching store.ts/db.ts/settings.tsx.
- **#4 PR detection**: `src/routes/workout.tsx` (handleEnd only), NEW `src/lib/pr-detection.ts` (pure, imports
  estimated1RM read-only), a test. ONLY batch member touching workout.tsx. **Decision: fire the toast at
  End Workout** (matches PRD §12.7 worked example + the issue's "replace the stub in handleEnd"; keeps #4 in
  its lane). Detection = real week/month rolling-window e1RM + rep-at-weight bests.
- Each runs in its own git worktree/branch, commits to its branch, reports branch name. Orchestrator merges
  all three into main, then runs full DoD verification.

### Issue #5 result (DONE, c6c17c7)
117 exercises total (110 added). Data-only change to `seedExercises`. Build green. Verified: only
store.ts changed, ASCII-only names, no dup names, custom-add untouched, 14 "main" (3 orig + 11 barbell variants).

### Verification note: lint baseline is RED (pre-existing)
`npm run lint` fails on the untouched prototype — ~145 `prettier/prettier` formatting errors across the
Lovable-generated codebase (store actions, routes, ui components). This is the BASELINE state, NOT a
regression. **The DoD gate is `npm run build`, not lint.** When verifying a subagent's diff, check that it
added no NEW lint errors *in the lines it touched* rather than expecting a clean lint run. Do not attempt a
repo-wide prettier reformat (out of scope; would bloat every diff and risk the Lovable sync).

## Key architecture facts (verified from code)
- **SSR app**: TanStack Start with a real server entry (`src/server.ts`, `src/start.ts`). Root uses
  `shellComponent` rendering `<html>`. → Issue #1 Dexie access MUST be client-only (guard against SSR;
  IndexedDB doesn't exist on the server). Issue #2 PWA must integrate with SSR, not a plain SPA.
- **Store**: `src/lib/store.ts` — synchronous Zustand `create`, consumed everywhere via
  `useStore((s) => ...)`. Persistence strategy: hydrate from Dexie into the store on client mount,
  then write-through every mutation to Dexie. Keeps all consuming components synchronous/unchanged.
- **vite.config.ts** wraps `@lovable.dev/vite-tanstack-config`. Extra plugins go via
  `defineConfig({ vite: { plugins: [...] } })` (per the file's own comment). Do NOT re-add tanstackStart/
  react/tailwind/nitro — the wrapper already includes them.
- **Palette** (current, established — DO NOT change): dark blue MyFitnessPal-style theme in
  `src/styles.css`; `theme-color` meta is `#1a1c1f`; accent is a blue. Use `#1a1c1f` for PWA
  manifest theme/background colors to match.
- **No icons** beyond `public/favicon.ico`. PWA needs an added icon (SVG ok).
- **Existing seed** exercises (do not duplicate in #5): Bench Press, Back Squat, Deadlift,
  Keenan Flaps, Tricep Pushdown, Incline DB Curl, Chest-Supported Row.
- **npm** (not bun). Node v24. Scripts: dev, dev:device (--host), build, preview, lint.

## Definition of done (HANDOFF §7)
- All 5 issues' acceptance criteria met.
- `npm run build` succeeds; `npm test` passes (issues #1, #4 add tests).
- `npm run dev:device` boots, usable on phone over LAN.
- No regressions to existing Lovable UI flows.
- Visual identity untouched: no NEW em dashes in UI copy, no glow/gradient, no orange accent tabs.
- Everything committed locally; nothing pushed; no PRs.

## Next action
Finish baseline commit, run `npm run build` to confirm green baseline, then spawn issue #5 subagent.
