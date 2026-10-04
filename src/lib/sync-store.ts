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
import {
  isNewerCoachPlan,
  parsePlanTab,
  planNeedsNewerApp,
  shouldPublishOwnPlan,
  type PlanPayload,
} from "./plan-tab";
import { loadDisplayName } from "./tutorial-state";
import { loadPendingCoach } from "./pending-coach";
import type { SyncErrorCode, SyncResponse } from "./sync-protocol";
import { createSpreadsheet, pullTabs, pushTabs } from "./sync-client-google";
import { clearGoogleToken, getAccessToken, googleClientId } from "./google-auth";

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
   * A plan is waiting in the sheet that this build is too old to read.
   *
   * Separate from `pendingCoachPlan` because there is nothing to review: the
   * payload could not be parsed, and the only thing the person can do about it
   * is update the app. Before this existed the plan was refused silently - the
   * parser returned undefined for "too new" and for "corrupt" alike, so the
   * caller could not tell a coach's new programme from a damaged tab, and
   * showed neither.
   */
  coachPlanNeedsUpdate: boolean;
  /**
   * Whether the review screen is on top of whatever the person was looking at.
   *
   * In the store rather than in the component because three things open it -
   * the card on Today, the card on Plan, and the sync that finds the plan in
   * the first place - and a plan nobody noticed is the failure this feature
   * exists to prevent.
   */
  planReviewOpen: boolean;
  setPlanReviewOpen: (open: boolean) => void;
  /**
   * Why sync is blocked, as a code rather than the prose in `lastError`.
   * The UI branches on this; matching on a message string would silently stop
   * working the moment the wording changed.
   */
  blockedReason?: SyncErrorCode;

  hydrate: () => Promise<void>;
  connectGoogle: () => Promise<{ ok: boolean; error?: string }>;
  /**
   * Re-grant a lapsed Google sign-in, KEEPING the sheet.
   *
   * Distinct from `connectGoogle` on purpose, and the distinction is the whole
   * point of it existing: `connectGoogle` calls `createSpreadsheet`, so wiring
   * an expired-token banner to it would quietly mint a second sheet, strand the
   * one that has the history in it, and break the share the coach is reading.
   *
   * The browser token model has no refresh token, so a lapsed grant genuinely
   * needs a tap. This is that tap, and nothing else about the connection moves.
   */
  reauthorize: () => Promise<{ ok: boolean; error?: string }>;
  /** True when this build carries an OAuth client id, so the button can exist. */
  googleAvailable: () => boolean;
  disconnect: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  markPending: () => void;
  syncNow: () => Promise<void>;
  /** Claims a sheet currently owned by another install. Replaces its contents. */

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

/**
 * Whether this connection can still sync.
 *
 * A config with no `spreadsheetId` was made by the Apps Script setup, which
 * this version no longer speaks. It is not an error state to recover from in
 * code: the sheet is still in the person's Drive, and reconnecting makes a new
 * one from the device, which holds everything.
 */
function isConnected(config: SyncConfigMeta): boolean {
  return config.kind === "google" && (config.spreadsheetId ?? "") !== "";
}

function pullFor(config: SyncConfigMeta): Promise<SyncResponse> {
  return pullTabs(config.spreadsheetId ?? "");
}

