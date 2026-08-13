import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore, type ExerciseType } from "../lib/store";

/** Handles all three exercise types even though the picker above filters
 * cardio out entirely -- kept exhaustive so a future caller (or a stray
 * cardio id) never falls through to a wrong label. */
function exerciseTypeLabel(type: ExerciseType): string {
  if (type === "main") return "Main";
  if (type === "accessory") return "Accessory";
  return "Cardio";
}

export function LogSetSheet({
  open,
  onClose,
  onLogged,
}: {
  open: boolean;
  onClose: () => void;
  onLogged?: () => void;
}) {
  const activeSessionId = useStore((s) => s.activeSessionId)!;
  const currentExerciseId = useStore((s) => s.currentExerciseId);
  // Subscribed, not read via getState() at render time: an unsubscribed read
  // leaves the weight suffix showing the old unit until something else happens
  // to re-render this sheet.
  const unit = useStore((s) => s.unit);
  const exercises = useStore((s) => s.exercises);
  const sets = useStore((s) => s.sets);
  const addExercise = useStore((s) => s.addExercise);
  const setCurrentExercise = useStore((s) => s.setCurrentExercise);
  const prefillFor = useStore((s) => s.prefillFor);
  const lastSetupNoteFor = useStore((s) => s.lastSetupNoteFor);
  const logSet = useStore((s) => s.logSet);

  const [pickingExercise, setPickingExercise] = useState(false);
  const [exerciseQuery, setExerciseQuery] = useState("");
  const [exerciseId, setExerciseId] = useState<string | undefined>(currentExerciseId);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState("");
  const [note, setNote] = useState("");
  const [targetSets, setTargetSets] = useState(1);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!open) {
      setDragY(0);
      setIsDragging(false);
      // Reset the keyboard lift too, or reopening the sheet paints one frame
      // with the padding left over from the last time a keyboard was up.
      setKeyboardOffset(0);
      return;
    }
    const eid = currentExerciseId;
    setExerciseId(eid);
    setPickingExercise(!eid);
    setNote("");
    setTargetSets(1);
    setWeight("");
    setReps("");
    setRpe("");
  }, [open, currentExerciseId]);

  // Adjust sheet bottom padding when soft keyboard appears to keep fields visible
  useEffect(() => {
    if (!open || typeof window === "undefined" || !window.visualViewport) return;

    const vv = window.visualViewport;
    const handleViewportChange = () => {
      const kH = window.innerHeight - vv.height;
      setKeyboardOffset(Math.max(0, kH));
    };

    vv.addEventListener("resize", handleViewportChange);
    vv.addEventListener("scroll", handleViewportChange);
    handleViewportChange();

    return () => {
      vv.removeEventListener("resize", handleViewportChange);
      vv.removeEventListener("scroll", handleViewportChange);
    };
  }, [open]);

  const suggestion = useMemo(() => {
    if (!exerciseId) return {} as { weight?: number; reps?: number; rpe?: number };
    const priorSetsThisSession = sets
      .filter((s) => s.sessionId === activeSessionId && s.exerciseId === exerciseId)
      .sort((a, b) => b.loggedAt - a.loggedAt);
    const mostRecent = priorSetsThisSession[0];
    if (mostRecent)
      return { weight: mostRecent.weight, reps: mostRecent.reps, rpe: mostRecent.rpe };
    return activeSessionId ? prefillFor(activeSessionId, exerciseId) : {};
  }, [sets, activeSessionId, exerciseId, prefillFor]);

  const chosen = exercises.find((e) => e.id === exerciseId);
  const suggestedNote = exerciseId ? lastSetupNoteFor(exerciseId) : undefined;

  // Cardio lives in the same `exercises` table but has its own picker
  // (CardioLogCard) -- it must never show up while logging a strength set.
  const strengthExercises = useMemo(
    () => exercises.filter((e) => e.type !== "cardio"),
    [exercises],
  );

  const filtered = useMemo(() => {
    const q = exerciseQuery.trim().toLowerCase();
    const list = q
      ? strengthExercises.filter((e) => e.name.toLowerCase().includes(q))
      : strengthExercises;
    return list.slice(0, 20);
  }, [strengthExercises, exerciseQuery]);

  if (!open || typeof document === "undefined") return null;

  const canLog =
    exerciseId &&
    (weight.trim() || suggestion.weight != null) &&
    (reps.trim() || suggestion.reps != null);

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
      setupNote: note.trim() || suggestedNote,
      targetSets,
    });
    // No toast raised here, on purpose, and no Undo. Two separate reasons:
    //
    // 1. `onLogged` is the confirmation. The /workout route already flashes a
    //    "Set logged" toast in response to it, at the same z-index this one
    //    would use, so raising a second one stacks two overlapping
    //    confirmations of the same action with different lifetimes.
    // 2. An Undo could not be made correct from here anyway. `logSet` returns
    //    void, and it does more than append a row: it sets currentExerciseId,
    //    opens a currentBlock when targetSets > 1, derives the next set's
    //    timeBetweenSetsSeconds from this one, and persists the active-workout
    //    meta. A `deleteSet` alone would leave a block whose only set is gone,
    //    and `logNextInBlock` then takes its exerciseId from whatever set is
    //    now most recent, which is how an Undo turns into a set logged against
    //    the wrong exercise. A broken Undo is worse than no Undo.
    onLogged?.();
    onClose();
  };

  const stepReps = (dir: -1 | 1) => {
    const raw = reps.trim();
    const current = raw ? parseInt(raw, 10) : (suggestion.reps ?? 10);
    const base = Number.isNaN(current) ? (suggestion.reps ?? 10) : current;
    const next = Math.max(1, base + dir);
    setReps(String(next));
  };

  const stepRpe = (dir: -1 | 1) => {
    const raw = rpe.trim();
    const current = raw ? parseFloat(raw) : (suggestion.rpe ?? 8);
    const base = Number.isNaN(current) ? (suggestion.rpe ?? 8) : current;
    const next = Math.min(10, Math.max(1, Math.round((base + dir * 0.5) * 10) / 10));
    setRpe(String(next));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragStartY.current = e.clientY;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const deltaY = e.clientY - dragStartY.current;
    setDragY(Math.max(0, deltaY));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragY > 80) {
      onClose();
    } else {
      setDragY(0);
    }
  };

  const handlePointerCancel = () => {
    setIsDragging(false);
    setDragY(0);
  };

  const focusNextOrLog = (index: number) => {
    if (index < 2) {
      inputRefs.current[index + 1]?.focus();
    } else {
      doLog();
    }
  };

  // `data-swipe-ignore` is belt-and-braces: /workout bypasses AppShell today,
  // so nothing here reaches the swipe-between-tabs handler. React portals
  // bubble along the React tree though, so the moment this sheet is rendered
  // from a route that IS wrapped in AppShell, a drag with any horizontal
  // component would navigate away mid-set. The attribute costs nothing and is
  // resolved by a DOM `closest` in AppShell's shouldIgnoreSwipe.
  return createPortal(
    <div
      data-swipe-ignore
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center bg-black/30 anim-backdrop"
      onClick={onClose}
      style={{ opacity: dragY > 0 ? Math.max(0, 1 - dragY / 300) : 1 }}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-surface anim-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          paddingBottom: `max(env(safe-area-inset-bottom), ${20 + keyboardOffset}px)`,
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: isDragging ? "none" : "transform 0.2s cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* min-h-[44px], not the visual height of the 4px grabber: this is the
            drag-to-dismiss target, and py-3 alone gave it a 28px hit area. */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          className="flex min-h-[44px] w-full cursor-grab touch-none items-center active:cursor-grabbing"
          aria-label="Drag down to close sheet"
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-border" />
        </div>

        {pickingExercise ? (
          <div className="px-5 pb-4">
            <input
              autoFocus
              aria-label="Search or add exercise"
              value={exerciseQuery}
              onChange={(e) => setExerciseQuery(e.target.value)}
              placeholder="Search or add exercise"
              className="w-full bg-transparent text-[22px] font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
            />
            <ul className="mt-3 max-h-72 divide-y divide-border overflow-y-auto">
              {filtered.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => {
                      setExerciseId(e.id);
                      setCurrentExercise(e.id);
                      setPickingExercise(false);
                      setWeight("");
                      setReps("");
                      setRpe("");
                      setNote("");
                    }}
                    className="flex w-full min-h-[44px] items-center justify-between py-3 text-left"
                  >
                    <span className="text-[16px]">{e.name}</span>
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {exerciseTypeLabel(e.type)}
                    </span>
                  </button>
                </li>
              ))}
              {exerciseQuery.trim() &&
                !filtered.some(
                  (e) => e.name.toLowerCase() === exerciseQuery.trim().toLowerCase(),
                ) && (
                  <li>
                    <button
                      onClick={() => {
                        const ex = addExercise(exerciseQuery.trim(), "accessory");
                        setExerciseId(ex.id);
                        setCurrentExercise(ex.id);
                        setPickingExercise(false);
                        setWeight("");
                        setReps("");
                        setRpe("");
                        setNote("");
                      }}
                      className="flex w-full min-h-[44px] items-center justify-between py-3 text-left text-accent"
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
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Exercise
                </div>
                <div className="mt-0.5 text-[22px] font-semibold tracking-tight">
                  {chosen?.name}
                </div>
              </button>
              <button
                onClick={() => setPickingExercise(true)}
                className="flex min-h-[44px] items-center text-[13px] font-medium text-accent"
              >
                Change
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
              <span className="shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
                Setup
              </span>
              <input
                // The visible "Setup" text is a sibling span, not a <label>,
                // and the placeholder is whatever note was used last time, so
                // neither one names this field to a screen reader.
                aria-label="Setup note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                enterKeyHint="next"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    inputRefs.current[0]?.focus();
                  }
                }}
                placeholder={suggestedNote ?? "Add notes - seat, pins, grip…"}
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <NumField
                label="Weight"
                suffix={unit}
                value={weight}
                onChange={setWeight}
                placeholder={suggestion.weight != null ? String(suggestion.weight) : "0"}
                inputMode="decimal"
                enterKeyHint="next"
                onEnter={() => focusNextOrLog(0)}
                inputRef={(el) => {
                  inputRefs.current[0] = el;
                }}
              />
              <NumField
                label="Reps"
                value={reps}
                onChange={setReps}
                placeholder={suggestion.reps != null ? String(suggestion.reps) : "0"}
                inputMode="numeric"
                enterKeyHint="next"
                onEnter={() => focusNextOrLog(1)}
                onStep={stepReps}
                inputRef={(el) => {
                  inputRefs.current[1] = el;
                }}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <NumField
                label="RPE"
                placeholder={suggestion.rpe != null ? String(suggestion.rpe) : "-"}
                value={rpe}
                onChange={setRpe}
                inputMode="decimal"
                enterKeyHint="done"
                onEnter={() => focusNextOrLog(2)}
                onStep={stepRpe}
                inputRef={(el) => {
                  inputRefs.current[2] = el;
                }}
              />
              <div className="rounded-xl bg-muted p-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Sets
                </div>
                {/* tabIndex={-1} + preventDefault on mousedown, matching the
                    steppers in NumField: without them these take focus off
                    whichever numeric field the user is filling, collapsing the
                    soft keyboard on every tap. */}
                <div className="mt-1 flex items-center justify-between">
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Decrease sets"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setTargetSets(Math.max(1, targetSets - 1))}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-[18px] font-semibold text-foreground hairline-t hairline-b active:scale-95"
                  >
                    −
                  </button>
                  <span className="tnum text-[22px] font-semibold">{targetSets}</span>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Increase sets"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setTargetSets(targetSets + 1)}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-[18px] font-semibold text-foreground hairline-t hairline-b active:scale-95"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-2">
              <button
                onClick={onClose}
                className="flex-1 min-h-[44px] rounded-full py-3 text-[15px] font-medium text-muted-foreground"
              >
                Cancel
              </button>
              <button
                onClick={doLog}
                disabled={!canLog}
                className="flex-[2] min-h-[44px] rounded-full bg-accent py-3 text-[15px] font-semibold text-accent-foreground disabled:opacity-40"
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

