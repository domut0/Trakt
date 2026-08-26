import { dayKey } from "./daily-log";
import { entriesByDate, type FoodEntry, type Meal } from "./food";
import { DEFAULT_PLANNED_DURATION_MINUTES, type PlannedWorkout } from "./plan";
import {
  isCardioSession,
  type Exercise,
  type SplitSlot,
  type WorkoutSession,
  type WorkoutSet,
} from "./store";

/**
 * Pure geometry and band-building for the day view timeline. No store, no
 * IndexedDB, no DOM, no clock: `now` is always passed in.
 *
 * The card this feeds shows INTENT against ACTUAL on one vertical axis. Intent
 * is a meal window you defined or a planned workout with a time; actual is food
 * you logged into that window or a session you actually ran. The visual rule is
 * one line long and lives in the component, not here: a `planned` band draws as
 * a dashed outline, an `actual` band draws as a solid fill.
 *
 * Two boundaries are deliberate:
 *
 * - **`FoodEntry.loggedAt` is never read.** It records the moment you tapped
 *   log, not the moment you ate, and two code paths stamp it as a batch:
 *   `copyMealFrom` and the MyFitnessPal importer both write `loggedAt: now + idx`.
 *   Reading it would pile an entire imported diary onto the minute the import
 *   ran. Food is positioned by the window of the meal it belongs to, and by
 *   nothing else. See `docs/home-screen-plan.md` decision 3.
 *
 * - **Habits never appear.** `HabitEntry` carries no time at all, and giving it
 *   one would record the tap rather than the act, which is the same defect that
 *   ruled out `loggedAt` above. Decision 7.
 */

/** Minutes in a day. The timeline is always exactly this tall in model space,
 * whatever it is in pixels. */
export const TIMELINE_MINUTES = 24 * 60;

/**
 * How short a band is allowed to render, in minutes of equivalent height.
 *
 * A 4 minute cardio bout is a sub-pixel sliver at any readable scale, and a band
 * you cannot see is a band you cannot tap. Clamping the HEIGHT rather than the
 * model keeps `toMinutes` honest for anything that reads the band as data.
 */
export const MIN_BAND_MINUTES = 20;

export type BandKind = "meal" | "strength" | "cardio";

/** `planned` draws dashed, `actual` draws filled. The only encoding on the card. */
export type BandState = "planned" | "actual";

/**
 * Which of the two layers a band belongs to.
 *
 * Meal windows are four hours wide by default and a workout routinely happens
 * inside one, so overlap is the normal state rather than an edge case. Rather
 * than packing collisions into columns (which would leave breakfast at half
 * width most mornings) the card draws two layers: `zone` spans the full width
 * behind everything, `block` is inset from the left and sits on top. Nothing
 * ever collides, and there is no packing algorithm to get wrong.
 */
export type BandLayer = "zone" | "block";

export interface TimelineBand {
  id: string;
  kind: BandKind;
  state: BandState;
  layer: BandLayer;
  /** Minutes past local midnight. Always within [0, TIMELINE_MINUTES]. */
  fromMinutes: number;
  toMinutes: number;
  label: string;
  /** Secondary line inside the band: "3 items", "12 sets", "28 min". */
  detail?: string;
  /**
   * A session that started but has not ended. It draws with no bottom edge,
   * because its end is not yet a fact.
   */
  openEnded?: boolean;
  /**
   * A window that covers the entire day, so it is not really a window at all.
   *
   * Snacks ships as all-day by default, which means every user has one of
   * these. Drawn on the canvas it becomes a full height dashed rectangle behind
   * everything else, reading as a frame around the day rather than as a band in
   * it, and its label lands at noon on top of whatever is actually there.
   *
   * The caller renders these in a strip ABOVE the scrolling canvas, which is
   * what Apple Calendar does with all-day events and for the same reason.
   */
  allDay?: boolean;
  /** Set on meal zones. Opens the meal sheet. */
  mealId?: string;
  /** Set on logged training blocks. Navigates to the workout. */
  sessionId?: string;
}

export interface BuildTimelineInput {
  /** The day being shown, as a local "yyyy-MM-dd" key. */
  date: string;
  /** Injected rather than read, so this stays pure and testable. */
  now: Date;
  meals: readonly Meal[];
  /** All entries. Filtered to `date` here so callers cannot filter differently. */
  foodEntries: readonly FoodEntry[];
  sessions: readonly WorkoutSession[];
  sets: readonly WorkoutSet[];
  exercises: readonly Exercise[];
  slots: readonly SplitSlot[];
  /** The plan for this weekday, already pruned by the caller. */
  planned?: PlannedWorkout;
  unit: "lbs" | "kg";
}

