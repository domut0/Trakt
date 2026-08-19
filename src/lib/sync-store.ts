import { create } from "zustand";
import {
  clearSyncBase,
  deleteSyncConfig,
  loadSyncBase,
  loadSyncConfig,
  saveSyncBase,
  saveSyncConfig,
  type SyncConfigMeta,
} from "./db";
import { useStore } from "./store";
import {
  buildBase,
  buildSheetTabs,
  mergeFromSheet,
  type Collision,
  type MergeResult,
} from "./sync";
import { isLikelyExecUrl, pullFromSheet, pushToSheet, type SyncConnection } from "./sync-client";

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

  hydrate: () => Promise<void>;
  connect: (url: string, secret: string) => Promise<{ ok: boolean; error?: string }>;
  disconnect: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  markPending: () => void;
  syncNow: () => Promise<void>;
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

/** Long enough that guessing it is not a way in, short enough to paste. */
export function generateSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

function generateDeviceId(): string {
  return `dev_${generateSecret().slice(0, 12)}`;
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

    const config: SyncConfigMeta = {
      key: "syncConfig",
      url: trimmed,
      secret: secret.trim(),
      deviceId: get().config?.deviceId ?? generateDeviceId(),
      enabled: true,
    };

    try {
      await saveSyncConfig(config);
      // A fresh connection knows nothing about what is in the sheet, so the
      // first sync must be a publish rather than a merge.
      await clearSyncBase();
    } catch {
      return { ok: false, error: "Couldn't save the connection to this device." };
    }

    set({ config, status: "idle", lastError: undefined });
    await get().syncNow();
    return { ok: true };
  },

  disconnect: async () => {
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
): Promise<void> {
  const connection = connectionFrom(config);
  let base = await loadSyncBase();
  let collisions: Collision[] = [];

  if (base) {
    const pulled = await pullFromSheet(connection);
    if (!pulled.ok) {
      const { status, message } = describeFailure(pulled.error);
      set({ status, lastError: message, pending: true });
      return;
    }

    const merged = mergeFromSheet(base, useStore.getState(), pulled.tabs);
    applyMerge(merged);
    collisions = merged.report.collisions;

    // Push against what the sheet actually is now, not what it was when this
    // base was written, so a push that failed earlier does not read as stale
    // forever.
    base = { ...base, revision: pulled.revision };
  }

  // Read AFTER applying the merge: the push must carry the sheet's edits back,
  // or the next pull would see them as edits all over again.
  const app = useStore.getState();

  const response = await pushToSheet(connection, {
    tabs: buildSheetTabs(app),
    expectedRevision: base?.revision ?? 0,
    // Without a base there is nothing to be stale against: this is the first
    // publish, and the app is the only thing that has ever written here.
    force: base === undefined,
    unit: app.unit,
  });

  if (!response.ok) {
    // Someone typed in the sheet between the pull and the push. The window is
    // about a second, but it is exactly when the user is looking at the sheet,
    // so re-running the cycle folds their edit in rather than losing it.
    if (response.error === "stale" && attempt < MAX_STALE_RETRIES) {
      await runCycle(config, set, get, attempt + 1);
      return;
    }
    const { status, message } = describeFailure(response.error);
    set({ status, lastError: message, pending: true });
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
    pending: false,
    // Appended, not replaced: a collision the user has not read yet must not be
    // dropped by the next successful sync.
    collisions: [...get().collisions, ...collisions].slice(-20),
  });
}
