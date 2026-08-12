/**
 * Pure 1RM (one-rep max) estimation formulas and percentage table generation.
 * No React, no store, no DOM - everything here is directly unit-testable.
 */

export interface OneRmEstimate {
  epley: number;
  brzycki: number;
  average: number;
}

export interface OneRmPercentageRow {
  percentage: number;
  weight: number;
  reps: string;
}

/**
 * Rounds a number to 1 decimal place to prevent floating-point noise in displays.
 */
function round1Decimal(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Rounds a weight to the nearest 2.5 (e.g. 299.25 to 300, 283.5 to 282.5).
 * Standard plate increments in both lbs and kg round to 2.5 / 1.25 multiples.
 */
function roundToNearest2Point5(n: number): number {
  return Math.round(n / 2.5) * 2.5;
}

/**
 * Epley formula for estimated 1RM: weight * (1 + reps / 30).
 *
 * Reps equal to 1 return the weight directly so single-rep sets are never
 * artificially inflated above the weight actually lifted.
 */
export function epley(weight: number, reps: number): number {
  if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(reps) || reps <= 0) {
    return 0;
  }
  if (reps === 1) return weight;
  return round1Decimal(weight * (1 + reps / 30));
}

/**
 * Brzycki formula for estimated 1RM: weight * (36 / (37 - reps)).
 *
 * The denominator (37 - reps) reaches zero at 37 reps and becomes negative
 * beyond it. To prevent division by zero and extreme linear inflation on high-rep
 * sets, reps are capped at 36. Single-rep sets return weight directly without
 * inflation.
 */
export function brzycki(weight: number, reps: number): number {
  if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(reps) || reps <= 0) {
    return 0;
  }
  if (reps === 1) return weight;

  // Clamping at 36 keeps the denominator positive (>= 1).
  const safeReps = Math.min(reps, 36);
  return round1Decimal(weight * (36 / (37 - safeReps)));
}

/**
 * Returns estimated 1RM using Epley, Brzycki, and their arithmetic mean.
 */
export function estimate1RM(weight: number, reps: number): OneRmEstimate {
  const e = epley(weight, reps);
  const b = brzycki(weight, reps);
  const avg = round1Decimal((e + b) / 2);
  return {
    epley: e,
    brzycki: b,
    average: avg,
  };
}

/** Typical rep ranges for standard training percentages. */
const PERCENTAGE_REP_RANGES: readonly { percentage: number; reps: string }[] = [
  { percentage: 95, reps: "1-2" },
  { percentage: 90, reps: "2-4" },
  { percentage: 85, reps: "4-6" },
  { percentage: 80, reps: "6-8" },
  { percentage: 75, reps: "8-10" },
  { percentage: 70, reps: "10-12" },
  { percentage: 65, reps: "12-15" },
  { percentage: 60, reps: "15-20" },
];

/**
 * Generates a standard percentage table (95% down to 60%) for a given 1RM.
 * Each row weight is rounded to the nearest 2.5 increment to match usable plate weights.
 */
export function percentageTable(oneRm: number): OneRmPercentageRow[] {
  if (!Number.isFinite(oneRm) || oneRm <= 0) {
    return PERCENTAGE_REP_RANGES.map((row) => ({
      percentage: row.percentage,
      weight: 0,
      reps: row.reps,
    }));
  }

  return PERCENTAGE_REP_RANGES.map((row) => {
    const rawWeight = oneRm * (row.percentage / 100);
    return {
      percentage: row.percentage,
      weight: roundToNearest2Point5(rawWeight),
      reps: row.reps,
    };
  });
}
