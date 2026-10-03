import { create } from "zustand";
import type { CoachClient } from "./db";
import { buildClientSnapshot, type ClientSnapshot } from "./client-snapshot";
import { getAccessToken } from "./google-auth";
import { pullTabs } from "./sync-client-google";
import type { SyncErrorCode } from "./sync-protocol";

export type ProgressError = SyncErrorCode | "not-configured";
const transportErrors = [
  "bad-secret",
  "busy",
  "network",
  "needs-consent",
  "popup-blocked",
  "timeout",
  "unreadable",
] as const;
export interface ProgressEntry {
  spreadsheetId?: string;
  snapshot?: ClientSnapshot;
  fetchedAt?: number;
  loading?: boolean;
  error?: ProgressError;
}
interface ProgressState {
  entries: Record<string, ProgressEntry>;
  refreshing: boolean;
  refresh: (clients: CoachClient[], interactive?: boolean) => Promise<void>;
  retainClients: (clients: CoachClient[]) => void;
}

/** Ephemeral read-only roster snapshots. Nothing reaches IndexedDB or the main store. */
export const useCoachProgressStore = create<ProgressState>((set, get) => ({
  entries: {},
  refreshing: false,
  retainClients: (clients) => {
    const entries: Record<string, ProgressEntry> = {};
    for (const client of clients) {
      const previous = get().entries[client.id];
      if (previous && previous.spreadsheetId === client.spreadsheetId)
        entries[client.id] = previous;
    }
    set({ entries });
  },
  refresh: async (clients, interactive = false) => {
    if (get().refreshing || clients.length === 0) return;
    set((state) => ({
      refreshing: true,
      entries: {
        ...state.entries,
        ...Object.fromEntries(
          clients.map((client) => [
            client.id,
            {
              ...(state.entries[client.id]?.spreadsheetId === client.spreadsheetId
                ? state.entries[client.id]
                : {}),
              spreadsheetId: client.spreadsheetId,
              loading: true,
              error: undefined,
            },
          ]),
        ),
      },
    }));
    const update = (client: CoachClient, patch: Partial<ProgressEntry>) => {
      // An in-flight response must not resurrect a removed or replaced client.
      if (
        !get().entries[client.id] ||
        get().entries[client.id].spreadsheetId !== client.spreadsheetId
      )
        return;
      set((state) => ({
        entries: { ...state.entries, [client.id]: { ...state.entries[client.id], ...patch } },
      }));
    };
    try {
      // Only an explicit Refresh/Connect tap can obtain fresh authorization.
      // One token request precedes all workers; every Sheets read is cache-only.
      if (interactive && clients.some((client) => client.spreadsheetId)) {
        try {
          await getAccessToken({ interactive: true });
        } catch (error) {
          const code = error instanceof Error ? error.message : "network";
          for (const client of clients)
            update(client, {
              loading: false,
              error:
                !client.spreadsheetId || code === "no-client-id"
                  ? "not-configured"
                  : code === "popup-blocked"
                    ? "popup-blocked"
                    : code === "needs-consent"
                      ? "needs-consent"
                      : "network",
            });
          return;
        }
      }
      let next = 0;
      const worker = async () => {
        while (next < clients.length) {
          const client = clients[next++];
          if (!client.spreadsheetId) {
            update(client, { loading: false, error: "not-configured" });
            continue;
          }
          try {
            const reply = await pullTabs(client.spreadsheetId, { interactive: false });
            if (!reply.ok) {
              update(client, {
                loading: false,
                error: transportErrors.find((code) => code === reply.error) ?? "network",
              });
              continue;
            }
            update(client, {
              snapshot: buildClientSnapshot(reply.tabs),
              fetchedAt: Date.now(),
              loading: false,
              error: undefined,
            });
          } catch {
            update(client, { loading: false, error: "network" });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, clients.length) }, worker));
    } finally {
      set({ refreshing: false });
    }
  },
}));
