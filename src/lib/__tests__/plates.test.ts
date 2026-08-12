import { describe, expect, it } from "vitest";
import {
  computePlateStack,
  DEFAULT_BAR_KG,
  DEFAULT_BAR_LBS,
  DEFAULT_PLATES_KG,
  DEFAULT_PLATES_LBS,
} from "../plates";

describe("plates module constants", () => {
  it("exports correct default values for lbs and kg", () => {
    expect(DEFAULT_BAR_LBS).toBe(45);
    expect(DEFAULT_BAR_KG).toBe(20);
    expect(DEFAULT_PLATES_LBS).toEqual([45, 35, 25, 10, 5, 2.5]);
    expect(DEFAULT_PLATES_KG).toEqual([25, 20, 15, 10, 5, 2.5, 1.25]);
  });
});

describe("computePlateStack", () => {
  it("returns empty perSide and achieved equal to bar when target is below bar weight", () => {
    const res = computePlateStack(30, 45, DEFAULT_PLATES_LBS, "lbs");
    expect(res.perSide).toEqual([]);
    expect(res.achieved).toBe(45);
    expect(res.remainder).toBe(0);
  });

  it("returns empty perSide and achieved equal to bar when target equals bar weight", () => {
    const res = computePlateStack(45, 45, DEFAULT_PLATES_LBS, "lbs");
    expect(res.perSide).toEqual([]);
    expect(res.achieved).toBe(45);
    expect(res.remainder).toBe(0);
  });

  it("computes a standard 135 lb load (45 lb bar + one 45 lb plate per side)", () => {
    const res = computePlateStack(135, 45, DEFAULT_PLATES_LBS, "lbs");
    expect(res.perSide).toEqual([{ weight: 45, count: 1 }]);
    expect(res.achieved).toBe(135);
    expect(res.remainder).toBe(0);
  });

  it("computes a 225 lb load (45 lb bar + two 45 lb plates per side)", () => {
    const res = computePlateStack(225, 45, DEFAULT_PLATES_LBS, "lbs");
    expect(res.perSide).toEqual([{ weight: 45, count: 2 }]);
    expect(res.achieved).toBe(225);
    expect(res.remainder).toBe(0);
  });

  it("computes kg loads with 1.25 kg fractional plates", () => {
    // 20 kg bar + 2 * (1.25 kg) = 22.5 kg total
    const res = computePlateStack(22.5, 20, DEFAULT_PLATES_KG, "kg");
    expect(res.perSide).toEqual([{ weight: 1.25, count: 1 }]);
    expect(res.achieved).toBe(22.5);
    expect(res.remainder).toBe(0);
  });

  it("handles fractional 2.5 lb plates accurately", () => {
    // 45 lb bar + 2 * (2.5 lb) = 50 lb total
    const res = computePlateStack(50, 45, DEFAULT_PLATES_LBS, "lbs");
    expect(res.perSide).toEqual([{ weight: 2.5, count: 1 }]);
    expect(res.achieved).toBe(50);
    expect(res.remainder).toBe(0);
  });

  it("surfaces remainder for odd targets that cannot be made exactly", () => {
    // Target 137 lbs with 45 lb bar: 92 lbs needed total (46 per side).
    // Heaviest load per side with standard plates is 45 lbs (total 135 lbs).
    // Remainder is 2 lbs.
    const res = computePlateStack(137, 45, DEFAULT_PLATES_LBS, "lbs");
    expect(res.perSide).toEqual([{ weight: 45, count: 1 }]);
    expect(res.achieved).toBe(135);
    expect(res.remainder).toBe(2);
  });

  it("respects per-side plate availability limits", () => {
    // Target 225 lbs needs 90 lbs per side.
    // If only one 45 lb plate per side is available, it uses 45, 35, 10.
    const limitedPlates = [
      { weight: 45, count: 1 },
      { weight: 35, count: 1 },
      { weight: 25, count: 1 },
      { weight: 10, count: 2 },
    ];
    const res = computePlateStack(225, 45, limitedPlates, "lbs");
    expect(res.perSide).toEqual([
      { weight: 45, count: 1 },
      { weight: 35, count: 1 },
      { weight: 10, count: 1 },
    ]);
    expect(res.achieved).toBe(225);
    expect(res.remainder).toBe(0);
  });

  it("sorts unsorted input plate arrays descending automatically", () => {
    const unsorted = [10, 45, 2.5, 25, 35, 5];
    const res = computePlateStack(135, 45, unsorted, "lbs");
    expect(res.perSide).toEqual([{ weight: 45, count: 1 }]);
    expect(res.achieved).toBe(135);
  });

  it("handles non-finite or invalid target weights safely", () => {
    const res = computePlateStack(NaN, 45, DEFAULT_PLATES_LBS, "lbs");
    expect(res.perSide).toEqual([]);
    expect(res.achieved).toBe(45);
    expect(res.remainder).toBe(0);
  });
});
