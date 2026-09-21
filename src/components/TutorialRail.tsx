import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useTutorialStore } from "../lib/tutorial-store";
import { tutorialInterrupted } from "../lib/tutorial-state";
import { readSeen } from "../lib/tutorial-seen";
import { loadPendingCoach } from "../lib/pending-coach";
import { useInstallMode } from "../lib/install-prompt";
import { useStore } from "../lib/store";
import { useSyncStore } from "../lib/sync-store";
import { TutorialCursor } from "./TutorialCursor";
import { TutorialSpotlight } from "./TutorialSpotlight";

/**
 * The tutorial rail: one line of instruction pinned to the bottom.
 *
 * ## How it works
 *
 * Portalled directly to `document.body` at `z-[55]`, above the spotlight
 * (`z-[54]`) and full-screen overlays like `ExerciseScreen` (`z-50`), below
 * `Toast` (`z-[60]`). It renders the current step's line, a "Show me" that
 * replays the demo, and - on the steps that depend on Google - a way past.
 *
 * ## It drives the app, not just the commentary
 *
 * A step names the screen it happens on, and the rail navigates there. The
 * tutorial used to start on Today and hope; the first thing a new client
 * actually has to do is in Settings, two taps away, and "go to Settings" as an
 * instruction is where most of them stopped.
 *
 * ## Why the snapshot is read every tick and not memoised
 *
 * Half of what a step waits for is in the DOM: whether a sheet is up, which set
 * row is open, whether the summary has mounted. Those were once read inside a
 * `useMemo` keyed on store values only, so opening Bench Press - which changes
 * no store value, because it is already the current lift - left the snapshot
 * stale and the step never completed. That one bug was four separate reports:
 * the instruction that would not go away, the rail stuck over the summary's
 * Done button, and both ends of the cardio flow.
 *
 * So the snapshot is assembled fresh on every render, and a timer re-renders
 * while the tutorial is up. Two hundred milliseconds of polling for the length
 * of an onboarding is not a cost worth a correctness argument.
 *
 * ## Height reservation
 *
 * The rail measures itself and writes `--rail-h` onto `document.documentElement`
 * (`0px` when inactive). `workout.tsx`, `ExerciseScreen.tsx` and the workout
 * summary add `var(--rail-h, 0px)` to their bottom padding, so the rail never
 * covers the control it is talking about.
 */
