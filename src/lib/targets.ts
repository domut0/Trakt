import { getDay } from "date-fns";
import { parseDayKey } from "./daily-log";
import type { DailyLog, TargetProfile } from "./store";

/**
 * Pure resolution of per-weekday nutrition targets. No store, no IndexedDB,
 * no DOM.
 *
 * The design problem this solves: the user eats differently on training days
 * than on rest days (fewer calories resting, more carbs training), but a
 * per-DATE target would be another daily logging chore, which is exactly the
 * friction this app exists to remove.
 *
 * So targets are NAMED PROFILES assigned to weekdays. The user writes "Training"
 * and "Rest" once, taps which days are which, and never touches it again. With a
 * single profile assigned to all seven days it collapses into plain global
 * goals, so the simple case costs nothing.
 */

/**
 * Weekday index for a day key, MONDAY FIRST (Monday 0 ... Sunday 6).
 *
 * date-fns `getDay` returns Sunday 0, which does NOT match this app's
 * Monday-start week (see `weekStartKey` in daily-log.ts). Every lookup into
 * `weekdayTargets` goes through here so that rotation lives in exactly one
 * place; indexing that array with a raw `getDay()` is off by one for six days
 * out of seven and correct on Monday, which is the worst possible way for a bug
 * like this to present.
 */
export function weekdayIndexFor(day: string | Date): number {
  const d = typeof day === "string" ? parseDayKey(day) : day;
  return (getDay(d) + 6) % 7;
}

/** Monday-first weekday labels, aligned with `weekdayIndexFor`. */
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * The profile that applies on `day`, or undefined when the assignment points at
 * a profile that no longer exists.
 *
 * Tolerant of a malformed `weekdayTargets` (wrong length, stale ids) because it
 * round-trips through user-editable backup JSON, and a bad import must degrade
 * to "no target" rather than throw on the Today screen.
 */
export function targetProfileFor(
  day: string | Date,
  profiles: readonly TargetProfile[],
  weekdayTargets: readonly string[],
): TargetProfile | undefined {
  if (weekdayTargets.length !== 7) return undefined;
  const id = weekdayTargets[weekdayIndexFor(day)];
  return profiles.find((p) => p.id === id);
}

/** The numeric fields a target can constrain. Steps included; bodyweight is not
 * a target, it is an outcome. */
export const TARGET_FIELDS = ["calories", "protein", "carbs", "fat", "steps"] as const;

export type TargetField = (typeof TARGET_FIELDS)[number];

export interface TargetProgress {
  field: TargetField;
  logged: number;
  target: number;
  /** Fraction of target, NOT clamped: going over is real information and the
   * ring needs to be able to show it. */
  fraction: number;
}

/**
 * Progress for every field the profile sets a target for and the day actually
 * logged. Fields the profile leaves unset produce no row, so a
 * calories-and-protein-only target does not render three empty bars.
 *
 * A logged value with no target, or a target with nothing logged, both yield
 * nothing: progress needs both halves to mean anything.
 */
export function targetProgressFor(
  log: DailyLog | undefined,
  profile: TargetProfile | undefined,
): TargetProgress[] {
  if (!log || !profile) return [];
  const out: TargetProgress[] = [];
  for (const field of TARGET_FIELDS) {
    const target = profile[field];
    const logged = log[field];
    // A target of 0 is not a meaningful goal, and dividing by it yields
    // Infinity, so treat it as unset rather than special-casing downstream.
    if (target === undefined || target <= 0 || logged === undefined) continue;
    out.push({ field, logged, target, fraction: logged / target });
  }
  return out;
}

/**
 * True when every weekday resolves to the same profile, which is the signal the
 * settings UI uses to stay in its simple one-set-of-goals mode instead of
 * showing the seven-day assignment strip.
 */
export function isUniformWeek(weekdayTargets: readonly string[]): boolean {
  return weekdayTargets.length === 7 && new Set(weekdayTargets).size === 1;
}
