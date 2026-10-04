# Coach progress calendar

## Approved direction

The user approved the compact **Mini Today** calendar on October 3, 2026. This replaces the earlier Calendar/Counts proposal and its logging-presence indicators.

- Show actual daily bodyweight, calories, protein, carbs, fat and steps, followed by logged workout names/set counts and cardio names/minutes.
- Seven days fit across the phone, with no horizontal scrolling or visible scrollbar.
- One row represents one Monday–Sunday week. Week shows one row; 2 weeks shows the previous and current week; Month adds calendar-week rows, with blank edge cells outside the month.
- Keep the same compact card size across periods. Numbers use 10px type, reduced to 9px on narrow phones, with abbreviated labels/icons at 7–8px. This density is an explicit user-approved exception for this surface, not a new app-wide type scale.
- Missing is a dash; a recorded zero stays zero. There are no adherence scores, goal scores or field-presence counts.
- A coach can scan all clients, select a client for a focused calendar, or tap a day for readable full details.

The approved interactive concept is `trakt-stats-calendar.html` in this chat's visualization directory. Its fictional examples are design references; production UI does not contain demo clients or fabricated numbers.

## Implemented flow

`/clients` appears as a primary tab when coach mode is enabled and the coach is viewing their own app. Configuration and invitations stay in Settings. Existing client-view mode retains its own read-only protections and Today/Plan navigation.

Week / 2 weeks / Month and the anchor date are shared across the roster. Previous/Next controls move a full selected period. Client and day selections live in the route's search state. Returning from a day retains the selected period, restores the roster's vertical position, and focuses the selected day. A client calendar can open the existing client's Trakt/Plan view through a deliberate action.

Full day details show six labeled values with units, every completed workout and cardio entry, actual sets/reps/load/RPE where present, times and notes. The coach cannot edit daily logs from this view. An unfinished strength workout is excluded, matching Today. Multiple training entries have a visible +N indicator. Totals are shown only when every contributing duration/count is known; an unknown duration is not treated as zero.

## Data and authorization

- A separate in-memory store caches read-only client snapshots. Reading the roster does not swap or write the coach's own data, change IndexedDB records, or push to a sheet.
- Reads use the existing Google Sheets transport and snapshot parser, in batches with at most two client reads in flight. Period/client changes reuse those snapshots.
- A successful response records **Fetched** time. This means retrieval time, not the client's last sync time.
- A failed refresh retains useful data with an explicit warning. Loading, unavailable and successfully empty logs remain distinct.
- Day details retain fetched age and offer Refresh alongside the stale-data warning.
- Background reads are cache-only for Google authorization. Only tapping Refresh can obtain a fresh Google token, once before all client reads. Reopening the app clears these in-memory snapshots and can require that deliberate reconnect action.
- Removing or replacing a client invalidates their cached entry; an in-flight response cannot restore it.

## Review and verification

Gemini 3.6 Flash High wrote the bounded calendar/detail display components. Codex owns the data/indexing/cache/auth/navigation implementation and reviewed/fixed the display output. The two approved GPT-6.1-sol reviewers assessed source and screenshots; their required findings about period hit targets and day freshness/recovery were fixed and scored resolved.

Validation completed on October 3, 2026:

- Full suite: 80 files, 1,206 tests passed. Typecheck, scoped ESLint and production build passed.
- Running-app checks at 390px and 320px confirm seven columns without horizontal overflow. Week, 2 weeks and September Month rendered 1, 2 and 5 rows respectively per client.
- A browser fixture went through the real Sheets reader/parser, including workout sets, two cardio entries, missing values, recorded zero and separate client units.
- Day entry/return, period retention and single-client navigation passed. Failed-refresh and day retry recovered while retaining useful figures.
- No coach main-store changes, unsolicited authorization interactions, popups or JavaScript errors occurred in those checks.
- Screenshots are under `screenshots/coach-calendar-*.png`; the local QA fixture script is `screenshots/coach-check.mjs` (gitignored).

Physical iPhone/VoiceOver and a real Google account remain user QA. The earlier design-detector engine was unavailable; these reviews used source and verified captures. Global DESIGN.md and its palette/type defaults remain intact; this is an extension in the incumbent visual system.

## Status

Prepared for the user-authorized direct release to `main` after integrating current production and completing the [release review](release-review-2026-10-03.md). The release also includes the workout overview/editor, workout-deviation persistence and background Google sign-in fixes. The chat records the final pushed commit and deployment result.