/** Minutes past local midnight for a `Date`. */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * "17:05" from 1025. The inverse of `minutesOfDay`, for anything that DISPLAYS
 * a time the user set.
 *
 * Not the same job as `PlanEditorSheet`'s own serialiser, which produces a
 * value for an `<input type="time">` and is therefore contractually 24 hour
 * zero padded whatever this ever becomes. Keep them separate: the day this
 * turns into a locale-aware "5:05 PM", the input would silently stop
 * round-tripping.
 */
export function formatMinutesOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Clamped into the day, so a band can never escape the canvas it is drawn on. */
function clampToDay(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.min(Math.max(minutes, 0), TIMELINE_MINUTES);
}

/**
 * Where a band's top edge sits, in pixels.
 *
 * Exported because the now line and the hour rules need the same arithmetic, and
 * two implementations of it drifting apart is exactly how a timeline ends up
 * with events that do not line up with their own labels.
 */
export function offsetPx(minutes: number, pxPerHour: number): number {
  return (clampToDay(minutes) / 60) * pxPerHour;
}

/**
 * How tall a band renders, with the short-band floor applied.
 *
 * The floor is applied in PIXELS at the end rather than by widening
 * `toMinutes`, so a 4 minute bout still reports its real end time to anything
 * that reads the band, and only its drawn height is a lie.
 */
export function heightPx(band: TimelineBand, pxPerHour: number): number {
  const spanned = clampToDay(band.toMinutes) - clampToDay(band.fromMinutes);
  return (Math.max(spanned, MIN_BAND_MINUTES) / 60) * pxPerHour;
}

/** Total canvas height for a given scale. */
export function canvasHeightPx(pxPerHour: number): number {
  return (TIMELINE_MINUTES / 60) * pxPerHour;
}

/**
 * A session belongs to the day it STARTED, matching Today, CalendarView and
 * WeeklyView. All four surfaces have to agree or one workout appears on two
 * dates, which is why this is a named predicate rather than an inline compare.
 */
function sessionStartedOn(session: WorkoutSession, date: string): boolean {
  return dayKey(new Date(session.startedAt)) === date;
}

/** "12 sets" / "28 min · 5 km", matching the copy the workouts list used. */
function trainingDetail(
  session: WorkoutSession,
  sets: readonly WorkoutSet[],
  unit: "lbs" | "kg",
): string | undefined {
  if (isCardioSession(session)) {
    const parts: string[] = [];
    if (session.durationMinutes !== undefined) parts.push(`${session.durationMinutes} min`);
    if (session.distance !== undefined) {
      parts.push(`${session.distance} ${unit === "lbs" ? "mi" : "km"}`);
    }
    return parts.length > 0 ? parts.join(" · ") : undefined;
  }
  const count = sets.filter((s) => s.sessionId === session.id).length;
  return count > 0 ? `${count} ${count === 1 ? "set" : "sets"}` : undefined;
}

function trainingLabel(
  session: WorkoutSession,
  exercises: readonly Exercise[],
  slots: readonly SplitSlot[],
): string {
  if (isCardioSession(session)) {
    return exercises.find((e) => e.id === session.cardioExerciseId)?.name ?? "Cardio";
  }
  return slots.find((sl) => sl.id === session.splitSlotId)?.name ?? "Workout";
}

/**
 * Meal zones: one per meal, whether or not anything was eaten in it.
 *
 * A window with no entries is the INTENT and draws dashed. A window with entries
 * is the actual and draws filled. That is the entire meal half of the feature.
 *
 * A window whose `toMinutes` is not after its `fromMinutes` wraps past midnight
 * (the meals editor allows this, and Snacks is all-day by default). A wrapping
 * window is clamped to the end of the day rather than split into two bands: two
 * bands for one meal would be tappable twice and would double its entry count.
 */
