import type { CellValue } from "./csv";
import { expireGoogleToken, getAccessToken } from "./google-auth";
import { SHEET_TABS } from "./sync";
import type { SyncErrorCode, SyncResponse } from "./sync-protocol";

/**
 * The Sheets API transport: the same sheet, reached directly instead of through
 * an Apps Script deployment.
 *
 * Everything in sync.ts -- the three-way merge, the base snapshot, the
 * collision rules -- is transport-agnostic and does not move for this. The
 * sheet this produces is byte-for-byte the same sheet, so a client can be moved
 * between transports without their data changing shape.
 *
 * Three things get better here. A Bearer header replaces the `text/plain` CORS
 * workaround in sync-client.ts, which exists only because Apps Script does not
 * answer preflight. Real HTTP status codes replace the "cannot branch on
 * status because of the redirect chain" guessing. And one `spreadsheets.create`
 * call produces the file and all of its tabs, so there is no first-run
 * tab-creation dance.
 *
 * One thing gets worse: `LockService` is gone and nothing replaces it. See
 * `pushTabs` below.
 */

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

/** Every tab the app owns, created up front so no later call has to add one. */
const ALL_TABS = [
  SHEET_TABS.sets,
  SHEET_TABS.sessions,
  SHEET_TABS.daily,
  SHEET_TABS.cardio,
  SHEET_TABS.plan,
  SHEET_TABS.meta,
];

/**
 * Maps an HTTP status onto what the user can do about it.
 *
 * Exported and table-driven because it is the one part of this file that can be
 * tested without a Google account, and it is where a wrong answer is most
 * expensive: calling a revoked grant "a network blip" would retry forever
 * instead of asking the user to reconnect.
 */
export function errorForStatus(status: number): SyncErrorCode {
  // The grant is gone or the token expired mid-flight. Retrying cannot help;
  // only the user can.
  if (status === 401) return "needs-consent";
  // Wrong scope, or the file was un-shared. Also not retryable.
  if (status === 403) return "bad-secret";
  if (status === 404) return "unreadable";
  // Rate limit and server errors are the genuinely transient ones.
  if (status === 429 || status >= 500) return "busy";
  return "unreadable";
}

