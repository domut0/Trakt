import { useMemo, useState } from "react";
import { NumField } from "./LogSetSheet";
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
        <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-border" />
        <input
          autoFocus
          value={exerciseQuery}
          onChange={(e) => setExerciseQuery(e.target.value)}
          placeholder="Search or add activity"
          // A placeholder is not an accessible name: it disappears the moment
          // anything is typed, so the field needs its own label.
          aria-label="Search or add a cardio activity"
          className="mt-3 min-h-[44px] w-full bg-transparent text-[20px] font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
        />
        <ul className="mt-3 max-h-72 divide-y divide-border overflow-y-auto">
          {filteredRows.map((r) =>
            r.kind === "existing" ? (
              <li key={r.exercise.id}>
                <button
                  onClick={() => selectExercise(r.exercise.id)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 py-3 text-left"
                >
                  <span className="truncate text-[16px]">{r.exercise.name}</span>
                </button>
              </li>
            ) : (
              <li key={r.name}>
                <button
                  onClick={() => addCustom(r.name)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 py-3 text-left"
                >
                  <span className="truncate text-[16px] text-muted-foreground">{r.name}</span>
                  <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-accent">
                    Suggested
                  </span>
                </button>
              </li>
            ),
          )}
          {showAddRow && (
            <li>
              <button
                onClick={() => addCustom(trimmedQuery)}
                className="flex min-h-[44px] w-full items-center justify-between gap-3 py-3 text-left text-accent"
              >
                <span className="truncate text-[16px]">Add "{trimmedQuery}"</span>
                <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider">
                  New
                </span>
              </button>
            </li>
          )}
        </ul>
        <button
          onClick={onBack}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-full py-3 text-[15px] font-medium text-muted-foreground"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-border" />
      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          onClick={() => setPickingExercise(true)}
          aria-label={`Change activity, currently ${chosen?.name ?? "not set"}`}
          className="min-h-[44px] min-w-0 text-left"
        >
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Activity
          </div>
          <div className="mt-0.5 truncate text-[20px] font-semibold tracking-tight">
            {chosen?.name}
          </div>
        </button>
        <button
          onClick={() => setPickingExercise(true)}
          className="flex min-h-[44px] shrink-0 items-center text-[13px] font-medium text-accent"
        >
          Change
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
        <label
          htmlFor="cardio-setup-note"
          className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
        >
          Setup
        </label>
        <input
          id="cardio-setup-note"
          value={setupNote}
          onChange={(e) => setSetupNote(e.target.value)}
          placeholder={suggestedNote ?? "Add notes: incline, resistance"}
          className="min-h-[44px] w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <NumField label="Duration" suffix="min" value={duration} onChange={setDuration} />
        <NumField
          label="Distance"
          suffix={unit === "lbs" ? "mi" : "km"}
          value={distance}
          onChange={setDistance}
        />
      </div>

      <div className="mt-6 flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-full py-3 text-[15px] font-medium text-muted-foreground"
        >
          Back
        </button>
        <button
          onClick={doSave}
          className="flex min-h-[44px] flex-[2] items-center justify-center rounded-full bg-accent py-3 text-[15px] font-semibold text-accent-foreground"
        >
          Save
        </button>
      </div>
    </div>
  );
}