function mealZones(meals: readonly Meal[], entriesForDay: readonly FoodEntry[]): TimelineBand[] {
  return [...meals]
    .sort((a, b) => a.rank - b.rank)
    .map((meal) => {
      const count = entriesForDay.filter((e) => e.mealId === meal.id).length;
      const from = clampToDay(meal.fromMinutes);
      const to = meal.toMinutes > meal.fromMinutes ? clampToDay(meal.toMinutes) : TIMELINE_MINUTES;
      return {
        id: `meal_${meal.id}`,
        kind: "meal" as const,
        state: (count > 0 ? "actual" : "planned") as BandState,
        layer: "zone" as const,
        fromMinutes: from,
        toMinutes: to,
        // Covering the whole day is not a window. See the note on `allDay`.
        allDay: from === 0 && to === TIMELINE_MINUTES ? true : undefined,
        label: meal.name,
        detail: count > 0 ? `${count} ${count === 1 ? "item" : "items"}` : undefined,
        mealId: meal.id,
      };
    });
}

/**
 * Training blocks, actual and planned.
 *
 * The planned band is suppressed when a real session exists for the day. Showing
 * both would draw a dashed ghost beside the thing that fulfilled it, which reads
 * as two workouts rather than as one intention that was met. The fulfilled case
 * is already legible: the band is filled.
 */
function trainingBlocks(input: BuildTimelineInput): TimelineBand[] {
  const { date, now, sessions, sets, exercises, slots, planned, unit } = input;
  const nowMinutes = minutesOfDay(now);
  const isToday = date === dayKey(now);

  const logged = sessions
    .filter((s) => sessionStartedOn(s, date))
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((session): TimelineBand => {
      const from = minutesOfDay(new Date(session.startedAt));
      // An unfinished session runs to NOW on today, and to its own start on any
      // other day: a session left open days ago should not paint the rest of
      // that day, and it is not still running.
      const openEnded = session.endedAt === undefined;
      const to =
        session.endedAt !== undefined
          ? minutesOfDay(new Date(session.endedAt))
          : isToday
            ? nowMinutes
            : from;
      return {
        id: `session_${session.id}`,
        kind: isCardioSession(session) ? "cardio" : "strength",
        state: "actual",
        layer: "block",
        fromMinutes: from,
        // A session that ran past midnight reports an end EARLIER than its
        // start once both are reduced to minutes-of-day. It belongs to the day
        // it started, so it runs to the end of that day rather than backwards.
        toMinutes: to >= from ? to : TIMELINE_MINUTES,
        label: trainingLabel(session, exercises, slots),
        detail: trainingDetail(session, sets, unit),
        openEnded: openEnded || undefined,
        sessionId: session.id,
      };
    });

  if (logged.length > 0) return logged;

  if (planned?.atMinutes === undefined) return [];
  const from = clampToDay(planned.atMinutes);
  const duration = planned.durationMinutes ?? DEFAULT_PLANNED_DURATION_MINUTES;
  return [
    {
      id: "planned",
      kind: "strength",
      state: "planned",
      layer: "block",
      fromMinutes: from,
      toMinutes: clampToDay(from + duration),
      label: planned.name,
      detail:
        planned.exerciseIds.length > 0
          ? `${planned.exerciseIds.length} ${planned.exerciseIds.length === 1 ? "lift" : "lifts"}`
          : undefined,
    },
  ];
}

/**
 * Every band for one day, zones first so the component can render them in order
 * and still get the layering right without sorting.
 */
export function buildTimelineBands(input: BuildTimelineInput): TimelineBand[] {
  const entriesForDay = entriesByDate(input.foodEntries).get(input.date) ?? [];
  return [...mealZones(input.meals, entriesForDay), ...trainingBlocks(input)];
}

/**
 * Where to scroll the canvas so the interesting part of the day is on screen.
 *
 * On today that is the now line, placed about a third of the way down so there
 * is context above it and room below for what is still coming. On any other day
 * it is the first band, since there is no now to centre on.
 *
 * Returns a scrollTop in pixels, never negative.
 */
export function initialScrollPx(
  bands: readonly TimelineBand[],
  date: string,
  now: Date,
  pxPerHour: number,
  viewportPx: number,
): number {
  const isToday = date === dayKey(now);
  const anchorMinutes = isToday
    ? minutesOfDay(now)
    : (bands.reduce<number | undefined>(
        (min, b) => (min === undefined ? b.fromMinutes : Math.min(min, b.fromMinutes)),
        undefined,
      ) ?? 0);
  const target = offsetPx(anchorMinutes, pxPerHour) - viewportPx / 3;
  const maxScroll = Math.max(canvasHeightPx(pxPerHour) - viewportPx, 0);
  return Math.min(Math.max(target, 0), maxScroll);
}
