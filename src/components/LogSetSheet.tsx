import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { useStore, type ExerciseType } from "../lib/store";

/** Handles all three exercise types even though the picker above filters
 * cardio out entirely -- kept exhaustive so a future caller (or a stray
 * cardio id) never falls through to a wrong label. */
/** Handles all three exercise types even though the picker above filters
 * cardio out entirely - kept exhaustive so a future caller (or a stray
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

  // Escape closes the sheet outright rather than stepping back out of the
  // exercise picker. The picker is not a second screen with somewhere to return
  // to - it is what this sheet shows when no exercise is chosen yet - so a
  // "back" would have nothing behind it half the time. Same as a backdrop tap.
  useSheetDismiss(open, onClose);

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
  // (CardioLogCard) - it must never show up while logging a strength set.
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

  return createPortal(
    <div
      data-swipe-ignore
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center bg-black/30 anim-backdrop"
      onClick={onClose}
      style={{ opacity: dragY > 0 ? Math.max(0, 1 - dragY / 300) : 1 }}
    >
      <div
        className="w-full max-w-md bg-paper rule-heavy-t anim-sheet rounded-md"
        onClick={(e) => e.stopPropagation()}
        style={{
          paddingBottom: `max(env(safe-area-inset-bottom), ${20 + keyboardOffset}px)`,
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: isDragging ? "none" : "transform 0.2s cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          className="flex min-h-[44px] w-full cursor-grab touch-none items-center active:cursor-grabbing"
          aria-label="Drag down to close sheet"
        >
          <div className="mx-auto h-1 w-10 bg-border" />
        </div>

        {pickingExercise ? (
          <div className="px-5 pb-4">
            <input
              autoFocus
              aria-label="Search or add exercise"
              value={exerciseQuery}
              onChange={(e) => setExerciseQuery(e.target.value)}
              placeholder="Search or add exercise"
              className="w-full bg-transparent t-heading font-semibold tracking-tight outline-none placeholder:text-ink-2"
            />
            <div className="mt-3 group-list bg-wash max-h-72 overflow-y-auto">
              {filtered.map((e, idx) => (
                <button
                  key={e.id}
                  onClick={() => {
                    setExerciseId(e.id);
                    setCurrentExercise(e.id);
                    setPickingExercise(false);
                    setWeight("");
                    setReps("");
                    setRpe("");
                    setNote("");
                  }}
                  className={`group-row w-full text-left ${idx > 0 ? "group-row-sep" : ""}`}
                >
                  <span className="t-body font-medium">{e.name}</span>
                  <span className="t-caption text-ink-2">{exerciseTypeLabel(e.type)}</span>
                </button>
              ))}
              {exerciseQuery.trim() &&
                !filtered.some(
                  (e) => e.name.toLowerCase() === exerciseQuery.trim().toLowerCase(),
                ) && (
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
                    className={`group-row w-full text-left t-action ${
                      filtered.length > 0 ? "group-row-sep" : ""
                    }`}
                  >
                    <span className="t-body font-medium">Add "{exerciseQuery.trim()}"</span>
                    <span className="t-caption">New</span>
                  </button>
                )}
            </div>
          </div>
        ) : (
          <div className="px-5 pb-5">
            <div className="flex items-baseline justify-between">
              <button onClick={() => setPickingExercise(true)} className="text-left">
                <div className="t-caption text-ink-2">Exercise</div>
                <div className="mt-0.5 t-heading font-semibold tracking-tight">{chosen?.name}</div>
              </button>
              <button
                onClick={() => setPickingExercise(true)}
                className="flex min-h-[44px] items-center t-label t-action"
              >
                Change
              </button>
            </div>

            {/* Grouped list of labelled set logging rows */}
            <div className="mt-4 group-list bg-wash">
              {/* Setup note */}
              <div className="group-row">
                <label htmlFor="set-field-note" className="t-body font-medium text-ink shrink-0">
                  Setup
                </label>
                <input
                  id="set-field-note"
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
                  placeholder={suggestedNote ?? "Add notes: seat, pins, grip..."}
                  className="t-body w-full bg-transparent text-right outline-none placeholder:text-ink-2"
                />
              </div>

              {/* Weight */}
              <div className="group-row group-row-sep">
                <label htmlFor="set-field-weight" className="t-body font-medium text-ink">
                  Weight
                </label>
                <div className="flex min-w-0 items-baseline justify-end gap-1">
                  <input
                    id="set-field-weight"
                    ref={(el) => {
                      inputRefs.current[0] = el;
                    }}
                    inputMode="decimal"
                    enterKeyHint="next"
                    aria-label="Weight"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    onFocus={(e) => {
                      selectAllOnEntry(e.currentTarget);
                      e.currentTarget.scrollIntoView({ block: "nearest" });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        focusNextOrLog(0);
                      }
                    }}
                    placeholder={suggestion.weight != null ? String(suggestion.weight) : "0"}
                    className="t-stat w-28 bg-transparent text-right outline-none placeholder:t-body placeholder:text-ink-2"
                  />
                  <span className="t-label text-ink-2">{unit}</span>
                </div>
              </div>

              {/* Reps */}
              <div className="group-row group-row-sep">
                <label htmlFor="set-field-reps" className="t-body font-medium text-ink">
                  Reps
                </label>
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Decrease reps"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => stepReps(-1)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center t-body font-semibold text-ink active:scale-95"
                  >
                    −
                  </button>
                  <input
                    id="set-field-reps"
                    ref={(el) => {
                      inputRefs.current[1] = el;
                    }}
                    inputMode="numeric"
                    enterKeyHint="next"
                    aria-label="Reps"
                    value={reps}
                    onChange={(e) => setReps(e.target.value)}
                    onFocus={(e) => {
                      selectAllOnEntry(e.currentTarget);
                      e.currentTarget.scrollIntoView({ block: "nearest" });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        focusNextOrLog(1);
                      }
                    }}
                    placeholder={suggestion.reps != null ? String(suggestion.reps) : "0"}
                    className="t-stat w-20 bg-transparent text-center outline-none placeholder:t-body placeholder:text-ink-2"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Increase reps"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => stepReps(1)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center t-body font-semibold text-ink active:scale-95"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* RPE */}
              <div className="group-row group-row-sep">
                <label htmlFor="set-field-rpe" className="t-body font-medium text-ink">
                  RPE
                </label>
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Decrease RPE"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => stepRpe(-1)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center t-body font-semibold text-ink active:scale-95"
                  >
                    −
                  </button>
                  <input
                    id="set-field-rpe"
                    ref={(el) => {
                      inputRefs.current[2] = el;
                    }}
                    inputMode="decimal"
                    enterKeyHint="done"
                    aria-label="RPE"
                    value={rpe}
                    onChange={(e) => setRpe(e.target.value)}
                    onFocus={(e) => {
                      selectAllOnEntry(e.currentTarget);
                      e.currentTarget.scrollIntoView({ block: "nearest" });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        focusNextOrLog(2);
                      }
                    }}
                    placeholder={suggestion.rpe != null ? String(suggestion.rpe) : "-"}
                    className="t-stat w-20 bg-transparent text-center outline-none placeholder:t-body placeholder:text-ink-2"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Increase RPE"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => stepRpe(1)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center t-body font-semibold text-ink active:scale-95"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Sets */}
              <div className="group-row group-row-sep">
                <span className="t-body font-medium text-ink">Target sets</span>
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Decrease sets"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setTargetSets(Math.max(1, targetSets - 1))}
                    className="flex h-9 w-9 shrink-0 items-center justify-center t-body font-semibold text-ink active:scale-95"
                  >
                    −
                  </button>
                  <span className="t-stat font-semibold text-ink w-12 text-center">
                    {targetSets}
                  </span>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Increase sets"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setTargetSets(targetSets + 1)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center t-body font-semibold text-ink active:scale-95"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-2">
              <button
                onClick={onClose}
                className="flex-1 min-h-[44px] py-3 t-body font-medium text-ink-2"
              >
                Cancel
              </button>
              <button
                onClick={doLog}
                disabled={!canLog}
                className="flex-[2] min-h-[44px] bg-ink py-3 t-body font-semibold text-paper disabled:opacity-40 rounded-md"
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
    <div className="bg-wash p-3">
      <div className="t-caption text-ink-2">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-1">
        {onStep && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Decrease ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onStep(-1)}
            className="flex h-11 w-11 shrink-0 items-center justify-center t-heading font-semibold text-ink hairline-t hairline-b active:scale-95"
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
              e.currentTarget.scrollIntoView({ block: "nearest" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter?.();
              }
            }}
            placeholder={placeholder ?? "0"}
            className={`t-stat w-full bg-transparent font-semibold outline-none placeholder:t-body placeholder:text-ink-2 ${
              onStep ? "text-center" : ""
            }`}
          />
          {suffix && <span className="t-label text-ink-2">{suffix}</span>}
        </div>
        {onStep && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Increase ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onStep(1)}
            className="flex h-11 w-11 shrink-0 items-center justify-center t-heading font-semibold text-ink hairline-t hairline-b active:scale-95"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}
