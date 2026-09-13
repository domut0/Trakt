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
  const plannedWeek = useStore((s) => s.plannedWeek);
  const plannedWorkoutForDate = useStore((s) => s.plannedWorkoutForDate);
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

  /**
   * Today's planned main lifts, in plan order, or null on an unplanned day.
   *
   * Shown here so the preload is something the user agrees to rather than
   * something that happens to them: the sheet says what starting will load
   * before Start is pressed. Off by default and empty on most days, and this
   * sheet is then character for character the one that shipped before plans
   * existed.
   *
   * The plan is deliberately NOT offered as the session name. A plan day names
   * what is trained, a Split Slot names where the rotation is, plan.ts is
   * explicit that the two need not agree, and `startWorkout` would create a new
   * slot for any name that does not match one, quietly bending the rotation.
   */
  const planned = useMemo(() => {
    if (!open || !plannedWeek) return null;
    const workout = plannedWorkoutForDate(dayKey(new Date()));
    if (!workout) return null;
    const lifts = workout.exerciseIds
      .map((id) => exercises.find((e) => e.id === id))
      .filter((e): e is Exercise => e !== undefined);
    return lifts.length > 0 ? { name: workout.name, lifts } : null;
  }, [open, plannedWeek, plannedWorkoutForDate, exercises]);

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
    // The preload itself: the first planned lift becomes the current exercise,
    // so the log button opens straight onto it with its own history prefilled
    // and the workout starts as a confirmation instead of a search. Nothing is
    // logged, and one tap in the picker (or in the planned list on /workout)
    // moves off it.
    if (planned) setCurrentExercise(planned.lifts[0].id);
    onStart(id);
  };

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
        <div className="mx-auto mb-4 h-1 w-10 bg-border" />
        <h2 className="t-caption text-ink-2">Today's session</h2>
        <input
          ref={inputRef}
          aria-label="Today's session name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={predicted ? `suggested: ${predicted}` : "Heavy Bench, D2, Arms…"}
          className="mt-2 w-full bg-transparent t-title font-semibold tracking-tight outline-none placeholder:t-title placeholder:font-normal placeholder:text-ink-2"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleStart();
          }}
        />
        {suggestions.length > 0 && (
          <ul className="mt-3 group-list bg-wash">
            {suggestions.map((s, idx) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => handleStart(s.name)}
                  className={`group-row w-full text-left t-body text-ink hover:bg-wash ${
                    idx > 0 ? "group-row-sep" : ""
                  }`}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {planned && (
          <div className="mt-5">
            <div className="group-header flex items-center justify-between px-0">
              <h2 className="t-caption">Planned</h2>
              {planned.name.trim() && (
                <span className="truncate t-label text-ink-2">{planned.name}</span>
              )}
            </div>
            <ul className="group-list max-h-52 overflow-y-auto bg-wash">
              {planned.lifts.map((ex, idx) => (
                <li key={ex.id} className={`group-row ${idx > 0 ? "group-row-sep" : ""}`}>
                  <span className="truncate t-body font-medium">{ex.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-6 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[44px] py-3 t-body font-medium text-ink-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleStart()}
            disabled={!(trimmed || predicted)}
            className="flex-[2] min-h-[44px] bg-ink py-3 t-body font-semibold text-paper disabled:opacity-40 rounded-lg"
          >
            Start
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
