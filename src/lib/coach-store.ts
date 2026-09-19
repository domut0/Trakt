import { create } from "zustand";
import {
  deleteCoachClient,
  loadCoachClients,
  saveCoachClient,
  setDbReadOnly,
  type CoachClient,
} from "./db";
import { useStore } from "./store";
import { buildClientSnapshot, type ClientSnapshot } from "./client-snapshot";
import { pullFromSheet, putPlanOnSheet, type SyncFail, type SyncResponse } from "./sync-client";
import { pullTabs, putPlanTab } from "./sync-client-google";
import {
  buildPlanTab,
  diffPlan,
  planFromStore,
  type PlanChange,
  type PlanPayload,
} from "./plan-tab";
import type { CellValue } from "./csv";

/**
 * Coach mode: looking at a client's app, and writing them a plan.
 *
 * ## How "Bob's Trakt" works
 *
 * Today, Charts and History are not reimplemented for a client. They read the
 * arrays on the main store, so coach mode swaps those arrays for a client's and
 * every screen renders their data unmodified. The coach's own state is kept
 * here, in memory, and put back on exit.
 *
 * That trick is only safe because of the read-only latch. The store's write
 * paths are still wired to the COACH's IndexedDB while a client's data is in
 * them, so `enterClientView` holds the database read-only for the entire
 * duration and every durable write is refused at the chokepoint. Order matters:
 * the latch goes on before the arrays are swapped and comes off after they are
 * put back, so there is no instant where a write could land on the wrong data.
 *
 * ## Why a separate store
 *
 * Same reason `sync-store` is separate. Sync is scheduled by subscribing to the
 * main store, so coach state living there would make entering a client's view
 * look like a local edit and schedule a push -- of the client's data, to the
 * coach's own sheet. Keeping them apart makes that impossible rather than
 * merely guarded against.
 */

/**
 * The slice of main-store state a client's snapshot replaces.
 *
 * Listed explicitly rather than spread, so that a field added to the store
 * later is a compile error here if it should travel, and silently left alone if
 * it should not.
 */
const SWAPPED_KEYS = [
  "exercises",
  "slots",
  "sessions",
  "sets",
  "dailyLogs",
  "nutritionPhases",
  "plannedDays",
  "unit",
  "activeSessionId",
  "currentExerciseId",
  "currentBlock",
  "nextSlotId",
  "restSince",
  "lastAcceptedPlanAt",
] as const;

type SwappedKey = (typeof SWAPPED_KEYS)[number];
type Swapped = Pick<ReturnType<typeof useStore.getState>, SwappedKey>;

function captureOwnState(): Swapped {
  const state = useStore.getState();
  const out = {} as Record<string, unknown>;
  for (const key of SWAPPED_KEYS) out[key] = state[key];
  return out as Swapped;
}

/** A snapshot as main-store state. Workout-in-progress fields are always clear:
 * a client's live session is not something a coach can be inside. */
function asStoreState(snapshot: ClientSnapshot): Swapped {
  return {
    exercises: snapshot.exercises,
    slots: snapshot.slots,
    sessions: snapshot.sessions,
    sets: snapshot.sets,
    dailyLogs: snapshot.dailyLogs,
    nutritionPhases: snapshot.nutritionPhases,
    plannedDays: snapshot.plannedDays,
    unit: snapshot.unit,
    activeSessionId: undefined,
    currentExerciseId: undefined,
    currentBlock: undefined,
    nextSlotId: undefined,
    restSince: undefined,
    lastAcceptedPlanAt: undefined,
  };
}

export type CoachError = "unreachable" | "unreadable" | "not-configured" | "needs-consent";

export interface ViewingClient {
  client: CoachClient;
  /** When the snapshot on screen was pulled. The banner says how stale it is. */
  pulledAt: number;
  /**
   * The plan as it stood in the sheet when this view opened.
   *
   * Kept so that "has the coach changed anything" is answerable without
   * re-reading the sheet, and so the Save button can show exactly what it is
   * about to send.
   */
  planAtOpen?: PlanPayload;
}

