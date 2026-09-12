import { describe, expect, it } from "vitest";
import { brzycki, BRZYCKI_MAX_REPS, epley, estimate1RM, RELIABLE_REP_LIMIT } from "../onerm";

describe("onerm module constants", () => {
  it("clamps Brzycki one rep short of its zero denominator", () => {
    // The formula divides by (37 - reps), so 37 is the pole. 36 is the last rep
    // count that keeps the denominator at 1 or more.
    expect(BRZYCKI_MAX_REPS).toBe(36);
    expect(37 - BRZYCKI_MAX_REPS).toBe(1);
  });

  it("exports the rep count past which the UI stops vouching for the estimate", () => {
    expect(RELIABLE_REP_LIMIT).toBe(12);
    expect(RELIABLE_REP_LIMIT).toBeLessThan(BRZYCKI_MAX_REPS);
  });
});

describe("epley formula", () => {
  it("returns the input weight untouched when reps equal 1", () => {
    // Not merely equal: identical. A single at 227.55 must not be reported as
    // 227.6, which would inflate a logged lift the user actually performed.
    expect(Object.is(epley(225, 1), 225)).toBe(true);
    expect(Object.is(epley(102.5, 1), 102.5)).toBe(true);
    expect(Object.is(epley(227.55, 1), 227.55)).toBe(true);
  });

  it("calculates weight * (1 + reps / 30) rounded to 1 decimal", () => {
    // 100 * (1 + 5/30) = 116.666... -> 116.7
    expect(epley(100, 5)).toBe(116.7);
    // 200 * (1 + 10/30) = 266.666... -> 266.7
    expect(epley(200, 10)).toBe(266.7);
    // 315 * 1.1 = 346.5, exact
    expect(epley(315, 3)).toBe(346.5);
    expect(epley(100, 2)).toBe(106.7);
  });

  it("grows monotonically with reps", () => {
    let previous = epley(225, 1);
    for (let reps = 2; reps <= 30; reps++) {
      const current = epley(225, reps);
      expect(current, `reps ${reps}`).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it("returns 0 for zero, negative and non-finite inputs", () => {
    expect(epley(0, 5)).toBe(0);
    expect(epley(100, 0)).toBe(0);
    expect(epley(-50, 5)).toBe(0);
    expect(epley(100, -3)).toBe(0);
    expect(epley(NaN, 5)).toBe(0);
    expect(epley(100, NaN)).toBe(0);
    expect(epley(Infinity, 5)).toBe(0);
    expect(epley(100, Infinity)).toBe(0);
  });

  it("returns a finite number for a weight large enough to overflow the rounding", () => {
    // 1e308 * 1.1666 is still finite, but scaling it by 10 to round is not.
    // "Infinity" must never reach the screen.
    expect(Number.isFinite(epley(1e308, 5))).toBe(true);
    expect(epley(1e308, 5)).toBe(0);
    expect(Number.isFinite(epley(1e10, 20))).toBe(true);
  });
});

describe("brzycki formula", () => {
  it("returns the input weight untouched when reps equal 1", () => {
    expect(Object.is(brzycki(225, 1), 225)).toBe(true);
    expect(Object.is(brzycki(102.5, 1), 102.5)).toBe(true);
    expect(Object.is(brzycki(227.55, 1), 227.55)).toBe(true);
  });

  it("calculates weight * 36 / (37 - reps) rounded to 1 decimal", () => {
    // 100 * (36 / 32) = 112.5, exact
    expect(brzycki(100, 5)).toBe(112.5);
    // 315 * (36 / 34) = 333.529... -> 333.5
    expect(brzycki(315, 3)).toBe(333.5);
    // 102.5 * (36 / 29) = 127.241... -> 127.2
    expect(brzycki(102.5, 8)).toBe(127.2);
  });

  it("clamps at the rep count where the denominator would hit zero", () => {
    // Unclamped, 37 reps divides by zero (Infinity) and 38 goes negative.
    const atCap = brzycki(100, BRZYCKI_MAX_REPS);
    expect(atCap).toBe(3600);
    expect(brzycki(100, 37)).toBe(atCap);
    expect(brzycki(100, 38)).toBe(atCap);
    expect(brzycki(100, 50)).toBe(atCap);
    expect(brzycki(100, 1000)).toBe(atCap);
  });

  it("never produces a negative or non-finite estimate at any rep count", () => {
    for (const reps of [12, 30, 36, 37, 38, 100, 1e6]) {
      const value = brzycki(225, reps);
      expect(Number.isFinite(value), `reps ${reps}`).toBe(true);
      expect(value, `reps ${reps}`).toBeGreaterThan(0);
    }
  });

  it("returns 0 for zero, negative and non-finite inputs", () => {
    expect(brzycki(0, 5)).toBe(0);
    expect(brzycki(100, 0)).toBe(0);
    expect(brzycki(-50, 5)).toBe(0);
    expect(brzycki(NaN, 5)).toBe(0);
    expect(brzycki(100, NaN)).toBe(0);
    expect(brzycki(Infinity, 5)).toBe(0);
  });

  it("returns a finite number for a weight large enough to overflow the rounding", () => {
    expect(Number.isFinite(brzycki(1e308, 5))).toBe(true);
    expect(brzycki(1e308, 5)).toBe(0);
  });
});

describe("estimate1RM", () => {
  it("returns epley, brzycki and their mean", () => {
    const res = estimate1RM(100, 5);
    expect(res.epley).toBe(116.7);
    expect(res.brzycki).toBe(112.5);
    expect(res.average).toBe(114.6);
  });

  it("reports one consistent number when both formulas agree", () => {
    // At 1 rep both formulas return the weight, so the headline average must be
    // that same weight and not a rounded-off neighbour of it.
    const round = estimate1RM(315, 1);
    expect(round.epley).toBe(315);
    expect(round.brzycki).toBe(315);
    expect(round.average).toBe(315);

    const fractional = estimate1RM(227.55, 1);
    expect(fractional.epley).toBe(227.55);
    expect(fractional.brzycki).toBe(227.55);
    expect(fractional.average).toBe(227.55);
    expect(fractional.average).toBe(fractional.epley);
  });

  it("zeroes every field for unusable input", () => {
    for (const [weight, reps] of [
      [0, 5],
      [100, 0],
      [-100, 5],
      [NaN, 5],
      [100, NaN],
      [Infinity, 5],
    ]) {
      const res = estimate1RM(weight, reps);
      expect(res.epley, `${weight} x ${reps}`).toBe(0);
      expect(res.brzycki, `${weight} x ${reps}`).toBe(0);
      expect(res.average, `${weight} x ${reps}`).toBe(0);
    }
  });

  it("keeps every field finite for any plausible or absurd input", () => {
    for (const [weight, reps] of [
      [225, 5],
      [1000, 36],
      [1000, 500],
      [1e308, 5],
      [1e10, 30],
    ]) {
      const res = estimate1RM(weight, reps);
      expect(Number.isFinite(res.epley), `${weight} x ${reps}`).toBe(true);
      expect(Number.isFinite(res.brzycki), `${weight} x ${reps}`).toBe(true);
      expect(Number.isFinite(res.average), `${weight} x ${reps}`).toBe(true);
    }
  });
});
