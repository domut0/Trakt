import { create } from "zustand";
import {
  clearSyncBase,
  dbReadOnlyReason,
  deleteSyncConfig,
  loadDeviceId,
  loadSyncBase,
  loadSyncConfig,
  saveDeviceId,
  saveSyncBase,
  saveSyncConfig,
  type SyncConfigMeta,
} from "./db";
import { useStore } from "./store";
import type { CellValue } from "./csv";
import {
  buildBase,
  buildSheetTabs,
  mergeFromSheet,
  SHEET_TABS,
  type Collision,
  type MergeResult,
} from "./sync";
import { isNewerCoachPlan, parsePlanTab, shouldPublishOwnPlan, type PlanPayload } from "./plan-tab";
import {
  isLikelyExecUrl,
  pullFromSheet,
  pushToSheet,
  type SyncConnection,
  type SyncErrorCode,
  type SyncResponse,
} from "./sync-client";
import { createSpreadsheet, pullTabs, pushTabs } from "./sync-client-google";
import { clearGoogleToken, googleClientId } from "./google-auth";

/**
 * Sheet sync state, deliberately in its own store.
 *
 * It must NOT live on the main store. Sync is scheduled by subscribing to that
 * store, so writing sync status into it would re-trigger the subscription that
 * wrote it -- a feedback loop whose only defence would be a dirty check that
 * happens to be correct. Keeping the two apart makes the loop impossible rather
 * than merely unlikely.
 *
 * It also keeps sync state out of `hydrate`, `BackupData` and
 * `persistSettingsFrom`, none of which should ever carry it.
 */

export type SyncStatus =
  /** No sheet connected. */
  | "off"
  /** Connected, nothing outstanding. */
  | "idle"
  | "syncing"
  | "offline"
  /** Failed, will retry. */
  | "error"
  /** Needs the user to do something; retrying cannot help. */
  | "blocked";

export interface SyncState {
  config?: SyncConfigMeta;
  status: SyncStatus;
  lastSyncedAt?: number;
  lastError?: string;
  /** Local changes that have not reached the sheet yet. */
  pending: boolean;
  hydrated: boolean;
  /** Single-flight guard: a second cycle must never overlap the first. */
  running: boolean;
  /** Sheet edits that lost to an app edit. Kept until the user dismisses them. */
  collisions: Collision[];
  /**
   * A coach-issued plan sitting in the sheet that this device has not absorbed.
   *
   * Held here rather than applied on arrival: a plan rewrites targets and the
   * split, which is not something to do to someone between them opening the app
   * and looking at it. The review screen shows what would change and the person
   * decides, in the same shape as the backup import.
   */
  pendingCoachPlan?: PlanPayload;
  /**
   * Why sync is blocked, as a code rather than the prose in `lastError`.
   * The UI branches on this; matching on a message string would silently stop
   * working the moment the wording changed.
   */
  blockedReason?: SyncErrorCode;

