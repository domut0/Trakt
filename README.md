# Trakt

Bodyweight, macros and training, logged once a day and mirrored to your own
Google Sheet.

It is an offline-first, installable PWA. All data lives on your device in
IndexedDB, there is no account and no backend, and it keeps working with no
network.

## What it does

**Four numbers and a workout.**

- **Morning bodyweight.** One number, first thing.
- **End-of-day macros.** Calories, protein, carbs and fat, entered once when the
  day is done. Plus steps, if you track them.
- **Workouts.** Start a session, log sets with weight and reps. The next set's
  values pre-fill from your last one, so logging is mostly confirming. Exercise
  names, starting weights and the next session's split are all predicted from
  your history and shown in grey until you accept them.
- **A weekly plan.** Main lifts get assigned to weekdays ahead of time, so
  starting a workout on a planned day preloads exactly those. Accessories are
  never constrained by it.
- **A Google Sheet.** Optional, off until you turn it on, and logging never waits
  on it. Set-up instructions are in [`google-apps-script/`](google-apps-script/).

**What it deliberately is not: a food tracker.** It never asks what you ate. It
asks for numbers you already know.

## Marking a day untracked

A day you chose not to log is not the same as a day you forgot. Marking a day
untracked records that difference, and the weekly counts and charts read it —
an untracked day is a deliberate break, not a gap.

## Running it

```bash
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run dev:device` | Dev server on the LAN, for testing on a phone |
| `npm run build` | Production build |
| `npm test` | Test suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run screenshots` | Deterministic screenshots of every screen |

`npm run screenshots` is the best QA instrument in the repo: a fixed seed, a
frozen clock, and it fails loudly on a blank page or a Vite error overlay.

## Backing up

Everything is on your device, so the JSON export in Settings is the only backup
that exists. Take one before you change phones.

## Where the decisions are written down

- [`docs/trakt-plan.md`](docs/trakt-plan.md) — the current overhaul: what the app
  is being cut down to, and why.
- [`DESIGN.md`](DESIGN.md) — the visual system.
- [`PRODUCT.md`](PRODUCT.md) — who this is for and how it actually gets used.
- [`PRD.md`](PRD.md) — the original spec. Historical; where it disagrees with the
  code, the code is right.

## Stack

TanStack Start (React 19, SSR) · Dexie/IndexedDB · Zustand · Tailwind v4 ·
Vite · Vitest. No backend.
