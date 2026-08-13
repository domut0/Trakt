/**
 * Pure barbell plate math helpers. No React, no store, no DOM - everything
 * here is directly unit-testable.
 */

export const DEFAULT_PLATES_LBS: readonly number[] = [45, 35, 25, 10, 5, 2.5];
export const DEFAULT_PLATES_KG: readonly number[] = [25, 20, 15, 10, 5, 2.5, 1.25];
export const DEFAULT_BAR_LBS = 45;
export const DEFAULT_BAR_KG = 20;

/**
 * Hard ceiling on plates loaded on one sleeve. A real sleeve holds well under
 * ten plates, so this never limits an achievable load (20 x 45 lb per side is
 * a 1845 lb bar). It exists so an absurd target typed into an input - 1e12 -
 * cannot return a count of eleven billion, which would hang any caller that
 * renders one element per plate.
 */
export const MAX_PLATES_PER_SIDE = 20;

/** Tolerance for plate arithmetic. Well below the smallest real plate. */
const EPSILON = 1e-6;

export interface PlateCount {
  weight: number;
  count: number;
}

export type PlateInput = number | { weight: number; count?: number };

export interface PlateStackResult {
  /** Plates loaded on ONE side of the barbell, ordered from heaviest to lightest. */
  perSide: PlateCount[];
  /** Total weight of the loaded barbell (bar + plates on both sides). */
  achieved: number;
  /**
   * How far short of the target the achievable load falls, or 0 when the
   * target is hit exactly. Never negative: a target under the bar weight
   * reports 0 here, and `achieved` reports the bare bar.
   */
  remainder: number;
}

/**
 * Clean floating-point arithmetic noise (e.g. 0.2500000000000004 to 0.25) so
 * remainder comparisons and displayed totals stay exact. Four decimals is far
 * finer than any plate increment (1.25 kg / 2.5 lb) yet coarse enough to
 * absorb the binary error that accumulates from repeated subtraction.
 *
 * NaN and Infinity degrade to 0. A magnitude so large that scaling by 10000
 * overflows is returned untouched instead: a double that big has no fractional
 * part left to clean, and collapsing it to 0 would make an unreachable target
 * report a remainder of 0, which reads as "loaded exactly".
 */
function cleanFloat(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const scaled = n * 10000;
  if (!Number.isFinite(scaled)) return n;
  return Math.round(scaled) / 10000;
}

/**
 * Computes the plate stack required PER SIDE to reach a target weight.
 *
 * Uses a greedy descending algorithm: loads as many of the heaviest available
 * plate as possible per side before trying smaller plates. Running out of a
 * plate falls through to the next smaller one.
 *
 * `availablePlates` counts are per side and are never exceeded. Pass `undefined`
 * to use the unit's default gym set; pass `[]` to mean "no plates at all",
 * which returns the bare bar with the whole gap as remainder.
 *
 * Non-finite or negative inputs degrade to the bare bar rather than producing
 * NaN, so a half-typed text field can be handed straight to this function.
 */
export function computePlateStack(
  targetWeight: number,
  barWeight: number = DEFAULT_BAR_LBS,
  availablePlates?: readonly PlateInput[],
  unit: "lbs" | "kg" = "lbs",
): PlateStackResult {
  // A NaN or negative bar (empty input field, bad settings value) is treated as
  // no bar at all instead of poisoning every downstream number with NaN.
  const bar = Number.isFinite(barWeight) && barWeight > 0 ? cleanFloat(barWeight) : 0;

  // Target below or equal to bar weight cannot take plates. We clamp achieved
  // to the bar itself because you cannot shave weight off an empty barbell.
  if (!Number.isFinite(targetWeight) || targetWeight <= bar + EPSILON) {
    return { perSide: [], achieved: bar, remainder: 0 };
  }

  // `undefined` means "caller did not specify", so fall back to the unit's
  // default set. An explicitly empty array means "no plates available" and is
  // honoured as such.
  const platesToUse: readonly PlateInput[] =
    availablePlates ?? (unit === "kg" ? DEFAULT_PLATES_KG : DEFAULT_PLATES_LBS);

  // Standardize inputs to objects with explicit per-side available counts.
  // Sorting descending guarantees the greedy heuristic tries largest plates
  // first. Duplicate weights are merged so their counts add up instead of
  // producing two rows for the same plate.
  const byWeight = new Map<number, number>();
  for (const p of platesToUse) {
    const weight = typeof p === "number" ? p : p.weight;
    const rawCount = typeof p === "number" ? Infinity : (p.count ?? Infinity);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    if (Number.isNaN(rawCount) || rawCount <= 0) continue;
    const count = Number.isFinite(rawCount) ? Math.floor(rawCount) : Infinity;
    if (count <= 0) continue;
    byWeight.set(weight, (byWeight.get(weight) ?? 0) + count);
  }
  const normalized = [...byWeight.entries()]
    .map(([weight, count]) => ({ weight, count }))
    .sort((a, b) => b.weight - a.weight);

  // Target weight per side is split evenly across both sleeves.
  let remainingPerSide = cleanFloat((targetWeight - bar) / 2);
  let takenPerSide = 0;
  const perSide: PlateCount[] = [];

  for (const plate of normalized) {
    if (remainingPerSide <= EPSILON || takenPerSide >= MAX_PLATES_PER_SIDE) break;

    // EPSILON keeps a remainder of 2.4999999999999996 from floor()-ing down to
    // zero plates when 2.5 is exactly what is left to load.
    const neededCount = Math.floor((remainingPerSide + EPSILON) / plate.weight);
    const takeCount = Math.min(neededCount, plate.count, MAX_PLATES_PER_SIDE - takenPerSide);

    if (takeCount > 0) {
      perSide.push({ weight: plate.weight, count: takeCount });
      takenPerSide += takeCount;
      remainingPerSide = cleanFloat(remainingPerSide - takeCount * plate.weight);
    }
  }

  const loadedPerSide = perSide.reduce((sum, p) => sum + p.weight * p.count, 0);
  const achieved = cleanFloat(bar + loadedPerSide * 2);
  const gap = cleanFloat(targetWeight - achieved);
  const remainder = gap > 0 ? gap : 0;

  return { perSide, achieved, remainder };
}