export function TutorialRail(): ReactElement | null {
  const active = useTutorialStore((s) => s.active);
  const steps = useTutorialStore((s) => s.steps);
  const stepIndex = useTutorialStore((s) => s.step);
  const advance = useTutorialStore((s) => s.advance);
  const skipStep = useTutorialStore((s) => s.skipStep);
  const storeChooserOpen = useTutorialStore((s) => s.chooserOpen);
  const storeStartSheetOpen = useTutorialStore((s) => s.startSheetOpen);

  const hydrated = useStore((s) => s.hydrated);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const currentExerciseId = useStore((s) => s.currentExerciseId);
  const sets = useStore((s) => s.sets);
  const sessions = useStore((s) => s.sessions);
  const dailyLogs = useStore((s) => s.dailyLogs);
  const syncConfig = useSyncStore((s) => s.config);
  const googleAvailable = useSyncStore((s) => s.googleAvailable);

  const install = useInstallMode();
  const router = useRouter();
  const location = useLocation();

  const railRef = useRef<HTMLDivElement>(null);
  const [showMeTrigger, setShowMeTrigger] = useState(0);
  const [, setTick] = useState(0);

  const currentStep = active ? steps[stepIndex] : undefined;

  /**
   * Pick up an interrupted run.
   *
   * The whole of setting this app up happens across an OAuth popup, a trip to
   * the home screen and back, and whatever else the day does. A tutorial that
   * only ever started from the beginning would be one most people never
   * finished.
   */
  useEffect(() => {
    if (active || !hydrated) return;
    if (!tutorialInterrupted()) return;
    useTutorialStore.getState().start({
      canInstall: install.kind === "prompt" || install.kind === "manual-ios",
      resume: true,
    });
  }, [active, hydrated, install.kind]);

  // Re-read the world. See "Why the snapshot is read every tick" above.
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 200);
    return () => window.clearInterval(timer);
  }, [active]);

  // Measure and publish the rail's height.
  useEffect(() => {
    if (typeof document === "undefined") return;

    if (!active) {
      document.documentElement.style.setProperty("--rail-h", "0px");
      return;
    }

    const measure = () => {
      if (railRef.current) {
        document.documentElement.style.setProperty("--rail-h", `${railRef.current.offsetHeight}px`);
      }
    };

    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      document.documentElement.style.setProperty("--rail-h", "0px");
    };
  }, [active, stepIndex]);

  // Take the user to the screen this step happens on.
  useEffect(() => {
    if (!active || !currentStep?.route) return;
    if (location.pathname === currentStep.route) return;
    try {
      void router.navigate({ to: currentStep.route });
    } catch {
      // Outside a live router (tests), the rail still narrates.
    }
  }, [active, currentStep?.route, location.pathname, router]);

  const seen = readSeen({
    activeSessionId,
    currentExerciseId,
    sets,
    sessions,
    dailyLogs,
    sheetConnected: syncConfig?.kind === "google" && Boolean(syncConfig.spreadsheetId),
    sheetPossible: googleAvailable(),
    installedNow: install.kind === "installed",
    storeChooserOpen,
    storeStartSheetOpen,
  });

  // Drive the progression.
  useEffect(() => {
    if (!active || !currentStep) return;
    // A step with nothing on screen to point at is passed in silence. Saying
    // "give Marcus access to it" over a Settings screen with no share control
    // on it is the failure the spotlight exists to prevent.
    if (currentStep.unreachable?.(seen) || currentStep.done(seen)) advance();
  }, [active, currentStep, seen, advance]);

  if (!active || !currentStep || typeof document === "undefined") return null;

  const handleShowMe = () => {
    setShowMeTrigger((t) => t + 1);
    window.dispatchEvent(new CustomEvent("tutorial-show-me"));
  };

  const coachName = loadPendingCoach()?.name ?? "your coach";
  const say = currentStep.say.replace("{coach}", coachName);

  return createPortal(
    <>
      <TutorialSpotlight target={currentStep.target} zoomKey={showMeTrigger} />
      <TutorialCursor target={currentStep.target} trigger={showMeTrigger} />
      <div
        ref={railRef}
        role="region"
        aria-label="Tutorial instructions"
        // Which step this is, on the element that says it. The rail is the one
        // place the current step is unambiguous, and an end-to-end driver that
        // has to infer it from the copy is a driver that breaks when the copy
        // is edited.
        data-tutorial-step={currentStep.id}
        data-tutorial-target={currentStep.target}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
        className="fixed inset-x-0 bottom-0 z-[55] border-t border-rule bg-surface px-4 pt-2.5 shadow-md"
      >
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <p aria-live="polite" className="min-w-0 flex-1 t-body font-medium text-ink">
            {say}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {/* Only where the app cannot finish the job on its own: a declined
                consent screen, no Google account, a build with no client id.
                See "Nothing is a dead end" in tutorial.ts. */}
            {currentStep.skippable && (
              <button
                type="button"
                onClick={skipStep}
                className="flex min-h-[44px] items-center px-1 t-label text-ink-2"
              >
                Skip
              </button>
            )}
            {/* Outlined. It used to be bare text beside a sentence, in the same
                weight as the sentence, so the one control on the rail read as
                the last two words of the instruction. */}
            <button
              type="button"
              onClick={handleShowMe}
              className="flex min-h-[44px] items-center rounded-md border border-ink/35 px-3 t-body font-semibold text-ink"
            >
              Show me
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
