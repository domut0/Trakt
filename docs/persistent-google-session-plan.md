# Persistent Google connection

Approved by the user on October 4, 2026: use Gemini to implement, then Codex
reviews, fixes, verifies preservation, and pushes directly to main.

## User experience

Existing users reconnect once to establish a renewable connection. Subsequently
opening or reloading the installed app recovers access silently. Expired access
tokens renew on the server. No automatic Google window. Reconnection is reserved
for a missing/expired connection or revoked Google authorization. Network trouble
remains retryable, and offline logging never depends on authorization.

## Architecture selected by Codex

- Keep `drive.file` as the only requested Google scope and the existing OAuth
  client ID. Use Google's GIS authorization-code popup on an explicit user tap.
  Exchange the code and refresh access on the server. The popup code model uses
  the calling origin as its redirect URI. Use only documented GIS fields.
- Use `iron-session` for a signed/encrypted, HttpOnly, SameSite=Lax persistent
  cookie, Secure on HTTPS. The refresh credential is inside the encrypted cookie;
  only the server can decrypt it. This stateless session needs no new database.
  The short-lived access token remains in browser memory. Neither credential
  belongs in IndexedDB, localStorage, backup JSON, URL parameters or logs.
- New server-only module reached from `src/server.ts` before normal SSR. It must
  not import client stores. Environment names: `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_SESSION_PASSWORD` (random >=32 characters), existing
  `VITE_GOOGLE_CLIENT_ID` (optional server `GOOGLE_CLIENT_ID` override must match).
- Persistent session lifetime: 90 days, renewed on successful token refresh.
  Google revocation or expiry still requires user authorization. Disconnect clears
  this browser's session; it must not revoke the whole Google application grant
  or affect other devices. Document stateless-session revocation boundaries.
- All token/session responses use Cache-Control: no-store. Token POSTs require
  an exact same-origin Origin header, JSON content type and a custom request
  header. Reject cross-origin/null origins and unsupported methods. No CORS.
  Cookies are host-only (no Domain), scoped consistently, and bounded in size.
- Prepare an expiring per-browser OAuth state challenge, bind it to an HttpOnly
  cookie, and validate the code response state before exchanging. Never take
  Google endpoint or redirect URI from arbitrary user input. Only Google's fixed
  token endpoint is called; requests and bodies have size/time limits.
- Support cookie corruption, expiry, missing server configuration, OAuth denial,
  invalid_grant, upstream timeout/429/5xx, code response without refresh token,
  and account changes safely. Never combine an old refresh token with a newly
  authorized account's access token. Missing refresh grant must be explicit.
- Client `getAccessToken` first uses its valid memory cache, then the same-origin
  session endpoint. Only a deliberate interactive call may start GIS. Deduplicate
  refreshes, retain timeouts, reject stale callbacks/results after cache reset or
  disconnect, and keep test injection seams. Preserve legacy token mode if the
  backend explicitly reports unconfigured, for local/older deployments; network
  failures must NOT silently select legacy mode or open a popup.
- Preserve the Picker's separate `freshSession` behavior: Picker may explicitly
  obtain an interactive Google browser session, because backend refresh does not
  repair Google iframe cookies. Routine sync and roster reads must not do this.
- Logout must clear the server cookie as well as memory; an offline logout must
  leave a non-secret pending marker so a later open cannot silently reconnect the
  old grant. Authorization failures must never clear application data.

## Data boundaries

No database migration/schema change, no sheet/backup format changes. Keep existing
sheet IDs, device IDs, coach shares, client records, merge bases, active workouts
and all logged values. Reconnect MUST call the existing reauthorization path,
never create a new spreadsheet. The backend handles credentials only; it does not
receive workout or client-sheet contents. Preserve read-only coach isolation.

## Verification

Server endpoint tests must cover exchange, encrypted cookie round-trip, no token
leakage, refresh success after simulated access expiry, tampered/expired cookies,
cross-origin rejection, invalid_grant, missing refresh token, temporary failures,
logout and configuration failures. Browser auth tests must cover cold-start
recovery without GIS, refresh single-flight, no automatic popup, initial consent,
old callback isolation, revoked consent and offline behavior. Existing sync and
backup tests must keep passing. Browser fixtures compare all durable tables before
and after reconnect/reload and demonstrate that an existing sheet ID is reused.

Update relevant in-app privacy language and setup documentation: the old claims
of no backend, no cookie and memory-only authorization are no longer accurate.
Use existing dark UI, 44px controls and clear reconnect/network/connecting states.
Do not redesign unrelated screens. PRODUCT.md's single-user/no-client claims are
stale; the user's explicit statement that multiple clients use Trakt governs.

References: Google's OAuth web code-model and web-server documentation; the
iron-session project README. Do not replace the architecture without reporting
a specific incompatibility to Codex.
