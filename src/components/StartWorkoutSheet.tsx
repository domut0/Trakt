import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { useStore } from "../lib/store";

export function StartWorkoutSheet({
  open,
  onClose,
  onStart,
}: {
  open: boolean;
  onClose: () => void;
  onStart: (sessionId: string) => void;
}) {
  const slots = useStore((s) => s.slots);
  const predicted = useStore((s) => s.predictedNextSlotName());
  const startWorkout = useStore((s) => s.startWorkout);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, predicted]);

  // Above the guard below, deliberately: hooks cannot live after a return.
  //
  // This sheet is the reason the lock is reference-counted rather than a plain
  // boolean. AppShell hands off from WorkoutChooserSheet by closing it and
  // opening this one in one batched update, so the chooser's cleanup and this
  // sheet's setup land in the same commit, cleanup first. A per-sheet lock
  // would unlock the page in between.
  useSheetDismiss(open, onClose);

  if (!open || typeof document === "undefined") return null;

  const trimmed = value.trim();
  const suggestions = trimmed
    ? slots
        .filter(
          (s) =>
            s.name.toLowerCase().includes(trimmed.toLowerCase()) &&
            s.name.toLowerCase() !== trimmed.toLowerCase(),
        )
        .slice(0, 4)
    : [];

  const handleStart = (name?: string) => {
    const n = (name ?? value).trim() || (predicted ?? "");
    if (!n) return;
    const id = startWorkout(n);
    onStart(id);
  };

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center bg-black/25 anim-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-surface p-5 pb-8 anim-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
        <h2 className="t-caption text-muted-foreground">Today's session</h2>
        <input
          ref={inputRef}
          aria-label="Today's session name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={predicted ? `suggested: ${predicted}` : "Heavy Bench, D2, Arms…"}
          className="mt-2 w-full bg-transparent t-title font-semibold tracking-tight outline-none placeholder:t-title placeholder:font-normal placeholder:text-muted-foreground"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleStart();
          }}
        />
        {suggestions.length > 0 && (
          <ul className="mt-3 group-list bg-muted/40">
            {suggestions.map((s, idx) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => handleStart(s.name)}
                  className={`group-row w-full text-left t-body text-foreground hover:bg-muted ${
                    idx > 0 ? "group-row-sep" : ""
                  }`}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[44px] rounded-full py-3 t-body font-medium text-muted-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleStart()}
            disabled={!(trimmed || predicted)}
            className="flex-[2] min-h-[44px] rounded-full bg-accent py-3 t-body font-semibold text-accent-foreground disabled:opacity-40"
          >
            Start
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
