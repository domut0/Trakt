import { getAccessToken, googleClientId, withTimeout } from "./google-auth";

/**
 * The Google Picker, which is how a coach gets at a client's sheet.
 *
 * ## Why a Picker at all
 *
 * `drive.file` only reaches files this app created -- and a client's sheet was
 * created by the client's copy of the app, not the coach's. What bridges that
 * is Google's rule that a file the user picks in the Picker is granted to the
 * app that showed it. The spike (scripts/google-spike.html, check 4) confirmed
 * the grant covers a sheet another account created and shared.
 *
 * ## The one line the grant depends on
 *
 * `setAppId` must name this app's Cloud project, or the Picker hands back an id
 * with no grant attached and the first read is a 404. The project number is the
 * leading segment of the OAuth client id, so it is derived rather than being a
 * third value to configure. The spike failed check 4 without it.
 *
 * Like GIS, the script loads only when a coach taps, never at boot.
 *
 * ## The Picker does not run on the token alone
 *
 * Everything else here reaches Google with a Bearer header and nothing else.
 * The Picker does not: it draws an iframe from `docs.google.com` that
 * authenticates with the user's Google COOKIES. On WebKit -- so every browser
 * on iOS, not just Safari -- those cookies are partitioned away from the frame
 * unless the storage-access grant is live, and that grant lapses on the order
 * of a day.
 *
 * When it has lapsed the Picker does not say so. It asks for cookie access,
 * and then reports whatever it could not do as "The API developer key is
 * invalid" -- from inside its own iframe, where no callback of ours can see
 * it. That message has sent more than one person to the Cloud Console after a
 * key that was never wrong.
 *
 * What puts the cookies back is an interactive sign-in: it opens
 * accounts.google.com as a FIRST-PARTY window. So `pickSharedSpreadsheet`
 * refuses to open the Picker on a cached credential old enough that the
 * session behind it may already be gone -- see `freshSession` in google-auth.
 */

const GAPI_SRC = "https://apis.google.com/js/api.js";

/** Same budget as the GIS script: long enough for a slow network, short enough to fail visibly. */
const LOAD_TIMEOUT_MS = 15_000;

export type PickFailure =
  | "no-api-key"
  | "no-client-id"
  | "needs-consent"
  | "script-blocked"
  | "bad-api-key"
  | "popup-blocked"
  | "timeout";

type PickerFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let pickerFetchImpl: PickerFetch | undefined;

/** A seam, matching `setGoogleTokenSource`. Tests install a fake rather than a global stub. */
export function setPickerFetch(fn: PickerFetch | undefined): void {
  pickerFetchImpl = fn;
}

export interface PickedSheet {
  id: string;
  name: string;
}

interface PickerDoc {
  id: string;
  name?: string;
}

interface PickerResult {
  action: string;
  docs?: PickerDoc[];
}

interface PickerBuilder {
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  addView(view: unknown): PickerBuilder;
  setCallback(fn: (result: PickerResult) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface PickerApi {
  DocsView: new (viewId: string) => {
    setIncludeFolders(v: boolean): unknown;
    setOwnedByMe(v: boolean): unknown;
  };
  ViewId: { SPREADSHEETS: string };
  PickerBuilder: new () => PickerBuilder;
  Action: { PICKED: string; CANCEL: string };
}

interface Gapi {
  load(name: string, config: { callback: () => void; onerror: () => void }): void;
}

/** Read through a cast: `window.google` is typed by google-auth.ts for GIS alone. */
function pickerApi(): PickerApi | undefined {
  return (window as unknown as { google?: { picker?: PickerApi } }).google?.picker;
}

function gapi(): Gapi | undefined {
  return (window as unknown as { gapi?: Gapi }).gapi;
}

export function googleApiKey(): string | undefined {
  const key = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
  return key && key.length > 0 ? key : undefined;
}

/** Whether this build can offer the Picker at all. */
export function pickerAvailable(): boolean {
  return googleClientId() !== undefined && googleApiKey() !== undefined;
}

let gapiPromise: Promise<void> | undefined;

function loadGapi(): Promise<void> {
  if (gapiPromise) return gapiPromise;
  gapiPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("script-blocked"));
    if (gapi()) return resolve();
    const el = document.createElement("script");
    el.src = GAPI_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      // A blocked script is often a content blocker the user can turn off, so a
      // later tap starts fresh.
      gapiPromise = undefined;
      reject(new Error("script-blocked"));
    };
    document.head.appendChild(el);
  });
  return gapiPromise;
}

async function loadPicker(): Promise<PickerApi> {
  try {
    await withTimeout(loadGapi(), LOAD_TIMEOUT_MS, "script-blocked");
    const loader = gapi();
    if (!loader) throw new Error("script-blocked");
    if (!pickerApi()) {
      await withTimeout(
        new Promise<void>((resolve, reject) =>
          loader.load("picker", { callback: resolve, onerror: () => reject(new Error("x")) }),
        ),
        LOAD_TIMEOUT_MS,
        "script-blocked",
      );
    }
  } catch {
    // Including a load that timed out without ever settling: the next tap
    // retries rather than awaiting the same dead promise.
    gapiPromise = undefined;
    throw new Error("script-blocked" satisfies PickFailure);
  }
  const api = pickerApi();
  if (!api) throw new Error("script-blocked" satisfies PickFailure);
  return api;
}

