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
 * The browser token model issues no refresh token. Silent renewal works while
 * the user has a live Google session and is unreliable in an iOS PWA, so sync
 * will occasionally need a tap to reconnect. That is survivable only because
 * logging never waits on sync: an expired token pauses the mirror, it does not
 * touch the app.
 */

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const GIS_SRC = "https://accounts.google.com/gsi/client";

/** Renew this long before expiry, so a sync cannot start on a token that dies mid-flight. */
const RENEW_MARGIN_MS = 60_000;

export type AuthFailure = "needs-consent" | "no-client-id" | "script-blocked";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
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

/** A seam, matching `setSyncFetch`. Tests install a fake rather than a global stub. */
type TokenSource = (interactive: boolean) => Promise<string>;
let tokenSourceImpl: TokenSource | undefined;

export function setGoogleTokenSource(fn: TokenSource | undefined): void {
  tokenSourceImpl = fn;
  cached = undefined;
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
 * Never at boot. This app is offline-first and nothing on the path to logging a
 * set may wait on a third-party script.
 */
function loadGis(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("script-blocked"));
    if (window.google?.accounts?.oauth2) return resolve();
    const el = document.createElement("script");
    el.src = GIS_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
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
 * `interactive: false` is what every background sync passes: it will renew
 * silently if it can and fail with `needs-consent` if it cannot, rather than
 * throwing a Google popup at someone mid-workout. Only a Settings tap passes
 * true.
 */
export async function getAccessToken({ interactive }: { interactive: boolean }): Promise<string> {
  if (tokenSourceImpl) return tokenSourceImpl(interactive);

  if (cached && cached.expiresAt - RENEW_MARGIN_MS > Date.now()) return cached.token;

  const clientId = googleClientId();
  if (!clientId) throw new Error("no-client-id" satisfies AuthFailure);

  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("script-blocked" satisfies AuthFailure);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_FILE_SCOPE,
      callback: (response) => {
        const token = response.access_token;
        if (response.error || !token) {
          return finish(() => reject(new Error("needs-consent" satisfies AuthFailure)));
        }
        cached = { token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 };
        finish(() => resolve(token));
      },
      // Fires when the popup is closed or blocked, which the success callback
      // never reports -- without it an interactive request hangs forever.
      error_callback: () => {
        finish(() => reject(new Error("needs-consent" satisfies AuthFailure)));
      },
    });

    // An empty prompt asks Google to renew without showing anything, and fails
    // when consent is actually needed -- which is exactly right for a
    // background sync, since throwing a Google popup at someone mid-workout is
    // not a thing this app does. A deliberate tap passes no override, so the
    // account picker and consent screen appear when they have to.
    client.requestAccessToken(interactive ? undefined : { prompt: "" });
  });
}
