import { useState } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { useStore } from "../lib/store";

/**
 * Red trash-icon button that deletes an entire logged workout after a
 * confirmation sheet. Used in the workout-review headers (in-workout "View
 * Workout" overlay and the /session/$id screen). `onDeleted` fires after the
 * delete so the caller can navigate away / close the overlay.
 */
export function DeleteWorkoutButton({
  sessionId,
  onDeleted,
}: {
  sessionId: string;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const deleteSession = useStore((s) => s.deleteSession);

  const doDelete = () => {
    deleteSession(sessionId);
    setConfirming(false);
    onDeleted();
  };

  return (
    <>
      {/* The visible circle stays 36px so the header row it sits in keeps its
          height, while an inset pseudo-element carries the hit area out to 44px.
          Same trick as the switch in settings.tsx. */}
      <button
        onClick={() => setConfirming(true)}
        aria-label="Delete workout"
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-destructive after:absolute after:-inset-1 after:content-['']"
      >
        <Trash2 size={20} aria-hidden="true" />
      </button>

      {confirming &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-x-0 top-0 z-[70] flex h-[100dvh] items-end justify-center bg-black/40 anim-backdrop"
            onClick={() => setConfirming(false)}
          >
            <div
              className="w-full max-w-md rounded-t-3xl bg-surface p-5 anim-sheet"
              onClick={(e) => e.stopPropagation()}
              style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
              <h2 className="text-[17px] font-semibold tracking-tight">Delete this workout?</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                This permanently removes the session and all its sets. This can't be undone.
              </p>
              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => setConfirming(false)}
                  className="flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-muted py-3 text-[15px] font-medium text-muted-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={doDelete}
                  className="flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-destructive py-3 text-[15px] font-semibold text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
