import { WEEKDAY_LABELS, weekdayIndexFor } from "./targets";

/**
 * Pure resolution of the weekly training plan. No store, no IndexedDB, no DOM,
 * no clock.
 *
 * The design problem this solves: deciding what to train is a decision the user
 * makes best when they are not standing in the gym. So the MAIN lifts (squat,
 * bench, deadlift) get planned ahead on a weekly template, and starting a
 * workout on a planned day preloads exactly those.
 *
 * Two boundaries are deliberate and load-bearing:
 *
 * - The plan is a WEEKLY TEMPLATE, not a calendar. A per-date plan would be a
 *   scheduling chore that decays the first week it is not maintained, and a
 *   stale plan is worse than none. A weekday template keeps working forever
 *   without being touched, which is the same reasoning that shaped the
 *   per-weekday nutrition targets in targets.ts.
 *
 * - ACCESSORIES ARE NEVER CONSTRAINED BY THE PLAN. Nothing here filters, orders
 *   or gates what else can be logged. The plan preloads main lifts and then gets
 *   out of the way, so a planned day never turns into a checklist the user has
 *   to fight to log an extra set of curls.
 *
 * Storage lives on the settings meta row next to `targetProfiles` /
 * `weekdayTargets` (see db.ts), so this is read from a value that round-trips
 * through user-editable backup JSON. Every function here is therefore tolerant
 * of shapes the type annotations promise cannot happen: a bad import must
 * degrade to "no plan" rather than throw on a screen the user is standing in
 * front of.
 */

/**
 * One planned training day.
 *
 * `name` is the user's own label for the day ("Heavy Bench"), matching how Split
 * Slots are already named, and is not required to correspond to any slot: the
 * plan says what to train, the slot rotation says what comes next, and forcing
 * them to agree would make one of them unusable.
 */
export interface PlannedWorkout {
  name: string;
  exerciseIds: string[];
  /**
   * Minutes past LOCAL midnight, or absent.
   *
   * Absent is the normal case and means unscheduled: the plan still says what to
   * train, it just does not claim to know when. The day view draws nothing for
   * an unscheduled plan rather than guessing a time, because a guess rendered as
   * a dashed band is indistinguishable from an intention the user actually set.
   *
   * This is the ONLY thing that makes a planned workout drawable, so it is also
   * the only reason `plannedWorkoutOf` below had to learn two new fields.
   */
  atMinutes?: number;
  /** How long the planned session is expected to run. Absent falls back to
   * `DEFAULT_PLANNED_DURATION_MINUTES`, so a time with no duration is still a
   * band rather than a zero-height line. */
  durationMinutes?: number;
}

/** Used when a planned workout has an `atMinutes` but no `durationMinutes`. An
 * hour is a plausible session and, more importantly, is long enough to be a
 * legible band at any sane pixels-per-hour. */
export const DEFAULT_PLANNED_DURATION_MINUTES = 60;

/** Minutes in a day. Any `atMinutes` outside [0, 1440) is treated as absent. */
const MINUTES_PER_DAY = 24 * 60;

/**
 * Both optional time fields, validated the same way and in one place.
 *
 * A field that is present but not a finite number, or out of range, resolves to
 * undefined rather than rejecting the whole planned workout. Losing the time off
 * a hand-edited backup should cost you the band, not the day's exercises.
 */
function plannedMinutesOf(value: unknown, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0 || value >= max) return undefined;
  return value;
}

/**
 * The two time validators, exported because `plannedWorkoutOf` is not the only
 * place a stored plan entry gets normalised.
 *
 * `plan.tsx` has its own reader, deliberately: the editor wants to show a
 * half-filled day (a name with no exercises) where this module wants to answer
 * "is there a plan or not", so one cannot be expressed in terms of the other.
 * What they must NOT disagree about is what counts as a valid time, which is
 * why that part lives here and both call it. Two copies of these bounds is one
 * refactor away from a plan that draws on one screen and not the other.
 */
export function plannedAtMinutesOf(value: unknown): number | undefined {
  return plannedMinutesOf(value, MINUTES_PER_DAY);
}

/** A duration may run to a full day. Zero and negatives are meaningless. */
export function plannedDurationMinutesOf(value: unknown): number | undefined {
  const v = plannedMinutesOf(value, MINUTES_PER_DAY + 1);
  return v !== undefined && v > 0 ? v : undefined;
}

/** Length 7, Monday-first. null = rest day. */
export type PlannedWeek = (PlannedWorkout | null)[];

/** How many days a well-formed `PlannedWeek` has, tied to the Monday-first
 * rotation rather than to a loose literal 7. */
const WEEK_LENGTH = WEEKDAY_LABELS.length;

/**
 * A week with every day a rest day.
 *
 * A factory rather than a const for the same reason `defaultTargets` is one: the
 * result goes into store state, and a shared literal is one careless mutation
 * away from changing every caller's copy.
 */
export function emptyPlannedWeek(): PlannedWeek {
  return Array.from({ length: WEEK_LENGTH }, () => null);
}

