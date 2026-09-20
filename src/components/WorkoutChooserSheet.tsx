import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { CardioLogCard } from "./CardioLogCard";

function StrengthIcon() {
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12h2M4 9v6M6 12h2M9 8v8M15 8v8M16 12h2M18 9v6M20 12h2" />
    </svg>
  );
}

function CardioIcon() {
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12h4l2 6 4-12 2 6h6" />
    </svg>
  );
}

/**
 * Opened by the nav bar's Workout button when no session is active. A single
 * centred popup that starts as a two-way chooser (Strength / Cardio) and, if
 * Cardio is tapped, swaps its own content for CardioLogCard in place - one
 * surface changing what it shows, not a second modal stacked on top.
 *
 * Strength instead delegates out: it closes this popup and hands off to
 * `onChooseStrength`, which the caller (AppShell) wires to the existing
 * StartWorkoutSheet.
 */
export function WorkoutChooserSheet({
  open,
  onClose,
  onChooseStrength,
  startOn = "choose",
}: {
  open: boolean;
  onClose: () => void;
  onChooseStrength: () => void;
  /** Which screen to open on. "cardio" skips the chooser, for a day whose plan
   *  already says it is a cardio day - the question has an answer, so asking it
   *  would be the app pretending not to know. Back still returns to the
   *  chooser, because a plan is not a cage. */
  startOn?: "choose" | "cardio";
}) {
  const [mode, setMode] = useState<"choose" | "cardio">(startOn);

  useEffect(() => {
    if (open) setMode(startOn);
  }, [open, startOn]);

  // Escape closes the whole popup even from cardio mode, matching what a
  // backdrop tap already does from there. CardioLogCard's own Back button is
  // the way to step back to the chooser without discarding the popup.
  //
  // Above the guard below, deliberately: hooks cannot live after a return.
  useSheetDismiss(open, onClose);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-6 anim-backdrop"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-surface p-5 anim-popup rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {mode === "choose" ? (
          <div>
            <div className="mx-auto mb-1 h-1 w-10 bg-border" />
            <h2 className="mt-3 text-center t-heading font-medium text-ink-2">Log a workout</h2>
            <div className="mt-5 flex items-center justify-center gap-10 py-2">
              <button
                type="button"
                onClick={onChooseStrength}
                aria-label="Log strength training workout"
                className="flex flex-col items-center gap-2"
              >
                <span className="flex h-20 w-20 items-center justify-center bg-ink text-paper rounded-lg">
                  <StrengthIcon />
                </span>
                <span className="t-label font-medium text-ink">Strength training</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("cardio")}
                aria-label="Log cardio workout"
                className="flex flex-col items-center gap-2"
              >
                <span className="flex h-20 w-20 items-center justify-center bg-wash text-ink">
                  <CardioIcon />
                </span>
                <span className="t-label font-medium text-ink">Cardio</span>
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 flex min-h-[44px] w-full items-center justify-center py-3 t-body font-medium text-ink-2"
            >
              Cancel
            </button>
          </div>
        ) : (
          <CardioLogCard onBack={() => setMode("choose")} onDone={onClose} />
        )}
      </div>
    </div>,
    document.body,
  );
}
