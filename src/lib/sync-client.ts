import type { CellValue } from "./csv";
import { SYNC_FORMAT_VERSION } from "./sync";

/**
 * The only module in the app that makes a network request.
 *
 * Kept apart from sync.ts so the merge logic stays testable without a network
 * stub, and so the CORS constraints below live in one place with the comment
 * that explains them.
 */

export interface SyncConnection {
  url: string;
  secret: string;
  deviceId: string;
}

export interface PushInput {
  tabs: Record<string, CellValue[][]>;
  /** The revision the merge was computed against. Ignored when `force`. */
  expectedRevision: number;
  /** Set on the first sync, when there is no base to be stale against. */
  force: boolean;
  unit: "lbs" | "kg";
  /** Claims a sheet another install owns, replacing its contents. */
  takeover?: boolean;
}

export type SyncOk = {
  ok: true;
  revision: number;
  scriptVersion?: number;
  spreadsheetUrl?: string;
  deviceId?: string;
  tabs?: Record<string, CellValue[][]>;
};

/** Every failure the script reports, plus the ones only the client can see. */
export type SyncErrorCode =
  | "bad-secret"
  | "other-device"
  | "stale"
  | "busy"
  | "unknown-action"
  | "empty-plan"
  | "network"
  | "timeout"
  | "unreadable";

export type SyncFail = {
  ok: false;
  error: SyncErrorCode | string;
  /** Present on "stale": the revision the sheet is actually at. */
  revision?: number;
  /** Present on "other-device": which device owns the sheet. */
  deviceId?: string;
};

export type SyncResponse = SyncOk | SyncFail;

// A seam rather than a global stub, mirroring `setWriteErrorHandler` in db.ts.
// src/test/setup.ts installs a throwing default, so a test that forgets to
// provide one fails loudly instead of quietly reaching the real network.
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike | undefined;

export function setSyncFetch(fn: FetchLike | undefined): void {
  fetchImpl = fn;
}

function activeFetch(): FetchLike {
  return fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
}

/** Apps Script cold starts are slow, but a hung request must not wedge the engine. */
const PUSH_TIMEOUT_MS = 60_000;
const PULL_TIMEOUT_MS = 30_000;

async function call(
  connection: SyncConnection,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<SyncResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await activeFetch()(connection.url, {
      method: "POST",
      // text/plain is what keeps this a CORS "simple request". Apps Script does
      // not answer preflight OPTIONS, so application/json -- or ANY custom
      // header, including an auth header -- makes the browser preflight and the
      // request fails before it is sent. The body is still JSON.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        secret: connection.secret,
        deviceId: connection.deviceId,
        formatVersion: SYNC_FORMAT_VERSION,
        ...body,
      }),
      // /exec answers with a 302 to script.googleusercontent.com and the real
      // reply is behind it, so the redirect has to be followed.
      redirect: "follow",
      signal: controller.signal,
    });

    // Deliberately not branching on response.status: the redirect chain makes it
    // unreliable, and cross-origin response headers are unreadable anyway. The
    // script always answers with an ok flag in the body, and anything that is
    // not parseable JSON is an Apps Script error page.
    const text = await response.text();
    try {
      return JSON.parse(text) as SyncResponse;
    } catch {
      return { ok: false, error: "unreadable" };
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: "timeout" };
    }
    return { ok: false, error: "network" };
  } finally {
    clearTimeout(timer);
  }
}

export function pushToSheet(connection: SyncConnection, input: PushInput): Promise<SyncResponse> {
  return call(
    connection,
    {
      action: "push",
      tabs: input.tabs,
      expectedRevision: input.expectedRevision,
      force: input.force,
      unit: input.unit,
      takeover: input.takeover ?? false,
    },
    PUSH_TIMEOUT_MS,
  );
}

/**
 * Writes only the plan tab, leaving the log alone.
 *
 * Used by coach mode against a CLIENT's sheet, which is why it exists as its
 * own call rather than a flag on push: a push carries the whole log and claims
 * the sheet for the pushing device, and a coach must do neither.
 */
export function putPlanOnSheet(
  connection: SyncConnection,
  plan: CellValue[][],
): Promise<SyncResponse> {
  return call(connection, { action: "putPlan", tabs: { plan } }, PUSH_TIMEOUT_MS);
}

export function pullFromSheet(connection: SyncConnection): Promise<SyncResponse> {
  return call(connection, { action: "pull" }, PULL_TIMEOUT_MS);
}

/**
 * A URL that looks like an Apps Script web app deployment.
 *
 * Checked before saving because pasting the *editor* URL rather than the
 * deployment URL is the easy mistake, and it fails in a way that otherwise just
 * looks like sync being broken.
 */
export function isLikelyExecUrl(url: string): boolean {
  return /^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[\w-]+\/exec\/?$/.test(
    url.trim(),
  );
}
