import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { EXERCISE_GROUPS } from "../lib/exercise-library";
import { useStore, type Exercise, type ExerciseType } from "../lib/store";

function exerciseTypeLabel(type: ExerciseType): string {
  if (type === "main") return "Main";
  if (type === "accessory") return "Accessory";
  return "Cardio";
}

/**
 * Choosing a replacement lift for a workout session or across the split.
 *
 * Distinct from ExercisePickerSheet because substituting is a comparison: it
 * prioritises other lifts that train the same muscle group, then falls back to
 * the full library underneath. It also branches on whether the change belongs
 * to today (Substitute) or to the plan (Replace everywhere).
 */
export function SubstituteSheet({
  open,
  onClose,
  exercise,
  sessionExerciseIds = [],
  onSubstitute,
  onReplaceEverywhere,
}: {
  open: boolean;
  onClose: () => void;
  exercise: Exercise;
  sessionExerciseIds?: readonly string[];
  onSubstitute: (replacementExerciseId: string) => void;
  onReplaceEverywhere?: (replacementExerciseId: string) => void;
}) {
  const exercises = useStore((s) => s.exercises);
  const addExercise = useStore((s) => s.addExercise);
  const coachManaged = useStore((s) => s.coachManaged);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedId(null);
    }
  }, [open]);

  useSheetDismiss(open, onClose);

  const strengthExercises = useMemo(
    () => exercises.filter((e) => e.type !== "cardio"),
    [exercises],
  );

  const group = EXERCISE_GROUPS[exercise.id];
  const sessionSet = useMemo(() => new Set(sessionExerciseIds), [sessionExerciseIds]);

  const suggestions = useMemo(() => {
    if (!group) return [];
    return strengthExercises.filter(
      (e) => e.id !== exercise.id && !sessionSet.has(e.id) && EXERCISE_GROUPS[e.id] === group,
    );
  }, [strengthExercises, exercise.id, sessionSet, group]);

  const filteredSuggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suggestions;
    return suggestions.filter((e) => e.name.toLowerCase().includes(q));
  }, [suggestions, query]);

  const visibleSuggestionIds = useMemo(
    () => new Set(filteredSuggestions.map((e) => e.id)),
    [filteredSuggestions],
  );

  /**
   * Everything else, minus what today already contains.
   *
   * The session exclusion is not tidiness, it is a data loss guard. The
   * workout log shows one row per exercise, so substituting a lift for one
   * that is ALREADY in the session merges the two rows -- observed in the
   * browser: a three-lift day silently became a two-lift day, and the
   * prescription on the row that vanished went with it. Offering the choice at
   * all was the bug.
   */
  const filteredEverythingElse = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = strengthExercises.filter(
      (e) => e.id !== exercise.id && !sessionSet.has(e.id) && !visibleSuggestionIds.has(e.id),
    );
    const matched = q ? list.filter((e) => e.name.toLowerCase().includes(q)) : list;
    return matched.slice(0, 20);
  }, [strengthExercises, exercise.id, sessionSet, visibleSuggestionIds, query]);

  if (!open || typeof document === "undefined") return null;

  const typed = query.trim();
  const canAdd =
    typed !== "" && !strengthExercises.some((e) => e.name.toLowerCase() === typed.toLowerCase());

  const handleSubstitute = () => {
    if (!selectedId) return;
    onSubstitute(selectedId);
    onClose();
  };

  // The sheet reports what was chosen and edits nothing itself. It cannot: the
  // plan knows this row by the lift the CARD prescribes, which is not
  // necessarily the exercise on screen, and only the caller holds that.
  const handleReplaceEverywhere = () => {
    if (!selectedId) return;
    onReplaceEverywhere?.(selectedId);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center bg-black/30 anim-backdrop"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col bg-surface anim-sheet rounded-lg"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}
      >
        <div className="flex min-h-[44px] w-full items-center shrink-0">
          <div className="mx-auto h-1 w-10 bg-border" />
        </div>

        <div className="px-4 pb-2 shrink-0">
          <input
            autoFocus
            aria-label="Search or add exercise"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or add exercise"
            className="min-h-[44px] w-full rounded-md bg-field px-3 t-heading font-semibold tracking-tight text-ink outline-none placeholder:text-ink-2"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 space-y-4">
          {filteredSuggestions.length > 0 && (
            <div>
              <div className="group-header">
                <h3 className="t-caption">Suggested alternatives</h3>
              </div>
              <div className="group-list bg-wash">
                {filteredSuggestions.map((e, idx) => {
                  const isSelected = e.id === selectedId;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setSelectedId(e.id)}
                      aria-pressed={isSelected}
                      className={`group-row w-full text-left ${
                        idx > 0 ? "group-row-sep" : ""
                      } ${isSelected ? "bg-ink text-paper rounded-md" : ""}`}
                    >
                      <span className="min-w-0 truncate t-body font-medium">{e.name}</span>
                      <span
                        className={`shrink-0 t-caption ${isSelected ? "text-paper" : "text-ink-2"}`}
                      >
                        {exerciseTypeLabel(e.type)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            {filteredSuggestions.length > 0 && (
              <div className="group-header">
                <h3 className="t-caption">Everything else</h3>
              </div>
            )}
            <div className="group-list bg-wash">
              {filteredEverythingElse.map((e, idx) => {
                const isSelected = e.id === selectedId;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setSelectedId(e.id)}
                    aria-pressed={isSelected}
                    className={`group-row w-full text-left ${
                      idx > 0 ? "group-row-sep" : ""
                    } ${isSelected ? "bg-ink text-paper rounded-md" : ""}`}
                  >
                    <span className="min-w-0 truncate t-body font-medium">{e.name}</span>
                    <span
                      className={`shrink-0 t-caption ${isSelected ? "text-paper" : "text-ink-2"}`}
                    >
                      {exerciseTypeLabel(e.type)}
                    </span>
                  </button>
                );
              })}
              {canAdd && (
                <button
                  type="button"
                  onClick={() => {
                    const created = addExercise(typed, "accessory");
                    setSelectedId(created.id);
                  }}
                  className={`group-row w-full text-left t-action ${
                    filteredEverythingElse.length > 0 ? "group-row-sep" : ""
                  }`}
                >
                  <span className="t-body font-medium">Add "{typed}"</span>
                  <span className="t-caption">New</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 pt-3 shrink-0 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleSubstitute}
            disabled={!selectedId}
            className="min-h-[44px] w-full rounded-md bg-ink t-body font-semibold text-paper disabled:opacity-40"
          >
            Substitute
          </button>
          {!coachManaged && onReplaceEverywhere && (
            <button
              type="button"
              onClick={handleReplaceEverywhere}
              disabled={!selectedId}
              className="min-h-[44px] w-full rounded-md bg-wash t-body font-semibold text-ink disabled:opacity-40"
            >
              Replace everywhere
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
