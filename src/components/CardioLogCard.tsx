import { useMemo, useState } from "react";
import { useStore, type Exercise } from "../lib/store";

/**
 * Suggested cardio activities offered until the user (or a prior save) has
 * created a same-named cardio exercise. Presets are created lazily via
 * `addExercise` the first time one is picked -- there is no seed data for
 * them, so a fresh install has nothing to filter the picker down to.
 */
const PRESET_ACTIVITIES = ["Treadmill", "Jog", "Stationary Bike"];

type PickerRow = { kind: "existing"; exercise: Exercise } | { kind: "preset"; name: string };

/**
 * One-shot cardio log: pick an activity, optionally note duration/distance/
 * setup, save. Embedded inside WorkoutChooserSheet as the second "screen" of
 * that same popup -- it owns no open/close state of its own, just `onBack`
 * (return to the chooser) and `onDone` (log was saved, close everything).
 */
export function CardioLogCard({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const exercises = useStore((s) => s.exercises);
  const addExercise = useStore((s) => s.addExercise);
  const logCardio = useStore((s) => s.logCardio);
  const lastSetupNoteFor = useStore((s) => s.lastSetupNoteFor);
  const unit = useStore((s) => s.unit);

  const cardioExercises = useMemo(() => exercises.filter((e) => e.type === "cardio"), [exercises]);

  const [pickingExercise, setPickingExercise] = useState(true);
  const [exerciseQuery, setExerciseQuery] = useState("");
  const [exerciseId, setExerciseId] = useState<string | undefined>(undefined);
  const [setupNote, setSetupNote] = useState("");
  const [duration, setDuration] = useState("");
  const [distance, setDistance] = useState("");

  const missingPresets = useMemo(
    () =>
      PRESET_ACTIVITIES.filter(
        (name) => !cardioExercises.some((e) => e.name.toLowerCase() === name.toLowerCase()),
      ),
    [cardioExercises],
  );

  const rows: PickerRow[] = useMemo(
    () => [
      ...cardioExercises.map((e): PickerRow => ({ kind: "existing", exercise: e })),
      ...missingPresets.map((name): PickerRow => ({ kind: "preset", name })),
    ],
    [cardioExercises, missingPresets],
  );

  const rowName = (r: PickerRow) => (r.kind === "existing" ? r.exercise.name : r.name);

  const filteredRows = useMemo(() => {
    const q = exerciseQuery.trim().toLowerCase();
    const list = q ? rows.filter((r) => rowName(r).toLowerCase().includes(q)) : rows;
    return list.slice(0, 20);
  }, [rows, exerciseQuery]);

  const chosen = exercises.find((e) => e.id === exerciseId);
  const suggestedNote = exerciseId ? lastSetupNoteFor(exerciseId) : undefined;

  const selectExercise = (id: string) => {
    setExerciseId(id);
    setPickingExercise(false);
    setSetupNote("");
    setDuration("");
    setDistance("");
  };

  // Shared by preset taps and the typed "Add" row. Re-checks the live store
  // (not the `cardioExercises` closure) so two rapid taps -- or picking a
  // preset right after typing the same name -- can never create a duplicate.
  const addCustom = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = useStore
      .getState()
      .exercises.find((e) => e.type === "cardio" && e.name.toLowerCase() === trimmed.toLowerCase());
    const ex = existing ?? addExercise(trimmed, "cardio");
    selectExercise(ex.id);
  };

  const trimmedQuery = exerciseQuery.trim();
  const showAddRow =
    trimmedQuery.length > 0 &&
    !filteredRows.some((r) => rowName(r).toLowerCase() === trimmedQuery.toLowerCase());

  const doSave = () => {
    if (!exerciseId) return;
    const dur = duration.trim() ? Math.round(parseFloat(duration)) : undefined;
    const dist = distance.trim() ? parseFloat(distance) : undefined;
    logCardio({
      exerciseId,
      durationMinutes: dur != null && !Number.isNaN(dur) ? dur : undefined,
      distance: dist != null && !Number.isNaN(dist) ? dist : undefined,
      setupNote: setupNote.trim() || suggestedNote,
    });
    onDone();
  };

  if (pickingExercise) {
    return (
      <div>
        <div className="mx-auto mb-1 h-1 w-10 bg-border" />
        <input
          autoFocus
          value={exerciseQuery}
          onChange={(e) => setExerciseQuery(e.target.value)}
          placeholder="Search or add activity"
          aria-label="Search or add a cardio activity"
          className="mt-3 min-h-[44px] w-full bg-transparent t-heading outline-none placeholder:text-ink-2"
        />
        <div className="mt-3 max-h-72 overflow-y-auto group-list">
          {filteredRows.map((r, idx) =>
            r.kind === "existing" ? (
              <button
                key={r.exercise.id}
                onClick={() => selectExercise(r.exercise.id)}
                className={`group-row w-full text-left ${idx > 0 ? "group-row-sep" : ""}`}
              >
                <span className="truncate t-body">{r.exercise.name}</span>
              </button>
            ) : (
              <button
                key={r.name}
                onClick={() => addCustom(r.name)}
                className={`group-row w-full text-left ${idx > 0 ? "group-row-sep" : ""}`}
              >
                <span className="truncate t-body text-ink-2">{r.name}</span>
                <span className="shrink-0 t-caption text-ink-2">Suggested</span>
              </button>
            ),
          )}
          {showAddRow && (
            <button
              onClick={() => addCustom(trimmedQuery)}
              className={`group-row w-full text-left t-action ${
                filteredRows.length > 0 ? "group-row-sep" : ""
              }`}
            >
              <span className="truncate t-body">Add "{trimmedQuery}"</span>
              <span className="shrink-0 t-caption">New</span>
            </button>
          )}
        </div>
        <button
          onClick={onBack}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center py-3 t-body font-medium text-ink-2"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mx-auto mb-1 h-1 w-10 bg-border" />
      <div className="mt-3 group-list">
        <button
          onClick={() => setPickingExercise(true)}
          aria-label={`Change activity, currently ${chosen?.name ?? "not set"}`}
          className="group-row w-full text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="t-caption text-ink-2">Activity</div>
            <div className="truncate t-heading">{chosen?.name}</div>
          </div>
          <span className="shrink-0 t-label t-action">Change</span>
        </button>

        <div className="group-row group-row-sep">
          <label htmlFor="cardio-setup-note" className="shrink-0 t-caption text-ink-2">
            Setup
          </label>
          <input
            id="cardio-setup-note"
            value={setupNote}
            onChange={(e) => setSetupNote(e.target.value)}
            placeholder={suggestedNote ?? "Incline, resistance"}
            className="min-h-[44px] w-full min-w-0 bg-transparent t-body outline-none placeholder:text-ink-2"
          />
        </div>

        <div className="group-row group-row-sep">
          <label htmlFor="cardio-duration" className="shrink-0 t-body text-ink-2">
            Duration
          </label>
          <div className="flex items-center gap-1.5 min-w-0">
            <input
              id="cardio-duration"
              inputMode="decimal"
              enterKeyHint="next"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="0"
              className="t-stat w-20 text-right bg-transparent outline-none placeholder:text-ink-2"
            />
            <span className="t-label text-ink-2">min</span>
          </div>
        </div>

        <div className="group-row group-row-sep">
          <label htmlFor="cardio-distance" className="shrink-0 t-body text-ink-2">
            Distance
          </label>
          <div className="flex items-center gap-1.5 min-w-0">
            {/* enterKeyHint and select-on-focus are not decoration: these two
                fields used to render through NumField and lost both when the
                restyle inlined them. Selecting on entry is what lets a typed
                value overwrite the previous one instead of appending to it,
                which is the difference between one tap and three. */}
            <input
              id="cardio-distance"
              inputMode="decimal"
              enterKeyHint="done"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="0"
              className="t-stat w-20 text-right bg-transparent outline-none placeholder:text-ink-2"
            />
            <span className="t-label text-ink-2">{unit === "lbs" ? "mi" : "km"}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex min-h-[44px] flex-1 items-center justify-center py-3 t-body font-medium text-ink-2"
        >
          Back
        </button>
        <button
          onClick={doSave}
          className="flex min-h-[44px] flex-[2] items-center justify-center bg-ink py-3 t-body font-semibold text-paper"
        >
          Save
        </button>
      </div>
    </div>
  );
}
