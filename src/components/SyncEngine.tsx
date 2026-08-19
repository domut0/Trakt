import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { useSyncStore } from "@/lib/sync-store";
import { syncSourceChanged } from "@/lib/sync";

/**
 * Schedules sheet syncs. Renders nothing.
 *
 * Mounted in __root.tsx beside StoreHydrator, which is where the app keeps its
 * client-only concerns. The app had no effect layer for this before: nothing
 * else in the tree listens for visibilitychange or online.
 */

/** Quiet period after the last change before pushing. */
const IDLE_DEBOUNCE_MS = 10_000;

/**
 * Longer while a workout is in progress. Every push rewrites the whole history,
 * and during a straight-set block the user logs a set every thirty seconds. The
 * sheet being a minute behind mid-session costs nothing.
 */
const ACTIVE_SESSION_DEBOUNCE_MS = 60_000;

/** Retry schedule after a failure, in ms. The last value repeats. */
const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];

export function SyncEngine() {
  const hydrateSync = useSyncStore((s) => s.hydrate);

  useEffect(() => {
    void hydrateSync();
  }, [hydrateSync]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let disposed = false;

    const clearTimers = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (retryTimer) clearTimeout(retryTimer);
      debounceTimer = undefined;
      retryTimer = undefined;
    };

    const run = async () => {
      if (disposed) return;
      await useSyncStore.getState().syncNow();
      if (disposed) return;

      const { status } = useSyncStore.getState();
      if (status === "error" || status === "offline") {
        // "blocked" is deliberately absent: it means the user has to do
        // something, and retrying a rejected secret forever helps nobody.
        const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
        failures += 1;
        retryTimer = setTimeout(() => void run(), delay);
      } else {
        failures = 0;
      }
    };

    const schedule = (delay: number) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void run(), delay);
    };

    const unsubscribe = useStore.subscribe((state, previous) => {
      if (!syncSourceChanged(state, previous)) return;
      useSyncStore.getState().markPending();
      schedule(state.activeSessionId ? ACTIVE_SESSION_DEBOUNCE_MS : IDLE_DEBOUNCE_MS);
    });

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // Leaving the app is the last chance to flush before the tab is frozen.
        // Best effort: a backgrounded fetch may not finish, in which case the
        // pending flag survives and the next foreground picks it up.
        if (useSyncStore.getState().pending) void run();
        return;
      }
      if (useSyncStore.getState().pending) void run();
    };

    const onOnline = () => {
      failures = 0;
      if (useSyncStore.getState().pending) void run();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    return () => {
      disposed = true;
      clearTimers();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return null;
}
