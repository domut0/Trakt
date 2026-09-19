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
 */

const GAPI_SRC = "https://apis.google.com/js/api.js";

/** Same budget as the GIS script: long enough for a slow network, short enough to fail visibly. */
const LOAD_TIMEOUT_MS = 15_000;

export type PickFailure = "no-api-key" | "no-client-id" | "needs-consent" | "script-blocked";

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
    token = await getAccessToken({ interactive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    throw new Error(message === "script-blocked" ? "script-blocked" : "needs-consent");
  }

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
