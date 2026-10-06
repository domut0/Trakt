# Persistent-session release review — 5 October 2026

Requested outcome: keep Trakt connected to Google across cold launches and access-token
expiry, protect existing users' data, and push directly to main.

Gemini (`gem`, `gemini-3.6-flash-high`) supplied the initial implementation on an
isolated clean branch. Codex reviewed and corrected it, including exact-origin
validation, GIS redirect origin, encrypted challenge expiry, missing-refresh-token
account isolation, transient error handling, disconnect races, and iOS tap activation.

## Verified before release

- 83 test files, 1,260 tests passed.
- TypeScript passed; ESLint had zero errors and the four existing warnings.
- Production Vercel build passed with Node 24 and the service worker in the served output.
- `npm audit`: zero known vulnerabilities.
- Server-only secret names and iron-session were absent from static client assets.
- Google OAuth publishing status: In production. Both server secrets configured in Vercel Production.
- `scripts/verify-persistent-session.mjs` passed against the built server and browser:
  a single deliberately initiated authorization; encrypted HttpOnly cookie;
  silent recovery in a newly opened page; existing spreadsheet reused; all durable
  IndexedDB tables unchanged after reconnect, cold reopen, and offline reload;
  no JavaScript errors or automatic dialogs. Google credentials/data were fictional.
- `scripts/verify-release.mjs` passed Today, Plan, and Clients in Honolulu and Kiritimati,
  including service-worker/offline recovery and daily-value persistence.
- Reconnect failure tests preserve bodyweight, macros, steps (including zero), sets,
  cardio, in-progress session details, client roster, device ID, and merge base.
- Database schema, app storage, merge rules, and backup/sheet formats are unchanged.
  No production records were read, migrated, rewritten, or deleted during this work.

## Operational limits

Existing users reconnect once to establish the new session. Google revocation,
expired/cleared cookies, or encryption-key rotation can require another reconnect.
The encrypted cookie lasts up to 90 days and renews with use. Google Picker may
still request its separate browser session after a deliberate file-selection tap.

Browser tests use a fake Google boundary; they do not prove a real iPhone's Google
consent flow. After rollout, the remaining device acceptance check is one real
reconnect from the Home Screen app followed by reopening and an hour-later sync.
Never clear site data as part of that check.

The prior production commit is `23777668277e38aec0e35f534fbf9fb1b278e6c6`.
Reverting this feature changes authorization behavior only; saved workout and client
records retain the same schema. Keep Google secrets stable across ordinary redeploys.
