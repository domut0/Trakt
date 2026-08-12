/**
 * Pure barbell plate math helpers. No React, no store, no DOM - everything
 * here is directly unit-testable.
 */

export const DEFAULT_PLATES_LBS: readonly number[] = [45, 35, 25, 10, 5, 2.5];
export const DEFAULT_PLATES_KG: readonly number[] = [25, 20, 15, 10, 5, 2.5, 1.25];
export const DEFAULT_BAR_LBS = 45;
export const DEFAULT_BAR_KG = 20;

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
  /** Weight requested that could not be matched by available plates. */
  remainder: number;
}

/**
 * Clean floating-point arithmetic noise (e.g. 0.2500000000000004 to 0.25) so
 * remainder comparisons and displayed totals stay exact.
 */
function cleanFloat(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Computes the plate stack required PER SIDE to reach a target weight.
 *
 * Uses a greedy descending algorithm: loads as many of the heaviest available
 * plate as possible per side before trying smaller plates.
 *
 * If targetWeight is less than or equal to barWeight, no plates are loaded and
 * achieved equals barWeight. If target weight cannot be met exactly with available
 * plates, remainder surfaces the unmatchable weight gap.
 */
export function computePlateStack(
  targetWeight: number,
  barWeight: number = DEFAULT_BAR_LBS,
  availablePlates?: readonly PlateInput[],
  unit: "lbs" | "kg" = "lbs",
): PlateStackResult {
  // Target below or equal to bar weight cannot take plates. We clamp achieved
  // to the bar itself because you cannot shave weight off an empty barbell.
  if (!Number.isFinite(targetWeight) || targetWeight <= barWeight) {
    return {
      perSide: [],
      achieved: barWeight,
      remainder: 0,
    };
  }

  const platesToUse =
    availablePlates && availablePlates.length > 0
      ? availablePlates
      : unit === "kg"
      ? DEFAULT_PLATES_KG
      : DEFAULT_PLATES_LBS;

  // Standardize inputs to objects with explicit per-side available counts.
  // Sorting descending guarantees the greedy heuristic tries largest plates first.
  const normalized = platesToUse
    .map((p) =>
      typeof p === "number"
        ? { weight: p, count: Infinity }
        : { weight: p.weight, count: p.count ?? Infinity },
    )
    .filter((p) => p.weight > 0 && p.count > 0)
    .sort((a, b) => b.weight - a.weight);

  // Target weight per side is split evenly across both sleeves.
  let remainingPerSide = cleanFloat((targetWeight - barWeight) / 2);
  const perSide: PlateCount[] = [];

  for (const plate of normalized) {
    if (remainingPerSide <= 0) break;

    // Small epsilon prevents floating-point floor errors like 5.0 / 2.5 = 1.99999
    const neededCount = Math.floor(cleanFloat(remainingPerSide + 1e-9) / plate.weight);
    const takeCount = Math.min(neededCount, plate.count);

    if (takeCount > 0) {
      perSide.push({ weight: plate.weight, count: takeCount });
      remainingPerSide = cleanFloat(remainingPerSide - takeCount * plate.weight);
    }
  }

  const loadedPerSide = perSide.reduce((sum, p) => sum + p.weight * p.count, 0);
  const achieved = cleanFloat(barWeight + loadedPerSide * 2);
  const remainder = cleanFloat(Math.max(0, targetWeight - achieved));

  return {
    perSide,
    achieved,
    remainder,
  };
}
