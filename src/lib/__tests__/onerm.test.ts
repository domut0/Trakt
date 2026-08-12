import { describe, expect, it } from "vitest";
import { brzycki, epley, estimate1RM, percentageTable } from "../onerm";

describe("epley formula", () => {
  it("returns weight directly when reps equal 1 (no inflation)", () => {
    expect(epley(225, 1)).toBe(225);
    expect(epley(100, 1)).toBe(100);
  });

  it("calculates estimated 1RM for standard rep counts", () => {
    // 100 * (1 + 5/30) = 116.666... rounded to 1 decimal = 116.7
    expect(epley(100, 5)).toBe(116.7);
    // 200 * (1 + 10/30) = 266.666... rounded to 1 decimal = 266.7
    expect(epley(200, 10)).toBe(266.7);
  });

  it("returns 0 for zero or negative inputs", () => {
    expect(epley(0, 5)).toBe(0);
    expect(epley(100, 0)).toBe(0);
    expect(epley(-50, 5)).toBe(0);
  });
});

describe("brzycki formula", () => {
  it("returns weight directly when reps equal 1 (no inflation)", () => {
    expect(brzycki(225, 1)).toBe(225);
    expect(brzycki(100, 1)).toBe(100);
  });

  it("calculates estimated 1RM for standard rep counts", () => {
    // 100 * (36 / (37 - 5)) = 100 * (36 / 32) = 112.5
    expect(brzycki(100, 5)).toBe(112.5);
  });

  it("guards against division by zero and negative values at high reps", () => {
    // Reps = 37 would make denominator (37 - 37) = 0.
    // Reps are clamped to 36, giving denominator 1 -> 100 * (36 / 1) = 3600.
    expect(brzycki(100, 37)).toBe(3600);
    expect(brzycki(100, 50)).toBe(3600);
    expect(Number.isFinite(brzycki(100, 100))).toBe(true);
    expect(brzycki(100, 100)).toBeGreaterThan(0);
  });

  it("returns 0 for zero or negative inputs", () => {
    expect(brzycki(0, 5)).toBe(0);
    expect(brzycki(100, 0)).toBe(0);
  });
});

describe("estimate1RM", () => {
  it("returns epley, brzycki and average estimates", () => {
    const res = estimate1RM(100, 5);
    expect(res.epley).toBe(116.7);
    expect(res.brzycki).toBe(112.5);
    // Average of 116.7 and 112.5 = 114.6
    expect(res.average).toBe(114.6);
  });

  it("returns weight for all metrics when reps equal 1", () => {
    const res = estimate1RM(315, 1);
    expect(res.epley).toBe(315);
    expect(res.brzycki).toBe(315);
    expect(res.average).toBe(315);
  });
});

describe("percentageTable", () => {
  it("generates rows for 95 down to 60 percent with weights rounded to nearest 2.5", () => {
    const table = percentageTable(315);
    expect(table).toHaveLength(8);

    const percentages = table.map((r) => r.percentage);
    expect(percentages).toEqual([95, 90, 85, 80, 75, 70, 65, 60]);

    // 315 * 0.95 = 299.25 -> rounded to 2.5 is 300
    expect(table[0].weight).toBe(300);
    // 315 * 0.90 = 283.5 -> rounded to 2.5 is 282.5
    expect(table[1].weight).toBe(282.5);
    // 315 * 0.85 = 267.75 -> rounded to 2.5 is 267.5
    expect(table[2].weight).toBe(267.5);
  });

  it("includes valid rep range strings with standard hyphens", () => {
    const table = percentageTable(100);
    expect(table[0].reps).toBe("1-2");
    expect(table[1].reps).toBe("2-4");
    expect(table[2].reps).toBe("4-6");

    for (const row of table) {
      expect(row.reps).not.toContain("—");
      expect(row.reps).not.toContain("–");
    }
  });

  it("returns 0 weights for invalid 1RM inputs", () => {
    const table = percentageTable(0);
    expect(table.every((r) => r.weight === 0)).toBe(true);
  });
});
