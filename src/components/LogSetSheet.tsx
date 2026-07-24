import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../lib/store";

export function LogSetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const activeSessionId = useStore((s) => s.activeSessionId)!;
  const currentExerciseId = useStore((s) => s.currentExerciseId);
  const exercises = useStore((s) => s.exercises);
  const sets = useStore((s) => s.sets);
  const addExercise = useStore((s) => s.addExercise);
  const setCurrentExercise = useStore((s) => s.setCurrentExercise);
  const prefillFor = useStore((s) => s.prefillFor);
  const logSet = useStore((s) => s.logSet);

  const [pickingExercise, setPickingExercise] = useState(false);
  const [exerciseQuery, setExerciseQuery] = useState("");
  const [exerciseId, setExerciseId] = useState<string | undefined>(currentExerciseId);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState("");
  const [flag, setFlag] = useState(false);
  const [targetSets, setTargetSets] = useState(1);

  useEffect(() => {
    if (!open) return;
    const eid = currentExerciseId;
    setExerciseId(eid);
    setPickingExercise(!eid);
    setFlag(false);
    setTargetSets(1);
    setWeight("");
    setReps("");
    setRpe("");
  }, [open, currentExerciseId]);

  const suggestion = useMemo(() => {
    if (!exerciseId) return {} as { weight?: number; reps?: number; rpe?: number };
    const priorSetsThisSession = sets
      .filter((s) => s.sessionId === activeSessionId && s.exerciseId === exerciseId)
      .sort((a, b) => b.loggedAt - a.loggedAt);
    const mostRecent = priorSetsThisSession[0];
    if (mostRecent) return { weight: mostRecent.weight, reps: mostRecent.reps, rpe: mostRecent.rpe };
    return activeSessionId ? prefillFor(activeSessionId, exerciseId) : {};
  }, [sets, activeSessionId, exerciseId, prefillFor]);

  const chosen = exercises.find((e) => e.id === exerciseId);

  const filtered = useMemo(() => {
    const q = exerciseQuery.trim().toLowerCase();
    const list = q ? exercises.filter((e) => e.name.toLowerCase().includes(q)) : exercises;
    return list.slice(0, 20);
  }, [exercises, exerciseQuery]);

  if (!open || typeof document === "undefined") return null;

  const canLog = exerciseId && (weight.trim() || suggestion.weight != null) && (reps.trim() || suggestion.reps != null);

  const doLog = () => {
    if (!canLog) return;
    const w = weight.trim() ? parseFloat(weight) : suggestion.weight;
    const r = reps.trim() ? parseInt(reps, 10) : suggestion.reps;
    const rp = rpe.trim() ? parseFloat(rpe) : suggestion.rpe;
    if (w == null || Number.isNaN(w) || r == null || Number.isNaN(r)) return;
    logSet({
      exerciseId: exerciseId!,
      weight: w,
      reps: r,
      rpe: rp,
      isDropsetOrPartial: flag || undefined,
      targetSets,
    });
    onClose();
  };

  return createPortal(
    <div className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center bg-black/30 anim-backdrop" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-surface anim-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}
      >
        <div className="mx-auto my-3 h-1 w-10 rounded-full bg-border" />

        {pickingExercise ? (
          <div className="px-5 pb-4">
            <input
              autoFocus
              value={exerciseQuery}
              onChange={(e) => setExerciseQuery(e.target.value)}
              placeholder="Search or add exercise"
              className="w-full bg-transparent text-[22px] font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
            />
            <ul className="mt-3 max-h-72 divide-y divide-border overflow-y-auto">
              {filtered.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => { setExerciseId(e.id); setCurrentExercise(e.id); setPickingExercise(false); setWeight(""); setReps(""); setRpe(""); }}
                    className="flex w-full items-center justify-between py-3 text-left"
                  >
                    <span className="text-[16px]">{e.name}</span>
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{e.type === "main" ? "Main" : "Accessory"}</span>
                  </button>
                </li>
              ))}
              {exerciseQuery.trim() && !filtered.some((e) => e.name.toLowerCase() === exerciseQuery.trim().toLowerCase()) && (
                <li>
                  <button
                    onClick={() => { const ex = addExercise(exerciseQuery.trim(), "accessory"); setExerciseId(ex.id); setCurrentExercise(ex.id); setPickingExercise(false); }}
                    className="flex w-full items-center justify-between py-3 text-left text-accent"
                  >
                    <span className="text-[16px]">Add "{exerciseQuery.trim()}"</span>
                    <span className="text-[11px] uppercase tracking-wider">New</span>
                  </button>
                </li>
              )}
            </ul>
          </div>
        ) : (
          <div className="px-5 pb-5">
            <div className="flex items-baseline justify-between">
              <button onClick={() => setPickingExercise(true)} className="text-left">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Exercise</div>
                <div className="mt-0.5 text-[22px] font-semibold tracking-tight">{chosen?.name}</div>
              </button>
              <button onClick={() => setPickingExercise(true)} className="text-[13px] font-medium text-accent">Change</button>
            </div>

            {chosen?.setupNote && (
              <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
                {chosen.setupNote}
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <NumField
                label="Weight"
                suffix={useStore.getState().unit}
                value={weight}
                onChange={setWeight}
                placeholder={suggestion.weight != null ? String(suggestion.weight) : "0"}
              />
              <NumField
                label="Reps"
                value={reps}
                onChange={setReps}
                placeholder={suggestion.reps != null ? String(suggestion.reps) : "0"}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <NumField
                label="RPE"
                placeholder={suggestion.rpe != null ? String(suggestion.rpe) : "—"}
                value={rpe}
                onChange={setRpe}
              />
              <div className="rounded-xl bg-muted p-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Sets</div>
                <div className="mt-1 flex items-center justify-between">
                  <button onClick={() => setTargetSets(Math.max(1, targetSets - 1))} className="h-8 w-8 rounded-full bg-surface text-[18px] hairline-t hairline-b">−</button>
                  <span className="tnum text-[22px] font-semibold">{targetSets}</span>
                  <button onClick={() => setTargetSets(targetSets + 1)} className="h-8 w-8 rounded-full bg-surface text-[18px] hairline-t hairline-b">+</button>
                </div>
              </div>
            </div>

            <label className="mt-4 flex items-center gap-2 text-[14px] text-muted-foreground">
              <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} className="h-4 w-4 accent-[color:var(--color-accent)]" />
              Dropset / partial reps
            </label>

            <div className="mt-6 flex items-center gap-2">
              <button onClick={onClose} className="flex-1 rounded-full py-3 text-[15px] font-medium text-muted-foreground">Cancel</button>
              <button
                onClick={doLog}
                disabled={!canLog}
                className="flex-[2] rounded-full bg-accent py-3 text-[15px] font-semibold text-accent-foreground disabled:opacity-40"
              >
                {targetSets > 1 ? `Log set 1 of ${targetSets}` : "Log set"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function NumField({ label, value, onChange, placeholder, suffix }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; suffix?: string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "0"}
          className="tnum w-full bg-transparent text-[22px] font-semibold outline-none placeholder:text-muted-foreground"
        />
        {suffix && <span className="text-[12px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
