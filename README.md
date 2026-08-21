# Anything But The Notes App

A frictionless workout logger for lifters. Weight and reps, nothing else in the way.

It's an offline-first, installable PWA: all data lives on your device (IndexedDB),
there's no account and no backend, and it keeps working with no network.

Optionally, it can mirror your log into a Google Sheet you own, so you can chart it
or point an LLM at it. That's off until you turn it on, and logging never waits on it.

## Features

- **Fast logging**: start a session, log sets with weight/reps/RPE; the next set's
  values pre-fill from your last one so logging is mostly confirming.
- **Smart suggestions**: the next session name, exercise, and starting weights are
  predicted from your history. Suggestions show in grey and commit only when you accept.
- **Per-set setup notes**: jot machine settings (seat height, pin, grip) once; they
  resurface as a grey hint next time and travel with each set as a snapshot.
- **PR detection**: `src/lib/pr.ts` finds three kinds of record across a finished
  workout, weight, estimated 1RM, and reps at a given load or above, and
  `src/lib/workout-summary.ts` assembles the end-of-workout summary from them. The first
  time you perform an exercise sets no records at all: an exercise starts producing them
  on its second outing, once there is something real to beat. Warm-ups are excluded,
  which is worked out from the workout itself rather than a threshold: a set followed by
  a heavier set of the same exercise was a warm-up.
- **A workout ends with what it was**: duration, volume, sets, and any records, on a
  summary screen instead of a silent redirect home. A workout with no records still gets
  a real summary; ending one with nothing logged is treated as a cancel and shows
  nothing.
- **History, calendar, and charts**: browse past workouts, a month calendar view, and
  progress charts (the Charts tab is toggleable in Settings; the calendar lives in History).
- **Backup**: export/import your entire dataset as a JSON file; "clear all data", behind a
  confirmation step, resets to a clean slate for testing.
- **Google Sheets sync** (optional): keeps a spreadsheet you own up to date with your
  log, and lets you edit nutrition, set values and session notes from a keyboard. See
  [`google-apps-script/README.md`](google-apps-script/README.md) for setup.
- **Installable PWA**: add to home screen; controlled service-worker updates prompt
  before taking over.

## Tech stack

- [TanStack Start](https://tanstack.com/start) (React 19 + TypeScript, SSR via nitro)
- [Vite](https://vite.dev/) 8
- [Tailwind CSS](https://tailwindcss.com/) v4
- [Zustand](https://github.com/pmndrs/zustand) for state
- [Dexie](https://dexie.org/) over IndexedDB for on-device persistence
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) for the service worker + manifest
- [Vitest](https://vitest.dev/) for tests
- [lucide-react](https://lucide.dev/) for icons, [date-fns](https://date-fns.org/) for dates

There is no component library. Every screen is hand-written Tailwind against the tokens in
`src/styles.css`, and [`DESIGN.md`](DESIGN.md) is the source of truth for type, colour and
spacing. The shadcn primitives this project once vendored were removed along with the 41
dependencies they pulled in, so a `src/components/ui/` import will not resolve.

## Getting started

Requires Node 20+ and npm.

```bash
npm install        # install dependencies
npm run dev        # start the dev server on http://localhost:8080
```

To test on a phone over your LAN:

```bash
npm run dev:device # binds to your network interface (--host)
```

## Scripts

| Command              | What it does                            |
| -------------------- | --------------------------------------- |
| `npm run dev`        | Dev server on port 8080                 |
| `npm run dev:device` | Dev server exposed on the local network |
| `npm run build`      | Production build to `.output/`          |
| `npm run preview`    | Preview the production build locally    |
| `npm test`           | Run the unit test suite (Vitest)        |
| `npm run lint`       | ESLint                                  |
| `npm run format`     | Prettier                                |

## Project structure

```
src/
  routes/            # file-based routes (home, workout, history, charts, settings,
                     #   one session, one exercise)
  components/        # app UI: sheets, session view, app shell, calendar, sync settings
  hooks/             # shared UI hooks
  lib/               # store (Zustand), db (Dexie), and the pure logic the store and
                     #   screens delegate to: pr.ts, workout-summary.ts, onerm.ts,
                     #   exercise-history.ts, targets.ts, chart-math.ts, plates.ts,
                     #   sync.ts. Prefill and next-session suggestions live in store.ts
  test/              # Vitest setup (fake-indexeddb, jest-dom)
  router.tsx         # router construction
  styles.css         # Tailwind theme: the type, colour and spacing tokens in DESIGN.md
  server.ts          # SSR entry (error wrapper)
  start.ts           # request middleware
public/              # icons + favicon
google-apps-script/  # the sync endpoint the user deploys into their own sheet
```

Tests sit in a `__tests__/` folder beside the code they cover.

All persistence is client-side: the store hydrates from IndexedDB after mount and
write-throughs mirror every mutation back to the database. IndexedDB stays the source of
truth even with sheet sync on, which reads from the store and never writes ahead of it.

## Data & privacy

There is no analytics, no account, and no server operated by this project. By default
your workout data never leaves the device, and **Settings → Export backup** is how you
move it between devices.

The one exception is sheet sync, which is off unless you enable it. Turning it on sends
your log to a Google Sheet you own, through a script running in your own Google account.
The deployment URL it uses is effectively a password for that sheet, so it is stored only
on the device and deliberately left out of JSON backups. Sync is single-device by design:
a second install is refused rather than allowed to overwrite the first one's history. Moving
to a new device is a deliberate handover ("Take over this sheet"), not something that happens
by accident.

## License

Private / unlicensed. All rights reserved.