export interface CoachState {
  enabled: boolean;
  clients: CoachClient[];
  hydrated: boolean;
  viewing?: ViewingClient;
  /** True while a client's data is being fetched. */
  loading: boolean;
  /** True while a plan is being written to a client's sheet. */
  saving: boolean;
  lastError?: CoachError;

  hydrate: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  addClient: (client: CoachClient) => Promise<void>;
  removeClient: (id: string) => Promise<void>;
  enterClientView: (id: string) => Promise<boolean>;
  exitClientView: () => void;
  /**
   * What the coach has changed since opening this client, as review lines.
   *
   * Reads the LIVE store, because the Plan tab edits it directly -- coach mode
   * has replaced the store's contents with the client's, so the ordinary Plan
   * screen editing ordinary store state is exactly right, and the latch stops
   * any of it reaching disk.
   */
  pendingChanges: () => PlanChange[];
  /** Writes the edited plan to the client's sheet. */
  saveClientPlan: () => Promise<boolean>;
}

/** Maps a Sheets API failure onto what the coach is told. */
function coachErrorFor(code: SyncFail["error"]): CoachError {
  if (code === "needs-consent") return "needs-consent";
  if (code === "unreadable" || code === "bad-secret") return "unreadable";
  return "unreachable";
}

/** Pulls a client's tabs. Dispatches on how their sheet is reached. */
async function pullClientTabs(
  client: CoachClient,
): Promise<{ ok: true; tabs: Record<string, CellValue[][]> } | { ok: false; error: CoachError }> {
  if (client.kind === "appsScript") {
    if (!client.url || !client.secret) return { ok: false, error: "not-configured" };
    const reply = await pullFromSheet({
      url: client.url,
      secret: client.secret,
      // A coach reads; they never push, so the device id is only ever echoed
      // back. `pull` carries no device check, which is what makes reading a
      // client's sheet possible without claiming it.
      deviceId: "coach",
    });
    if (!reply.ok) {
      return { ok: false, error: reply.error === "unreadable" ? "unreadable" : "unreachable" };
    }
    return { ok: true, tabs: reply.tabs ?? {} };
  }
  if (client.kind === "google") {
    if (!client.spreadsheetId) return { ok: false, error: "not-configured" };
    // Interactive, because opening a client is always a tap. A silent request
    // fails once the coach reloads or the hour-long token lapses, and coach
    // mode has no Reconnect button of its own to recover with.
    const reply = await pullTabs(client.spreadsheetId, { interactive: true });
    if (!reply.ok) return { ok: false, error: coachErrorFor(reply.error) };
    return { ok: true, tabs: reply.tabs ?? {} };
  }
  return { ok: false, error: "not-configured" };
}

