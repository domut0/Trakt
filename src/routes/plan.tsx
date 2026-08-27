import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { PlanEditorSheet } from "../components/PlanEditorSheet";
import {
  isEmptyPlan,
  plannedAtMinutesOf,
  plannedDurationMinutesOf,
  type PlannedWeek,
  type PlannedWorkout,
} from "../lib/plan";
import { WEEKDAY_LABELS, weekdayIndexFor } from "../lib/targets";
import { formatMinutesOfDay } from "../lib/timeline";
import { useStore } from "../lib/store";

export const Route = createFileRoute("/plan")({
  head: () => ({
    meta: [
      { title: "Plan" },
      { name: "description", content: "Your main lifts for each weekday." },
      { property: "og:title", content: "Plan" },
      { property: "og:description", content: "Your main lifts for each weekday." },
    ],
  }),
  component: PlanPage,
});

/**
 * Full weekday names, Monday-first, aligned index-for-index with
 * WEEKDAY_LABELS and `weekdayIndexFor`.
 *
 * Only the editor uses these. The week list stays on the short labels so its
 * seven leading captions line up in one narrow column, which is what makes the
 * list scannable as a week rather than as seven unrelated rows.
 */
const WEEKDAY_FULL = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/**
 * The stored entry for one weekday, read as tolerantly as plan.ts reads it.
 *
 * Not `plannedWorkoutFor`, which resolves a DATE: this screen is the template
 * itself, and manufacturing seven dates to index a template would put a
 * calendar inside the one surface that is deliberately not one.
 *
 * Not `prunePlannedWorkout` either. That collapses a day whose lifts have all
 * been deleted from the library into "no plan", which is the right answer for a
 * resolver about to preload a workout and the wrong one here: the day still has
 * a name, and this is the only screen where the user can repair it. Individual
 * dead ids still disappear, because `nameFor` below drops what it cannot
 * resolve.
 *
 * `entry` is typed `unknown` rather than trusted, because the store loads this
 * value straight out of IndexedDB where a hand-edited backup can have left
 * anything at all, and a thrown TypeError here is a blank screen.
 */
function plannedDayAt(week: PlannedWeek | undefined, index: number): PlannedWorkout | undefined {
  const entry: unknown = Array.isArray(week) ? week[index] : undefined;
  if (entry === null || typeof entry !== "object") return undefined;
  const { name, exerciseIds, atMinutes, durationMinutes } = entry as Partial<PlannedWorkout>;
  const workout: PlannedWorkout = {
    name: typeof name === "string" ? name : "",
    exerciseIds: Array.isArray(exerciseIds)
      ? exerciseIds.filter((id): id is string => typeof id === "string")
      : [],
  };
  // Through plan.ts, not re-derived here. This reader is deliberately more
  // forgiving than `plannedWorkoutFor` about name and exercises, because the
  // editor has to show a half-filled day. What it must not have is its own
  // opinion about which times are valid: two copies of those bounds is one
  // careless edit away from a plan that draws on the day view and not here.
  const at = plannedAtMinutesOf(atMinutes);
  if (at !== undefined) workout.atMinutes = at;
  const duration = plannedDurationMinutesOf(durationMinutes);
  if (duration !== undefined) workout.durationMinutes = duration;
  return workout;
}

