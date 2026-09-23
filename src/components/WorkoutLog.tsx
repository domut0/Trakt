import { useMemo, useState } from "react";
import { Plus } from "./icons";
import { ExercisePickerSheet } from "./ExercisePickerSheet";
import { ExerciseScreen } from "./ExerciseScreen";
import { applyOrder, useReorderList } from "../hooks/useReorderList";
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
   * How this session departs from the card: what was added off-plan, what was
   * swapped, and the order the lifts are being done in.
   *
   * All three live ON THE SESSION, not in this component. They used to be
   * `useState` here, on the reasoning that a row nobody has logged against is
   * not yet part of the record -- and that reasoning does not survive contact
   * with a gym. Leaving this screen unmounts the component, so a reorder was
   * gone the moment you looked at anything else, and a substitution lasted
   * only until you left unless a set had already been logged against it. Both
   * were reported. The session also survives the app being evicted while
   * backgrounded, which this component cannot.
   */
  const session = useStore((s) => s.sessions.find((x) => x.id === sessionId));
  const updateSession = useStore((s) => s.updateSession);
  const added = useMemo(() => session?.addedExerciseIds ?? [], [session?.addedExerciseIds]);
  const substitutions = useMemo(() => session?.substitutions ?? {}, [session?.substitutions]);
  const order = useMemo(() => session?.exerciseOrder ?? [], [session?.exerciseOrder]);
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
  const baseRows = useMemo(() => {
    const byId = new Map(exercises.map((e) => [e.id, e]));
    const out: { exercise: Exercise; lift?: PlannedLift }[] = [];
    const seen = new Set<string>();
    for (const lift of lifts) {
      const effectiveId = substitutions[lift.exerciseId] ?? lift.exerciseId;
      const exercise = byId.get(effectiveId);
      if (!exercise || seen.has(exercise.id)) {
        seen.add(lift.exerciseId);
        continue;
      }
      seen.add(lift.exerciseId);
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
  }, [exercises, lifts, sessSets, added, substitutions]);

  const rows = useMemo(() => applyOrder(baseRows, order), [baseRows, order]);

  const reorder = useReorderList({
    items: rows,
    getItemId: (r) => r.exercise.id,
    onReorder: (_newItems, newIds) => updateSession(sessionId, { exerciseOrder: newIds }),
  });

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
          <ul ref={reorder.listRef} className="group-list relative">
            {rows.map(({ exercise, lift }, idx) => {
              const logged = loggedCountOf(exercise.id);
              const isCurrent = exercise.id === currentExerciseId;
              const isDraggingThis = reorder.dragIndex === idx;

              let shiftY = 0;
              if (reorder.dragIndex !== null && reorder.overIndex !== null && !isDraggingThis) {
                if (reorder.dragIndex < reorder.overIndex) {
                  if (idx > reorder.dragIndex && idx <= reorder.overIndex) {
                    shiftY = -reorder.rowHeight;
                  }
                } else if (reorder.dragIndex > reorder.overIndex) {
                  if (idx >= reorder.overIndex && idx < reorder.dragIndex) {
                    shiftY = reorder.rowHeight;
                  }
                }
              }

              return (
                <li
                  key={exercise.id}
                  className={isDraggingThis ? "relative z-10" : "relative"}
                  style={{
                    transform: isDraggingThis
                      ? `translateY(${reorder.dragOffsetY}px) scale(1.02)`
                      : shiftY !== 0
                        ? `translateY(${shiftY}px)`
                        : undefined,
                    transition: isDraggingThis ? "none" : "transform 150ms ease",
                  }}
                >
                  <button
                    {...reorder.getItemProps(idx)}
                    onClick={() => {
                      if (reorder.isClickSuppressed()) return;
                      open(exercise.id);
                    }}
                    aria-pressed={isCurrent}
                    data-tutorial={idx === 0 ? "lift-row-first" : undefined}
                    style={{
                      touchAction: isDraggingThis ? "none" : undefined,
                    }}
                    /*
                      The lift you are on is an INKED ROW, which is the same mark
                      the week strip uses for the day you are on. One vocabulary
                      for "you are here" across the app. A dragged row declares its
                      own opaque background explicitly (DESIGN.md background rule).
                    */
                    className={`group-row w-full text-left ${idx > 0 && !isDraggingThis ? "group-row-sep" : ""} ${
                      isCurrent
                        ? "bg-ink text-paper rounded-md"
                        : isDraggingThis
                          ? "bg-surface text-ink rounded-md shadow-md"
                          : "text-ink"
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
          if (!added.includes(exerciseId)) {
            updateSession(sessionId, { addedExerciseIds: [...added, exerciseId] });
          }
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
          onSubstitute={(replacementId) => {
            // Keyed by what the CARD prescribes, so substituting twice
            // rewrites the one entry rather than chaining A->B->C.
            const originalKey =
              Object.keys(substitutions).find((k) => substitutions[k] === openExerciseId) ??
              openExerciseId;
            updateSession(sessionId, {
              substitutions: { ...substitutions, [originalKey]: replacementId },
              exerciseOrder: order.map((id) => (id === openExerciseId ? replacementId : id)),
              addedExerciseIds: added.includes(openExerciseId)
                ? Array.from(
                    new Set(added.map((id) => (id === openExerciseId ? replacementId : id))),
                  )
                : added,
            });
            setCurrentExercise(replacementId);
            setOpenExerciseId(undefined);
          }}
          sessionExerciseIds={rows.map((r) => r.exercise.id)}
        />
      )}
    </>
  );
}
