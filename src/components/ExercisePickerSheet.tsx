import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { useStore, type ExerciseType } from "../lib/store";

/** Handles all three exercise types even though this picker filters cardio out
 * entirely - kept exhaustive so a stray cardio id never falls through to a
 * wrong label. */
function exerciseTypeLabel(type: ExerciseType): string {
  if (type === "main") return "Main";
  if (type === "accessory") return "Accessory";
  return "Cardio";
}

/**
 * Choosing a lift to add to the workout.
 *
 * Lifted out of the log sheet unchanged. It was never part of logging a set -
 * it was what that sheet showed when no exercise had been chosen yet - and now
 * that the exercise is a screen of its own, the picker is what "+ Add exercise"
 * opens and nothing else.
 *
 * Cardio lives in the same `exercises` table but has its own card
 * (CardioLogCard), and produces no sets, so it must never show up here.
 */
export function ExercisePickerSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (exerciseId: string) => void;
}) {
  const exercises = useStore((s) => s.exercises);
  const addExercise = useStore((s) => s.addExercise);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  useSheetDismiss(open, onClose);

  const strengthExercises = useMemo(
    () => exercises.filter((e) => e.type !== "cardio"),
    [exercises],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? strengthExercises.filter((e) => e.name.toLowerCase().includes(q))
      : strengthExercises;
    return list.slice(0, 20);
  }, [strengthExercises, query]);

  if (!open || typeof document === "undefined") return null;

  const typed = query.trim();
  const canAdd =
    typed !== "" && !filtered.some((e) => e.name.toLowerCase() === typed.toLowerCase());

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center bg-black/30 anim-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-surface anim-sheet rounded-lg"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}
      >
        <div className="flex min-h-[44px] w-full items-center">
          <div className="mx-auto h-1 w-10 bg-border" />
        </div>
        <div className="px-4 pb-4">
          <input
            autoFocus
            aria-label="Search or add exercise"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or add exercise"
            className="w-full bg-transparent t-heading font-semibold tracking-tight outline-none placeholder:text-ink-2"
          />
          <div className="mt-3 max-h-72 overflow-y-auto group-list bg-wash">
            {filtered.map((e, idx) => (
              <button
                key={e.id}
                onClick={() => onPick(e.id)}
                className={`group-row w-full text-left ${idx > 0 ? "group-row-sep" : ""}`}
              >
                <span className="t-body font-medium">{e.name}</span>
                <span className="t-caption text-ink-2">{exerciseTypeLabel(e.type)}</span>
              </button>
            ))}
            {canAdd && (
              <button
                onClick={() => onPick(addExercise(typed, "accessory").id)}
                className={`group-row w-full text-left t-action ${
                  filtered.length > 0 ? "group-row-sep" : ""
                }`}
              >
                <span className="t-body font-medium">Add "{typed}"</span>
                <span className="t-caption">New</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