  hydrate: () => Promise<void>;
  connect: (url: string, secret: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Creates a spreadsheet in the user's own Drive and syncs to it.
   *
   * The whole point of the Sheets transport: no Apps Script editor, no deploy
   * dialogs, no URL to copy. One consent screen and the sheet exists.
   */
  connectGoogle: () => Promise<{ ok: boolean; error?: string }>;
  /** True when this build carries an OAuth client id, so the button can exist. */
  googleAvailable: () => boolean;
  disconnect: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  markPending: () => void;
  syncNow: () => Promise<void>;
  /** Claims a sheet currently owned by another install. Replaces its contents. */
  takeOverSheet: () => Promise<void>;
  dismissCollisions: () => void;
}

/**
 * Feeds merged sheet edits through the store's own actions.
 *
 * Deliberately not a bespoke bulk write: `upsertDailyLog` already deletes a row
 * whose fields have all been cleared (via `isDailyLogEmpty`), which is exactly
 * what blanking a day in the sheet should do, and every action already handles
 * its own IndexedDB write-through. Reimplementing that here would mean two
 * write paths that have to agree forever.
 */
function applyMerge(result: MergeResult): void {
  const store = useStore.getState();
  for (const { id, patch } of result.setPatches) store.updateSet(id, patch);
  for (const { id, patch } of result.sessionPatches) {
    store.updateSession(id, { note: patch.note });
  }
  for (const { date, patch } of result.dailyPatches) store.upsertDailyLog(date, patch);
}

function connectionFrom(config: SyncConfigMeta): SyncConnection {
  return { url: config.url, secret: config.secret, deviceId: config.deviceId };
}

/**
 * Which transport a connection uses.
 *
 * An absent `kind` is an Apps Script connection made before the Sheets API
 * transport existed, so the default is what keeps every one of those working.
 */
function isGoogle(config: SyncConfigMeta): boolean {
  return config.kind === "google";
}

/**
 * Pull and push, dispatched on transport.
 *
 * The two live here rather than behind one client module because they are the
 * only two places the transports differ at all. Everything downstream -- the
 * merge, the base snapshot, the collision reporting -- reads the same tabs
 * whichever produced them, which is the property worth protecting: a sheet
 * written by one transport is readable by the other.
 */
function pullFor(config: SyncConfigMeta): Promise<SyncResponse> {
  return isGoogle(config)
    ? pullTabs(config.spreadsheetId ?? "")
    : pullFromSheet(connectionFrom(config));
}

function pushFor(
  config: SyncConfigMeta,
  input: {
    tabs: Record<string, CellValue[][]>;
    expectedRevision: number;
    force: boolean;
    unit: "lbs" | "kg";
    takeover?: boolean;
  },
): Promise<SyncResponse> {
  if (isGoogle(config)) {
    // No revision, no device ownership and no takeover: those exist because an
    // Apps Script deployment is a shared endpoint several installs could post
    // to. A spreadsheet reached with this device's own OAuth token has no such
    // ambiguity -- the grant IS the identity.
    return pushTabs(config.spreadsheetId ?? "", input.tabs);
  }
  return pushToSheet(connectionFrom(config), input);
}

/** Long enough that guessing it is not a way in, short enough to paste. */
export function generateSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

function generateDeviceId(): string {
  return `dev_${generateSecret().slice(0, 12)}`;
}

/**
 * This install's id, generated once and kept.
 *
 * Read from its own meta row rather than from the sync config, so disconnecting
 * and reconnecting does not mint a new one -- which the sheet would then refuse,
 * locking the user out over nothing more than a mistyped URL.
 *
 * Lazily created here rather than during `hydrate` so that someone who never
 * turns sync on never gets the write.
 */
async function ensureDeviceId(): Promise<string> {
  const existing = await loadDeviceId();
  if (existing) return existing;
  const created = generateDeviceId();
  await saveDeviceId(created);
  return created;
}

/** Maps a script or transport failure onto what the user can do about it. */
function describeFailure(error: string): { status: SyncStatus; message: string } {
  switch (error) {
    case "bad-secret":
      return {
        status: "blocked",
        message: "The sheet rejected this app's secret. Re-paste the script and reconnect.",
      };
    case "other-device":
      return {
        status: "blocked",
        message: "This sheet is already connected to another device.",
      };
    case "stale":
      // Only reachable in push-only mode if something else wrote the sheet.
      return { status: "error", message: "The sheet changed while syncing. Trying again shortly." };
    case "busy":
      return { status: "error", message: "The sheet was busy. Trying again shortly." };
    case "timeout":
      return { status: "error", message: "The sheet did not respond in time." };
    case "network":
      return { status: "error", message: "Couldn't reach the sheet." };
    case "needs-consent":
      // The one failure the user can actually clear, and the one where a retry
      // is pointless: the browser token model has no refresh token, so a lapsed
      // grant needs a tap.
      return {
        status: "blocked",
        message: "Google sign-in has expired. Reconnect to keep syncing.",
      };
    case "empty-plan":
      return { status: "error", message: "There was no plan to send." };
    case "unreadable":
      return {
        status: "blocked",
        message: "The sheet address did not return the expected reply. Check the deployment URL.",
      };
    default:
      return { status: "error", message: "Sync failed." };
  }
}

export const useSyncStore = create<SyncState>((set, get) => ({
  status: "off",
  pending: false,
  hydrated: false,
  running: false,
  collisions: [],
  pendingCoachPlan: undefined,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const config = await loadSyncConfig();
      set({
        config,
        hydrated: true,
        status: config?.enabled ? "idle" : "off",
      });
    } catch {
      // A settings row the app cannot read must not stop the app from starting.
      set({ hydrated: true, status: "off" });
    }
  },

  connect: async (url, secret) => {
    const trimmed = url.trim();
    if (!isLikelyExecUrl(trimmed)) {
      return {
        ok: false,
        error: "That does not look like a deployment URL. It should end in /exec.",
      };
    }
    if (!secret.trim()) {
      return { ok: false, error: "Paste the secret from the script." };
    }

    let config: SyncConfigMeta;
    try {
      config = {
        key: "syncConfig",
        url: trimmed,
        secret: secret.trim(),
        deviceId: await ensureDeviceId(),
        enabled: true,
      };
      await saveSyncConfig(config);
      // A fresh connection knows nothing about what is in the sheet, so the
      // first sync must be a publish rather than a merge.
      await clearSyncBase();
    } catch {
      return { ok: false, error: "Couldn't save the connection to this device." };
    }

    set({ config, status: "idle", lastError: undefined, blockedReason: undefined });
    await get().syncNow();
    return { ok: true };
  },

  googleAvailable: () => googleClientId() !== undefined,

  connectGoogle: async () => {
    if (googleClientId() === undefined) {
      // A build with no client id cannot sign in at all, and saying so beats
      // an opaque failure from Google Identity Services.
      return { ok: false, error: "This build has no Google client id configured." };
    }

    const title = `Trakt — ${new Date().toISOString().slice(0, 10)}`;
    const created = await createSpreadsheet(title);
    if (!created.ok) {
      const { message } = describeFailure(created.error);
      return { ok: false, error: message };
    }

    // createSpreadsheet carries the new id back in a reserved tab key, since
    // SyncOk has no field of its own for it.
    const spreadsheetId = String(created.tabs?.__id?.[0]?.[0] ?? "");
    if (spreadsheetId === "") {
      return { ok: false, error: "Google did not return a spreadsheet id." };
    }

    let config: SyncConfigMeta;
    try {
      config = {
        key: "syncConfig",
        kind: "google",
        spreadsheetId,
        // Empty rather than optional: the Apps Script fields stay on the record
        // so that every reader keeps one shape to handle.
        url: "",
        secret: "",
        deviceId: await ensureDeviceId(),
        enabled: true,
        spreadsheetUrl: created.spreadsheetUrl,
      };
      await saveSyncConfig(config);
      // A brand new spreadsheet has nothing in it, so the first sync publishes.
      await clearSyncBase();
    } catch {
      return { ok: false, error: "Couldn't save the connection to this device." };
    }

    set({ config, status: "idle", lastError: undefined, blockedReason: undefined });
    await get().syncNow();
    return { ok: true };
  },

  disconnect: async () => {
    // Drop the token as well: leaving it cached would let the next connection
    // reuse a grant the user believes they just ended.
    clearGoogleToken();
    try {
      await deleteSyncConfig();
      await clearSyncBase();
    } catch {
      // Falling through still clears it in memory, which is what the user asked
      // for; a stale row would be overwritten by the next connect anyway.
    }
    set({
      config: undefined,
      status: "off",
      lastError: undefined,
      lastSyncedAt: undefined,
      pending: false,
      collisions: [],
      blockedReason: undefined,
    });
  },

  setEnabled: async (enabled) => {
    const config = get().config;
    if (!config) return;
    const next = { ...config, enabled };
    try {
      await saveSyncConfig(next);
    } catch {
      return;
    }
    set({ config: next, status: enabled ? "idle" : "off" });
    if (enabled) await get().syncNow();
  },

  markPending: () => {
    if (get().config?.enabled) set({ pending: true });
  },

  syncNow: async () => {
    const { config, running } = get();
    if (!config?.enabled || running) return;

    // The store's default state is empty arrays until IndexedDB has loaded.
    // Pushing that would publish an empty sheet, and once a base exists it would
    // read as the user having deleted their entire history.
    if (!useStore.getState().hydrated) return;

    // Coach mode has swapped a CLIENT's data into the store. Syncing now would
    // publish that client's log to the coach's own sheet and then record it as
    // the merge base, so the next sync would read the coach's real history as
    // deletions. The read-only latch is the signal because it means exactly
    // this: what the store holds is not this device's data.
    if (dbReadOnlyReason() !== undefined) {
      set({ pending: true });
      return;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      set({ status: "offline", pending: true });
      return;
    }

    set({ running: true, status: "syncing" });
    try {
      await runCycle(config, set, get, 0);
    } catch {
      // Nothing here may throw into React. A sync failure is not a data-loss
      // event and must never interrupt logging.
      set({ status: "error", lastError: "Sync failed.", pending: true });
    } finally {
      set({ running: false });
    }
  },

  takeOverSheet: async () => {
    const { config, running } = get();
    if (!config || running) return;
    if (!useStore.getState().hydrated) return;

    set({ running: true, status: "syncing" });
    try {
      // A takeover republishes wholesale, so whatever ancestor was recorded
      // against the previous owner's sheet is meaningless. Dropping it also
      // makes the cycle below force, which is what claiming the sheet means.
      await clearSyncBase();
      await runCycle(config, set, get, 0, { takeover: true });
    } catch {
      set({ status: "error", lastError: "Sync failed.", pending: true });
    } finally {
      set({ running: false });
    }
  },

  dismissCollisions: () => set({ collisions: [] }),
}));