/**
 * The one place a stored week entry is checked before anyone trusts it.
 *
 * Returns a NORMALIZED COPY rather than the stored object, which does two jobs:
 * it drops any extra keys a hand-edited backup carried in, and it means a caller
 * cannot reach through the result and mutate store state.
 *
 * `null` (a rest day) and any malformed entry both resolve to undefined here.
 * The caller cannot tell those two apart, and deliberately so: "nothing is
 * planned today" is the only answer either one can be turned into.
 *
 * BECAUSE THIS RETURNS A NORMALIZED COPY, every field of `PlannedWorkout` has to
 * be named here or it is silently dropped. That is the intended behaviour for
 * junk keys in a hand-edited backup, and it is a trap for real ones: a new field
 * that is not copied here saves fine, reads back as undefined, and produces no
 * error anywhere. `atMinutes` and `durationMinutes` were added for the day
 * view's planned bands and are copied for exactly that reason.
 */
function plannedWorkoutOf(entry: unknown): PlannedWorkout | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const { name, exerciseIds, atMinutes, durationMinutes } = entry as Partial<PlannedWorkout>;
  if (typeof name !== "string") return undefined;
  if (!Array.isArray(exerciseIds) || !exerciseIds.every((id) => typeof id === "string")) {
    return undefined;
  }
  const planned: PlannedWorkout = { name, exerciseIds: [...exerciseIds] };
  // Assigned conditionally rather than always, so a plan with no time round
  // trips through backup JSON without gaining two `undefined` keys.
  const at = plannedAtMinutesOf(atMinutes);
  if (at !== undefined) planned.atMinutes = at;
  const duration = plannedDurationMinutesOf(durationMinutes);
  if (duration !== undefined) planned.durationMinutes = duration;
  return planned;
}

/**
 * The workout planned for `day`, or undefined on a rest day, an unplanned week,
 * or a malformed one.
 *
 * The weekday index comes from `weekdayIndexFor` and never from a raw
 * `getDay()`: date-fns is Sunday-first, this array is Monday-first, and indexing
 * with the wrong one is correct on Monday and wrong the other six days, which is
 * the worst possible way for a bug like this to present. That rotation exists in
 * exactly one place (targets.ts) so it can only be got wrong once.
 *
 * A week that is not exactly 7 long is treated as no plan at all rather than
 * indexed into, matching `targetProfileFor`: a truncated array read at a
 * Monday-first index would otherwise hand back a real, confidently wrong day.
 */
export function plannedWorkoutFor(
  day: string | Date,
  week: PlannedWeek | undefined,
): PlannedWorkout | undefined {
  if (!Array.isArray(week) || week.length !== WEEK_LENGTH) return undefined;
  // An unparseable day key makes weekdayIndexFor NaN, and week[NaN] is
  // undefined, so a bad date falls out as "no plan" without a throw.
  return plannedWorkoutOf(week[weekdayIndexFor(day)]);
}

/**
 * True when the week plans no lifts at all, which is the signal the UI uses to
 * stay out of the way entirely instead of rendering seven empty rest days.
 *
 * A day with a name but no exercises counts as empty HERE while still resolving
 * through `plannedWorkoutFor`. That asymmetry is the point: a half-filled day is
 * something to keep showing while the user is editing it, but it is not a reason
 * to put the planning surface in front of someone who has never used it.
 */
export function isEmptyPlan(week: PlannedWeek | undefined): boolean {
  if (!Array.isArray(week) || week.length !== WEEK_LENGTH) return true;
  return !week.some((entry) => {
    const planned = plannedWorkoutOf(entry);
    return planned !== undefined && planned.exerciseIds.length > 0;
  });
}

/**
 * Drops planned exercise ids that no longer name a real exercise, and reports
 * "no plan" when nothing survives.
 *
 * Exercises can be deleted (and ids can be typed by hand into a backup) long
 * after a plan referenced them, so a stored id is a claim, not a guarantee.
 * Dropping just the dead ids rather than the whole day is the kinder failure:
 * deleting one lift out of three should still preload the other two, and a
 * one-lift day collapsing to undefined is the same "no plan" result either way.
 *
 * Kept separate from `plannedWorkoutFor` because that function is pure weekday
 * arithmetic and has no business knowing the exercise library exists. The store
 * composes the two (see `plannedWorkoutForDate`).
 */
export function prunePlannedWorkout(
  planned: PlannedWorkout | undefined,
  knownExerciseIds: readonly string[],
): PlannedWorkout | undefined {
  if (!planned) return undefined;
  const known = new Set(knownExerciseIds);
  const exerciseIds = planned.exerciseIds.filter((id) => known.has(id));
  return exerciseIds.length > 0 ? { ...planned, exerciseIds } : undefined;
}

/**
 * A planned time as a fixed 24-hour "HH:MM" string.
 *
 * Not the same job as `PlanEditorSheet`'s own serialiser, which produces a value
 * for an `<input type="time">` and is therefore contractually 24-hour
 * zero-padded whatever this ever becomes. Keep them separate: the day this turns
 * into a locale-aware "5:05 PM", the input would silently stop round-tripping.
 */
export function formatMinutesOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
