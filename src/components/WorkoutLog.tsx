import { useMemo, useState } from "react";
import { Plus } from "./icons";
import { ExercisePickerSheet } from "./ExercisePickerSheet";
import { ExerciseScreen } from "./ExerciseScreen";
import { hasUnloggedSets } from "../lib/set-rows";
import { useStore, type Exercise, type PlannedLift } from "../lib/store";

/**
 * The workout's exercises, one row each, and the screen each row opens.
 *
 * The list is the same object whether or not the day was planned: a plan simply
 * puts rows in it before you start. An unplanned workout is the empty version
 * of this list with the same "+ Add exercise" underneath, so the screen is never
 * a different thing depending on how the session began.
 *
 * A row counts SETS, not visits: "2/3" is two of three prescribed logged, and a
 * bare count for a lift nobody prescribed anything for.
 */
export function WorkoutLog({
  sessionId,
  lifts,
  stopwatch,
}: {
  sessionId: string;
  /** The card's prescribed lifts, in the order it wants them done. */
  lifts: readonly PlannedLift[];
  /** Time between sets, already formatted, passed through to the exercise screen. */
  stopwatch: string;
}) {
  const exercises = useStore((s) => s.exercises);
  const allSets = useStore((s) => s.sets);
  const currentExerciseId = useStore((s) => s.currentExerciseId);
  const setCurrentExercise = useStore((s) => s.setCurrentExercise);

  /**
   * Exercises added by hand that have no sets yet.
   *
   * Held here rather than in the store because an off-plan lift with nothing
   * logged against it is not yet part of the record - it is a row somebody
   * opened. Once a set exists the row is derived from the set instead, so this
   * list stops mattering.
   */
  const [added, setAdded] = useState<string[]>([]);
  const [openExerciseId, setOpenExerciseId] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState(false);

  const sessSets = useMemo(
    () => allSets.filter((s) => s.sessionId === sessionId),
    [allSets, sessionId],
  );

  /**
   * Every exercise this workout is about: what was prescribed, then anything
   * logged or added off-plan, in the order it turned up.
   *
   * A lift whose exercise has since been deleted is dropped here rather than
   * stored pruned, so deleting an exercise never has to walk every slot.
   */
  const rows = useMemo(() => {
    const byId = new Map(exercises.map((e) => [e.id, e]));
    const out: { exercise: Exercise; lift?: PlannedLift }[] = [];
    const seen = new Set<string>();
    for (const lift of lifts) {
      const exercise = byId.get(lift.exerciseId);
      if (!exercise || seen.has(exercise.id)) continue;
      seen.add(exercise.id);
      out.push({ exercise, lift });
    }
    const logged = [...sessSets].sort((a, b) => a.loggedAt - b.loggedAt).map((s) => s.exerciseId);
    for (const id of [...logged, ...added]) {
      const exercise = byId.get(id);
      if (!exercise || seen.has(id)) continue;
      seen.add(id);
      out.push({ exercise });
    }
    return out;
  }, [exercises, lifts, sessSets, added]);

  const loggedCountOf = (exerciseId: string) =>
    sessSets.filter((s) => s.exerciseId === exerciseId).length;

  const open = (exerciseId: string) => {
    setCurrentExercise(exerciseId);
    setOpenExerciseId(exerciseId);
  };

  /**
   * Leaving an exercise, and picking up the next one.
   *
   * Only a FINISHED exercise moves the workout on. Stepping out of a half-done
   * lift to check something must leave you on it, or the app would keep quietly
   * reassigning what you are doing while you are still doing it.
   */
  const done = (complete: boolean) => {
    const leaving = openExerciseId;
    setOpenExerciseId(undefined);
    if (!complete || leaving === undefined) return;
    const from = rows.findIndex((r) => r.exercise.id === leaving);
    for (let step = 1; step <= rows.length; step++) {
      const row = rows[(from + step) % rows.length];
      if (hasUnloggedSets(row.lift, loggedCountOf(row.exercise.id))) {
        setCurrentExercise(row.exercise.id);
        return;
      }
    }
  };

  const openRow = rows.find((r) => r.exercise.id === openExerciseId);

  return (
    <>
      <section className="section-gap min-h-0 flex-1 overflow-y-auto px-4">
        {rows.length > 0 && (
          <ul className="group-list">
            {rows.map(({ exercise, lift }, idx) => {
              const logged = loggedCountOf(exercise.id);
              const isCurrent = exercise.id === currentExerciseId;
              return (
                <li key={exercise.id}>
                  <button
                    onClick={() => open(exercise.id)}
                    aria-pressed={isCurrent}
                    data-tutorial={idx === 0 ? "lift-row-first" : undefined}
                    /*
                      The lift you are on is an INKED ROW, which is the same mark
                      the week strip uses for the day you are on. One vocabulary
                      for "you are here" across the app.
                    */
                    className={`group-row w-full text-left ${idx > 0 ? "group-row-sep" : ""} ${
                      isCurrent ? "bg-ink text-paper rounded-md" : "text-ink"
                    }`}
                  >
                    {/* The space between the two spans is load-bearing: flex
                        `gap` is not text, so without it the row's accessible
                        name runs together as "Bench Press 0/3 sets". */}
                    <span className="min-w-0 truncate t-body">{exercise.name}</span>{" "}
                    <span
                      className={`shrink-0 tnum t-body ${isCurrent ? "text-paper" : "text-ink-2"}`}
                    >
                      {logged}
                      {lift?.sets !== undefined ? `/${lift.sets}` : ""} sets
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <button
          onClick={() => setPicking(true)}
          className="flex min-h-[44px] w-full items-center gap-2 t-action t-body"
        >
          <Plus size={18} />
          Add exercise
        </button>
      </section>

      <ExercisePickerSheet
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(exerciseId) => {
          setPicking(false);
          setAdded((prev) => (prev.includes(exerciseId) ? prev : [...prev, exerciseId]));
          open(exerciseId);
        }}
      />

      {openExerciseId !== undefined && (
        <ExerciseScreen
          key={openExerciseId}
          exerciseId={openExerciseId}
          lift={openRow?.lift}
          stopwatch={stopwatch}
          onDone={done}
        />
      )}
    </>
  );
}
