# Release review — October 3, 2026

User authorized a comprehensive review followed by a direct push to `main`.
The review base is `ca2b7938db9bd279c3e8be9cfa03a51f09d29e82`, the production
commit fetched from `origin/main`. A local recovery branch,
`codex/trakt-main-before-release-20261003`, retains that commit.

## Scope and integration

- Full workout overview and full-height prescription editor.
- Compact read-only client calendars with weekly rows and full day details.
- Cache-only background Google authorization and explicit reconnection.
- The existing local workout-deviation persistence commit `7f436bc`.
- Latest main's Picker freshness and sign-in timeout recovery, preserved in
  merge `548d519`. Background requests never start or join a Google dialog.

## Findings fixed before release

1. An own-sheet sync could resume after a coach opened a client while the sync
   awaited IndexedDB or Google. It now rechecks the read-only latch after both
   reads, before merging or capturing a write payload. Regression tests first
   reproduced the unwanted clear/update calls, then passed with no write and
   unchanged own records and merge base.
2. A timed-out Google dialog could answer a later request. Retiring its token
   client makes late callbacks inert; timeout recovery remains available.
3. Applying a template immediately changed an existing card or created a new
   one. It now previews draft lifts until Save; Cancel preserves the card.
4. The client snapshot reader treated a blank workout end as midnight and
   failed to attach sets without a split card. It now preserves unfinished
   sessions, joins unplanned workouts, separates repeated same-day workouts
   by their times, and handles sets logged after midnight.
5. A cardio-only client could display the wrong distance unit. The reader now
   recovers the unit from the cardio sheet column.
6. The service worker was written to the Node build folder during Vercel builds,
   so the deployed `/sw.js` returned 404. Its output now follows the Vercel
   static folder when building for Vercel. Update activation still requires the
   user's Reload tap; the database and its contents are unaffected.
7. The live production check exposed Today rendering the server's date before
   the device's date when their time zones crossed midnight. Reproduced with
   a UTC server and a Pacific browser, it caused React hydration errors. Today
   now renders a stable loading shell until the client supplies its local date.
   Logging continues to use the device's calendar date.

## Data preservation boundaries

The release does not change the IndexedDB schema, migrations, backup version,
sheet format, plan format, Settings backup writer or PWA
update policy. It introduces no database reset or record deletion on upgrade.
The new session fields are optional and use the existing session write path.

Client-calendar snapshots live in a separate memory store. Calendar reads
cannot write a client's sheet, replace the coach's main store, or write their
database. A failed refresh retains the previous snapshot with a visible
warning. Snapshot caches clear on reload; clients' source data remains in
their sheets and on their devices.

Google reconnection keeps the existing sheet and sharing. While authorization
is paused, logging still saves to IndexedDB. No existing user's device storage
or live client sheet was used as a test fixture.

## Deployment security fix

The first push, `79995ce`, was blocked by Vercel before building because the
existing TanStack Start version was vulnerable to CVE-2026-102989. Production
continued serving the previous deployment. The security check was not bypassed.

TanStack Start is now 1.168.60, with start-server-core 1.169.39 and compatible
router/plugin updates. The router error component uses the library's current
props type. Compatible dependency patches also resolve the remaining npm audit
findings; `npm audit` reports zero vulnerabilities. These changes update the
dependency lockfile but do not change application storage formats.

Advisory: https://github.com/TanStack/router/security/advisories/GHSA-qx66-fv34-fjm8

## Verification

- Full Vitest suite: **80 files and 1,219 tests passed**. TypeScript and the
  production build passed after dependency updates. Full ESLint passed with zero errors and four
  existing warnings. Existing Vite test-route/plugin warnings remain.
- Regression coverage includes migrations, backup parsing, persistence,
  read-only latches, coach plans, sync merges, auth and the fixes above.
- Real-browser fixture: two clients, distinct units, all periods, day details,
  retained data on refresh failure, successful retry, and 320/390px layouts.
- The same fixture seeded every durable table and connection metadata,
  including an active workout with exercise order/substitutions, prescriptions,
  nutrition, zero steps, templates and both clients. All tables were identical
  after calendar reads and full reload. Active workout and backup session
  fields survived. No unsolicited popup or JavaScript error remained after
  interacting with the streamed UI before fixture setup. The harness now
  asserts zero JavaScript errors both before and after reload.
- The final Vercel artifact contains the service worker, Workbox runtime and
  all 53 precache entries. Running its built server function and static assets
  locally returned 200 for Today, Plan and Clients. In an isolated browser,
  saved bodyweight, calories and zero steps survived both online and offline
  reload with an active service worker, no JavaScript errors and no popups.
- `scripts/verify-release.mjs` repeats the production browser check in Honolulu
  and Kiritimati, whose local dates differ by a full day. Both pass against the
  built Vercel function with a UTC server, including an assertion that values
  save to the browser's local date. Set `TRAKT_CHECK_URL` to a built app's origin
  and run `node scripts/verify-release.mjs`. It creates fresh isolated browser
  contexts and connects to no Google account or client sheet.
- The two previously approved GPT-6.1-sol reviewers checked standards and spec
  independently, then reviewed the release fixes. No blocking findings remain.

These checks establish compatibility and preservation for the tested paths;
they cannot inspect every user's private device or guarantee against device
storage failure. Physical iPhone, VoiceOver and real-account Google UI behavior
remain device-specific checks. Do not clear site data to install this update.
