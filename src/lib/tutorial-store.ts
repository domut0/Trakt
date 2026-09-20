import { create } from "zustand";
import { setDbReadOnly } from "./db";
import { useStore } from "./store";
import { useCoachStore } from "./coach-store";
import { captureOwnState, type Swapped } from "./store-swap";
import { tutorialStoreState } from "./tutorial-fixture";
import { markTutorialDone } from "./tutorial-state";

/**
 * Tutorial mode: a sandboxed practice workout that teaches logging.
 *
 * ## How the sandbox works
 *
 * Just like coach mode ("Bob's Trakt"), we do not create a parallel logging
 * pipeline or mock screens for the tutorial. Every screen in the app — Today,
 * the workout runner, the exercise screen, set rows, and workout summary —
 * renders the store unmodified.
 *
 * To let a new client practise logging without corrupting their actual split,
 * history, or sync state, we swap the store's contents for fixture data
 * (`tutorialFixture`). The user's real state is captured in memory at module
 * scope and restored when the tutorial finishes or is skipped.
 *
 * ## The single most important invariant
 *
 * This trick is safe only because of the read-only latch (`setDbReadOnly`).
 * The store's write paths are still wired to the user's IndexedDB while fixture
 * data is in them, so `start()` latches the database read-only BEFORE any
 * state is touched, and keeps it read-only for the entire duration.
 *
 * Order matters critically:
 *   1. setDbReadOnly("tutorial")  <-- FIRST, before any state is swapped
 *   2. Capture user's own state
 *   3. Swap in fixture data
 *   ...
 *   4. Restore user's real state
 *   5. setDbReadOnly(undefined)   <-- LAST, after real state is back
 *
 * If the latch were ever left on with the user's real data back in the store,
 * the app would silently stop saving anything for the rest of the session,
 * with no error and no way for the user to know. Both the restore and the
 * unlatch go in a `finally` block to guarantee the latch is released.
 *
 * ## Why a separate store
 *
 * Same reason `coach-store` and `sync-store` are separate: sync subscribes
 * to the main store, so tutorial state living there would look like a local
 * edit and trigger sync pushes. Keeping tutorial state in its own store
 * isolates it completely.
 */

export interface TutorialStoreState {
  /** True while the sandbox is on. */
  active: boolean;
  /** 0-based index into the 9 steps. */
  step: number;

  start: () => boolean; // false if refused
  skip: () => void;
  finish: () => void;
  advance: () => void;
}

/**
 * The user's real state while the tutorial sandbox is active.
 *
 * Module-level rather than part of the store because it is not state anything
 * renders -- putting it in the store would publish the user's whole log to
 * every subscriber for the duration, and invite a component to read the wrong
 * one of the two.
 */
let ownState: Swapped | undefined;

function teardown(set: (state: Partial<TutorialStoreState>) => void): void {
  try {
    if (ownState) {
      const stateToRestore = ownState;
      ownState = undefined;
      useStore.setState(stateToRestore);
    }
  } finally {
    // AFTER the restore, always. Even if the restore throws, the latch must come off.
    setDbReadOnly(undefined);
    set({ active: false, step: 0 });
    markTutorialDone();
  }
}

export const useTutorialStore = create<TutorialStoreState>((set, get) => ({
  active: false,
  step: 0,

  start: () => {
    // 1. Refuse, before touching anything
    const main = useStore.getState();
    if (!main.hydrated) return false;
    if (main.activeSessionId) return false;
    if (useCoachStore.getState().viewing !== undefined) return false;
    if (get().active) return false;

    // 2. Latch FIRST. From here until finish/skip, no store action can reach IndexedDB.
    setDbReadOnly("tutorial");
    try {
      // 3. Capture
      ownState = captureOwnState();
      // 4. Swap
      useStore.setState(tutorialStoreState(main.unit));
      set({ active: true, step: 0 });
      return true;
    } catch {
      // Never leave the latch on with the user's own data back in the store.
      try {
        if (ownState) {
          useStore.setState(ownState);
          ownState = undefined;
        }
      } finally {
        setDbReadOnly(undefined);
        set({ active: false, step: 0 });
      }
      return false;
    }
  },

  skip: () => {
    teardown(set);
  },

  finish: () => {
    teardown(set);
  },

  advance: () => {
    if (!get().active) return;
    set((s) => ({ step: s.step + 1 }));
  },
}));

/** True when the tutorial sandbox is currently running. */
export function isTutorialActive(): boolean {
  return useTutorialStore.getState().active;
}