const PREFLIGHT_TIMEOUT_MS = 5_000;

/**
 * Asks Google whether it will accept this build's API key, before the Picker
 * gets a chance to fail behind glass.
 *
 * ## Why this exists
 *
 * When the key is wrong the Picker reports "API developer key invalid" INSIDE
 * its own iframe. That never reaches our callback, so the coach sees a dead
 * sheet chooser and the app says nothing. The person who has to fix it is
 * holding a phone with no Cloud Console open, which is why the message has to
 * name the fix rather than the symptom.
 *
 * ## Why only one status blocks
 *
 * This probes the DRIVE api, because the Picker has no endpoint worth probing.
 * That means it can prove the key is rejected and it CANNOT prove anything
 * about whether the Picker API itself is enabled -- Drive answers happily
 * while the Picker is switched off. So a 400 naming the key is the one
 * unambiguous answer, and it is the only one allowed to stop the flow.
 *
 * ## What it can still catch that the Picker would hide
 *
 * A 401 means the token itself is dead -- revoked, or issued to an account the
 * browser is no longer signed into. The Picker reports that as the same
 * "developer key is invalid" it reports everything else as, so catching it
 * here is the difference between "reconnect your Google account" and a coach
 * reading Cloud Console docs on a phone.
 *
 * ## A caveat about the key probe, which is not the same thing
 *
 * `docs/google-setup.md` step 5 restricts the API key to the Google Picker API
 * alone, and this probes DRIVE, so on a correctly-restricted production key
 * Google answers 403 and the key check below never fires. It is kept for
 * unrestricted and development keys, where it still earns its place. The 401
 * check does not depend on any of that.
 *
 * Everything else -- 403, 5xx, a dropped connection, a timeout -- falls
 * through and opens the Picker exactly as before. `drive.file` is a narrow
 * scope and a 403 here is at least as likely to mean "this token may not call
 * about.get" as it is to mean a real misconfiguration. Blocking on it would
 * turn a working coach into a blocked one, which is a worse failure than the
 * one this function exists to explain.
 */
export async function preflightPicker(apiKey: string, token: string): Promise<void> {
  const fetchFn = pickerFetchImpl ?? fetch;
  const url = `https://www.googleapis.com/drive/v3/about?fields=kind&key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await withTimeout(
      fetchFn(url, { headers: { Authorization: `Bearer ${token}` } }),
      PREFLIGHT_TIMEOUT_MS,
      "timeout",
    );
    // The one status that is about the credential rather than the endpoint.
    if (res.status === 401) throw new Error("needs-consent" satisfies PickFailure);
    if (res.status !== 400) return;
    const text = await res.text().catch(() => "");
    const lower = text.toLowerCase();
    if ((lower.includes("invalid") && lower.includes("key")) || lower.includes("api key")) {
      throw new Error("bad-api-key" satisfies PickFailure);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "bad-api-key" || message === "needs-consent") throw err;
    // Anything else is not evidence. Fall through and let the Picker try.
  }
}

/**
 * Opens the Picker on spreadsheets other people own, resolving with the one the
 * coach picks, or undefined if they close it.
 *
 * Rejects with a `PickFailure` message. Must be called from a tap: the token
 * request may open Google's consent popup.
 *
 * The wait on the human has no deadline -- a coach may take as long as they
 * like to find the right sheet, and the Picker reports its own close as CANCEL.
 * Only the script loads, which a blocker can stall forever, are timed.
 */
export async function pickSharedSpreadsheet(): Promise<PickedSheet | undefined> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("no-client-id" satisfies PickFailure);
  const apiKey = googleApiKey();
  if (!apiKey) throw new Error("no-api-key" satisfies PickFailure);

  let token: string;
  try {
    // `freshSession` is the fix for "adding a client stops working after a
    // day". A cached token is enough for every OTHER call to Google, because
    // they carry it in a header; the Picker needs the cookie session it was
    // minted from to still be reachable from an iframe, and on WebKit that
    // stops being true long before the token expires. Re-minting it re-opens
    // accounts.google.com first-party, which is what restores them.
    token = await getAccessToken({ interactive: true, freshSession: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    // Each of these has a different cure, and flattening them all into
    // "sign-in was closed" told coaches they had cancelled something they had
    // never been shown. Only a message we do not recognise falls back.
    const known: PickFailure[] = ["script-blocked", "popup-blocked", "timeout", "no-client-id"];
    throw new Error(
      (known as string[]).includes(message) ? message : ("needs-consent" satisfies PickFailure),
    );
  }

  await preflightPicker(apiKey, token);

  const api = await loadPicker();
  return new Promise<PickedSheet | undefined>((resolve) => {
    const view = new api.DocsView(api.ViewId.SPREADSHEETS);
    view.setIncludeFolders(false);
    // A client's sheet is theirs, shared with the coach. Hiding the coach's own
    // files keeps their personal sheet from being picked as a client.
    view.setOwnedByMe(false);

    new api.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(clientId.split("-")[0])
      .addView(view)
      .setCallback((result) => {
        if (result.action === api.Action.PICKED) {
          const doc = result.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name ?? "" } : undefined);
        } else if (result.action === api.Action.CANCEL) {
          resolve(undefined);
        }
        // Anything else is "loaded", which is not an answer yet.
      })
      .build()
      .setVisible(true);
  });
}
