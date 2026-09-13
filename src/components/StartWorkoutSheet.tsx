import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { dayKey } from "../lib/daily-log";
import { useStore, type Exercise } from "../lib/store";

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
  const exercises = useStore((s) => s.exercises);
  const setCurrentExercise = useStore((s) => s.setCurrentExercise);
  const pinnedSlotFor = useStore((s) => s.pinnedSlotFor);

  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
    }
  }, [open, predicted]);

  useSheetDismiss(open, onClose);

  /**
   * What the rotation says next, unless today is pinned.
   *
   * A pin is a fact the user recorded about this specific day, so it outranks
   * the rotation's guess. Everything here is still only a SUGGESTION: the slot
   * buttons and the free-text field both override it, which is the whole point
   * after a rest day, when the next slot is a genuinely free choice.
   */
  const suggestedName = useMemo(() => {
    if (!open) return undefined;
    return pinnedSlotFor(dayKey(new Date()))?.name ?? predicted;
  }, [open, pinnedSlotFor, predicted]);

  /** The lifts a slot is for, which now live on the slot rather than on a
   *  weekday. Resolved for whichever slot is about to be started. */
  const liftsFor = (name: string): Exercise[] => {
    const slot = slots.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!slot?.plannedExerciseIds) return [];
    return slot.plannedExerciseIds
      .map((id) => exercises.find((e) => e.id === id))
      .filter((e): e is Exercise => e !== undefined);
  };

  if (!open || typeof document === "undefined") return null;

  const trimmed = value.trim();
  const ordered = [...slots].sort((a, b) => a.rotationOrder - b.rotationOrder);
  /** Filtered only while the user is typing. With an empty field EVERY slot is
   *  listed, which is the fix for the thing that made this sheet hard to use:
   *  it used to show a lone grey placeholder, so choosing anything other than
   *  the suggestion meant typing it from memory. */
  const shown = trimmed
    ? ordered.filter((s) => s.name.toLowerCase().includes(trimmed.toLowerCase()))
    : ordered;

  const handleStart = (name?: string) => {
    const n = (name ?? value).trim() || (suggestedName ?? "");
    if (!n) return;
    const id = startWorkout(n);
    // Preload: the first planned lift becomes the current exercise, so the log
    // button opens straight onto it with its own history prefilled and the
    // workout starts as a confirmation rather than a search. Nothing is logged,
    // and one tap in the picker moves off it.
    const lifts = liftsFor(n);
    if (lifts.length > 0) setCurrentExercise(lifts[0].id);
    onStart(id);
  };

  const preview = liftsFor(trimmed || (suggestedName ?? ""));

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center bg-black/25 anim-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-surface p-5 pb-8 anim-sheet rounded-lg"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-wash" />
        <h2 className="t-caption text-ink-2">Today's session</h2>

        {shown.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {shown.map((s) => {
              const isSuggested = s.name === suggestedName;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleStart(s.name)}
                  className={
                    "flex min-h-[44px] items-center rounded-md px-4 t-body font-medium transition-colors " +
                    (isSuggested ? "bg-ink text-paper" : "bg-wash text-ink")
                  }
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}

        <input
          ref={inputRef}
          aria-label="Today's session name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={shown.length > 0 ? "or something new" : "Upper, Lower, Arms…"}
          className="mt-4 min-h-[44px] w-full rounded-md bg-wash px-3 t-body text-ink outline-none placeholder:text-ink-3"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleStart();
          }}
        />

        {preview.length > 0 && (
          <div className="mt-4">
            <h2 className="group-header t-caption">Planned</h2>
            <ul className="group-list max-h-52 overflow-y-auto">
              {preview.map((ex, idx) => (
                <li key={ex.id} className={`group-row ${idx > 0 ? "group-row-sep" : ""}`}>
                  <span className="truncate t-body text-ink">{ex.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex-1 min-h-[44px] py-3 t-body font-medium text-ink-2"
          >
            Cancel
          </button>
          <button
            onClick={() => handleStart()}
            className="flex-1 min-h-[44px] rounded-lg bg-ink py-3 t-body font-semibold text-paper"
          >
            Start
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
