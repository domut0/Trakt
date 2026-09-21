import { create } from "zustand";
import { setDbReadOnly } from "./db";
import { useStore } from "./store";
import { useCoachStore } from "./coach-store";
import { captureOwnState, type Swapped } from "./store-swap";
import { tutorialStoreState } from "./tutorial-fixture";
import { isSandboxed, resumePoint, stepsFor, type TutorialStep } from "./tutorial";
import { loadTutorialState, markTutorialDone, updateTutorialState } from "./tutorial-state";

/**
 * Tutorial mode: a guided run through everything that happens once.
 *
 * ## Two halves, and the line between them
 *
 * The first chapters - home screen, sheet, share, bodyweight - run on the REAL
 * app. There is no sandboxed way to create a file in somebody's Drive, and the
 * bodyweight they type is a real bodyweight. Keeping it is the honest thing to
 * do, and it costs nothing, because it was never in a sandbox to begin with.
 *
 * The sandbox latches on at the workout chapter and lifts at the end, so
 * exactly the two things that would otherwise land in someone's history - a
 * practice session and a practice cardio bout - are the two that are thrown
 * away.
 *
 * ## How the sandbox works
 *
 * Just like coach mode ("Bob's Trakt"), we do not create a parallel logging
 * pipeline or mock screens. Every screen in the app - Today, the workout
 * runner, the exercise screen, set rows, the summary - renders the store
 * unmodified. To let someone practise without corrupting their split, history
 * or sync state, we swap the store's contents for fixture data
 * (`tutorialFixture`). Their own state is captured in memory at module scope
 * and restored when the tutorial finishes or is skipped.
 *
 * ## The single most important invariant
 *
 * This trick is safe only because of the read-only latch (`setDbReadOnly`).
 * The store's write paths are still wired to the user's IndexedDB while fixture
 * data is in them, so the latch goes on BEFORE any state is touched, and stays
 * on for the whole sandboxed stretch.
 *
 * Order matters critically:
 *   1. setDbReadOnly("tutorial")  <-- FIRST, before any state is swapped
 *   2. Capture the user's own state
 *   3. Swap in fixture data
 *   ...
 *   4. Restore the user's real state
 *   5. setDbReadOnly(undefined)   <-- LAST, after real state is back
 *
 * If the latch were ever left on with real data back in the store, the app
 * would silently stop saving anything for the rest of the session, with no
 * error and no way for the user to know. Both the restore and the unlatch go in
 * a `finally` so the latch always comes off.
 *
 * ## Why a separate store
 *
 * Same reason `coach-store` and `sync-store` are separate: sync subscribes to
 * the main store, so tutorial state living there would look like a local edit
 * and trigger sync pushes. Keeping it in its own store isolates it completely.
 */

export interface TutorialStoreState {
  /** True while the tutorial is running. */
  active: boolean;
  /** The steps this device runs. Empty while inactive. */
  steps: readonly TutorialStep[];
  /** 0-based index into `steps`. */
  step: number;
  /** True while the fixture is in the store and the database is latched. */
  sandboxed: boolean;

  chooserOpen: boolean;
  startSheetOpen: boolean;

  setChooserOpen: (open: boolean) => void;
  setStartSheetOpen: (open: boolean) => void;

  /** Begins, or picks up where an interrupted run left off. False if refused. */
  start: (options?: { canInstall?: boolean; resume?: boolean }) => boolean;
  skip: () => void;
  finish: () => void;
  advance: () => void;
  /** Past a step the app cannot complete for reasons outside it. */
  skipStep: () => void;
}

/**
 * The user's real state while the sandbox is on.
 *
 * Module-level rather than part of the store because it is not state anything
 * renders -- putting it in the store would publish the user's whole log to
 * every subscriber for the duration, and invite a component to read the wrong
 * one of the two.
 */
let ownState: Swapped | undefined;

function enterSandbox(): boolean {
  if (ownState) return true;
  const main = useStore.getState();
  // 1. Latch FIRST. From here until teardown, no store action reaches IndexedDB.
  setDbReadOnly("tutorial");
  try {
    // 2. Capture, 3. Swap.
    ownState = captureOwnState();
    useStore.setState(tutorialStoreState(main.unit));
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
    }
    return false;
  }
}

function exitSandbox(): void {
  try {
    if (ownState) {
      const stateToRestore = ownState;
      ownState = undefined;
      useStore.setState(stateToRestore);
    }
  } finally {
    // AFTER the restore, always. Even if the restore throws, the latch comes off.
    setDbReadOnly(undefined);
  }
}

const IDLE = {
  active: false,
  steps: [] as readonly TutorialStep[],
  step: 0,
  sandboxed: false,
  chooserOpen: false,
  startSheetOpen: false,
};

export const useTutorialStore = create<TutorialStoreState>((set, get) => ({
  ...IDLE,

  setChooserOpen: (chooserOpen) => set({ chooserOpen }),
  setStartSheetOpen: (startSheetOpen) => set({ startSheetOpen }),

  start: ({ canInstall = false, resume = false } = {}) => {
    // Refuse, before touching anything.
    const main = useStore.getState();
    if (!main.hydrated) return false;
    if (main.activeSessionId) return false;
    if (useCoachStore.getState().viewing !== undefined) return false;
    if (get().active) return false;

    const steps = stepsFor({ canInstall });
    if (steps.length === 0) return false;

    // A resume lands at the start of the chapter it left, never mid-chapter:
    // the practice workout lives in memory only, so half of one is not a thing
    // to come back to.
    const step = resume ? resumePoint(steps, loadTutorialState()?.stepId) : 0;

    if (isSandboxed(steps[step].chapter) && !enterSandbox()) return false;

    set({
      active: true,
      steps,
      step,
      sandboxed: ownState !== undefined,
      chooserOpen: false,
      startSheetOpen: false,
    });
    updateTutorialState({ startedAt: Date.now(), stepId: steps[step].id });
    return true;
  },

  advance: () => {
    const { active, steps, step } = get();
    if (!active) return;

    const next = step + 1;
    if (next >= steps.length) {
      get().finish();
      return;
    }

    if (isSandboxed(steps[next].chapter) && !get().sandboxed) {
      // A sandbox that refuses to open is not a reason to strand somebody in a
      // tutorial: end it, with their own data back on screen.
      if (!enterSandbox()) {
        get().finish();
        return;
      }
    }

    set({ step: next, sandboxed: ownState !== undefined });
    updateTutorialState({ stepId: steps[next].id });
  },

  skipStep: () => {
    const { active, steps, step } = get();
    if (!active || !steps[step]?.skippable) return;
    get().advance();
  },

  skip: () => {
    exitSandbox();
    set({ ...IDLE });
    markTutorialDone();
  },

  finish: () => {
    exitSandbox();
    set({ ...IDLE });
    markTutorialDone();
  },
}));

/** True when the tutorial sandbox is currently running. */
export function isTutorialActive(): boolean {
  return useTutorialStore.getState().active;
}

/** True while fixture data is in the store. Exported for tests and assertions. */
export function isTutorialSandboxed(): boolean {
  return useTutorialStore.getState().sandboxed;
}
