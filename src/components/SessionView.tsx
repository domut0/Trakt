import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { previousSessionExerciseOrder } from "../lib/exercise-history";
import { useStore, type WorkoutSet } from "../lib/store";

/** Row with swipe-left to delete / swipe-right to edit (touch). */
function SetRow({
  s,
  index,
  isFirst,
  editable,
  onEdit,
  onDelete,
}: {
  s: WorkoutSet;
  index: number;
  isFirst: boolean;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [dx, setDx] = useState(0);
  const startX = useRef<number | null>(null);
  const unit = useStore((st) => st.unit);

  const onStart = (x: number) => {
    startX.current = x;
  };
  const onMove = (x: number) => {
    if (startX.current == null || !editable) return;
    const delta = x - startX.current;
    setDx(Math.max(-100, Math.min(100, delta)));
  };
  const onEnd = () => {
    if (!editable) {
      setDx(0);
      startX.current = null;
      return;
    }
    if (dx < -60) onDelete();
    else if (dx > 60) onEdit();
    setDx(0);
    startX.current = null;
  };

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5 t-label font-medium text-accent">
        Edit
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-5 t-label font-medium text-destructive">
        Delete
      </div>
      <div
        className={`group-row relative bg-surface ${isFirst ? "" : "group-row-sep"}`}
        style={{
          transform: `translateX(${dx}px)`,
          transition: startX.current == null ? "transform 160ms ease" : "none",
        }}
        onTouchStart={(e) => onStart(e.touches[0].clientX)}
        onTouchMove={(e) => onMove(e.touches[0].clientX)}
        onTouchEnd={onEnd}
        onMouseDown={(e) => onStart(e.clientX)}
        onMouseMove={(e) => e.buttons === 1 && onMove(e.clientX)}
        onMouseUp={onEnd}
        onMouseLeave={() => {
          if (startX.current != null) onEnd();
        }}
      >
        <div className="flex min-w-0 flex-wrap items-baseline gap-3">
          <span className="t-label w-5 shrink-0 text-muted-foreground">{index}</span>
          <span className="t-stat">
            {s.weight}
            <span className="t-label text-muted-foreground"> {unit}</span>
          </span>
          <span className="text-muted-foreground">×</span>
          <span className="t-stat">{s.reps}</span>
          {s.rpe != null && (
            <span className="t-label text-muted-foreground">@ {s.rpe}</span>
          )}
          {s.isDropsetOrPartial && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 t-caption text-muted-foreground">
              drop
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function SessionView({
  sessionId,
  editable = true,
}: {
  sessionId: string;
  editable?: boolean;
}) {
  // Select the stable `sets` array reference and derive the per-session slice
  // in a memo. Filtering inside the selector would return a new array on every
  // getSnapshot call, which useSyncExternalStore treats as a changed snapshot,
  // causing an infinite render loop ("getSnapshot should be cached").
  const allSets = useStore((s) => s.sets);
  const sets = useMemo(
    () => allSets.filter((x) => x.sessionId === sessionId),
    [allSets, sessionId],
  );
  const sessions = useStore((s) => s.sessions);
  const exercises = useStore((s) => s.exercises);
  const currentExerciseId = useStore((s) => s.currentExerciseId);
  const setCurrentExercise = useStore((s) => s.setCurrentExercise);
  const deleteSet = useStore((s) => s.deleteSet);
  const updateSet = useStore((s) => s.updateSet);
  const updateSession = useStore((s) => s.updateSession);
  const [editing, setEditing] = useState<WorkoutSet | null>(null);
  const [showRepeatList, setShowRepeatList] = useState(true);

  const session = sessions.find((s) => s.id === sessionId);

  // The in-progress draft of the session note. `null` means "not editing" -
  // one piece of state rather than an open flag plus a draft, so the two can
  // never disagree about whether the editor is up.
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const isEditingNote = noteDraft !== null;
  const noteFieldRef = useRef<HTMLTextAreaElement | null>(null);
  // Derived from the session id rather than useId: it only has to be unique on
  // the page, and one SessionView renders exactly one session.
  const noteFieldId = `session-note-${sessionId}`;

  const grouped = useMemo(() => {
    const byExercise = new Map<string, WorkoutSet[]>();
    const order: string[] = [];
    [...sets]
      .sort((a, b) => a.loggedAt - b.loggedAt)
      .forEach((s) => {
        if (!byExercise.has(s.exerciseId)) {
          byExercise.set(s.exerciseId, []);
          order.push(s.exerciseId);
        }
        byExercise.get(s.exerciseId)!.push(s);
      });
    return order.map((eid) => {
      const groupSets = byExercise.get(eid)!;
      const ex = exercises.find((e) => e.id === eid)!;
      // Snapshot: the latest note recorded in THIS session for the exercise
      // (per-set, so past sessions keep whatever they were logged with).
      const noteSet = [...groupSets].reverse().find((s) => s.setupNote?.trim());
      return { exercise: ex, sets: groupSets, setupNote: noteSet?.setupNote ?? ex.setupNote };
    });
  }, [sets, exercises]);

  const repeatExerciseIds = useMemo(
    () => previousSessionExerciseOrder(sessions, allSets, sessionId),
    [sessions, allSets, sessionId],
  );

  const repeatExercises = useMemo(
    () =>
      repeatExerciseIds
        .map((id) => exercises.find((e) => e.id === id))
        .filter((e): e is NonNullable<typeof e> => e !== undefined),
    [repeatExerciseIds, exercises],
  );

  // The field only mounts in response to a tap on the note row, so focusing it
  // here can never pull the caret out of the set-logging flow. Deliberately not
  // `autoFocus`, which would also fire on a session that merely happens to
  // already carry a note, throwing the keyboard up over the sets.
  useEffect(() => {
    if (isEditingNote) noteFieldRef.current?.focus();
  }, [isEditingNote]);

  const commitNote = () => {
    if (noteDraft === null) return;
    const trimmed = noteDraft.trim();
    // A cleared note has to leave the record exactly as it found it, so store
    // `undefined` and never "". An empty string is truthy enough to survive
    // JSON.stringify into every backup and to keep rendering an empty card,
    // where an absent key disappears from both.
    const next = trimmed === "" ? undefined : trimmed;
    // Skip the write when nothing changed: tapping in and straight back out is
    // the common case, and it should not touch IndexedDB or the session object.
    if (next !== session?.note) updateSession(sessionId, { note: next });
    setNoteDraft(null);
  };

  /**
   * The whole-session note. Sits at the very bottom, under the sets, and stays
   * as quiet as a row can be until it holds something: this is the one thing on
   * the screen that is never worth interrupting a set for.
   *
   * Same markup for the live workout and for a past session being edited. In
   * the live case SessionView only exists behind "View workout", so the note is
   * already a screen away from the log button.
   */
  const renderSessionNote = () => {
    const saved = session?.note;
    const savedBody = saved ? (
      <>
        <div className="t-caption text-muted-foreground">
          Session note
        </div>
        <div className="mt-1 whitespace-pre-wrap t-body text-foreground">{saved}</div>
      </>
    ) : null;

    if (!editable) {
      if (!savedBody) return null;
      return <div className="mx-5 section-gap group-list p-4">{savedBody}</div>;
    }

    if (isEditingNote) {
      return (
        // Swipe-ignored: placing the caret or dragging out a selection inside
        // the field must not read as a swipe between tabs.
        <div data-swipe-ignore className="mx-5 section-gap group-list p-4">
          <label
            htmlFor={noteFieldId}
            className="block t-caption text-muted-foreground"
          >
            Session note
          </label>
          <textarea
            id={noteFieldId}
            ref={noteFieldRef}
            value={noteDraft ?? ""}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={commitNote}
            rows={3}
            placeholder="Felt flat, shoulder tweaked, good bar speed"
            // Placeholder at full text-muted-foreground, not /60: at 60% over the surface
            // it measures 3.7:1, under the 4.5:1 AA floor for text this size.
            className="mt-1 w-full resize-none bg-transparent t-body text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      );
    }

    if (savedBody) {
      return (
        <div className="mx-5 section-gap">
          <button
            onClick={() => setNoteDraft(saved ?? "")}
            className="group-list w-full p-4 text-left"
          >
            {savedBody}
          </button>
        </div>
      );
    }

    return (
      <div className="mx-5 section-gap">
        <button
          onClick={() => setNoteDraft("")}
          className="flex min-h-[44px] w-full items-center t-label text-muted-foreground"
        >
          Add a note
        </button>
      </div>
    );
  };

  const renderRepeatChecklist = () => {
    if (repeatExercises.length === 0) return null;
    return (
      <div className="mx-5 section-gap">
        <div className="group-list">
          <button
            onClick={() => setShowRepeatList((v) => !v)}
            aria-expanded={showRepeatList}
            className="group-row w-full text-left"
          >
            <div className="min-w-0">
              <div className="t-caption text-muted-foreground">
                Repeat last workout
              </div>
              <div className="t-body font-semibold">
                {repeatExercises.length} exercise{repeatExercises.length === 1 ? "" : "s"} from
                previous session
              </div>
            </div>
            <span className="shrink-0 t-label font-medium text-accent">
              {showRepeatList ? "Hide" : "Show"}
            </span>
          </button>
          {showRepeatList && (
            <div>
              {repeatExercises.map((ex) => {
                const isSelected = currentExerciseId === ex.id;
                const isLogged = sets.some((s) => s.exerciseId === ex.id);
                return (
                  <button
                    key={ex.id}
                    onClick={() => setCurrentExercise(ex.id)}
                    aria-pressed={isSelected}
                    className={
                      "group-row group-row-sep w-full text-left transition-colors " +
                      (isSelected ? "text-accent font-semibold" : "text-foreground")
                    }
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className={
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border t-caption " +
                          (isLogged
                            ? "border-accent bg-accent text-accent-foreground"
                            : isSelected
                              ? "border-accent text-accent"
                              : "border-muted-foreground text-transparent")
                        }
                      >
                        ✓
                      </span>
                      <span className="truncate t-body">{ex.name}</span>
                    </div>
                    <span className="shrink-0 t-caption text-muted-foreground">
                      {ex.type === "main" ? "Main" : ex.type === "cardio" ? "Cardio" : "Accessory"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (grouped.length === 0) {
    return (
      <div className="pb-6">
        <div className="mx-5 my-6 group-list px-5 py-8 text-center">
          <h2 className="t-heading">No sets logged yet</h2>
          <p className="mt-1 t-label text-muted-foreground">
            Select an exercise from below or open the set picker to log your first set.
          </p>
        </div>
        {renderRepeatChecklist()}
        {renderSessionNote()}
      </div>
    );
  }

  return (
    <div className="pb-6">
      {renderRepeatChecklist()}
      {grouped.map(({ exercise, sets, setupNote }) => (
        <div key={exercise.id} className="section-gap">
          {/* The row carries the 44px floor and the link fills it, rather than an
              inset overlay: an overlay here would hang over the first set row
              below and intercept its swipe-to-delete. */}
          <div className="flex min-h-[44px] items-center justify-between gap-3 px-5">
            <Link
              to="/exercise/$id"
              params={{ id: exercise.id }}
              className="flex min-h-[44px] min-w-0 items-center truncate t-heading text-foreground hover:text-accent"
            >
              {exercise.name}
            </Link>
            <span className="shrink-0 t-caption text-muted-foreground">
              {exercise.type === "main"
                ? "Main"
                : exercise.type === "cardio"
                  ? "Cardio"
                  : "Accessory"}
            </span>
          </div>
          {setupNote && (
            <div className="mx-5 mb-2 rounded-lg bg-muted px-3 py-1.5 t-label text-muted-foreground">
              {setupNote}
            </div>
          )}
          <div className="mx-5 group-list">
            {sets.map((s, i) => (
              <SetRow
                key={s.id}
                s={s}
                index={i + 1}
                isFirst={i === 0}
                editable={editable}
                onEdit={() => setEditing(s)}
                onDelete={() => deleteSet(s.id)}
              />
            ))}
          </div>
        </div>
      ))}

      {renderSessionNote()}

      {editing && (
        <EditSetSheet
          s={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            updateSet(editing.id, patch);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EditSetSheet({
  s,
  onClose,
  onSave,
}: {
  s: WorkoutSet;
  onClose: () => void;
  onSave: (patch: Partial<WorkoutSet>) => void;
}) {
  const [weight, setWeight] = useState(String(s.weight));
  const [reps, setReps] = useState(String(s.reps));
  const [rpe, setRpe] = useState(s.rpe != null ? String(s.rpe) : "");
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end bg-black/30 anim-backdrop"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-md rounded-t-3xl bg-surface p-5 anim-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        <h2 className="t-caption text-muted-foreground">
          Edit set
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {(
            [
              ["Weight", weight, setWeight],
              ["Reps", reps, setReps],
              ["RPE", rpe, setRpe],
            ] as Array<[string, string, (v: string) => void]>
          ).map(([label, val, setter]) => {
            // Scoped to the set being edited so two of these can never collide,
            // and lowercased because an id is matched case-sensitively.
            const fieldId = `edit-set-${s.id}-${label.toLowerCase()}`;
            return (
              <div key={label} className="min-w-0 rounded-xl bg-muted p-3">
                <label
                  htmlFor={fieldId}
                  className="block t-caption text-muted-foreground"
                >
                  {label}
                </label>
                <input
                  id={fieldId}
                  inputMode="decimal"
                  value={val}
                  onChange={(e) => setter(e.target.value)}
                  className="mt-1 min-h-[44px] w-full min-w-0 bg-transparent t-stat outline-none"
                />
              </div>
            );
          })}
        </div>
        <div className="mt-6 flex gap-2">
          <button
            onClick={onClose}
            className="flex min-h-[44px] flex-1 items-center justify-center rounded-full py-3 t-body text-muted-foreground"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onSave({
                weight: parseFloat(weight),
                reps: parseInt(reps, 10),
                rpe: rpe ? parseFloat(rpe) : undefined,
              })
            }
            className="flex min-h-[44px] flex-[2] items-center justify-center rounded-full bg-accent py-3 t-body font-semibold text-accent-foreground"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
