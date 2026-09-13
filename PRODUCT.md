# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One user: the person who built it. A powerlifter / powerbuilder who trains on a named
split and has failed to log consistently in every other app he has tried.

The app was designed for him plus a small circle of lifting friends, but **nobody else has
installed it**. There is no user base to avoid disrupting and no onboarding debt. The
audience it must win is the builder himself.

He is not yet a habitual user. He opens it **twice a day, and the two openings are
different products**:

- **Mid-workout, in the gym.** Standing, between sets, often one-handed, phone held at
  arm's length, possibly sweaty hands and gym lighting. He is logging weight and reps and
  wants to be done. Speed and target size dominate everything.
- **At night, in bed, before sleeping.** Lying down, in a dark room, one hand, no hurry.
  He is filling in the day: six numbers, and looking at what the day came to.

These two scenes have opposite requirements and both are first-class. Any design that
serves one at the cost of the other has failed.

## Product Purpose

Log a workout with as little friction as physically possible, and keep the day's six
numbers alongside it - morning bodyweight, then calories, protein, carbs, fat and steps -
entirely on the device.

**It is not a food tracker.** It used to be, and that was cut in September 2026: it never
asks what you ate, only for numbers you already know. Anything that reintroduces
per-item food entry is reintroducing the thing that was removed.

Success is **habit**: the builder reaching for it without deciding to. The app is
functionally complete and still not part of his routine, so the gap between "it works" and
"it gets used" is the whole remaining problem.

## Positioning

Two things a neighbouring app could not truthfully copy:

- **Suggestions keyed to named split-slot rotation, not the calendar.** Lifters skip and
  reorder days, so day-of-week prefill is wrong for them. Prefill is scoped per split slot
  and matched by distinct-weight-block order, so "Heavy Bench" and "Volume Bench" never
  contaminate each other's history. This self-corrects across training blocks with no
  mesocycle entity to maintain.
- **No account, no backend, no analytics, no server operated by this project.** Data lives
  in IndexedDB. The only way out is a JSON export or an optional sync into a Google Sheet
  the user owns, running in their own Google account.

## Operating Context

- Installed to the home screen as a PWA. **Phone only.** No desktop layout, no responsive
  breakpoints. The app shell is locked to `100dvh` and the page itself never scrolls;
  scrolling happens inside the content area only.
- Offline-first. Logging never waits on a network.
- The gym scene and the bedtime scene, above, are the two real usage environments. Ambient
  light differs sharply between them.
- Optional Google Sheets sync exists so the log can be charted or read by an LLM. It is off
  by default, single-device by design, and the deployment URL is deliberately kept out of
  backups.

## Capabilities and Constraints

Built and working today:

- Freeform workout logging: split slots created inline, sets with weight/reps and optional
  RPE, per-set setup notes that resurface as grey hints, straight-set blocks with a
  count-up stopwatch labelled **"time between sets"** (never "rest time" — it necessarily
  includes performing the next set).
- No warm-up set logging at all, by design: warm-ups are not comparable week to week and
  would corrupt record detection.
- Cardio is a `WorkoutSession` with `kind: "cardio"` and no split slot, not a separate
  entity.
- Records across a finished workout (weight, estimated 1RM, reps at load), assembled into
  an end-of-workout summary.
- A date-parameterised day view: a week strip and one card of the day's six numbers.
  Every row always renders, "Not recorded" when it has nothing, so the shape of the
  screen does not change as it fills in.
- Daily numbers: bodyweight, calories, protein, carbs, fat, steps, and an **untracked**
  flag meaning a day deliberately not logged rather than one missed.
- A weekly training plan, a calendar history, charts for bodyweight, steps and calories,
  a two-way Google Sheet mirror, JSON export/import, clear-all-data.

Deleted in September 2026 and not to be rebuilt without a decision: food logging (foods,
meals, recipes, barcode scanning, MyFitnessPal import), habits, the plate and 1RM
calculators, the 24-hour day timeline, per-weekday target profiles, and every feature
toggle in Settings.

Technical constraints future work must respect:

- TanStack Start (React 19, SSR via nitro) + Vite 8 + Tailwind v4 + Zustand + Dexie.
- **No component library.** Every screen is hand-written Tailwind against the tokens in
  `src/styles.css`. `src/components/ui/` was deleted along with 41 dependencies; imports
  from it will not resolve.