async function call(
  url: string,
  init: RequestInit & { interactive?: boolean } = {},
  retried = false,
): Promise<{ ok: true; body: unknown } | { ok: false; error: SyncErrorCode }> {
  let token: string;
  try {
    token = await getAccessToken({ interactive: init.interactive ?? false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    // A window the browser refused to open is its own failure with its own
    // cure. Folding it into "needs-consent" told the user their sign-in had
    // expired when nothing had; folding it into "network" blamed the network.
    if (message === "popup-blocked") return { ok: false, error: "popup-blocked" };
    return { ok: false, error: message === "needs-consent" ? "needs-consent" : "network" };
  }

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (response.status === 401 && !retried) {
      // Google rejected authorization before performing this operation. Renew
      // once, silently; never reopen consent or retry a possibly completed write.
      expireGoogleToken(token);
      return call(url, { ...init, interactive: false }, true);
    }
    if (!response.ok) return { ok: false, error: errorForStatus(response.status) };
    return { ok: true, body: (await response.json()) as unknown };
  } catch {
    return { ok: false, error: "network" };
  }
}

/**
 * Creates the spreadsheet, with every tab, in one call.
 *
 * Interactive by definition: this only ever runs from a Settings tap, and it is
 * the moment the consent screen is expected.
 */
export async function createSpreadsheet(title: string): Promise<SyncResponse> {
  const result = await call(SHEETS, {
    method: "POST",
    interactive: true,
    body: JSON.stringify({
      properties: { title },
      sheets: ALL_TABS.map((t) => ({ properties: { title: t } })),
    }),
  });
  if (!result.ok) return { ok: false, error: result.error };
  const body = result.body as { spreadsheetId?: string; spreadsheetUrl?: string };
  if (!body.spreadsheetId) return { ok: false, error: "unreadable" };
  return {
    ok: true,
    revision: 0,
    spreadsheetUrl: body.spreadsheetUrl,
    // Carried on the response so the caller can persist it without a second
    // shape to thread through; `SyncOk` has no spreadsheetId field of its own.
    tabs: { __id: [[body.spreadsheetId]] },
  };
}

/**
 * Asked of a transport call. Background sync stays silent; a coach's tap may
 * put a consent popup in front of them, since they are there to answer it.
 */
interface CallOptions {
  interactive?: boolean;
}

/** Reads every tab the app knows about, in one request. */
export async function pullTabs(
  spreadsheetId: string,
  { interactive = false }: CallOptions = {},
): Promise<SyncResponse> {
  const ranges = ALL_TABS.map((t) => `ranges=${encodeURIComponent(t)}`).join("&");
  const result = await call(
    `${SHEETS}/${spreadsheetId}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`,
    { interactive },
  );
  if (!result.ok) return { ok: false, error: result.error };

  const body = result.body as { valueRanges?: Array<{ range?: string; values?: CellValue[][] }> };
  const tabs: Record<string, CellValue[][]> = {};
  (body.valueRanges ?? []).forEach((vr, i) => {
    // Matched by INDEX, not by parsing `range`: the API quotes sheet names that
    // contain spaces and appends the used range, so the string does not come
    // back as it went in. Order is guaranteed to match the request.
    tabs[ALL_TABS[i]] = vr.values ?? [];
  });
  return { ok: true, revision: 0, tabs };
}

/**
 * Writes the given tabs, clearing each first.
 *
 * Two calls, because `batchUpdate` does not shrink a range: a rewrite producing
 * fewer rows than last time would leave the tail of the old data behind, which
 * on the `sets` tab means deleted sets reappearing.
 *
 * The pair is NOT atomic, and nothing here can make it so -- `LockService` was
 * server-side and there is no client equivalent. This is an accepted loss
 * rather than an oversight: one sheet, one device is already the rule, so the
 * only writer that could interleave is one the app already refuses.
 *
 * Tabs absent from `tabs` are left entirely alone, which is what preserves a
 * coach's pending plan through a client's ordinary sync.
 */
export async function pushTabs(
  spreadsheetId: string,
  tabs: Record<string, CellValue[][]>,
  { interactive = false }: CallOptions = {},
): Promise<SyncResponse> {
  const names = Object.keys(tabs);
  if (names.length === 0) return { ok: true, revision: 0 };

  const cleared = await call(`${SHEETS}/${spreadsheetId}/values:batchClear`, {
    method: "POST",
    interactive,
    body: JSON.stringify({ ranges: names }),
  });
  if (!cleared.ok) return { ok: false, error: cleared.error };

  const written = await call(`${SHEETS}/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    interactive,
    body: JSON.stringify({
      valueInputOption: "RAW",
      data: names.map((name) => ({ range: name, values: tabs[name] })),
    }),
  });
  if (!written.ok) return { ok: false, error: written.error };
  return { ok: true, revision: 0 };
}

/**
 * Writes only the plan tab, for a coach writing to a client's sheet.
 *
 * Interactive: it only ever runs from the coach's Save tap.
 */
export function putPlanTab(spreadsheetId: string, plan: CellValue[][]): Promise<SyncResponse> {
  return pushTabs(spreadsheetId, { [SHEET_TABS.plan]: plan }, { interactive: true });
}

/**
 * Shares this app's sheet with a coach, as an editor.
 *
 * Editor, not reader: the coach's app writes the plan tab. What stops it
 * writing anything else is coach mode's read-only latch, not Drive -- Drive
 * has no per-tab permission to express "the plan and nothing else".
 *
 * `drive.file` covers permission changes on files the app created, which the
 * spike confirmed (check 3), so this needs no wider scope. Google emails the
 * coach, which is how they learn the sheet is waiting in their Picker.
 * Interactive: it only ever runs from a tap.
 */
export async function shareWithCoach(spreadsheetId: string, email: string): Promise<SyncResponse> {
  const result = await call(
    `https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions?sendNotificationEmail=true`,
    {
      method: "POST",
      interactive: true,
      body: JSON.stringify({ role: "writer", type: "user", emailAddress: email.trim() }),
    },
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, revision: 0 };
}
