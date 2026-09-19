# Coaching: clients, plans, and no database

Written 2026-09-14. Three phases, in build order: the frictionless Google Sheet,
coach mode, then the invite link.

## Status

Everything that does not need a Google account is built, tested and on
`claude/client-plans-no-database-mq7loc`. What remains is listed in
[`docs/google-setup.md`](google-setup.md) and is roughly half an hour of
console work.

|                   | Built                                               | Waiting on                   |
| ----------------- | --------------------------------------------------- | ---------------------------- |
| A — one-tap sheet | transport, auth, error mapping                      | Cloud project, domain, spike |
| B — coach mode    | latch, plan tab, snapshot, view, edit, save, accept | Picker (needs the API key)   |
| C — invite links  | codec, `/connect`, `/join`                          | the production origin        |

Three things in Phase B are deliberately still open, each because it needs the
A9 spike answered first: adding a client through the Google Picker, opening a
Google-backed client (the store refuses with `not-configured` rather than
failing obscurely), and locking a coached client's own Plan tab.

The Apps Script path works end to end today, so coach mode is usable for a
client onboarded by hand before any of the Google work is done.

## The premise

A coach wants to edit his clients' nutrition, training and step plans from inside
his own Trakt, and wants to look at their logged data while he does it. He does
not want to operate a database holding other people's bodyweight history.

He does not have to, because plans and logs are opposite flows:

|      | Direction       | Size         | Author     | Sensitive |
| ---- | --------------- | ------------ | ---------- | --------- |
| Plan | coach to client | ~2 KB        | the coach  | no        |
| Log  | client to coach | MBs per year | the client | yes       |

The thing that would need protecting is the log, and the client's own Google
account already holds it. The coach holds only plans, which he wrote himself.
So the architecture is unchanged from `PRD.md` §5.1: no accounts, no backend, no
server this project operates. Every client's data lives in a spreadsheet in that
client's Drive, and the coach is a guest on it.

Each client's sheet is the channel in both directions. It is already
authenticated, already synced, and already the app's one network dependency.

---

## Phase A — one tap to a Google Sheet

Today's setup is: make a sheet, open the Apps Script editor, paste a file, run a
test function, click through an unverified-app warning, deploy as a web app
through four dialogs, copy an `/exec` URL, paste it into the app. It needs a
desktop and about ten minutes, and there are five places to get it wrong. No
client will do this.

The replacement: Settings, "Connect Google Sheet", the Google account picker, one
consent screen, and the spreadsheet exists. About twenty seconds, on a phone.

### A1. The scope decision

Ask for `https://www.googleapis.com/auth/drive.file` and nothing else. It means
"files this app created", which is exactly the access needed, and it is a
non-sensitive scope: no security assessment, no verification review, no
unverified-app interstitial in production.

`spreadsheets` and `drive.readonly` are sensitive. They require app verification,
which means a privacy policy, a homepage, a demo video, and weeks of review. The
entire feasibility of this phase rests on never needing them.

Google reclassifies scopes from time to time. Confirm the current requirement in
the Cloud console before building on it.

### A2. Cloud project setup

No code. Done once, by hand.

1. New Google Cloud project.
2. Enable the Sheets API and the Drive API. Drive is needed for the share call in
   Phase C and the Picker in Phase B.
3. OAuth consent screen: External, publishing status **In production**, scopes
   limited to `drive.file`.
4. OAuth client ID, type **Web application**. Authorized JavaScript origins:
   `https://trakt-fit.vercel.app`, plus `http://localhost:8080` (the dev server)
   and `http://localhost:3000` (the spike page).
5. An API key restricted to the Picker API. Phase B needs it; create it now.

Outputs `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY`. Both are public
values that ship in the bundle. Neither is a secret, so `PRD.md`'s "no secrets in
the repo" survives intact — but the project now owns a registered OAuth identity,
which is a small and real departure from "no infrastructure at all". Worth
spending deliberately rather than discovering later.

### A3. The config becomes a union

`SyncConfigMeta` (`db.ts:87`) currently assumes Apps Script. It gains a
discriminant:

