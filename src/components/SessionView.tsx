import { useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useStore, type WorkoutSet } from "../lib/store";

/** Row with swipe-left to delete / swipe-right to edit (touch). */
function SetRow({
  s,
  index,
  editable,
  onEdit,
  onDelete,
}: {
  s: WorkoutSet;
  index: number;
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
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-[13px] font-medium text-accent">
        Edit
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-[13px] font-medium text-destructive">
        Delete
      </div>
      <div
        className="relative flex items-center justify-between bg-surface px-4 py-3 hairline-t"
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
        <div className="flex items-baseline gap-3">
          <span className="tnum w-5 text-[13px] text-muted-foreground">{index}</span>
          <span className="tnum text-[17px] font-medium">
            {s.weight}
            <span className="text-[12px] text-muted-foreground"> {unit}</span>
          </span>
          <span className="text-muted-foreground">×</span>
          <span className="tnum text-[17px] font-medium">{s.reps}</span>
          {s.rpe != null && (
            <span className="tnum text-[13px] text-muted-foreground">@ {s.rpe}</span>
          )}
          {s.isDropsetOrPartial && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
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
  const exercises = useStore((s) => s.exercises);
  const deleteSet = useStore((s) => s.deleteSet);
  const updateSet = useStore((s) => s.updateSet);
  const [editing, setEditing] = useState<WorkoutSet | null>(null);

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

  if (grouped.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-[15px] text-muted-foreground">
        No sets logged yet.
      </div>
    );
  }

  return (
    <div className="pb-6">
      {grouped.map(({ exercise, sets, setupNote }) => (
        <div key={exercise.id} className="mt-4">
          <div className="flex items-baseline justify-between px-4 pb-2">
            <h3 className="text-[17px] font-semibold tracking-tight">{exercise.name}</h3>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {exercise.type === "main"
                ? "Main"
                : exercise.type === "cardio"
                  ? "Cardio"
                  : "Accessory"}
            </span>
          </div>
          {setupNote && (
            <div className="mx-4 mb-1 rounded-md bg-muted px-3 py-1.5 text-[12px] text-muted-foreground">
              {setupNote}
            </div>
          )}
          <div className="bg-surface">
            {sets.map((s, i) => (
              <SetRow
                key={s.id}
                s={s}
                index={i + 1}
                editable={editable}
                onEdit={() => setEditing(s)}
                onDelete={() => deleteSet(s.id)}
              />
            ))}
          </div>
        </div>
      ))}

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
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Edit set</div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {(
            [
              ["Weight", weight, setWeight],
              ["Reps", reps, setReps],
              ["RPE", rpe, setRpe],
            ] as Array<[string, string, (v: string) => void]>
          ).map(([label, val, setter]) => (
            <div key={label} className="rounded-xl bg-muted p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <input
                inputMode="decimal"
                value={val}
                onChange={(e) => setter(e.target.value)}
                className="tnum mt-1 w-full bg-transparent text-[20px] font-semibold outline-none"
              />
            </div>
          ))}
        </div>
        <div className="mt-6 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-full py-3 text-[15px] text-muted-foreground"
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
            className="flex-[2] rounded-full bg-accent py-3 text-[15px] font-semibold text-accent-foreground"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
