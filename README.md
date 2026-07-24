# Anything But The Notes App

A frictionless workout logger for lifters. Weight and reps — nothing else in the way.

It's an offline-first, installable PWA: all data lives on your device (IndexedDB),
there's no account and no backend, and it keeps working with no network.

## Features

- **Fast logging** — start a session, log sets with weight/reps/RPE; the next set's
  values pre-fill from your last one so logging is mostly confirming.
- **Smart suggestions** — the next session name, exercise, and starting weights are
  predicted from your history. Suggestions show in grey and commit only when you accept.
- **Per-set setup notes** — jot machine settings (seat height, pin, grip) once; they
  resurface as a grey hint next time and travel with each set as a snapshot.
- **PR detection** — celebrates estimated-1RM and rep PRs at the end of a session.
- **History, calendar, and charts** — browse past sessions, a month calendar view, and
  progress charts (charts and calendar are toggleable in Settings).
- **Backup** — export/import your entire dataset as a JSON file; a one-tap "clear data"
  resets to a clean slate for testing.
- **Installable PWA** — add to home screen; controlled service-worker updates prompt
  before taking over.

## Tech stack

- [TanStack Start](https://tanstack.com/start) (React 19 + TypeScript, SSR via nitro)
- [Vite](https://vite.dev/) 8
- [Tailwind CSS](https://tailwindcss.com/) v4
- [Zustand](https://github.com/pmndrs/zustand) for state
- [Dexie](https://dexie.org/) over IndexedDB for on-device persistence
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) for the service worker + manifest
- [Vitest](https://vitest.dev/) for tests

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
  routes/        # file-based routes (home, workout, calendar, charts, settings, session)
  components/    # app UI (sheets, session view, app shell) + ui/ primitives (shadcn)
  lib/           # store (Zustand), db (Dexie), pure logic (suggestions, PR detection)
  server.ts      # SSR entry (error wrapper)
  start.ts       # request middleware
public/          # icons + favicon
```

All persistence is client-side: the store hydrates from IndexedDB after mount and
write-throughs mirror every mutation back to the database. Nothing is sent to a server.

## Data & privacy

Your workout data never leaves the device. There is no analytics, no account, and no
sync. Use **Settings → Export backup** to move data between devices manually.

## License

Private / unlicensed. All rights reserved.