```ts
export type SyncConfigMeta =
  | {
      key: "syncConfig";
      kind: "appsScript";
      url: string;
      secret: string;
      deviceId: string;
      enabled: boolean;
      spreadsheetUrl?: string;
    }
  | {
      key: "syncConfig";
      kind: "google";
      spreadsheetId: string;
      deviceId: string;
      enabled: boolean;
      spreadsheetUrl?: string;
    };
```

A stored row with no `kind` reads as `appsScript`, so existing installs need no
migration. `kind` is not indexed, so by the rule `db.ts:33` already states, no
Dexie version bump either.

### A4. `src/lib/google-auth.ts`

Google Identity Services, loaded lazily — only when the user taps Connect or a
sync needs a token, never at boot. The app is offline-first and must not fetch a
third-party script on the path to logging a set.

```ts
getAccessToken({ interactive }: { interactive: boolean }): Promise<string>
```

- Token held **in memory only**, never in Dexie. It is a bearer credential with
  an hour of life, and `db.ts:81` already promises that sync credentials stay out
  of `BackupData`. Keeping the token off disk keeps that promise without a second
  exclusion rule to remember.
- Returns the cached token when it has more than sixty seconds left.
- Otherwise attempts silent renewal via `requestAccessToken({ prompt: "" })`.
- If silent renewal fails and `interactive` is false, rejects with
  `needs-consent`.

`needs-consent` joins `SyncErrorCode` (`sync-client.ts:39`) and maps to the
existing `blocked` status, which is exactly right: retrying cannot help, the user
must act. The `blockedReason` machinery (`sync-store.ts:71`) renders it already.

**Token expiry is this phase's one regression.** The Apps Script URL and secret
work forever; an OAuth token does not, and the browser token model issues no
refresh token. Silent renewal works while the user has a live Google session, and
is unreliable in an iOS PWA. Sync will occasionally need a "Reconnect Google"
tap. This is tolerable only because `PRD.md` §5.1 already guarantees logging never
waits on sync — an expired token pauses the mirror, it does not touch the app.

### A5. `src/lib/sync-client-google.ts`

Mirrors the surface of `sync-client.ts`, which already declares itself the only
module in the app that makes a network request. That comment stays true: the new
file is the second half of the same seam, not a new one.

| Operation | Call                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------- |
| Create    | `POST /v4/spreadsheets` with every tab in the request body                                                |
| Pull      | `GET /v4/spreadsheets/{id}/values:batchGet` with one range per tab, `valueRenderOption=UNFORMATTED_VALUE` |
| Push      | `POST .../values:batchClear`, then `POST .../values:batchUpdate`                                          |

Three things get better. `Authorization: Bearer` replaces the `text/plain`
CORS workaround at `sync-client.ts:89`. Real HTTP status codes replace the
"cannot branch on status because of the redirect chain" guessing at
`sync-client.ts:106`. And one `spreadsheets.create` call produces the file and
all of its tabs, so there is no first-run tab-creation dance.

Status mapping, table-driven and tested: 401 to `needs-consent`, 403 to
`blocked`, 429 and 5xx to a retryable `error`, transport failure to `network`.

Push is two calls because `batchUpdate` does not shrink a range — a rewrite that
produced fewer rows would leave the tail of the old data behind. Clear then
write. The pair is not atomic; see A6.

### A6. What the Apps Script did that the browser must now do

**The `_sync` tab** carries the revision and the owning device id. Keep it, and
keep the semantics identical, so both transports produce a sheet that looks the
same and the merge in `sync.ts` cannot tell them apart. The client now does the
read-modify-write itself.

**`LockService` is gone**, and nothing replaces it. Two writers can interleave
between the clear and the update. This is an accepted loss: "one sheet, one
device" is already the rule (`google-apps-script/README.md`), the `expectedRevision`
check still catches the case it was written for, and the exposure is a wider race
window on a rule that already forbids the race. Named here so it is a decision
rather than an oversight.

### A7. Dispatch, and the UI

`sync-store.ts` splits `connect()` into `connectAppsScript(url, secret)` — the
existing flow, unchanged — and `connectGoogle()`: get a token, create the
spreadsheet, save the config, force the first push. `syncNow()` branches on
`config.kind` to pick a transport.

**Nothing in `sync.ts` moves.** The three-way merge, the base snapshot, the
collision rules and every test over them are transport-agnostic and stay exactly
as they are. That is the whole reason this phase is tractable.

