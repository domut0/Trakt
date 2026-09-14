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
import { pullFromSheet } from "./sync-client";
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

export type CoachError = "unreachable" | "unreadable" | "not-configured";

export interface ViewingClient {
  client: CoachClient;
  /** When the snapshot on screen was pulled. The banner says how stale it is. */
  pulledAt: number;
}

export interface CoachState {
  enabled: boolean;
  clients: CoachClient[];
  hydrated: boolean;
  viewing?: ViewingClient;
  /** True while a client's data is being fetched. */
  loading: boolean;
  lastError?: CoachError;

  hydrate: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  addClient: (client: CoachClient) => Promise<void>;
  removeClient: (id: string) => Promise<void>;
  enterClientView: (id: string) => Promise<boolean>;
  exitClientView: () => void;
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
  // The Sheets API transport lands with Phase A; until then a Google-backed
  // client cannot be opened, and says so rather than failing obscurely.
  return { ok: false, error: "not-configured" };
}

export const useCoachStore = create<CoachState>((set, get) => ({
  enabled: false,
  clients: [],
  hydrated: false,
  loading: false,

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
      set({ viewing: { client, pulledAt }, loading: false });
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

/** True when the main store currently holds someone else's data. */
export function isViewingClient(): boolean {
  return useCoachStore.getState().viewing !== undefined;
}
