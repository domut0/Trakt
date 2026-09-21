import type { CellValue } from "./csv";

/**
 * What a transport answers with.
 *
 * These were defined beside the Apps Script client, which was the only
 * transport when they were written. They outlived it: the merge, the base
 * snapshot and every caller in the store speak this shape and do not care what
 * produced it.
 */

export interface PushInput {
  tabs: Record<string, CellValue[][]>;
  /** The revision the merge was computed against. Ignored when `force`. */
  expectedRevision: number;
  /** Set on the first sync, when there is no base to be stale against. */
  force: boolean;
  unit: "lbs" | "kg";
}

export type SyncOk = {
  ok: true;
  revision: number;
  spreadsheetUrl?: string;
  tabs?: Record<string, CellValue[][]>;
};

/**
 * Every failure a sync can end in.
 *
 * `needs-consent` is the one the user can actually clear, and the only one
 * where retrying is pointless: the browser token model issues no refresh
 * token, so a lapsed grant needs a tap.
 */
export type SyncErrorCode =
  "bad-secret" | "busy" | "network" | "needs-consent" | "popup-blocked" | "timeout" | "unreadable";

export type SyncFail = {
  ok: false;
  error: SyncErrorCode | string;
};

export type SyncResponse = SyncOk | SyncFail;