Settings' "Google sheet" section gets **Connect Google Sheet** as the primary
action and collapses the Apps Script flow under **Advanced**. When
`blockedReason === "needs-consent"`, it shows Reconnect.

### A8. Tests

- Status-to-`SyncErrorCode` mapping, table-driven.
- Token cache and expiry logic against a fake clock, no network.
- The new client gets the same injectable-fetch seam as `setSyncFetch`
  (`sync-client.ts:66`), so `src/test/setup.ts`'s throwing default keeps a test
  that forgets a stub from reaching the real network.

**Phase A ships when** a client installs the PWA, taps one button, consents once,
and has a syncing spreadsheet. No coaching exists yet.

### A9. Spike, during Phase A

Before Phase B is designed in code, verify with a throwaway page that selecting a
**shared** spreadsheet through the Google Picker grants the app `drive.file`
access to it. Phase B's entire read path depends on this. If it does not hold,
coach read needs `spreadsheets.readonly`, that is a sensitive scope, and Phase B
needs a different design. Half a day now against a rewrite later.

---

## Phase B — coach mode

The flow being built: open Trakt, Settings, Coach mode, tap Bob. A bar reads
**Bob's Trakt**. The usual tabs are still there; Workout is disabled and Today is
read-only. Charts and History show Bob's data. The Plan tab is editable, and
editing it raises a **Save changes** button that pushes the new plan to Bob.

### B1. The `safeWrite` latch, first

Every store action writes through to IndexedDB — 33 `safeWrite` calls in
`store.ts`. Load Bob's data into `useStore` and any action that slips past a
disabled control writes **Bob's data into the coach's own database**. Not a
crash. A slow corruption of the coach's own training history, noticed weeks later.

`safeWrite` (`db.ts:562`) is the single chokepoint for every Dexie write in the
app. One latch there, in the same shape as the existing `setWriteErrorHandler`
seam:

```ts
let readOnlyReason: string | undefined;
export function setDbReadOnly(reason: string | undefined): void {
  readOnlyReason = reason;
}

export function safeWrite(op: () => Promise<unknown>): void {
  if (readOnlyReason) return;
  // ...unchanged
}
```

Disabling the UI is cosmetics. This is the guarantee, and it has to exist before
the screen that needs it. Test it by running every mutating action with the latch
on and asserting Dexie is untouched.

### B2. The `plan` tab

The sheet carries `sets`, `sessions`, `daily` and `cardio` (`sync.ts:188`).
`NutritionPhase[]`, `SplitSlot[]` and `PlannedDay[]` never leave the device — so
today there is nothing to read a client's plan from and nowhere to write a new
one. This tab is the phase's central design decision.

One tab, heterogeneous rows, discriminated by `Kind`. Three shapes across a few
dozen rows do not justify three tabs and three times the plumbing.

| Kind  | Key        | Name                 | Starts On  | Calories | Protein | Carbs | Fat | Steps | Order | Card Kind | Exercises                    |
| ----- | ---------- | -------------------- | ---------- | -------- | ------- | ----- | --- | ----- | ----- | --------- | ---------------------------- |
| phase | `ph_1`     | Cut                  | 2026-09-20 | 3000     | 200     | 300   | 80  | 24000 |       |           |                              |
| card  | `sl_1`     | Upper                |            |          |         |       |     |       | 0     | workout   | `Bench Press \| Barbell Row` |
| pin   | 2026-09-22 | Upper                |            |          |         |       |     |       |       |           |                              |
| meta  | issuedBy   | coach                |            |          |         |       |     |       |       |           |                              |
| meta  | issuedAt   | 2026-09-14T10:04:00Z |            |          |         |       |     |       |       |           |                              |

**Exercises travel as names, pipe-delimited, never as ids.** `plannedExerciseIds`
holds ids from the authoring device's `exercises` table, which mean nothing
anywhere else. On accept, the client resolves each name case-insensitively
against its own exercises, then against `seedExercises`, and creates one only if
both miss.

**The two `meta` rows are the whole conflict rule.** `issuedBy` is `coach` or
`client`; `issuedAt` is an ISO instant. A plan is applied only when `issuedBy` is
`coach` and `issuedAt` is newer than the last one accepted, which is what stops
a stale plan — an old link, a slow sync — from overwriting a newer one.

