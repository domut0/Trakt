import type { DailyLog } from "./store";

/**
 * What a target MEANS, once you have one. No store, no IndexedDB, no DOM.
 *
 * TWO RULES, and there used to be nine.
 *
 *   Calories are a CEILING: hit them, or come in a little under.
 *   Steps are a FLOOR: hit them, or go past.
 *
 * Protein, carbs and fat have no rule at all, and that is the substantive
 * change rather than a simplification. This file used to carry a cut / maintain
 * / gain dial that flipped each macro between floor, ceiling and band, on the
 * theory that a cut wants protein high and fat low while a bulk wants the
 * reverse. The user's answer was blunt: there is no more-or-less-is-better rule
 * for macros, ever. A macro target is a number you are aiming at, and missing it
 * in either direction is just missing it - so the app says nothing about it
 * rather than inventing a verdict.
 *
 * That deletes the mode, the per-mode direction table, the band tolerance, and
 * the whole class of bug where the app painted a deliberate surplus red because
 * it had guessed the wrong phase of training.
 */

/** A thing that can carry targets. `NutritionPhase` satisfies this. */
export interface TargetBearing {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  steps?: number;
}

/** The numeric fields a target can constrain. Steps included; bodyweight is not
 * a target, it is an outcome. */
export const TARGET_FIELDS = ["calories", "protein", "carbs", "fat", "steps"] as const;

export type TargetField = (typeof TARGET_FIELDS)[number];

/** Which way a target wants to be missed. */
export type TargetDirection = "floor" | "ceiling";

/**
 * How close to a ceiling still counts as hitting it.
 *
 * "Hit them or slightly below" needs a floor under the "slightly", or a calorie
 * ceiling could only ever read as unmet: landing exactly on it is vanishingly
 * rare, and 200 under a 2,400 target is a day that went well, not a day that
 * fell short.
 */
export const CEILING_TOLERANCE = 0.05;

/**
 * The direction a field is judged in, or undefined when it is not judged.
 *
 * Undefined is the answer for all three macros, and it is load-bearing: a caller
 * that gets it back must render no status mark at all, not a neutral one. The
 * field is not passing or failing, it is simply a number beside another number.
 */
export function directionFor(field: TargetField): TargetDirection | undefined {
  if (field === "calories") return "ceiling";
  if (field === "steps") return "floor";
  return undefined;
}

export type TargetStatus = "progress" | "met" | "exceeded";

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
  if (direction === "floor") {
    // Going past a floor is the point, so there is no such thing as too many
    // steps. A floor can only be met or not yet met.
    return logged >= target ? "met" : "progress";
  }
  // A ceiling is met by landing on it or just under, and exceeded by passing it.
  // Without the tolerance the met state would be unreachable in practice.
  if (logged > target) return "exceeded";
  return logged >= target * (1 - CEILING_TOLERANCE) ? "met" : "progress";
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
   *  or "exceeded" (a ceiling overage). */
  delta: number;
}

/**
 * Progress for every JUDGED field the profile sets a target for and the day
 * actually logged.
 *
 * The three macros are skipped entirely, because they have no direction: they
 * are numbers to aim at, not budgets to stay under or floors to clear. Fields the profile leaves unset produce no row, so a
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
    const direction = directionFor(field);
    // No direction means no verdict. A macro is not passing or failing.
    if (direction === undefined) continue;
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

// ---------------------------------------------------------------------------
// Macros against the calorie target.
//
// The one arithmetic relationship this app knows. It is not a rule about what
// to eat - there is still no more-or-less-is-better direction on a macro - it
// is the fact that three of the numbers on the phase editor add up to a fourth
// one sitting three rows above them, and that the screen should say so.
// ---------------------------------------------------------------------------

export const MACRO_FIELDS = ["protein", "carbs", "fat"] as const;

export type MacroField = (typeof MACRO_FIELDS)[number];

/**
 * Atwater factors. Approximations by nature - they are averages over food, not
 * constants - which is exactly why what is derived from them is offered as a
 * SUGGESTION and never written on the user's behalf.
 */
export const KCAL_PER_GRAM: Record<MacroField, number> = {
  protein: 4,
  carbs: 4,
  fat: 9,
};

/** Calories accounted for by whichever macros carry a number. */
export function macroKcal(t: TargetBearing): number {
  return MACRO_FIELDS.reduce((sum, f) => sum + (t[f] ?? 0) * KCAL_PER_GRAM[f], 0);
}

/**
 * The grams of `field` that would spend exactly what the calorie target has
 * left, or undefined when there is nothing to derive it from.
 *
 * Four conditions, and every one of them is a case where a number would be a
 * guess rather than a consequence:
 *
 *   the field already has a value       - it is not the app's to change
 *   the other two are not both set      - two unknowns, one equation
 *   there is no calorie target          - nothing to divide up
 *   the other two already spend it all  - the honest answer is not a positive
 *                                         number of grams
 */
export function suggestMacroGrams(t: TargetBearing, field: MacroField): number | undefined {
  if (t[field] !== undefined) return undefined;
  if (t.calories === undefined) return undefined;
  const others = MACRO_FIELDS.filter((f) => f !== field);
  if (others.some((f) => t[f] === undefined)) return undefined;
  const left = t.calories - others.reduce((sum, f) => sum + t[f]! * KCAL_PER_GRAM[f], 0);
  if (left <= 0) return undefined;
  return Math.round(left / KCAL_PER_GRAM[field]);
}

/**
 * Whether the macros already set spend more than the calorie target.
 *
 * Strictly more: landing exactly on it is the plan working, not a problem. False
 * whenever there is no calorie target, because with nothing to exceed there is
 * nothing to warn about.
 */
export function macrosExceedCalories(t: TargetBearing): boolean {
  if (t.calories === undefined) return false;
  return macroKcal(t) > t.calories;
}