function PlanPage() {
  const plannedWeek = useStore((s) => s.plannedWeek);
  const exercises = useStore((s) => s.exercises);
  const hydrated = useStore((s) => s.hydrated);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const nameById = useMemo(() => new Map(exercises.map((e) => [e.id, e.name])), [exercises]);

  /**
   * Which row is today, or -1 before the client has hydrated.
   *
   * Gated on `hydrated` rather than computed straight from the clock: the
   * server renders in its own timezone and would pick a different row often
   * enough to matter, and a highlight that disagrees between the two passes is
   * a hydration mismatch. `hydrated` is false on the server and on the first
   * client render alike, so the two always agree and the marker appears with
   * the plan it belongs to.
   */
  const todayIndex = hydrated ? weekdayIndexFor(new Date()) : -1;

  const days = WEEKDAY_LABELS.map((label, index) => {
    const planned = plannedDayAt(plannedWeek, index);
    const lifts =
      planned?.exerciseIds
        .map((id) => nameById.get(id))
        .filter((name): name is string => name !== undefined) ?? [];
    return { label, index, planned, lifts };
  });

  const trainingDays = days.filter((d) => d.planned !== undefined).length;
  const nothingPlanned = isEmptyPlan(plannedWeek);
  const editing = editingIndex === null ? null : days[editingIndex];

  return (
    <AppShell>
      <header className="px-5 pb-4 pt-14">
        <h1 className="t-title">Plan</h1>
        {nothingPlanned && (
          <p className="mt-2 t-label text-ink-2">
            The week is empty. Any day you tap becomes a training day.
          </p>
        )}
      </header>

      <section className="anim-fade-up">
        <div className="group-header flex items-baseline justify-between gap-3">
          <h2 className="t-caption">Your week</h2>
          {trainingDays > 0 && (
            <span className="t-caption">
              {trainingDays} training {trainingDays === 1 ? "day" : "days"}
            </span>
          )}
        </div>

        <div className="group-list mx-5">
          {days.map(({ label, index, planned, lifts }) => {
            const isToday = index === todayIndex;
            const title = planned ? planned.name.trim() || "Untitled" : "Rest day";
            // The time leads the detail line when there is one. A start time you
            // can set in the editor but cannot see anywhere in the week is a
            // setting that appears not to have saved.
            const detail = planned
              ? [
                  planned.atMinutes !== undefined
                    ? formatMinutesOfDay(planned.atMinutes)
                    : undefined,
                  lifts.join(" · ") || "No lifts yet",
                ]
                  .filter((part): part is string => part !== undefined)
                  .join(" · ")
              : "";
            return (
              <button
                key={label}
                type="button"
                onClick={() => setEditingIndex(index)}
                // Today's row carries the one lift on this screen, one step up
                // the palette from the group it sits in (background -> surface
                // -> muted). A week of seven identical rows answers "what does
                // my week look like" and never "which of these is now", and now
                // is what the user is standing in.
                className={
                  "group-row w-full text-left " +
                  (index > 0 ? "group-row-sep " : "") +
                  (isToday ? "bg-wash" : "")
                }
                aria-label={`${WEEKDAY_FULL[index]}, ${
                  planned ? `${title}${lifts.length ? `: ${lifts.join(", ")}` : ""}` : "rest day"
                }${isToday ? ", today" : ""}. Edit.`}
              >
                {/* The strip cell from TargetsEditor, stood on its end: same
                    Monday-first labels, same caption type, same muted colour.
                    Vertical because a row has to hold three or four lift names
                    and a seven-across grid cannot. */}
                <span aria-hidden="true" className="w-12 shrink-0 t-caption text-ink-2">
                  {label}
                </span>
                <span className="min-w-0 flex-1" aria-hidden="true">
                  <span className={"block truncate t-body " + (planned ? "" : "text-ink-2")}>
                    {title}
                  </span>
                  {detail && (
                    <span className="mt-0.5 block truncate t-label text-ink-2">{detail}</span>
                  )}
                </span>
                {isToday && (
                  <span aria-hidden="true" className="shrink-0 t-caption text-ink-2">
                    Today
                  </span>
                )}
                <span className="shrink-0 t-action" aria-hidden="true">
                  →
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {editing && (
        <PlanEditorSheet
          open
          weekdayIndex={editing.index}
          dayName={WEEKDAY_FULL[editing.index]}
          workout={editing.planned}
          onClose={() => setEditingIndex(null)}
        />
      )}
    </AppShell>
  );
}