/** How many times a stale push is retried before giving up for this cycle. */
const MAX_STALE_RETRIES = 1;

type SetState = (partial: Partial<SyncState>) => void;
type GetState = () => SyncState;

/**
 * One pull, merge, push.
 *
 * The pull comes first so that anything typed in the sheet is folded into the
 * app BEFORE the push rewrites the tabs. Reversing the two would overwrite the
 * user's edits with the values they had just replaced.
 */
async function runCycle(
  config: SyncConfigMeta,
  set: SetState,
  get: GetState,
  attempt: number,
  options: { takeover?: boolean } = {},
): Promise<void> {
  let base = await loadSyncBase();
  let collisions: Collision[] = [];
  // Undefined until a pull happens. On the very first sync there is nothing in
  // the sheet to preserve, so publishing the app's own plan is always right.
  let tabPlan: PlanPayload | undefined;
  let pulledAnything = false;

  if (base) {
    const pulled = await pullFor(config);
    if (!pulled.ok) {
      const { status, message } = describeFailure(pulled.error);
      set({
        status,
        lastError: message,
        pending: true,
        blockedReason: status === "blocked" ? (pulled.error as SyncErrorCode) : undefined,
      });
      return;
    }

    const merged = mergeFromSheet(base, useStore.getState(), pulled.tabs);
    applyMerge(merged);
    collisions = merged.report.collisions;

    // The plan tab sits outside the merge entirely. It is not a log with
    // editable columns, it is a document one side hands the other, so it has
    // its own format and its own conflict rule (see plan-tab.ts).
    pulledAnything = true;
    tabPlan = parsePlanTab(pulled.tabs?.[SHEET_TABS.plan]);
    const offered = tabPlan && isNewerCoachPlan(tabPlan, useStore.getState().lastAcceptedPlanAt);
    set({ pendingCoachPlan: offered ? tabPlan : undefined });

    // Push against what the sheet actually is now, not what it was when this
    // base was written, so a push that failed earlier does not read as stale
    // forever.
    base = { ...base, revision: pulled.revision };
  }

  // Read AFTER applying the merge: the push must carry the sheet's edits back,
  // or the next pull would see them as edits all over again.
  const app = useStore.getState();

  // Leaving the plan tab out of the payload is what preserves a coach's plan
  // through the client's ordinary sync: the script clears only the tabs it is
  // handed, so an absent key means "do not touch this one".
  const publishOwnPlan = !pulledAnything || shouldPublishOwnPlan(tabPlan, app.lastAcceptedPlanAt);

  const response = await pushFor(config, {
    tabs: buildSheetTabs(app, publishOwnPlan ? { issuedAt: new Date().toISOString() } : undefined),
    expectedRevision: base?.revision ?? 0,
    // Without a base there is nothing to be stale against: this is the first
    // publish, and the app is the only thing that has ever written here.
    force: base === undefined,
    unit: app.unit,
    takeover: options.takeover,
  });

  if (!response.ok) {
    // Someone typed in the sheet between the pull and the push. The window is
    // about a second, but it is exactly when the user is looking at the sheet,
    // so re-running the cycle folds their edit in rather than losing it.
    if (response.error === "stale" && attempt < MAX_STALE_RETRIES) {
      await runCycle(config, set, get, attempt + 1, options);
      return;
    }
    const { status, message } = describeFailure(response.error);
    set({
      status,
      lastError: message,
      pending: true,
      blockedReason: status === "blocked" ? (response.error as SyncErrorCode) : undefined,
    });
    return;
  }

  // Captured from the state that was actually pushed, not from a re-read:
  // anything logged during the request belongs to the NEXT push, and recording
  // it here would make that edit invisible to the merge forever.
  await saveSyncBase(buildBase(app, response.revision));

  if (response.spreadsheetUrl && response.spreadsheetUrl !== config.spreadsheetUrl) {
    const next = { ...config, spreadsheetUrl: response.spreadsheetUrl };
    await saveSyncConfig(next);
    set({ config: next });
  }

  set({
    status: "idle",
    lastSyncedAt: Date.now(),
    lastError: undefined,
    blockedReason: undefined,
    pending: false,
    // Appended, not replaced: a collision the user has not read yet must not be
    // dropped by the next successful sync.
    collisions: [...get().collisions, ...collisions].slice(-20),
  });
}
