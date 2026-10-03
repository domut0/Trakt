/**
 * Google sign-in for the Sheets transport.
 *
 * ## One scope, and why it is the whole design
 *
 * `drive.file` means "files this app created". It is a NON-SENSITIVE scope, so
 * it needs no verification review, no privacy policy, and shows no unverified-
 * app warning in production. `spreadsheets` or `drive.readonly` would give
 * broader access and cost weeks of review, so nothing here may ever ask for
 * them. A client's setup being one tap rests entirely on this line.
 *
 * ## The token never touches disk
 *
 * It is a bearer credential with about an hour of life. db.ts already promises
 * that sync credentials stay out of `BackupData` so that sharing a backup does
 * not hand over the sheet; keeping the token in memory only keeps that promise
 * without a second exclusion rule for someone to forget.
 *
 * ## The regression worth knowing about
 *
 * The browser token model issues no refresh token. Obtaining a fresh token uses
 * a Google dialog, even with an empty prompt, so an expired token needs a
 * deliberate tap to reconnect. That is survivable only because
 * logging never waits on sync: an expired token pauses the mirror, it does not
 * touch the app.
 */

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const GIS_SRC = "https://accounts.google.com/gsi/client";

/** Renew this long before expiry, so a sync cannot start on a token that dies mid-flight. */
const RENEW_MARGIN_MS = 60_000;

/**
 * Nothing here may hang forever.
 *
 * `syncNow` holds a single-flight `running` flag for the length of a cycle, so
 * a promise that never settles does not merely fail -- it wedges sync for the
 * rest of the session, silently, with the UI still reading "syncing". Google
 * Identity Services is a third-party script that can be blocked by an
 * extension, stalled by a captive portal, or loaded into a tab that is then
 * backgrounded, and in none of those cases is either callback guaranteed.
 */
const GIS_LOAD_TIMEOUT_MS = 15_000;

/** An interactive request waits on a human, but must still settle. */
const INTERACTIVE_TOKEN_TIMEOUT_MS = 120_000;

/** Rejects with `reason` if `promise` has not settled in time. */
export function withTimeout<T>(promise: Promise<T>, ms: number, reason: AuthFailure): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(reason)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export type AuthFailure =
  "needs-consent" | "no-client-id" | "script-blocked" | "popup-blocked" | "timeout";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

/** What the caller of an in-flight `requestAccessToken` is waiting on. */
interface Pending {
  resolve: (token: string) => void;
  reject: (err: Error) => void;
}

interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string }) => void;
      }) => TokenClient;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

let cached: { token: string; expiresAt: number } | undefined;
let scriptPromise: Promise<void> | undefined;

/**
 * The token client, built once and kept.
 *
 * THIS IS THE FIX FOR "IT TAKES THREE TAPS". `requestAccessToken` opens a
 * popup, and a browser only allows that while the page holds transient user
 * activation - roughly five seconds from the tap that caused it. Building the
 * client meant loading accounts.google.com/gsi/client first, and on a phone on
 * mobile data that load routinely outlives the activation, so the popup was
 * blocked before it ever appeared. GIS reports a blocked popup through the same
 * error callback as a closed one, so it read as "the user declined" and the
 * only cure on offer was tapping again - by which time the script was cached
 * and it worked.
 *
 * So the script and the client are built AHEAD of the tap, by `warmGoogleAuth`,
 * and the tap itself does nothing but call `requestAccessToken`.
 */
let tokenClient: TokenClient | undefined;

/** The request the shared client's callbacks belong to, if any. */
let pending: Pending | undefined;

/** The request in flight, so two callers never race the one set of callbacks. */
let inflight: Promise<string> | undefined;

/** A seam, matching `setSyncFetch`. Tests install a fake rather than a global stub. */
type TokenSource = (interactive: boolean) => Promise<string>;
let tokenSourceImpl: TokenSource | undefined;

export function setGoogleTokenSource(fn: TokenSource | undefined): void {
  tokenSourceImpl = fn;
  cached = undefined;
  tokenClient = undefined;
  pending = undefined;
  inflight = undefined;
}

export function clearGoogleToken(): void {
  cached = undefined;
}

/** The configured OAuth client id, or undefined when this build has none. */
export function googleClientId(): string | undefined {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  return id && id.length > 0 ? id : undefined;
}

/**
 * Loads Google Identity Services, once, and only when it is actually needed.
 *
 * Sign-in surfaces may warm it ahead of a tap. Nothing on the path to logging
 * a set may wait on this third-party script.
 */
