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

/**
 * Which way a target wants to be missed.
 *
 * A stored target is a bare number, and a number cannot say whether exceeding
 * it is a success or a failure. Blowing past a protein or step goal is the
 * whole point; blowing past a calorie budget on a cut is not. Without this the
 * only available rule is `fraction > 1 === bad`, which paints a red bar and an
 * "OVER" badge on the best day the user has had all week.
 *
 * - `floor`   — a minimum to reach. More is fine, and there is no "too much".
 * - `ceiling` — a budget not to break. Under is the normal state, over is the event.
 * - `band`    — a number to land ON, missable in either direction.
 */
export type TargetDirection = "floor" | "ceiling" | "band";

/** The one dial that decides every field's direction. See `directionFor`. */
export type GoalMode = "cut" | "maintain" | "gain";

export const GOAL_MODES = ["cut", "maintain", "gain"] as const;

/**
 * The mode assumed when a profile has none.
 *
 * `maintain` because it is the only mode whose directions are wrong in a
 * survivable way for the other two: it never marks a real overage as fine, and
 * it never nags an intentional surplus. Guessing `cut` for a bulking user would
 * paint their calorie win red, which is the exact bug this module exists to end.
 */
export const DEFAULT_GOAL_MODE: GoalMode = "maintain";

/** Fraction of target either side of which a "band" goal stops counting as met. */
export const BAND_TOLERANCE = 0.05;

/** How a value compares to its target, given that target's direction. */
export type TargetStatus = "progress" | "met" | "exceeded";

/**
 * Per-mode direction defaults.
 *
 * Deliberately ONE mode per profile rather than five per-field pickers: the
 * user knows whether they are cutting, holding or gaining, and does not know
 * (or want to answer) whether fat should be a ceiling or a band on a bulk.
 *
 * `protein` and `steps` are floors in EVERY mode. There is no diet in which
 * hitting 220g of protein against a 200g goal is a failure, and the old
 * `fraction > 1` rule called it one.
 */
const DIRECTIONS_BY_MODE: Record<GoalMode, Readonly<Record<TargetField, TargetDirection>>> = {
  // Cutting: calories and fat are budgets, protein guards against muscle loss,
  // carbs still want to land near target to keep training quality.
  cut: { calories: "ceiling", protein: "floor", carbs: "band", fat: "ceiling", steps: "floor" },
  // Maintaining: calories are a number to land on, not a budget to squeak under.
  maintain: { calories: "band", protein: "floor", carbs: "band", fat: "band", steps: "floor" },
  // Gaining: calories become a floor. Under-eating is the failure mode here,
  // which is precisely inverted from the cut, and no single global rule can
  // serve both.
  gain: { calories: "floor", protein: "floor", carbs: "band", fat: "band", steps: "floor" },
};

/**
 * The direction to apply to `field`, resolved ON READ from the profile's mode.
 *
 * Absent `mode` resolves to `DEFAULT_GOAL_MODE` here rather than being written
 * onto the stored profile, so every existing saved profile is fixed with no
 * migration, no Dexie version bump and nothing for the user to do.
 *
 * Defensive about `mode` on purpose: it round-trips through user-editable
 * backup JSON, so at runtime it can be a string this table has never heard of,
 * and the type annotation cannot catch that.
 */
export function directionFor(field: TargetField, mode: GoalMode | undefined): TargetDirection {
  const table =
    (mode !== undefined && DIRECTIONS_BY_MODE[mode]) || DIRECTIONS_BY_MODE[DEFAULT_GOAL_MODE];
  return table[field] ?? DIRECTIONS_BY_MODE[DEFAULT_GOAL_MODE][field] ?? "band";
}

/**
 * Where `logged` stands against `target` under `direction`.
 *
 * The two asymmetries here are the whole design:
 *
 * A `floor` never reports "exceeded". A floor cannot be overshot — 12,000 steps
 * against a 10,000 goal is 10,000 steps plus a bonus, not a violation.
 *
 * A `ceiling` never reports "met". Being under a calorie budget at 9am is not
 * an achievement, it is breakfast; stamping it green would make green mean
 * "nothing has happened yet" everywhere it appears, and a colour that means
 * both "you did it" and "you have not started" means nothing.
 *
 * The band comparison is done in the FIELD'S OWN UNITS (`|logged - target|`
 * against `BAND_TOLERANCE * target`) rather than on the fraction. It is not a
 * stylistic choice: `1.05 - 1` is `0.050000000000000044` in IEEE 754, so
 * `Math.abs(fraction - 1) <= BAND_TOLERANCE` rejects a value sitting exactly on
 * the upper edge. The units form is exact for every integer edge case.
 */
export function targetStatusFor(
  direction: TargetDirection,
  logged: number,
  target: number,
): TargetStatus {
  const delta = logged - target;
  switch (direction) {
    case "floor":
      return logged >= target ? "met" : "progress";
    case "ceiling":
      return logged > target ? "exceeded" : "progress";
    case "band": {
      const tolerance = BAND_TOLERANCE * target;
      if (delta > tolerance) return "exceeded";
      if (delta < -tolerance) return "progress";
      return "met";
    }
  }
}

export interface TargetProgress {
  field: TargetField;
  logged: number;
  target: number;
  /** Fraction of target, NOT clamped: going over is real information and the
   * ring needs to be able to show it. */
  fraction: number;
  direction: TargetDirection;
  status: TargetStatus;
  /** Signed distance from target, in the field's own units. Positive = above
   *  target. Only meaningful to display when status is "met" (a floor surplus)
   *  or "exceeded" (a ceiling/band overage). */
  delta: number;
}

/**
 * Progress for every field the profile sets a target for and the day actually
 * logged. Fields the profile leaves unset produce no row, so a
 * calories-and-protein-only target does not render three empty bars.
 *
 * A logged value with no target, or a target with nothing logged, both yield
 * nothing: progress needs both halves to mean anything.
 *
 * Each row carries its own direction and status so that callers never have to
 * re-derive "is over bad here?" — that question has exactly one right answer
 * per field, and it lives here rather than in whichever component renders the bar.
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
    const direction = directionFor(field, profile.goalMode);
    out.push({
      field,
      logged,
      target,
      fraction: logged / target,
      direction,
      status: targetStatusFor(direction, logged, target),
      delta: logged - target,
    });
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
