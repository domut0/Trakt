import { describe, expect, it } from "vitest";
import {
  computePlateStack,
  DEFAULT_BAR_KG,
  DEFAULT_BAR_LBS,
  DEFAULT_PLATES_KG,
  DEFAULT_PLATES_LBS,
  MAX_PLATES_PER_SIDE,
  type PlateInput,
} from "../plates";

/** Total weight the returned stack actually accounts for: bar plus both sides. */
function loadedTotal(res: { perSide: { weight: number; count: number }[] }, bar: number): number {
  return bar + res.perSide.reduce((sum, p) => sum + p.weight * p.count, 0) * 2;
}

describe("plates module constants", () => {
  it("exports correct default values for lbs and kg", () => {
    expect(DEFAULT_BAR_LBS).toBe(45);
    expect(DEFAULT_BAR_KG).toBe(20);
    expect(DEFAULT_PLATES_LBS).toEqual([45, 35, 25, 10, 5, 2.5]);
    expect(DEFAULT_PLATES_KG).toEqual([25, 20, 15, 10, 5, 2.5, 1.25]);
    expect(MAX_PLATES_PER_SIDE).toBe(20);
  });
});

describe("computePlateStack: standard loads", () => {
  it("computes a standard 135 lb load (45 lb bar + one 45 lb plate per side)", () => {
    const res = computePlateStack(135, 45, DEFAULT_PLATES_LBS, "lbs");
    expect(res.perSide).toEqual([{ weight: 45, count: 1 }]);
    expect(res.achieved).toBe(135);
    expect(res.remainder).toBe(0);
  });

  it("computes a 225 lb load with no floating-point residue", () => {
    const res = computePlateStack(225, 45, DEFAULT_PLATES_LBS, "lbs");
    expect(res.perSide).toEqual([{ weight: 45, count: 2 }]);
    // toBe is Object.is, so 224.99999999999997 would fail this line.
    expect(res.achieved).toBe(225);
    expect(Object.is(res.remainder, 0)).toBe(true);
  });

  it("orders perSide from heaviest to lightest regardless of input order", () => {
    const res = computePlateStack(305, 45, [10, 45, 2.5, 25, 35, 5], "lbs");
    const weights = res.perSide.map((p) => p.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(res.achieved).toBe(305);
    expect(res.remainder).toBe(0);
  });

  it("picks the unit's default plate set when availablePlates is undefined", () => {
    // 22.5 kg needs a 1.25 kg plate per side, which only exists in the kg set.
    const kg = computePlateStack(22.5, 20, undefined, "kg");
    expect(kg.perSide).toEqual([{ weight: 1.25, count: 1 }]);
    expect(kg.achieved).toBe(22.5);
    expect(kg.remainder).toBe(0);

    // The same request in lbs has no 1.25 plate, so it falls 2.5 short.
    const lbs = computePlateStack(50, 45, undefined, "lbs");
    expect(lbs.perSide).toEqual([{ weight: 2.5, count: 1 }]);
    expect(lbs.achieved).toBe(50);
    expect(lbs.remainder).toBe(0);
  });
});

describe("computePlateStack: floating-point exactness", () => {
  it("hits 137.5 kg exactly through a five-plate fractional chain", () => {
    // 117.5 kg of plate over a 20 kg bar is 58.75 per side: 25+25+5+2.5+1.25.
    // Four successive subtractions, every one a chance to leave binary dust.
    const res = computePlateStack(137.5, 20, DEFAULT_PLATES_KG, "kg");
    expect(res.perSide).toEqual([
      { weight: 25, count: 2 },
      { weight: 5, count: 1 },
      { weight: 2.5, count: 1 },
      { weight: 1.25, count: 1 },
    ]);
    expect(res.achieved).toBe(137.5);
    expect(Object.is(res.remainder, 0)).toBe(true);
  });

  it("hits 100 kg exactly on a 20 kg bar", () => {
    const res = computePlateStack(100, 20, DEFAULT_PLATES_KG, "kg");
    expect(res.perSide).toEqual([
      { weight: 25, count: 1 },
      { weight: 15, count: 1 },
    ]);
    expect(res.achieved).toBe(100);
    expect(Object.is(res.remainder, 0)).toBe(true);
  });

  it("reports 137.5 lb as exactly 2.5 short rather than a noisy fraction", () => {
    // 46.25 per side is not a multiple of 2.5, so the lbs set genuinely cannot
    // make it. The shortfall must read as 2.5, not 2.4999999999999996.
    const res = computePlateStack(137.5, 45, DEFAULT_PLATES_LBS, "lbs");
    expect(res.perSide).toEqual([{ weight: 45, count: 1 }]);
    expect(res.achieved).toBe(135);
    expect(res.remainder).toBe(2.5);
  });

  it("does not call a loadable weight unmakeable when the split is inexact", () => {
    // (49.4 - 45) / 2 evaluates to 2.1999999999999957 in binary, so an
    // unguarded Math.floor(2.1999999999999957 / 2.2) yields 0 plates and the
    // sheet then claims a perfectly loadable 49.4 is 2.2 short.
    expect((49.4 - 45) / 2).toBeLessThan(2.2);
    const res = computePlateStack(49.4, 45, [2.2, 1.1], "lbs");
    expect(res.perSide).toEqual([{ weight: 2.2, count: 1 }]);
    expect(res.achieved).toBe(49.4);
    expect(Object.is(res.remainder, 0)).toBe(true);
  });

  it("does not lose a plate when the division lands just under a whole count", () => {
    // 3.3 / 1.1 evaluates to 2.9999999999999996, so an unguarded Math.floor
    // takes two plates instead of three and reports a loadable 51.6 as 2.2
    // short. This is the same failure as above, one division later.
    expect(Math.floor(3.3 / 1.1)).toBe(2);
    const res = computePlateStack(51.6, 45, [1.1], "lbs");
    expect(res.perSide).toEqual([{ weight: 1.1, count: 3 }]);
    expect(res.achieved).toBe(51.6);
    expect(Object.is(res.remainder, 0)).toBe(true);
  });

  it("keeps binary dust out of achieved when the target itself carries it", () => {
    // A target arrived at by arithmetic elsewhere (a percentage of a 1RM, say)
    // can be 138.60000000000002 rather than 138.6. The stack still resolves,
    // and the total shown on screen must be the clean number.
    const noisyTarget = 45 + 2 * (45 + 1.1 + 0.7);
    expect(noisyTarget).not.toBe(138.6);
    const res = computePlateStack(noisyTarget, 45, [45, 1.1, 0.7], "lbs");
    expect(res.achieved).toBe(138.6);
    expect(Object.is(res.remainder, 0)).toBe(true);
  });

  it("leaves zero remainder and an exact total for every loadable lbs weight", () => {
    // Every 5 lb step from 50 to 1045 is loadable with the default lbs set.
    for (let step = 1; step <= 200; step++) {
      const target = 45 + 5 * step;
      const res = computePlateStack(target, 45, DEFAULT_PLATES_LBS, "lbs");
      expect(Object.is(res.remainder, 0), `remainder at ${target}`).toBe(true);
      expect(res.achieved, `achieved at ${target}`).toBe(target);
      expect(loadedTotal(res, 45), `plate sum at ${target}`).toBe(target);
    }
  });

  it("leaves zero remainder and an exact total for every loadable kg weight", () => {
    // Every 2.5 kg step from 22.5 to 270 is loadable with the default kg set,
    // which means repeated 1.25 subtractions.
    for (let step = 1; step <= 100; step++) {
      const target = 20 + 2.5 * step;
      const res = computePlateStack(target, 20, DEFAULT_PLATES_KG, "kg");
      expect(Object.is(res.remainder, 0), `remainder at ${target}`).toBe(true);
      expect(res.achieved, `achieved at ${target}`).toBe(target);
      expect(loadedTotal(res, 20), `plate sum at ${target}`).toBe(target);
    }
  });

  it("never returns an achieved or remainder with more than 4 decimals", () => {
    for (let tenths = 1; tenths <= 600; tenths++) {
      const target = 40 + tenths * 0.1;
      const res = computePlateStack(target, 45, DEFAULT_PLATES_LBS, "lbs");
      expect(res.achieved).toBe(Math.round(res.achieved * 10000) / 10000);
      expect(res.remainder).toBe(Math.round(res.remainder * 10000) / 10000);
      expect(res.remainder).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("computePlateStack: per-side availability", () => {
  it("respects per-side plate limits and falls through to smaller plates", () => {
    // 90 lb per side with only one 45 available: 45 + 35 + 10.
    const res = computePlateStack(
      225,
      45,
      [
        { weight: 45, count: 1 },
        { weight: 35, count: 1 },
        { weight: 25, count: 1 },
        { weight: 10, count: 2 },
      ],
      "lbs",
    );
    expect(res.perSide).toEqual([
      { weight: 45, count: 1 },
      { weight: 35, count: 1 },
      { weight: 10, count: 1 },
    ]);
    expect(res.achieved).toBe(225);
    expect(res.remainder).toBe(0);
  });

  it("never exceeds an available count for any target", () => {
    const inventory = [
      { weight: 45, count: 2 },
      { weight: 25, count: 1 },
      { weight: 10, count: 3 },
      { weight: 5, count: 1 },
      { weight: 2.5, count: 1 },
    ];
    const limits = new Map(inventory.map((p) => [p.weight, p.count]));

    for (let step = 0; step <= 120; step++) {
      const target = 45 + 2.5 * step;
      const res = computePlateStack(target, 45, inventory, "lbs");
      for (const p of res.perSide) {
        expect(p.count, `${p.weight} at target ${target}`).toBeLessThanOrEqual(
          limits.get(p.weight) ?? 0,
        );
        expect(p.count).toBeGreaterThan(0);
      }
      // Rows are unique, so a plate cannot be split across two entries to dodge
      // its own limit.
      const seen = res.perSide.map((p) => p.weight);
      expect(new Set(seen).size).toBe(seen.length);
      expect(res.achieved).toBeLessThanOrEqual(target);
    }
  });

  it("caps at the whole inventory when the target outruns it", () => {
    const res = computePlateStack(1000, 45, [45], "lbs");
    // 477.5 per side, 10 plates of 45 is 450 and nothing smaller exists.
    expect(res.perSide).toEqual([{ weight: 45, count: 10 }]);
    expect(res.achieved).toBe(945);
    expect(res.remainder).toBe(55);
  });

  it("merges duplicate weights instead of emitting two rows", () => {
    const res = computePlateStack(
      225,
      45,
      [
        { weight: 45, count: 1 },
        { weight: 45, count: 1 },
      ],
      "lbs",
    );
    expect(res.perSide).toEqual([{ weight: 45, count: 2 }]);
    expect(res.achieved).toBe(225);
  });

  it("floors fractional counts and drops unusable plate entries", () => {
    const twoAndAHalf = computePlateStack(225, 45, [{ weight: 45, count: 2.9 }], "lbs");
    expect(twoAndAHalf.perSide).toEqual([{ weight: 45, count: 2 }]);
    expect(twoAndAHalf.achieved).toBe(225);

    const junk: PlateInput[] = [
      { weight: NaN, count: 2 },
      { weight: -10, count: 1 },
      { weight: 0, count: 4 },
      { weight: 45, count: 0 },
      { weight: 35, count: NaN },
      { weight: 25, count: 2 },
    ];
    const res = computePlateStack(145, 45, junk, "lbs");
    expect(res.perSide).toEqual([{ weight: 25, count: 2 }]);
    expect(res.achieved).toBe(145);
    expect(res.remainder).toBe(0);
  });

  it("treats an explicitly empty plate list as no plates at all", () => {
    const res = computePlateStack(225, 45, [], "lbs");
    expect(res.perSide).toEqual([]);
    expect(res.achieved).toBe(45);
    expect(res.remainder).toBe(180);
  });
});

describe("computePlateStack: degenerate inputs", () => {
  it("returns the bare bar when the target is below, at, or barely over the bar", () => {
    for (const target of [30, 45, 45.0000001]) {
      const res = computePlateStack(target, 45, DEFAULT_PLATES_LBS, "lbs");
      expect(res.perSide, `target ${target}`).toEqual([]);
      expect(res.achieved, `target ${target}`).toBe(45);
      expect(res.remainder, `target ${target}`).toBe(0);
    }
  });

  it("returns the bare bar for zero, negative and non-finite targets", () => {
    for (const target of [0, -100, NaN, Infinity, -Infinity]) {
      const res = computePlateStack(target, 45, DEFAULT_PLATES_LBS, "lbs");
      expect(res.perSide, `target ${target}`).toEqual([]);
      expect(res.achieved, `target ${target}`).toBe(45);
      expect(res.remainder, `target ${target}`).toBe(0);
      expect(Number.isNaN(res.achieved)).toBe(false);
    }
  });

  it("treats a missing, zero or negative bar as no bar rather than NaN", () => {
    for (const bar of [0, -45, NaN, Infinity]) {
      const res = computePlateStack(100, bar, DEFAULT_PLATES_LBS, "lbs");
      expect(res.achieved, `bar ${bar}`).toBe(100);
      expect(res.remainder, `bar ${bar}`).toBe(0);
      expect(res.perSide).toEqual([
        { weight: 45, count: 1 },
        { weight: 5, count: 1 },
      ]);
    }
  });

  it("never returns NaN for any combination of junk target and junk bar", () => {
    // A NaN reaching achieved renders on screen as the literal text "NaN", and
    // the bare-bar early return is the easiest place to leak the raw bar value.
    const junk = [NaN, Infinity, -Infinity, 0, -1, -45];
    for (const target of junk) {
      for (const bar of junk) {
        const res = computePlateStack(target, bar, DEFAULT_PLATES_LBS, "lbs");
        expect(Number.isNaN(res.achieved), `target ${target} bar ${bar}`).toBe(false);
        expect(Number.isFinite(res.achieved), `target ${target} bar ${bar}`).toBe(true);
        expect(Number.isNaN(res.remainder), `target ${target} bar ${bar}`).toBe(false);
        expect(res.perSide).toEqual([]);
      }
    }
    expect(computePlateStack(0, NaN).achieved).toBe(0);
    expect(computePlateStack(NaN, NaN).achieved).toBe(0);
    expect(computePlateStack(NaN, 45).achieved).toBe(45);
  });

  it("defaults to the lbs bar when barWeight is omitted", () => {
    const res = computePlateStack(135);
    expect(res.perSide).toEqual([{ weight: 45, count: 1 }]);
    expect(res.achieved).toBe(135);
  });
});

describe("computePlateStack: runaway protection", () => {
  it("terminates on an absurd target without exceeding the per-side cap", () => {
    for (const target of [1e6, 1e12, 1e308]) {
      const res = computePlateStack(target, 45, DEFAULT_PLATES_LBS, "lbs");
      const total = res.perSide.reduce((sum, p) => sum + p.count, 0);
      expect(total, `target ${target}`).toBeLessThanOrEqual(MAX_PLATES_PER_SIDE);
      expect(res.achieved).toBe(1845);
      expect(Number.isFinite(res.achieved)).toBe(true);
      // Infinity on screen is the failure this guards: the shortfall must stay
      // a real number even when the request is nonsense.
      expect(Number.isFinite(res.remainder), `remainder at ${target}`).toBe(true);
      expect(res.remainder).toBeGreaterThan(0);
    }
  });

  it("never emits an infinite count even when plate supply is unbounded", () => {
    const res = computePlateStack(1e9, 45, [45, 2.5], "lbs");
    for (const p of res.perSide) {
      expect(Number.isFinite(p.count)).toBe(true);
      expect(Number.isInteger(p.count)).toBe(true);
    }
  });
});
