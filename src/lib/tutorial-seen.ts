import { dayKey } from "./daily-log";
import { loadPendingCoach } from "./pending-coach";
import { isCardioSession, useStore } from "./store";
import { loadTutorialState } from "./tutorial-state";
import { type TutorialSeen } from "./tutorial";

/**
 * What the app currently looks like, assembled from the store, the DOM and the
 * two facts that live in localStorage.
 *
 * Exported for the test suite, which drives it directly rather than mounting
 * the whole app to reach one predicate.
 */
export function readSeen({
  activeSessionId,
  currentExerciseId,
  sets,
  sessions,
  dailyLogs,
  sheetConnected,
  installedNow,
  storeChooserOpen,
  storeStartSheetOpen,
}: {
  activeSessionId?: string;
  currentExerciseId?: string;
  sets: ReturnType<typeof useStore.getState>["sets"];
  sessions: ReturnType<typeof useStore.getState>["sessions"];
  dailyLogs: ReturnType<typeof useStore.getState>["dailyLogs"];
  sheetConnected: boolean;
  installedNow: boolean;
  storeChooserOpen: boolean;
  storeStartSheetOpen: boolean;
}): TutorialSeen {
  const has = (marker: string) =>
    typeof document !== "undefined" &&
    document.querySelector(`[data-tutorial="${marker}"]`) !== null;

  const region = (name: string) =>
    typeof document !== "undefined" &&
    document.querySelector(`[data-tutorial-region="${name}"]`) !== null;

  const tutorialState = typeof window === "undefined" ? undefined : loadTutorialState();
  const coach = typeof window === "undefined" ? undefined : loadPendingCoach();

  let editingRow: number | undefined;
  if (typeof document !== "undefined") {
    if (document.getElementById("set-1-weight")) editingRow = 1;
    else if (document.getElementById("set-2-weight")) editingRow = 2;
    else if (document.getElementById("set-3-weight")) editingRow = 3;
  }

  const durationField =
    typeof document === "undefined"
      ? null
      : (document.getElementById("cardio-duration") as HTMLInputElement | null);

  const today = dayKey(new Date());

  return {
    installHandled:
      installedNow ||
      Boolean(tutorialState?.installedSeen) ||
      Boolean(tutorialState?.installOffered),
    sheetConnected,
    sharedWithCoach: coach?.sharedAt !== undefined,
    bodyweightLogged: dailyLogs.some((l) => l.date === today && l.bodyweight !== undefined),
    startSheetOpen: storeStartSheetOpen || has("start-confirm"),
    activeSessionId,
    // The summary screen says so itself. This used to be inferred from the URL
    // plus the absence of the End button, which is also true of the moment
    // before the summary mounts.
    exerciseScreenOpen: has("exercise-back"),
    currentExerciseId,
    sets: activeSessionId
      ? sets.filter((s) => s.sessionId === activeSessionId).sort((a, b) => a.loggedAt - b.loggedAt)
      : [],
    editingRow,
    summaryShown:
      typeof document !== "undefined" && document.querySelector("[data-summary-screen]") !== null,
    chooserOpen: storeChooserOpen || has("chooser-cardio") || region("cardio-picker"),
    cardioPickerOpen: region("cardio-picker"),
    cardioFormOpen: has("cardio-duration"),
    cardioDurationTyped: (durationField?.value ?? "").trim() !== "",
    cardioLogged: sessions.some((s) => isCardioSession(s)),
  };
}
