/**
 * Pure 1RM (one-rep max) estimation formulas and percentage table generation.
 * No React, no store, no DOM - everything here is directly unit-testable.
 */

export interface OneRmEstimate {
  epley: number;
  brzycki: number;
  average: number;
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
 *
 * The finiteness check is on the ROUNDED value, not the argument: scaling by 10
 * is itself enough to overflow a merely huge input, so checking only the
 * argument would let Infinity straight through to the screen.
 */
function round1Decimal(n: number): number {
  const rounded = Math.round(n * 10) / 10;
  return Number.isFinite(rounded) ? rounded : 0;
}

/** True for a usable weight/reps pair; anything else estimates to 0. */
function validInput(weight: number, reps: number): boolean {
  return Number.isFinite(weight) && weight > 0 && Number.isFinite(reps) && reps > 0;
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
 *
 * When both formulas agree the mean is that value verbatim, with no rounding
 * pass. Rounding it would let a single at 102.55 display an average of 102.6
 * beside two component estimates of 102.55, and the headline number differing
 * from both numbers it averages reads as a bug.
 */
export function estimate1RM(weight: number, reps: number): OneRmEstimate {
  const e = epley(weight, reps);
  const b = brzycki(weight, reps);
  return {
    epley: e,
    brzycki: b,
    average: e === b ? e : round1Decimal((e + b) / 2),
  };
}
