import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { TUTORIAL_STEPS, type TutorialSeen } from "../lib/tutorial";
import { useTutorialStore } from "../lib/tutorial-store";
import { useStore } from "../lib/store";
import { TutorialCursor } from "./TutorialCursor";

/**
 * The tutorial rail: one line of instruction pinned to the bottom.
 *
 * ## How it works
 *
 * Portalled directly to `document.body` at `z-[55]`, above full-screen overlays
 * like `ExerciseScreen` (`z-50`) but below `Toast` (`z-[60]`). It renders
 * whatever line the current step prescribes, along with a "Show me" action
 * that triggers the live dot cursor.
 *
 * ## Not a sheet
 *
 * It does not use `useSheetDismiss`. Escape must continue to dismiss modal
 * screens (like the exercise screen) rather than closing the teacher.
 *
 * ## Height reservation
 *
 * The rail reserves its own height by measuring its rendered DOM element and
 * writing `--rail-h` onto `document.documentElement` (`0px` when inactive or
 * unmounted). Both `workout.tsx` and `ExerciseScreen.tsx` add `var(--rail-h, 0px)`
 * to their bottom padding so that the pinned rail never covers "+ Add set" or
 * the bottom action row.
 *
 * ## Reactive step advancement
 *
 * The rail listens to store updates and observes DOM mutations while active,
 * assembling a `TutorialSeen` snapshot per tick. When a step predicate reports
 * `done(seen) === true`, the rail advances to the next step. When step 9
 * finishes, it calls `finish()`.
 */
export function TutorialRail(): ReactElement | null {
  const active = useTutorialStore((s) => s.active);
  const step = useTutorialStore((s) => s.step);
  const advance = useTutorialStore((s) => s.advance);
  const finish = useTutorialStore((s) => s.finish);
  const storeChooserOpen = useTutorialStore((s) => s.chooserOpen);
  const storeStartSheetOpen = useTutorialStore((s) => s.startSheetOpen);

  const activeSessionId = useStore((s) => s.activeSessionId);
  const currentExerciseId = useStore((s) => s.currentExerciseId);
  const sets = useStore((s) => s.sets);

  const railRef = useRef<HTMLDivElement>(null);
  const [showMeTrigger, setShowMeTrigger] = useState(0);
  const [, setDomTick] = useState(0);

  // Watch for DOM changes (dialog portals mounting/unmounting, input focus, row expansion)
  useEffect(() => {
    if (!active || typeof document === "undefined") return;

    const observer = new MutationObserver(() => {
      setDomTick((t) => t + 1);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-tutorial", "aria-expanded"],
    });

    return () => observer.disconnect();
  }, [active]);

  // Measure height and set --rail-h on document.documentElement
  useEffect(() => {
    if (typeof document === "undefined") return;

    if (!active) {
      document.documentElement.style.setProperty("--rail-h", "0px");
      return;
    }

    const measure = () => {
      if (railRef.current) {
        const h = railRef.current.offsetHeight;
        document.documentElement.style.setProperty("--rail-h", `${h}px`);
      }
    };

    measure();
    window.addEventListener("resize", measure);

    return () => {
      window.removeEventListener("resize", measure);
      document.documentElement.style.setProperty("--rail-h", "0px");
    };
  }, [active, step]);

  const currentStep = TUTORIAL_STEPS[step];

  // Assemble current TutorialSeen snapshot
  const seen: TutorialSeen = useMemo(() => {
    const sessionSets = activeSessionId
      ? sets.filter((s) => s.sessionId === activeSessionId).sort((a, b) => a.loggedAt - b.loggedAt)
      : [];

    let editingRow: number | undefined;
    if (typeof document !== "undefined") {
      if (document.getElementById("set-1-weight")) editingRow = 1;
      else if (document.getElementById("set-2-weight")) editingRow = 2;
      else if (document.getElementById("set-3-weight")) editingRow = 3;
    }

    const exerciseScreenOpen =
      typeof document !== "undefined" &&
      document.querySelector('[data-tutorial="exercise-back"]') !== null;

    const chooserOpen =
      storeChooserOpen ||
      (typeof document !== "undefined" &&
        document.querySelector('[data-tutorial="chooser-strength"]') !== null);

    const startSheetOpen =
      storeStartSheetOpen ||
      (typeof document !== "undefined" &&
        document.querySelector('[data-tutorial="start-confirm"]') !== null);

    // The summary screen says so itself. This used to fall back to "we are on
    // /workout, there is no active session, and the End button is gone", which
    // is also true of the moment before the summary mounts and of a /workout
    // visited with nothing running - so the last step could complete without
    // the user having seen anything.
    const summaryShown =
      typeof document !== "undefined" && document.querySelector("[data-summary-screen]") !== null;

    return {
      chooserOpen,
      startSheetOpen,
      activeSessionId,
      exerciseScreenOpen,
      currentExerciseId,
      sets: sessionSets,
      editingRow,
      summaryShown,
    };
  }, [activeSessionId, currentExerciseId, sets, storeChooserOpen, storeStartSheetOpen]);

  // Drive step progression
  useEffect(() => {
    if (!active || !currentStep) return;

    if (currentStep.done(seen)) {
      if (step >= TUTORIAL_STEPS.length - 1) {
        finish();
      } else {
        advance();
      }
    }
  }, [active, step, currentStep, seen, advance, finish]);

  if (!active || !currentStep || typeof document === "undefined") {
    return null;
  }

  const handleShowMe = () => {
    setShowMeTrigger((t) => t + 1);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("tutorial-show-me"));
    }
  };

  return createPortal(
    <>
      <TutorialCursor target={currentStep.target} trigger={showMeTrigger} />
      <div
        ref={railRef}
        role="region"
        aria-label="Tutorial instructions"
        style={{
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)",
        }}
        className="fixed inset-x-0 bottom-0 z-[55] bg-surface border-t border-rule px-4 pt-2.5 shadow-md"
      >
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <p className="min-w-0 flex-1 t-body font-medium text-ink">{currentStep.say}</p>
          <button
            type="button"
            onClick={handleShowMe}
            className="shrink-0 flex min-h-[44px] items-center t-action t-body font-semibold text-ink"
          >
            Show me
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