function loadGis(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("script-blocked"));
    if (window.google?.accounts?.oauth2) return resolve();
    const timer = setTimeout(() => {
      // Let a later attempt start fresh rather than awaiting a promise that is
      // never going to settle.
      scriptPromise = undefined;
      reject(new Error("script-blocked" satisfies AuthFailure));
    }, GIS_LOAD_TIMEOUT_MS);

    const el = document.createElement("script");
    el.src = GIS_SRC;
    el.async = true;
    el.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    el.onerror = () => {
      clearTimeout(timer);
      // Let a later attempt retry: a blocked script is often a network blip or
      // a content blocker the user can turn off, not a permanent state.
      scriptPromise = undefined;
      reject(new Error("script-blocked"));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/**
 * An access token, from cache where possible.
 *
 * `interactive: false` is what every background sync passes: it may
 * only use an existing token and fail with `needs-consent` otherwise.
 * Google's token flow opens a dialog even with an empty prompt, so only a
 * deliberate sign-in tap may obtain a fresh token.
 */
export async function getAccessToken({ interactive }: { interactive: boolean }): Promise<string> {
  if (tokenSourceImpl) return tokenSourceImpl(interactive);

  if (cached && cached.expiresAt - RENEW_MARGIN_MS > Date.now()) return cached.token;

  const clientId = googleClientId();
  if (!clientId) throw new Error("no-client-id" satisfies AuthFailure);

  // Cache-only: background sync must never invoke the Google dialog API.
  if (!interactive) throw new Error("needs-consent" satisfies AuthFailure);

  await withTimeout(loadGis(), GIS_LOAD_TIMEOUT_MS, "script-blocked");

  const client = ensureTokenClient(clientId);
  if (!client) throw new Error("script-blocked" satisfies AuthFailure);

  const timeout = INTERACTIVE_TOKEN_TIMEOUT_MS;

  try {
    return await withTimeout(requestToken(client), timeout, "timeout");
  } catch (err) {
    // One retry, and only for the one failure a retry can actually fix. The
    // first attempt may have spent its user activation loading the script; by
    // now everything is in memory and the window opens on the spot. A decline
    // is not retried - asking twice is the app arguing with an answer.
    const blocked = err instanceof Error && err.message === "popup-blocked";
    if (!blocked || !interactive) throw err;
    return withTimeout(requestToken(client), timeout, "timeout");
  }
}

/**
 * Loads the script and builds the token client before anyone taps anything.
 *
 * Call it wherever sign-in is about to be offered, including Settings and the
 * paused-sync notice. Warming never requests a token or opens a dialog, and
 * logging never waits for it.
 *
 * Deliberately returns nothing and throws nothing. A failure here costs the
 * warm start and no more; the real attempt reports for itself.
 */
export function warmGoogleAuth(): void {
  if (tokenSourceImpl) return;
  const clientId = googleClientId();
  if (!clientId) return;
  if (tokenClient) return;
  void loadGis()
    .then(() => {
      ensureTokenClient(clientId);
    })
    .catch(() => {
      // See above: warming is best-effort by design.
    });
}

/**
 * The one token client, built on first use and kept for the page's life.
 *
 * Its two callbacks are fixed at construction, so they answer whichever request
 * is in flight rather than closing over one -- which is what `pending` is.
 */
function ensureTokenClient(clientId: string): TokenClient | undefined {
  if (tokenClient) return tokenClient;
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) return undefined;

  tokenClient = oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_FILE_SCOPE,
    callback: (response) => {
      const waiting = pending;
      pending = undefined;
      if (!waiting) return;
      const token = response.access_token;
      if (response.error || !token) {
        waiting.reject(new Error("needs-consent" satisfies AuthFailure));
        return;
      }
      cached = { token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 };
      waiting.resolve(token);
    },
    // Fires when the popup is closed or blocked, which the success callback
    // never reports -- without it an interactive request hangs forever.
    error_callback: (error) => {
      const waiting = pending;
      pending = undefined;
      if (!waiting) return;
      // A window the browser refused to open is not a person deciding not to
      // sign in, and the two used to arrive here as the same error. Only one of
      // them is worth retrying, and only one of them is the user's fault.
      const blocked = error?.type === "popup_failed_to_open";
      waiting.reject(
        new Error((blocked ? "popup-blocked" : "needs-consent") satisfies AuthFailure),
      );
    },
  });
  return tokenClient;
}

/**
 * One request at a time.
 *
 * The client's callbacks are shared, so two overlapping requests would both be
 * answered by whichever one the callback happened to find. A second caller gets
 * the first one's promise, which is the answer it was going to get anyway.
 */
function requestToken(client: TokenClient): Promise<string> {
  if (inflight) return inflight;

  const request = new Promise<string>((resolve, reject) => {
    pending = { resolve, reject };
    try {
      // Every fresh token uses Google's dialog flow. Background requests are
      // rejected before this point; this path follows a deliberate sign-in tap.
      client.requestAccessToken();
    } catch {
      pending = undefined;
      reject(new Error("popup-blocked" satisfies AuthFailure));
    }
  }).finally(() => {
    inflight = undefined;
    pending = undefined;
  });

  inflight = request;
  return request;
}