Both sides write this tab. The client pushes its current plan on every ordinary
sync, so the coach has something to read. The coach writes a replacement.

Add to `SHEET_TABS` (`sync.ts:47`), to `APP_TABS` in `sync.gs:19`, and to the
Google transport's range list. `SYNC_FORMAT_VERSION` to 3, `SCRIPT_VERSION` to 4.

### B3. `src/lib/plan-tab.ts`

`buildPlanTab(source): CellValue[][]` and `parsePlanTab(rows): ParsedPlan | undefined`.
Both pure, both fully tested without a network or a database — the same division
`sync.ts` already draws and states its reasons for at the top of the file. Reuses
`ColumnSpec` and `toRows` from `csv.ts` where the shape fits.

Parsing validates hard and refuses the whole tab on anything malformed, in the
spirit of `parseBackup` (`store.ts:891`): a partially applied plan would leave
the client believing they were following something they are not.

### B4. Client connections

A new Dexie table, and therefore a genuine `version(7)` bump:

```ts
coachClients: {
  id: string;
  name: string;
  kind: "google" | "appsScript";
  spreadsheetId?: string;   // google
  url?: string; secret?: string;  // appsScript
  lastPulledAt?: number;
}
```

Pointers only. No client health data is stored on the coach's device — it is
pulled into memory when viewing and dropped on exit.

Under `drive.file` the coach's app cannot touch a sheet it did not create, so
**adding a client goes through the Google Picker**: Bob shares his sheet with the
coach in Drive, the coach taps Add client, picks it, and the app now holds
`drive.file` access to that one file. This is the mechanism that keeps coach mode
on a non-sensitive scope, and A9 is where it gets verified.

### B5. Viewing as a client

On the main store: `viewingClient?: { id: string; name: string; pulledAt: number }`.

`enterClientView(clientId)`:

1. `setDbReadOnly("viewing " + name)` — the guarantee, before anything else.
2. Snapshot the coach's own in-memory arrays. They are replaced immutably on
   every action (`sync.ts:135`), so this is a handful of references.
3. Pull the client's tabs and parse them into the same arrays `hydrate()` fills.
4. `set({ ...clientArrays, viewingClient })`.

`exitClientView()` restores the snapshot and clears the latch.

**No selectors change.** Every tab reads `useStore((s) => s.sets)` and friends, so
swapping the arrays swaps the whole app. Today, Charts and History become Bob's
for nothing.

One thing needs synthesising: the sheet has no `exercises` tab. Set and cardio
rows carry exercise _names_, because `csv.ts:100` denormalises them for
readability. So the coach view must build an `Exercise[]` from the distinct names
in the pulled rows, with stable synthetic ids, or every set in History renders
"Unknown".

### B6. The screen

- **Settings**: a Coach mode toggle, then the client list — name and last-synced
  per row, Add via Picker.
- **`ClientBanner`**, modelled directly on `ActiveSessionBanner`
  (`AppShell.tsx:117`): fixed, top, `z-40`, `bg-accent`, reading
  `Bob's Trakt · synced 2h ago`, with an exit control. AppShell's existing
  `showBanner` and `pt-11` reservation extend to cover it. The two banners are
  naturally exclusive — there is no active session in coach view — but assert it
  rather than assuming it.
- **`BottomNav`**: the centre Workout button disabled under `viewingClient`.
  `aria-disabled`, muted fill, no navigation.
- **Today**: inputs disabled. The latch already makes it safe; disabling makes it
  honest.
- **Plan**: editable, writing to a `planDraft` slice seeded from the pulled plan
  — never to the store arrays, which are Bob's snapshot.
- **`SaveChangesBar`**: floats at `z-40` above `BottomNav`, which is `z-30` with
  its own safe-area padding. Visible only when the draft differs from what was
  pulled.

**The timestamp in the banner is not decoration.** The coach is about to make
programming decisions from data that is as fresh as the client's last sync.

### B7. Save, and accept