/**
 * Select a field's whole value as it is entered, so typing REPLACES the number
 * instead of appending to it. This is the single biggest friction win when
 * logging: without it, changing 225 to 235 means clearing three digits first.
 *
 * The synchronous `select()` is what works on desktop. iOS Safari runs its own
 * tap-to-place-caret AFTER the focus event and collapses that selection, so the
 * range is reapplied on the next frame. The activeElement check makes the
 * deferred half a no-op if the user has already moved on, and is also why this
 * needs no cleanup on unmount: a frame that lands after the sheet closes finds
 * a detached element and does nothing.
 *
 * These inputs carry no `type`, so they are text inputs and support
 * setSelectionRange; the try/catch is only insurance against that changing,
 * since `type="number"` would throw here.
 */
function selectAllOnEntry(el: HTMLInputElement) {
  el.select();
  requestAnimationFrame(() => {
    if (document.activeElement !== el) return;
    try {
      el.setSelectionRange(0, el.value.length);
    } catch {
      // Selection unsupported for this input type; the sync select() stands.
    }
  });
}

export function NumField({
  label,
  value,
  onChange,
  placeholder,
  suffix,
  inputMode = "decimal",
  enterKeyHint = "next",
  onEnter,
  onStep,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  inputMode?: "decimal" | "numeric";
  enterKeyHint?: "next" | "done";
  onEnter?: () => void;
  onStep?: (dir: -1 | 1) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-1">
        {onStep && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Decrease ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onStep(-1)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-[18px] font-semibold text-foreground hairline-t hairline-b active:scale-95"
          >
            −
          </button>
        )}
        <div
          className={`flex min-w-0 flex-1 items-baseline gap-1 ${
            onStep ? "justify-center text-center" : ""
          }`}
        >
          <input
            ref={inputRef}
            inputMode={inputMode}
            enterKeyHint={enterKeyHint}
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={(e) => {
              selectAllOnEntry(e.currentTarget);
              // `block: "nearest"` with no `behavior`, deliberately. A JS
              // smooth scroll is not covered by styles.css's global
              // prefers-reduced-motion clamp (that only flattens CSS
              // durations), and on iOS it also races the keyboard resize that
              // the visualViewport lift above already handles.
              e.currentTarget.scrollIntoView({ block: "nearest" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter?.();
              }
            }}
            placeholder={placeholder ?? "0"}
            className={`tnum w-full bg-transparent text-[22px] font-semibold outline-none placeholder:text-muted-foreground ${
              onStep ? "text-center" : ""
            }`}
          />
          {suffix && <span className="text-[12px] text-muted-foreground">{suffix}</span>}
        </div>
        {onStep && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Increase ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onStep(1)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-[18px] font-semibold text-foreground hairline-t hairline-b active:scale-95"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}