function pushFor(
  config: SyncConfigMeta,
  input: { tabs: Record<string, CellValue[][]> },
): Promise<SyncResponse> {
  // No revision, no device ownership and no takeover: those existed because an
  // Apps Script deployment was a shared endpoint several installs could post
  // to. A spreadsheet reached with this device's own OAuth token has no such
  // ambiguity -- the grant IS the identity.
  return pushTabs(config.spreadsheetId ?? "", input.tabs);
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

/** Maps a transport failure onto what the user can do about it. */
function describeFailure(error: string): { status: SyncStatus; message: string } {
  switch (error) {
    case "bad-secret":
      // 403 from the Sheets API: the grant no longer covers this file, which is
      // what a client un-sharing their sheet looks like from here.
      return {
        status: "blocked",
        message: "This sheet is no longer shared with this account.",
      };
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
    case "popup-blocked":
      // Not an expired grant and not the network. The browser declined to open
      // the sign-in window, which the user clears by allowing popups or simply
      // by tapping again now that nothing has to be fetched first.
      return {
        status: "blocked",
        message: "Your browser blocked the Google sign-in window. Allow popups, then try again.",
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

/**
 * The plan this session has already shown, by its issued instant. Module-level
 * because it is not state anything renders and must not survive a relaunch:
 * a dismissed plan is offered again the next time the app opens.
 */
let seenThisSession: string | undefined;

export const useSyncStore = create<SyncState>((set, get) => ({
  status: "off",
  pending: false,
  hydrated: false,
  running: false,
  collisions: [],
  pendingCoachPlan: undefined,
  coachPlanNeedsUpdate: false,
  planReviewOpen: false,
  setPlanReviewOpen: (open) => {
    // Dismissing marks this plan seen for THIS session only: it stays in the
    // sheet, the cards stay on screen, and the next launch offers it again,
    // because tapping past something is not deciding about it.
    if (!open) seenThisSession = get().pendingCoachPlan?.issuedAt;
    set({ planReviewOpen: open });
  },

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

  googleAvailable: () => googleClientId() !== undefined,

  connectGoogle: async () => {
    if (googleClientId() === undefined) {
      // A build with no client id cannot sign in at all, and saying so beats
      // an opaque failure from Google Identity Services.
      return { ok: false, error: "This build has no Google client id configured." };
    }

    // Named after the person whose sheet it is. Onboarding asks them directly
    // now, so the date fallback is reached only by someone who connected a
    // sheet without ever going through /join - every client's sheet used to be
    // called the same thing, and a coach with six of them picked by date.
    const chosenName = loadDisplayName() ?? loadPendingCoach()?.clientName?.trim();
    const title = chosenName
      ? `Trakt — ${chosenName}`
      : `Trakt — ${new Date().toISOString().slice(0, 10)}`;
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

  reauthorize: async () => {
    const { config } = get();
    if (!config) return { ok: false, error: "There is no sheet connected." };

    // The cached token is the thing that expired. Dropping it first means the
    // request below cannot be answered from the cache with the same dead
    // credential and report success.
    clearGoogleToken();
    try {
      await getAccessToken({ interactive: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      // A dismissed Google dialog lands here too, which is not an error worth
      // colouring red: the person closed a window, and the banner they opened
      // it from is still on screen saying what to do.
      return {
        ok: false,
        error:
          message === "needs-consent"
            ? "Google sign-in was not completed."
            : "Couldn't reach Google. Check your connection.",
      };
    }

    // `config` is deliberately untouched. The sheet id, the coach's share and
    // every row in it are all still exactly what they were.
    set({
      status: config.enabled ? "idle" : "off",
      lastError: undefined,
      blockedReason: undefined,
    });
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

    // An Apps Script connection, which this version no longer speaks. Blocked
    // rather than errored: retrying cannot help, and Settings offers the
    // reconnect that can.
    if (!isConnected(config)) {
      set({
        status: "blocked",
        blockedReason: "unreadable",
        lastError: "Sheet sync has moved to Google sign-in. Reconnect in Settings.",
      });
      return;
    }

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
      await runCycle(config, set, get);
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

type SetState = (partial: Partial<SyncState>) => void;
type GetState = () => SyncState;

/**
 * One pull, merge, push.
 *
 * The pull comes first so that anything typed in the sheet is folded into the
 * app BEFORE the push rewrites the tabs. Reversing the two would overwrite the
 * user's edits with the values they had just replaced.
 */
async function runCycle(config: SyncConfigMeta, set: SetState, get: GetState): Promise<void> {
  // Opening a client can swap the main store while either read is awaiting.
  // Recheck after those boundaries before merging or capturing a push payload;
  // the entry guard alone only protects cycles started inside client view.
  const pauseForClient = () => {
    if (dbReadOnlyReason() === undefined) return false;
    set({ status: "idle", pending: true });
    return true;
  };
  let base = await loadSyncBase();
  if (pauseForClient()) return;
  let collisions: Collision[] = [];
  // Undefined until a pull happens. On the very first sync there is nothing in
  // the sheet to preserve, so publishing the app's own plan is always right.
  let tabPlan: PlanPayload | undefined;
  let pulledAnything = false;

  if (base) {
    const pulled = await pullFor(config);
    if (pauseForClient()) return;
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
    const planRows = pulled.tabs?.[SHEET_TABS.plan];
    tabPlan = parsePlanTab(planRows);
    // Asked only when the parse failed, and it is the difference between "your
    // coach sent something and you need to update" and silence.
    const needsUpdate = tabPlan === undefined && planNeedsNewerApp(planRows);
    const offered = tabPlan && isNewerCoachPlan(tabPlan, useStore.getState().lastAcceptedPlanAt);
    // A plan this session has not put in front of the person yet opens the
    // review itself. That is the whole point of syncing on launch: the plan
    // arrives and says so, rather than waiting to be found on the Plan tab.
    const unseen = offered === true && tabPlan?.issuedAt !== seenThisSession;
    set({
      pendingCoachPlan: offered ? tabPlan : undefined,
      coachPlanNeedsUpdate: needsUpdate,
      // A plan that cannot be read opens the review too. It has nothing to
      // show but the reason, which is the whole message.
      ...(unseen || needsUpdate ? { planReviewOpen: true } : {}),
    });

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
  });

  if (!response.ok) {
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
