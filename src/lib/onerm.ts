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
 * Brzycki's denominator is (37 - reps), which hits exactly zero at 37 reps
 * (Infinity) and goes negative beyond it (a negative 1RM). Reps are clamped
 * here so the denominator stays at or above 1.
 */
export const BRZYCKI_MAX_REPS = 36;

/**
 * Above this many reps both formulas drift badly from reality, so the UI warns
 * rather than presenting the number as trustworthy.
 */
export const RELIABLE_REP_LIMIT = 12;

/**
 * Rounds a number to 1 decimal place to prevent floating-point noise in
 * displays. Non-finite results (a weight so large the formula overflows to
 * Infinity) collapse to 0 so nothing can render "Infinity" or "NaN".
 */
function round1Decimal(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

/**
 * Rounds a weight to the nearest 2.5 (e.g. 299.25 to 300, 283.5 to 282.5).
 * Standard plate increments in both lbs and kg round to 2.5 / 1.25 multiples.
 *
 * The input is trimmed to 4 decimals first so binary noise (236.24999999999997
 * for what is mathematically 236.25) cannot fall on the wrong side of a
 * half-increment boundary.
 */
function roundToNearest2Point5(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const clean = Math.round(n * 10000) / 10000;
  return Math.round(clean / 2.5) * 2.5;
}

/** True for a usable weight/reps pair; anything else estimates to 0. */
function validInput(weight: number, reps: number): boolean {
  return (
    Number.isFinite(weight) && weight > 0 && Number.isFinite(reps) && reps > 0
  );
}

/**
 * Epley formula for estimated 1RM: weight * (1 + reps / 30).
 *
 * Reps equal to 1 return the weight directly so single-rep sets are never
 * artificially inflated above the weight actually lifted.
 */
export function epley(weight: number, reps: number): number {
  if (!validInput(weight, reps)) return 0;
  if (reps === 1) return weight;
  return round1Decimal(weight * (1 + reps / 30));
}

/**
 * Brzycki formula for estimated 1RM: weight * (36 / (37 - reps)).
 *
 * The denominator (37 - reps) reaches zero at 37 reps and becomes negative
 * beyond it, so reps are clamped to BRZYCKI_MAX_REPS (36), keeping the
 * denominator at 1 or more. That is a guard against division by zero and a
 * negative 1RM, not an accuracy claim: past roughly 12 reps the formula's
 * linear model is already unreliable. Single-rep sets return weight directly
 * without inflation.
 */
export function brzycki(weight: number, reps: number): number {
  if (!validInput(weight, reps)) return 0;
  if (reps === 1) return weight;

  const safeReps = Math.min(reps, BRZYCKI_MAX_REPS);
  return round1Decimal(weight * (36 / (37 - safeReps)));
}

/**
 * Returns estimated 1RM using Epley, Brzycki, and their arithmetic mean.
 */
export function estimate1RM(weight: number, reps: number): OneRmEstimate {
  const e = epley(weight, reps);
  const b = brzycki(weight, reps);
  return {
    epley: e,
    brzycki: b,
    average: round1Decimal((e + b) / 2),
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
 * Each row weight is rounded to the nearest 2.5 increment, which is loadable in
 * both units (2.5 lb plates, a pair of 1.25 kg plates).
 */
export function percentageTable(oneRm: number): OneRmPercentageRow[] {
  const usable = Number.isFinite(oneRm) && oneRm > 0 ? oneRm : 0;

  return PERCENTAGE_REP_RANGES.map((row) => ({
    percentage: row.percentage,
    weight: usable === 0 ? 0 : roundToNearest2Point5(usable * (row.percentage / 100)),
    reps: row.reps,
  }));
}
