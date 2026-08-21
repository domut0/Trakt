import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { type PlannedWorkout } from "../lib/plan";
import { useStore } from "../lib/store";

function ArrowUpIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19V5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

/** Take a lift back off the day. Deliberately NOT the trash glyph the habit
 * editor uses for deleting a habit and its history: nothing is destroyed here,
 * the lift stays in the library and the plan is a template the user rewrites
 * every time they think of something better. */
function RemoveIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

/**
 * Editor for one weekday of the training plan.
 *
 * Scoped to MAIN LIFTS, which is what shapes every decision in here. A planned
 * day is one to four entries, so the chosen list is a plain reorderable stack
 * with no search of its own, and the picker below it opens on the main lifts
 * rather than on the whole library: a user looking for Back Squat should not
 * have to walk past ninety accessories to find it. Anything else is still one
 * search away, because the plan constrains nothing about what gets logged.
 *
 * Every edit writes through to the store immediately, the same way the targets
 * editor does. There is no draft to lose, no save button to miss, and the week
 * behind the sheet stays honest while it is open.
 */
export function PlanEditorSheet({
  open,
  weekdayIndex,
  dayName,
  workout,
  onClose,
}: {
  open: boolean;
  /** 0 = Monday, 6 = Sunday, matching the store's Monday-first week. */
  weekdayIndex: number;
  /** The weekday's full name, for the sheet's title. */
  dayName: string;
  /** What is stored for this day right now, or undefined on a rest day. */
  workout: PlannedWorkout | undefined;
  onClose: () => void;
}) {
  const exercises = useStore((s) => s.exercises);
  const setPlannedDay = useStore((s) => s.setPlannedDay);

  const [query, setQuery] = useState("");

  /**
   * Whether to open with the name field focused, decided once when the sheet
   * mounts.
   *
   * A day with nothing on it yet needs naming before anything else, so the
   * keyboard is welcome. A day that already has lifts almost never does, and
   * putting the keyboard over the list the user came here to reorder is help
   * nobody asked for.
   *
   * Lazy initial state rather than the live prop: `workout` stops being
   * undefined the moment the first character is typed, and this has to mean
   * "how the day arrived", not "how it is right now".
   */
  const [focusNameOnOpen] = useState(() => workout === undefined);

  // Reopening on another day starts with a clear search rather than the last
  // one's leftovers. Free when the caller unmounts the sheet between opens,
  // and correct when it does not.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  useSheetDismiss(open, onClose);

  if (!open || typeof document === "undefined") return null;

  const current: PlannedWorkout = workout ?? { name: "", exerciseIds: [] };

  /**
   * The one write path, so the rest-day rule lives in exactly one place: a day
   * with no name AND no lifts is a rest day, whichever edit emptied it. Deleting
   * the last lift out of an unnamed day and clearing the name of a lift-less one
   * are the same gesture as far as the week is concerned.
   */
  const commit = (next: PlannedWorkout) => {
    const isRest = next.name.trim() === "" && next.exerciseIds.length === 0;
    setPlannedDay(weekdayIndex, isRest ? null : next);
  };

  const chosen = current.exerciseIds
    .map((id) => exercises.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => e !== undefined);

  const addLift = (id: string) => {
    if (current.exerciseIds.includes(id)) return;
    commit({ ...current, exerciseIds: [...current.exerciseIds, id] });
    setQuery("");
  };

  const removeLift = (index: number) => {
    commit({ ...current, exerciseIds: current.exerciseIds.filter((_, i) => i !== index) });
  };

  const moveLift = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= current.exerciseIds.length) return;
    const next = [...current.exerciseIds];
    [next[index], next[target]] = [next[target], next[index]];
    commit({ ...current, exerciseIds: next });
  };

  // Cardio is in the same table and has its own after-the-fact log card. It is
  // never a main lift, so it never appears here.
  const pool = exercises.filter((e) => e.type !== "cardio" && !current.exerciseIds.includes(e.id));
  const q = query.trim().toLowerCase();
  const candidates = q
    ? pool.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 12)
    : pool.filter((e) => e.type === "main").slice(0, 8);

  // `data-swipe-ignore`: this sheet is portaled out of a component that renders
  // inside AppShell's <main>, and React portals bubble along the React tree, so
  // without it a horizontal drag while editing would navigate to the next tab.
  return createPortal(
    <div
      data-swipe-ignore
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-6 anim-backdrop"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-3xl bg-surface p-5 anim-popup"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-border" />

        <div className="flex shrink-0 items-center justify-between pb-4">
          <h2 className="t-heading">{dayName}</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex min-h-[44px] items-center px-2 t-label font-medium text-muted-foreground"
          >
            Done
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-0.5">
          <label htmlFor="plan-day-name" className="sr-only">
            Day name
          </label>
          <input
            autoFocus={focusNameOnOpen}
            id="plan-day-name"
            type="text"
            value={current.name}
            onChange={(e) => commit({ ...current, name: e.target.value })}
            placeholder="Name this day"
            className="min-h-[44px] w-full rounded-xl bg-muted px-3.5 t-body outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-accent"
          />

          {chosen.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 t-caption text-muted-foreground">Lifts</h3>
              <div className="group-list bg-muted">
                {chosen.map((exercise, idx) => (
                  <div
                    key={exercise.id}
                    className={"group-row gap-2 " + (idx > 0 ? "group-row-sep" : "")}
                  >
                    <span className="min-w-0 flex-1 truncate t-body">{exercise.name}</span>
                    {/* gap-0.5 and a 16px glyph inside a 44px box: three
                        controls plus a lift name have to fit next to each other
                        without the name collapsing, and the hit area is the
                        thing that must not shrink. */}
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveLift(idx, -1)}
                        disabled={idx === 0}
                        aria-label={`Move ${exercise.name} up`}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground disabled:opacity-30"
                      >
                        <ArrowUpIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveLift(idx, 1)}
                        disabled={idx === chosen.length - 1}
                        aria-label={`Move ${exercise.name} down`}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground disabled:opacity-30"
                      >
                        <ArrowDownIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeLift(idx)}
                        aria-label={`Remove ${exercise.name}`}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground"
                      >
                        <RemoveIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5">
            <h3 className="mb-2 t-caption text-muted-foreground">Add a lift</h3>
            <label htmlFor="plan-lift-search" className="sr-only">
              Search lifts
            </label>
            <input
              id="plan-lift-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search lifts"
              className="min-h-[44px] w-full rounded-xl bg-muted px-3.5 t-body outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-accent"
            />
            {candidates.length > 0 ? (
              <div className="mt-2 max-h-56 overflow-y-auto group-list bg-muted/40">
                {candidates.map((exercise, idx) => (
                  <button
                    key={exercise.id}
                    type="button"
                    onClick={() => addLift(exercise.id)}
                    className={"group-row w-full text-left " + (idx > 0 ? "group-row-sep" : "")}
                  >
                    <span className="min-w-0 truncate t-body font-medium">{exercise.name}</span>
                    <span className="shrink-0 t-caption text-muted-foreground">
                      {exercise.type === "main" ? "Main" : "Accessory"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 t-label text-muted-foreground">
                {q
                  ? `Nothing in the library matches "${query.trim()}".`
                  : "Every lift is on the day already."}
              </p>
            )}
          </div>

          {workout !== undefined && (
            <button
              type="button"
              onClick={() => setPlannedDay(weekdayIndex, null)}
              className="mt-5 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-muted t-body font-medium text-muted-foreground"
            >
              Make this a rest day
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
