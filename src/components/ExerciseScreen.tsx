import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "./icons";
import { Primary } from "./Frame";
import { TutorialBanner } from "./TutorialBanner";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { lastSessionFor } from "../lib/exercise-history";
import {
  buildSetRows,
  lastTimeLine,
  prescriptionOf,
  type GhostValues,
  type SetRow,
} from "../lib/set-rows";
import { useStore, type PlannedLift } from "../lib/store";

/**
 * One exercise, with its sets as rows inside it.
 *
 * This replaces a bottom sheet that logged one set at a time and then had to be
 * reopened for the next. The unit of the screen is the LIFT: what was
 * prescribed for it, what it came to last time, and a row per set of it today.
 * A row is tapped to log it or to correct it, so the set you are looking at and
 * the set you are editing are the same object - which is the whole of the bug
 * where the log interface offered the previous exercise.
 *
 * Rendered through a portal, like every other full-screen overlay here: a route
 * animation leaves a transform on <main>, and a fixed child of a transformed
 * element positions against that element rather than the screen.
 */
export function ExerciseScreen({
  exerciseId,
  lift,
  stopwatch,
  onDone,
}: {
  exerciseId: string;
  /** What the card prescribed, when this exercise came off a plan. */
  lift?: PlannedLift;
  /** Time between sets, already formatted, so this and the workout screen show
   *  one clock rather than two that drift a second apart. */
  stopwatch: string;
  /** `complete` is true when every row on this screen has been logged. */
  onDone: (complete: boolean) => void;
}) {
  const activeSessionId = useStore((s) => s.activeSessionId);
  const exercises = useStore((s) => s.exercises);
  const allSets = useStore((s) => s.sets);
  const sessions = useStore((s) => s.sessions);
  const unit = useStore((s) => s.unit);
  const logSet = useStore((s) => s.logSet);
  const updateSet = useStore((s) => s.updateSet);
  const lastSetupNoteFor = useStore((s) => s.lastSetupNoteFor);
  const setSetupNote = useStore((s) => s.setSetupNote);

  /** How far "+ Add set" has pushed the row count past what is prescribed. */
  const [minRows, setMinRows] = useState(0);
  /** The row whose editor is open, by its 1-based index, or null for none. */
  const [editing, setEditing] = useState<number | null>(null);
  /** Whether the setup note at the top is open for editing, and its draft. */
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  /** Whether the setup note was edited during this visit to the exercise screen. */
  const [noteEditedThisVisit, setNoteEditedThisVisit] = useState(false);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState("");
  const [note, setNote] = useState("");
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const exercise = exercises.find((e) => e.id === exerciseId);
  const setupNote = lastSetupNoteFor(exerciseId);

  const logged = useMemo(
    () =>
      allSets
        .filter((s) => s.sessionId === activeSessionId && s.exerciseId === exerciseId)
        .sort((a, b) => a.loggedAt - b.loggedAt),
    [allSets, activeSessionId, exerciseId],
  );

  // The same "last session" the card on the workout screen used to show, and
  // the same one the ghosts are read from - one source, so the line above the
  // rows always explains the numbers in them.
  const lastSets = useMemo(
    () => lastSessionFor(allSets, sessions, exerciseId, activeSessionId)?.sets ?? [],
    [allSets, sessions, exerciseId, activeSessionId],
  );

  const rows = useMemo(
    () => buildSetRows({ lift, logged, lastSession: lastSets, minRows }),
    [lift, logged, lastSets, minRows],
  );
  const complete = rows.every((row) => row.set !== undefined);
  const hasDoneSomething = logged.length > 0 || noteEditedThisVisit;

  useSheetDismiss(true, () => onDone(complete));

  // Lift the scroller by the soft keyboard's height so the row being edited is
  // not left underneath it.
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const handleViewportChange = () => {
      setKeyboardOffset(Math.max(0, window.innerHeight - vv.height));
    };
    vv.addEventListener("resize", handleViewportChange);
    vv.addEventListener("scroll", handleViewportChange);
    handleViewportChange();
    return () => {
      vv.removeEventListener("resize", handleViewportChange);
      vv.removeEventListener("scroll", handleViewportChange);
    };
  }, []);

  const openRow = (row: SetRow) => {
    if (editing === row.index) {
      setEditing(null);
      return;
    }
    setEditing(row.index);
    if (row.set) {
      setWeight(String(row.set.weight));
      setReps(String(row.set.reps));
      setRpe(row.set.rpe != null ? String(row.set.rpe) : "");
    } else {
      // The ghost goes in as a real value, not a placeholder: a suggestion you
      // have to retype is not a suggestion.
      setWeight(row.ghost.weight != null ? String(row.ghost.weight) : "");
      setReps(row.ghost.reps != null ? String(row.ghost.reps) : "");
      setRpe(row.ghost.rpe != null ? String(row.ghost.rpe) : "");
    }
    // Carried forward rather than blank: the setup is the same bench at the
    // same pin height until somebody changes it. This field is the per-SET
    // snapshot - the one set you did at a different pin - while the note at the
    // top of the screen is the lift's own, and changing that one does not need
    // a set to hang off.
    setNote(row.set?.setupNote ?? setupNote ?? "");
  };

  /**
   * Committed on blur, and on Enter by way of blurring.
   *
   * No Escape: this screen is used on a phone, where there is no such key, and
   * a cancel that only exists on a desktop keyboard is a cancel most people
   * never have. Backing out of a note is retyping it, which is the same gesture
   * as writing one.
   */
  const commitNote = () => {
    setEditingNote(false);
    if (noteDraft.trim() === (setupNote ?? "").trim()) return;
    setSetupNote(exerciseId, noteDraft);
    setNoteEditedThisVisit(true);
  };

  const parsedWeight = parseFloat(weight);
  const parsedReps = parseInt(reps, 10);
  const canSave = Number.isFinite(parsedWeight) && parsedWeight >= 0 && parsedReps > 0;

  const save = (row: SetRow) => {
    if (!canSave) return;
    const typedRpe = rpe.trim() ? parseFloat(rpe) : NaN;
    const rpeValue = Number.isFinite(typedRpe) ? typedRpe : undefined;
    if (row.set) {
      updateSet(row.set.id, {
        weight: parsedWeight,
        reps: parsedReps,
        rpe: rpeValue,
        setupNote: note.trim() || undefined,
      });
    } else {
      // The note is a per-set snapshot, which is what `prefillFor` buckets on:
      // "Heavy Bench" at pin 4 and the same bar at pin 6 are different setups
      // and must not prefill each other.
      logSet({
        exerciseId,
        weight: parsedWeight,
        reps: parsedReps,
        rpe: rpeValue,
        setupNote: note.trim() || undefined,
      });
    }
    setEditing(null);
  };

  if (typeof document === "undefined") return null;

  const plan = prescriptionOf(lift);
  const lastTime = lastTimeLine(lastSets);

  return createPortal(
    <div className="fixed inset-x-0 top-0 z-50 h-[100dvh] bg-paper anim-backdrop">
      <div className="mx-auto flex h-full max-w-md flex-col">
        <TutorialBanner />
        {/* The way out in the corner stays as the exit when nothing has been
            done. An unconditional full-width Done pinned to the bottom was
            deliberately removed, because it promised a transaction that does
            not exist: a set is saved the moment you save it, and naming the
            exit after a commit made leaving mid-exercise feel like abandoning
            something. A conditional Done that appears only once you have logged
            a set or edited the setup note is different: it marks work you did
            rather than a commit you owe. */}
        <div className="flex items-center justify-between px-4 pt-14 pb-2">
          <button
            onClick={() => onDone(complete)}
            data-tutorial="exercise-back"
            className="-my-[11px] flex min-h-[44px] items-center t-body font-medium t-action"
          >
            Back
          </button>
        </div>

        <div className="px-4 pb-2">
          <h1 className="text-balance break-words t-title text-ink">
            {exercise?.name ?? "Unknown exercise"}
          </h1>

          {/* Two readings, and between them they are why a ghosted row is
              grey: the plan is where a prescribed number came from, last time
              is where the rest came from. That is what lets the rows carry no
              badges at all. */}
          {plan && (
            <p className="mt-2 t-label text-ink-2">
              Plan <span className="tnum text-ink">{plan}</span>
            </p>
          )}
          {lastTime && (
            <p className="mt-1 truncate t-label text-ink-2">
              Last time <span className="tnum text-ink">{lastTime}</span>
            </p>
          )}
          {/* The setup, as a thing you can change rather than a thing you are
              told. It was a paragraph, and the only way to alter it was to open
              a set row and save a set - so the one screen that shows you the
              pin height was the one place you could not correct it. */}
          {editingNote ? (
            <input
              type="text"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={commitNote}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              autoFocus
              placeholder="Seat, pins, grip"
              aria-label="Setup note"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="mt-2 min-h-[44px] w-full rounded-md bg-field px-3 t-label text-ink outline-none placeholder:text-ink-3"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setNoteDraft(setupNote ?? "");
                setEditingNote(true);
              }}
              // Named for what tapping it does. Its visible text is the note
              // itself, which reads as a statement rather than a control, and
              // when there is no note yet that text is only a placeholder.
              aria-label="Edit setup note"
              className="mt-2 flex min-h-[44px] w-full items-center rounded-md bg-field px-3 text-left t-label text-ink-2"
            >
              {setupNote ?? <span className="text-ink-3">Seat, pins, grip</span>}
            </button>
          )}

          <div className="mt-3 flex items-baseline justify-between gap-3">
            <span className="t-caption text-ink-3">Time between sets</span>
            <span className="tnum t-stat text-ink">{stopwatch}</span>
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-4"
          // Who owns the bottom inset depends on whether the Done bar is
          // there. With no bar, the scroller runs to the bottom of the screen
          // and "Add set" is the last thing on it, so the scroller carries the
          // inset itself. With the bar, the bar is the last thing on screen
          // and carries it instead -- both would double it.
          style={{
            marginBottom: keyboardOffset,
            paddingBottom: hasDoneSomething
              ? "16px"
              : "calc(max(env(safe-area-inset-bottom), 24px) + var(--rail-h, 0px))",
          }}
        >
          <ul className="group-list">
            {rows.map((row, idx) => {
              const isEditing = editing === row.index;
              const ghost = ghostLabel(row.ghost, unit);
              return (
                <li key={row.index}>
                  <button
                    onClick={() => openRow(row)}
                    aria-expanded={isEditing}
                    data-tutorial={
                      row.index === 1 ? "set-row-1" : row.index === 2 ? "set-row-2" : undefined
                    }
                    // Logged and unlogged rows differ on screen by solid versus
                    // grey, which is not a difference a screen reader can hear.
                    // The name says which it is, so "the suggestion" and "what
                    // you actually lifted" are never the same sentence.
                    aria-label={
                      row.set
                        ? `Set ${row.index}, logged, ${row.set.weight} ${unit} by ${row.set.reps}`
                        : ghost
                          ? `Set ${row.index}, not logged, suggested ${ghost}`
                          : `Set ${row.index}, not logged`
                    }
                    className={`group-row w-full text-left ${idx > 0 ? "group-row-sep" : ""}`}
                  >
                    {/* The space between the two spans is load-bearing: flex
                        `gap` is not text, so without it the row's accessible
                        name runs together as "Set 18". */}
                    <span className="t-body text-ink">Set {row.index}</span>{" "}
                    {row.set ? (
                      <span className="shrink-0 tnum t-body text-ink">
                        {row.set.weight} {unit} × {row.set.reps}
                        {row.set.rpe != null && (
                          <span className="t-label text-ink-2"> @ {row.set.rpe}</span>
                        )}
                      </span>
                    ) : (
                      ghost && <span className="shrink-0 tnum t-body text-ink-3">{ghost}</span>
                    )}
                  </button>

                  {isEditing && (
                    <div className="group-row-sep flex items-end gap-2 px-4 py-3">
                      <EditorField
                        id={`set-${row.index}-weight`}
                        label="Weight"
                        value={weight}
                        onChange={setWeight}
                        suffix={unit}
                        onEnter={() => inputRefs.current[1]?.focus()}
                        inputRef={(el) => {
                          inputRefs.current[0] = el;
                        }}
                      />
                      <EditorField
                        id={`set-${row.index}-reps`}
                        label="Reps"
                        value={reps}
                        onChange={setReps}
                        inputMode="numeric"
                        onEnter={() => inputRefs.current[2]?.focus()}
                        inputRef={(el) => {
                          inputRefs.current[1] = el;
                        }}
                      />
                      <EditorField
                        id={`set-${row.index}-rpe`}
                        label="RPE"
                        value={rpe}
                        onChange={setRpe}
                        enterKeyHint="done"
                        onEnter={() => save(row)}
                        inputRef={(el) => {
                          inputRefs.current[2] = el;
                        }}
                      />
                      <button
                        onClick={() => save(row)}
                        disabled={!canSave}
                        data-tutorial="set-save"
                        className="min-h-[44px] shrink-0 bg-ink px-4 t-body font-semibold text-paper disabled:opacity-40 rounded-md"
                      >
                        Save
                      </button>
                    </div>
                  )}
                  {isEditing && (
                    /* Words rather than a figure, so it gets its own line
                       instead of squeezing three number fields into a third
                       of the screen each. */
                    <div className="group-row-sep px-4 pb-3">
                      <input
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Seat, pins, grip"
                        aria-label="Setup note"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        className="min-h-[44px] w-full rounded-md bg-field px-3 t-label text-ink outline-none placeholder:text-ink-3"
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <button
            onClick={() => setMinRows(rows.length + 1)}
            className="flex min-h-[44px] w-full items-center gap-2 t-action t-body"
          >
            <Plus size={18} />
            Add set
          </button>
        </div>

        {hasDoneSomething && (
          <div
            className="shrink-0 bg-paper px-4 pt-2"
            style={{
              paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + var(--rail-h, 0px))",
            }}
          >
            <Primary onClick={() => onDone(complete)} dataTutorial="exercise-done">
              Done
            </Primary>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** "100 lbs × 8-12 @ 8", with whatever is missing simply absent. */
function ghostLabel(ghost: GhostValues, unit: string): string {
  const parts: string[] = [];
  if (ghost.weight != null) parts.push(`${ghost.weight} ${unit}`);
  if (ghost.repsLabel) parts.push(ghost.repsLabel);
  const main = parts.join(" × ");
  if (!main) return "";
  return ghost.rpe != null ? `${main} @ ${ghost.rpe}` : main;
}

function EditorField({
  id,
  label,
  value,
  onChange,
  suffix,
  inputMode = "decimal",
  enterKeyHint = "next",
  onEnter,
  inputRef,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  inputMode?: "decimal" | "numeric";
  enterKeyHint?: "next" | "done";
  onEnter: () => void;
  inputRef: (el: HTMLInputElement | null) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="block t-caption text-ink-3">
        {label}
      </label>
      <div className="mt-1 flex items-baseline gap-1">
        <input
          id={id}
          ref={inputRef}
          inputMode={inputMode}
          enterKeyHint={enterKeyHint}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            selectAllOnEntry(e.currentTarget);
            e.currentTarget.scrollIntoView?.({ block: "nearest" });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            }
          }}
          className="min-h-[44px] w-full min-w-0 rounded-md bg-field px-3 tnum t-stat text-ink outline-none"
        />
        {suffix && <span className="t-label text-ink-2">{suffix}</span>}
      </div>
    </div>
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
 * needs no cleanup on unmount: a frame that lands after the screen closes finds
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
