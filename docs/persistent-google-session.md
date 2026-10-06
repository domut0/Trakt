# Persistent Google sessions

Trakt uses Google's GIS popup authorization-code flow on a deliberate user tap.
The server exchanges that code and renews expired access. Existing installations
reconnect once after this rollout; normal cold launches do not open Google.

## Configuration

Production needs the existing public `VITE_GOOGLE_CLIENT_ID` and Picker API key,
plus server-only `GOOGLE_CLIENT_SECRET` for that same client and
`GOOGLE_SESSION_PASSWORD` (cryptographically random, at least 32 characters).
Neither secret may use a `VITE_` prefix. Keep the encryption password stable.
OAuth origins must include the actual app origin, `https://trakt-fit.vercel.app`.
The GIS popup exchange uses that origin as redirect URI, not `postmessage`.
Publish the Google OAuth application to Production; Google's Testing mode can
expire refresh grants after seven days.

With both server secrets absent, local development explicitly offers the legacy
interactive token mode. Partial configuration, network errors, and upstream
failures never silently select that fallback.

## Storage and security boundaries

- Only `drive.file` is requested. No new Google permission or database schema.
- Access tokens live in browser memory. Refresh credentials live inside an
  iron-session encrypted and authenticated HttpOnly cookie. Only the server can
  decrypt it. No token is put into IndexedDB, localStorage, URLs, or backups.
- The host-only cookie is Secure on HTTPS, SameSite=Lax, and scoped to
  `/api/session`. It expires after 90 days, renewed on successful refresh.
- All four session routes accept POST only and enforce exact Origin, JSON, and
  `X-Trakt-Client: 1`. Every response is no-store. The service worker excludes API
  navigation. The OAuth challenge is encrypted, browser-bound, and expires after
  ten minutes; the server checks its expiration independently of cookie expiry.
- Only the fixed Google token endpoint receives credentials. Bodies and waits
  are bounded. Session routes never receive workout logs or spreadsheet data.
- A new code lacking a refresh credential is rejected; a previous account's
  refresh credential is never attached to the new account's access token.
- Google `invalid_grant` requires reconnection. Temporary failures and server
  configuration errors retain the cookie and remain retryable.
- Disconnect clears this browser's cookie and cache, not Google's global grant.
  A non-secret localStorage logout marker blocks recovery even after an offline
  disconnect or a late response. It is cleared by a completed deliberate sign-in.
- Sessions are stateless: there is no per-session central revocation list. Removing
  Trakt from Google revokes authorization everywhere. Rotating the encryption
  password invalidates all browser sessions. Neither action deletes fitness data.
- Google Picker may still open a first-party Google window after a user chooses
  to add a client, because its iframe also needs Google browser cookies. A
  Picker-only token never replaces the server-backed token used for normal sync.

## Data preservation

Reconnect uses `reauthorize`, never `connectGoogle` or `createSpreadsheet`.
Existing spreadsheet IDs, device IDs, shares, merge bases, coach records, active
workouts, and all logged data retain their existing formats. No migration or
production data rewrite runs during deployment. Offline logging still works.

## Verification

Run `npm run typecheck`, `npm test`, `npm run lint`, and a production Vercel build.
Session tests cover encrypted round trips, expiry, exact-origin rejection,
malformed input, account changes, network errors, revocation, and disconnect
races. Data-preservation fixtures compare all durable tables around reconnect.
The browser release checks use isolated fictional records, never live client data.

Real-device acceptance: after updating the installed iOS app, reconnect once,
close and reopen it, then try again after an hour. Sync should recover without
another Google dialog. Test an offline entry followed by reconnection. Do not
clear site data to troubleshoot; export a backup first if a reset is ever needed.

References: [Google code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model),
[GIS API reference](https://developers.google.com/identity/oauth2/web/reference/js-reference),
[iron-session](https://github.com/vvo/iron-session).