Coach taps Save. `buildPlanTab(draft)` with `issuedBy: "coach"` and
`issuedAt: now`, written to the `plan` tab only — no revision bump, no device
check. On the Google transport that is a `values.update` on one range; on Apps
Script it needs a new `putPlan` action in `sync.gs` that writes `plan` and skips
both the device lock at `sync.gs:85` and the revision bump.

On the client, the next ordinary sync pulls `plan`, sees a coach-issued plan
newer than the last accepted, and raises **New plan from your coach**. The review
screen shows a diff — _Calories 2400 to 2200, steps 8k to 10k, Push day gains
incline DB press_ — and Accept applies it through the existing store actions, so
the write path and its IndexedDB write-through stay the only ones in the app.
This is the preview-then-confirm pattern the backup import in `settings.tsx`
already uses; copy it rather than inventing a second one.

### B8. Who owns the plan while coached

A coached client's Plan tab locks, showing "Your coach manages your plan", with
an unlink escape hatch.

Not a merge. Both sides can write the tab, and a three-way merge over a plan is a
conflict matrix nobody would remember the rules of. `sync.ts` chose a base
snapshot over per-record timestamps for the same reason — take the simpler thing
that is correct. A lock is honest: the client has a coach now.

### B9. Tests

- `plan-tab` round-trip, including a plan with no phases and a card with no
  exercises.
- Exercise name resolution: exact match, case difference, seed-library match,
  creation.
- A stale `issuedAt` is refused.
- The read-only latch, over every mutating action.
- Enter and exit client view restores the coach's own arrays exactly.

---

## Phase C — the invite link

One link, sent over whatever the coach already texts clients on, that takes
someone from nothing to a syncing, coach-connected Trakt.

### C1. `/join`

```
https://trakt.app/join#<payload>
```

The payload goes in the **fragment**, never the query string: a fragment is not
sent to a server and never lands in an access log. It carries
`{ coachName, coachEmail, clientName, v }` — and deliberately no credential. In
the Google-transport world there is nothing to hand over, because the client's
sheet does not exist yet and they will create it themselves. The link pre-names
the client and scripts the sequence; it does not transfer access.

### C2. What the link drives

1. **"Marcus invited you to Trakt"** — install the PWA, via
   `beforeinstallprompt` where it fires, or the Add to Home Screen instructions
   on iOS.
2. **Connect your Google Sheet** — the Phase A flow, one tap.
3. **Share it with your coach** — `drive.file` includes permission changes on
   files the app created, so the app can add `coachEmail` as a reader on the
   sheet it just made. One tap, no Drive UI. Verify this during the A9 spike,
   alongside the Picker.
4. Done. The coach adds them through the Picker on his end.

### C3. Keep `/connect` for the old transport

`trakt.app/connect#url=…&secret=…` prefills an Apps Script connection, for the
hand-built installs and anyone already on that path. **This is also the thing
worth building in a spare hour if onboarding gets urgent before Phase A lands**:
the coach runs the Apps Script setup himself for the first few clients, five
minutes each on a desktop, and hands each of them a QR code. They tap once,
having never seen the Apps Script editor.

### C4. Tests

- Payload encode/decode round-trip.
- A truncated or malformed fragment renders an error state, never a
  half-configured app.
- `/join` is inert when the app already has a connection.

---

## Risks

**Token expiry** (A4) is the one user-visible regression, and it is permanent.
Accepted because sync is already best-effort.

**Picker granting `drive.file` on a shared file** (A9) is load-bearing for all of
Phase B. Spike it during Phase A. If it fails, coach read needs a sensitive scope
and Phase B needs redesigning.

**Losing `LockService`** (A6) widens a race that the one-device rule already
forbids. Accepted.

**Staleness**: the coach programs from last-synced data. Mitigated by putting the
timestamp in the banner, not by pretending it is live.

**`SYNC_FORMAT_VERSION` 3** must land in both transports at once, or a sheet
written by one is unreadable by the other.

## Sequencing

Phase A is independently useful: it fixes onboarding for the coach's own use and
for anyone he onboards by hand, and it ships before a single line of coaching
code exists. Phase B's first three steps — the latch, the `plan` tab, the client
connections — are worth doing as a unit, because at the end of them the coach can
read every client's data from his own phone, which is most of the value, and
nothing has been written to anyone's sheet yet. Phase C is polish on a flow that
already works.
