import type { DailyLog } from "./store";

/**
 * What a target MEANS, once you have one. No store, no IndexedDB, no DOM.
 *
 * This file used to also decide WHICH target applied, by looking the day up in
 * a seven-entry weekday table. That model is gone: targets are now a timeline
 * of dated phases (see planning.ts), because the user's actual requirement was
 * "maintenance until Friday, then cutting from Sunday onward" and a weekday
 * table cannot say that at all.
 *
 * What survived is everything about INTERPRETING a target, which never depended
 * on where it came from: whether going over a number is a win or a miss, what
 * counts as met, and how to describe the gap.
 *
 * The shape it reads is structural rather than nominal - anything carrying the
 * optional numeric fields and a goalMode works - so a NutritionPhase drops
 * straight in where a TargetProfile used to go.
 */

/** A thing that can carry targets. `NutritionPhase` satisfies this. */
export interface TargetBearing {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  steps?: number;
  goalMode?: GoalMode;
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
  profile: TargetBearing | undefined,
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