export const useCoachStore = create<CoachState>((set, get) => ({
  enabled: false,
  clients: [],
  hydrated: false,
  loading: false,
  saving: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const clients = await loadCoachClients();
    // Coach mode turns itself on for anyone who has a client, so the toggle is
    // a way in rather than something to remember to switch back on.
    set({ clients, hydrated: true, enabled: clients.length > 0 });
  },

  setEnabled: (enabled) => set({ enabled }),

  addClient: async (client) => {
    await saveCoachClient(client);
    set({ clients: [...get().clients.filter((c) => c.id !== client.id), client], enabled: true });
  },

  removeClient: async (id) => {
    // Leaving a client's view open while deleting them would strand their data
    // on screen with nothing to exit back to.
    if (get().viewing?.client.id === id) get().exitClientView();
    await deleteCoachClient(id);
    set({ clients: get().clients.filter((c) => c.id !== id) });
  },

  enterClientView: async (id) => {
    const client = get().clients.find((c) => c.id === id);
    if (!client || get().viewing || get().loading) return false;

    set({ loading: true, lastError: undefined });
    try {
      const pulled = await pullClientTabs(client);
      if (!pulled.ok) {
        set({ loading: false, lastError: pulled.error });
        return false;
      }

      // The latch FIRST. From here until exit, no store action can reach the
      // coach's database, whatever the UI does.
      setDbReadOnly(`viewing ${client.name}`);
      ownState = captureOwnState();
      useStore.setState(asStoreState(buildClientSnapshot(pulled.tabs)));

      const pulledAt = Date.now();
      // Read back off the store rather than from `snapshot.plan`, so the
      // baseline is exactly what is on screen and "nothing changed yet" holds
      // by construction. A client whose sheet has no plan tab still has an
      // implied plan -- the cards synthesised from their logged history -- and
      // taking `undefined` as the baseline would show that whole split as the
      // coach's unsaved changes the moment their view opened.
      set({
        viewing: { client, pulledAt, planAtOpen: currentPlanFromStore() },
        loading: false,
      });
      // Best-effort bookkeeping; a failure here costs a timestamp, not data.
      void saveCoachClient({ ...client, lastPulledAt: pulledAt }).catch(() => {});
      return true;
    } catch {
      // Never leave the latch on with the coach's own data restored, or the app
      // would silently stop saving for the rest of the session.
      if (ownState) {
        useStore.setState(ownState);
        ownState = undefined;
      }
      setDbReadOnly(undefined);
      set({ loading: false, lastError: "unreachable", viewing: undefined });
      return false;
    }
  },

  pendingChanges: () => {
    const viewing = get().viewing;
    if (!viewing) return [];
    return diffPlan(viewing.planAtOpen, currentPlanFromStore());
  },

  saveClientPlan: async () => {
    const viewing = get().viewing;
    if (!viewing || get().saving) return false;
    const client = viewing.client;

    // Which sheet, and how to reach it, settled once up front so the send below
    // has nothing left to check.
    let send: (tab: CellValue[][]) => Promise<SyncResponse>;
    let errorFor: (code: SyncFail["error"]) => CoachError;
    if (client.kind === "appsScript" && client.url && client.secret) {
      const target = { url: client.url, secret: client.secret, deviceId: "coach" };
      send = (tab) => putPlanOnSheet(target, tab);
      errorFor = () => "unreachable";
    } else if (client.kind === "google" && client.spreadsheetId) {
      const id = client.spreadsheetId;
      send = (tab) => putPlanTab(id, tab);
      errorFor = coachErrorFor;
    } else {
      set({ lastError: "not-configured" });
      return false;
    }

    set({ saving: true, lastError: undefined });
    try {
      const plan = currentPlanFromStore();
      const reply = await send(buildPlanTab(plan));
      if (!reply.ok) {
        set({ saving: false, lastError: errorFor(reply.error) });
        return false;
      }
      // The new plan becomes the baseline, so Save goes quiet until the coach
      // changes something again rather than staying lit on work already sent.
      set({ viewing: { ...viewing, planAtOpen: plan }, saving: false });
      return true;
    } catch {
      set({ saving: false, lastError: "unreachable" });
      return false;
    }
  },

  exitClientView: () => {
    if (ownState) {
      useStore.setState(ownState);
      ownState = undefined;
    }
    // After the arrays are back, so there is no instant where a write could
    // land on a client's data.
    setDbReadOnly(undefined);
    set({ viewing: undefined });
  },
}));

/**
 * The coach's own state while a client's is on screen.
 *
 * Module-level rather than part of the store because it is not state anything
 * renders -- putting it in the store would publish the coach's whole log to
 * every subscriber for the duration, and invite a component to read the wrong
 * one of the two.
 */
let ownState: Swapped | undefined;

/**
 * The plan as the store currently holds it, issued by the coach.
 *
 * Stamped at read time rather than at save time so that the payload the review
 * screen shows and the payload that gets written are the same object -- an
 * issuedAt assigned during the save would make them differ by a field.
 */
function currentPlanFromStore(): PlanPayload {
  return planFromStore(useStore.getState(), { by: "coach", at: new Date().toISOString() });
}

/** True when the main store currently holds someone else's data. */
export function isViewingClient(): boolean {
  return useCoachStore.getState().viewing !== undefined;
}