- No push notifications, ever. They require a server, which breaks the zero-backend design.
  Feedback has to work in-app or not at all.
- A dense, load-bearing test suite (677 tests). Behaviour changes are expected to come
  with tests.
- `npm run screenshots` is the best QA instrument here and catches things the tests
  cannot: it found four stranded feature flags and two controls that had become
  invisible, none of which any test could see.

Terminology that is settled and must not fork:

- **Daily numbers**, never "daily log", "daily summary" or "today's numbers".
- **Workout**, never "session", on any user-facing surface. The internal type stays
  `WorkoutSession`.
- **Untracked**, never "cheat day". The flag is a claim about LOGGING, not about food:
  a day you chose not to record. The two come apart constantly.

Settled:

- **The product's name is Trakt** (decided 2026-09-12). It replaces the "Anything But The
  Notes App" placeholder from the PRD. Note that trakt.tv is an unrelated existing
  product; the collision was raised and accepted.

## Brand Commitments

- **The interface must not read as default AI-generated UI.** This is the user's own
  standing constraint and predates any specific theme. Concretely, and independent of
  whatever visual world is current: no glow, no mesh gradients, no purple-blue "AI"
  gradient, no decorative noise or texture, and no second accent colour competing with the
  first.
- **Copy is sentence case.** "View workout", not "View Workout".
- **No em dashes in UI copy.** Use a hyphen, or restructure the sentence. Restructuring is
  preferred; the substitution usually reads worse than the sentence you would have written
  instead.
- **Empty states must not share a shape.** Six empty states built from one template
  ("[imperative] + [object] + [to + purpose]") is the signature of machine-written text
  even when every sentence is defensible. Vary them deliberately and read them as a set. A
  purpose clause is almost always deletable.
- **Do not manufacture praise.** The app notices records because a training log is about
  them. It does not congratulate anyone for showing up, and a workout with no records still
  gets a plain, real summary.

## Evidence on Hand

- Real training and nutrition data in the builder's own IndexedDB. Seeded fixture data
  exists in one dev browser profile only; it is not in the repo and is not real.
- `docs/trakt-plan.md` — the September 2026 overhaul: 12 locked decisions from a grilling
  session, and a closing section recording the four places the plan turned out to be
  wrong. Read that section before trusting any specific claim in it.
- `DESIGN.md` — the visual system, written from what shipped rather than what was intended.
- `PRD.md` (draft v1, 2026-07-21) — historical. Its stack, host, font, visual and product
  sections have all diverged from the code. **Trust the code.**
- `screenshots/` — 33 deterministic captures, regenerated by `npm run screenshots` and
  gitignored. Layout and state only: the runner is Playwright on Windows, so its type is
  never the app's type.
- There are **no users, no testimonials, no press, no benchmarks, no pricing and no
  deployment claims**. None of these may be invented.

## Product Principles

1. **Friction is the product.** Every screen is judged by how little it asks of a person
   holding a phone between sets. A feature that is correct but slow has failed.
2. **Two scenes, one app.** The gym and the bedroom are both first-class, and they want
   different things. Design for the harder one on each axis rather than averaging them.
3. **The device owns the data.** No account, no backend, no analytics. Anything that would
   require a server is out of scope, not merely deferred.
4. **Say what is true.** Real numbers, real records, plain summaries. No encouragement the
   software has not earned and no claim it cannot support.
5. **It has to be worth opening.** The app is complete and unused. Habit is the goal, and
   an interface the builder actively enjoys opening counts as function, not decoration.

## Accessibility & Inclusion

Established commitments, held across any visual world:

- **AA contrast minimum** on all text, measured rather than assumed.
- **State is never carried by hue alone.** A fill, label or icon must repeat whatever the
  colour says. This is measured, not boilerplate: simulated for protanopia the current
  success and warning tokens collapse from 37.9 apart to roughly 10 (CIEDE2000) and read as
  the same olive.
- **44px minimum hit area** on everything interactive. Expand the hit area with padding or
  an overlay rather than growing the row.
- `prefers-reduced-motion` is handled globally in `styles.css`, not per component.
- Every icon-only button carries an `aria-label` saying what it does.
