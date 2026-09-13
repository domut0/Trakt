import { describe, expect, it } from "vitest";
import {
  computeWindowChange,
  linearRegression,
  niceTicks,
  rollingAverage,
  splitIntoSegments,
  niceCeil,
  tickDecimals,
} from "../chart-math";

const DAY = 86400000;

/**
 * A point anchored to LOCAL midnight, exactly how charts.tsx builds its
 * timestamps from a "yyyy-MM-dd" day key. Tests that care about calendar
 * behaviour must use this rather than adding DAY repeatedly, because two
 * consecutive local midnights are 23 or 25 hours apart across a
 * daylight-saving transition.
 */
const day = (y: number, m: number, d: number, val: number) => ({
  ts: new Date(y, m - 1, d).getTime(),
  val,
});

const mean = (nums: number[]) => nums.reduce((a, b) => a + b, 0) / nums.length;

describe("niceTicks", () => {
  it("generates rounded, clean tick intervals covering the data range", () => {
    expect(niceTicks(172.4, 188.1, 5)).toEqual([170, 175, 180, 185, 190]);
  });

  it("handles large scale metrics like daily steps cleanly", () => {
    expect(niceTicks(2150, 8900, 5)).toEqual([2000, 4000, 6000, 8000, 10000]);
  });

  it("handles flat or single point series by expanding bounds symmetrically", () => {
    expect(niceTicks(180, 180, 5)).toEqual([170, 175, 180, 185, 190]);
  });

  it("expands a zero bounded series upward only", () => {
    // Every metric on this page is a count, so an axis dipping below zero would
    // imply negative calories.
    const ticks = niceTicks(0, 0, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(0);
  });

  it("keeps a realistic bodyweight range readable instead of over-ticking it", () => {
    // The 1/2/5 step is 0.3 before rounding. Rounding it DOWN to 0.2 and then
    // extending both bounds is what produced 6 gridlines for a 1.2 lb spread.
    expect(niceTicks(180.2, 181.4, 5)).toEqual([180, 180.5, 181, 181.5]);
  });

  it("does not invent a spurious tick from float division drift", () => {
    // 180.2 / 0.2 evaluates to 900.9999999999999, so a naive Math.floor snaps
    // the axis a whole step too low and wastes a quarter of the plot height.
    expect(niceTicks(180.2, 180.8, 5)).toEqual([180.2, 180.4, 180.6, 180.8]);
  });

  it("handles a tiny fractional range without duplicate or drifting values", () => {
    const ticks = niceTicks(180.2, 180.4, 5);
    expect(ticks).toEqual([180.2, 180.25, 180.3, 180.35, 180.4]);
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it("handles negative and mixed-sign ranges", () => {
    expect(niceTicks(-12, -3, 5)).toEqual([-15, -10, -5, 0]);
    expect(niceTicks(-5, 5, 5)).toEqual([-5, 0, 5]);
  });

  it("handles a huge range", () => {
    expect(niceTicks(0, 1000000, 5)).toEqual([0, 500000, 1000000]);
  });

  it("orders reversed bounds", () => {
    expect(niceTicks(200, 100, 5)).toEqual([100, 150, 200]);
  });

  it("always returns at least two finite ascending ticks that enclose the data", () => {
    const cases: [number, number][] = [
      [172.4, 188.1],
      [180.2, 180.4],
      [180, 180],
      [0, 0],
      [-12, -3],
      [-5, 5],
      [0, 1000000],
      [2150, 8900],
      [0.5, 0.5],
      [-1000000, 1000000],
      [1800, 3200],
    ];
    for (const [min, max] of cases) {
      const ticks = niceTicks(min, max, 5);
      expect(ticks.length, `${min}..${max}`).toBeGreaterThanOrEqual(2);
      expect(ticks.length, `${min}..${max}`).toBeLessThanOrEqual(7);
      expect(
        ticks.every((t) => Number.isFinite(t)),
        `${min}..${max}`,
      ).toBe(true);
      expect(ticks[0], `${min}..${max}`).toBeLessThanOrEqual(min);
      expect(ticks[ticks.length - 1], `${min}..${max}`).toBeGreaterThanOrEqual(max);
      // A zero-width domain would make every plotted Y coordinate NaN.
      expect(ticks[ticks.length - 1], `${min}..${max}`).toBeGreaterThan(ticks[0]);
      const step = ticks[1] - ticks[0];
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 6);
      }
    }
  });

  it("survives non-finite bounds without emitting NaN ticks", () => {
    for (const ticks of [niceTicks(NaN, NaN), niceTicks(NaN, 5), niceTicks(0, Infinity)]) {
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks.every((t) => Number.isFinite(t))).toBe(true);
      expect(ticks[ticks.length - 1]).toBeGreaterThan(ticks[0]);
    }
  });
});

describe("tickDecimals", () => {
  it("derives label precision from the tick step", () => {
    expect(tickDecimals([2000, 4000, 6000])).toBe(0);
    expect(tickDecimals([180, 180.5, 181])).toBe(1);
    expect(tickDecimals([180.2, 180.25, 180.3])).toBe(2);
    expect(tickDecimals([180.2, 180.4, 180.6])).toBe(1);
  });

  it("returns 0 when there is no step to measure", () => {
    expect(tickDecimals([])).toBe(0);
    expect(tickDecimals([5])).toBe(0);
  });

  it("gives every tick in a fractional axis a distinct label", () => {
    const ticks = niceTicks(180.2, 180.4, 5);
    const decimals = tickDecimals(ticks);
    const labels = ticks.map((t) => t.toFixed(decimals));
    expect(new Set(labels).size).toBe(ticks.length);
  });
});

describe("linearRegression", () => {
  const base = 1700000000000;

  it("fits a line to perfectly collinear points", () => {
    const points = [
      { ts: base, val: 10 },
      { ts: base + DAY, val: 20 },
      { ts: base + DAY * 2, val: 30 },
    ];
    const res = linearRegression(points);
    expect(res).not.toBeNull();
    expect(res!.slope * DAY).toBeCloseTo(10, 5);
  });

  it("returns a slope per millisecond, so a weekly rate is slope * 604800000", () => {
    // 1 lb lost per week, sampled daily over 4 weeks.
    const points = Array.from({ length: 29 }, (_, i) => ({
      ts: base + i * DAY,
      val: 200 - i / 7,
    }));
    const res = linearRegression(points);
    expect(res).not.toBeNull();
    expect(res!.slope * 7 * 86400000).toBeCloseTo(-1, 9);
    expect(7 * 86400000).toBe(604800000);
  });

  it("recovers the intercept at a real timestamp", () => {
    const points = [
      { ts: base, val: 100 },
      { ts: base + 10 * DAY, val: 120 },
    ];
    const res = linearRegression(points)!;
    expect(res.slope * base + res.intercept).toBeCloseTo(100, 6);
    expect(res.slope * (base + 10 * DAY) + res.intercept).toBeCloseTo(120, 6);
  });

  it("returns null when fewer than 2 points are provided", () => {
    expect(linearRegression([])).toBeNull();
    expect(linearRegression([{ ts: 100, val: 50 }])).toBeNull();
  });

  it("returns null when all timestamps are identical to avoid division by zero", () => {
    const points = [
      { ts: 1000, val: 10 },
      { ts: 1000, val: 20 },
    ];
    expect(linearRegression(points)).toBeNull();
  });

  it("returns a zero slope for a flat series rather than null", () => {
    const points = [
      { ts: base, val: 180 },
      { ts: base + DAY, val: 180 },
      { ts: base + 2 * DAY, val: 180 },
    ];
    const res = linearRegression(points)!;
    expect(res.slope).toBe(0);
    expect(res.intercept).toBeCloseTo(180, 6);
  });
});

describe("rollingAverage", () => {
  it("averages over a trailing 7 calendar-day window", () => {
    const points = Array.from({ length: 7 }, (_, i) => ({
      ts: 100000 + i * DAY,
      val: (i + 1) * 10,
    }));
    const avg = rollingAverage(points, 7);
    expect(avg).toHaveLength(7);
    expect(avg[0].val).toBe(10);
    expect(avg[1].val).toBe(15);
    expect(avg[6].val).toBe(40);
  });

  it("respects calendar day gaps by averaging only recorded days in the trailing window", () => {
    const points = [day(2025, 6, 1, 10), day(2025, 6, 7, 70), day(2025, 6, 11, 100)];
    const avg = rollingAverage(points, 7);
    expect(avg[0].val).toBe(10);
    // Jun 1 and Jun 7 are 7 calendar days inclusive, so both count.
    expect(avg[1].val).toBe(40);
    // Window Jun 5 to Jun 11 drops Jun 1 entirely.
    expect(avg[2].val).toBe(85);
  });

  it("does not degrade into a trailing-N-points window when days are missing", () => {
    const points = [
      day(2025, 6, 1, 10),
      day(2025, 6, 2, 20),
      day(2025, 6, 3, 30),
      day(2025, 6, 20, 500),
    ];
    const avg = rollingAverage(points, 7);
    // Nothing else falls in Jun 14 to Jun 20, so the last point averages only
    // itself. A trailing-3-points window would have returned 183.33.
    expect(avg[3].val).toBe(500);
    expect(avg[2].val).toBe(20);
  });

  it("keeps a full 7 calendar days across a daylight-saving transition", () => {
    // Nov 2 2025 is the US fall-back date: local midnights around it are 25
    // hours apart, so a window measured as 6 * 86400000 ms silently drops the
    // oldest day and reports a 6 day average.
    const vals = [10, 20, 30, 40, 50, 60, 70];
    const week = [
      day(2025, 10, 29, vals[0]),
      day(2025, 10, 30, vals[1]),
      day(2025, 10, 31, vals[2]),
      day(2025, 11, 1, vals[3]),
      day(2025, 11, 2, vals[4]),
      day(2025, 11, 3, vals[5]),
      day(2025, 11, 4, vals[6]),
    ];
    const avg = rollingAverage(week, 7);
    expect(avg[6].val).toBeCloseTo(mean(vals), 10);

    // And the spring-forward direction, where days are 23 hours apart.
    const springVals = [1, 2, 3, 4, 5, 6, 7];
    const spring = [
      day(2026, 3, 6, springVals[0]),
      day(2026, 3, 7, springVals[1]),
      day(2026, 3, 8, springVals[2]),
      day(2026, 3, 9, springVals[3]),
      day(2026, 3, 10, springVals[4]),
      day(2026, 3, 11, springVals[5]),
      day(2026, 3, 12, springVals[6]),
    ];
    expect(rollingAverage(spring, 7)[6].val).toBeCloseTo(mean(springVals), 10);
  });

  it("treats a 1 day window as the point's own day", () => {
    const points = [day(2025, 6, 1, 10), day(2025, 6, 2, 20)];
    const avg = rollingAverage(points, 1);
    expect(avg.map((p) => p.val)).toEqual([10, 20]);
  });

  it("averages same-day duplicates together", () => {
    const points = [day(2025, 6, 1, 10), day(2025, 6, 1, 30)];
    expect(rollingAverage(points, 7).map((p) => p.val)).toEqual([20, 20]);
  });

  it("preserves fields other than val", () => {
    const points = [
      { ...day(2025, 6, 1, 10), isUntracked: true },
      { ...day(2025, 6, 2, 30), isUntracked: false },
    ];
    const avg = rollingAverage(points, 7);
    expect(avg[0].isUntracked).toBe(true);
    expect(avg[1].isUntracked).toBe(false);
    expect(avg[1].ts).toBe(points[1].ts);
    expect(avg[1].val).toBe(20);
  });

  it("returns empty array when input is empty", () => {
    expect(rollingAverage([], 7)).toEqual([]);
  });

  it("returns the single value for a one point series", () => {
    expect(rollingAverage([day(2025, 6, 1, 42)], 7).map((p) => p.val)).toEqual([42]);
  });
});

describe("splitIntoSegments", () => {
  it("groups contiguous days within maxGapDays into a single segment", () => {
    const points = [day(2025, 6, 1, 10), day(2025, 6, 2, 20), day(2025, 6, 3, 30)];
    const segments = splitIntoSegments(points, 2);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(3);
  });

  it("keeps a gap of exactly maxGapDays in one segment", () => {
    const points = [day(2025, 6, 1, 10), day(2025, 6, 3, 30)];
    expect(splitIntoSegments(points, 2)).toHaveLength(1);
  });

  it("splits one calendar day past maxGapDays", () => {
    const points = [day(2025, 6, 1, 10), day(2025, 6, 4, 30)];
    const segments = splitIntoSegments(points, 2);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(1);
    expect(segments[1]).toHaveLength(1);
  });

  it("measures the boundary in calendar days, not milliseconds", () => {
    // Nov 2 to Nov 4 2025 is 49 hours in the US, which a millisecond comparison
    // reads as more than 2 days and splits, unlike the identical June case.
    expect(splitIntoSegments([day(2025, 11, 2, 1), day(2025, 11, 4, 2)], 2)).toHaveLength(1);
    expect(splitIntoSegments([day(2025, 6, 2, 1), day(2025, 6, 4, 2)], 2)).toHaveLength(1);
  });

  it("splits segments when a gap exceeds maxGapDays", () => {
    const points = [
      day(2025, 6, 1, 10),
      day(2025, 6, 2, 20),
      day(2025, 6, 6, 30),
      day(2025, 6, 7, 40),
    ];
    const segments = splitIntoSegments(points, 2);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual([points[0], points[1]]);
    expect(segments[1]).toEqual([points[2], points[3]]);
  });

  it("keeps duplicate timestamps in the same segment", () => {
    const points = [day(2025, 6, 1, 10), day(2025, 6, 1, 20), day(2025, 6, 1, 30)];
    const segments = splitIntoSegments(points, 2);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(3);
  });

  it("returns one single-point segment for a one point series", () => {
    const points = [day(2025, 6, 1, 10)];
    expect(splitIntoSegments(points, 2)).toEqual([points]);
  });

  it("returns empty array for empty input", () => {
    expect(splitIntoSegments([], 2)).toEqual([]);
  });

  it("never loses or reorders points", () => {
    const points = [
      day(2025, 6, 1, 10),
      day(2025, 6, 2, 20),
      day(2025, 6, 9, 30),
      day(2025, 6, 10, 40),
      day(2025, 7, 1, 50),
    ];
    const segments = splitIntoSegments(points, 2);
    expect(segments.flat()).toEqual(points);
    expect(segments).toHaveLength(3);
  });
});

describe("computeWindowChange", () => {
  it("calculates the delta between current and prior window averages", () => {
    const current = [{ val: 180 }, { val: 184 }];
    const prior = [{ val: 186 }, { val: 188 }];
    expect(computeWindowChange(current, prior)).toBe(-5);
  });

  it("compares averages, not sums, across unequal point counts", () => {
    const current = [{ val: 10 }, { val: 20 }, { val: 30 }];
    const prior = [{ val: 10 }];
    expect(computeWindowChange(current, prior)).toBe(10);
  });

  it("returns 0 for identical windows, including all-zero data", () => {
    expect(computeWindowChange([{ val: 0 }, { val: 0 }], [{ val: 0 }])).toBe(0);
  });

  it("returns null when either window is empty", () => {
    expect(computeWindowChange([{ val: 100 }], [])).toBeNull();
    expect(computeWindowChange([], [{ val: 100 }])).toBeNull();
  });
});

describe("niceCeil", () => {
  it("rounds up to the next step", () => {
    expect(niceCeil(2180, 500)).toBe(2500);
    expect(niceCeil(12480, 2000)).toBe(14000);
  });

  it("leaves a value already on a step alone", () => {
    // Otherwise a 20,000-step goal would scale the axis to 22,000 and never
    // let a bar reach its own line.
    expect(niceCeil(20000, 2000)).toBe(20000);
  });

  it("holds the floor for a sparse chart", () => {
    // One 300-calorie day must not scale the axis to itself and draw as a
    // full-height bar.
    expect(niceCeil(300, 500, 2000)).toBe(2000);
    expect(niceCeil(0, 500)).toBe(500);
  });

  it("treats nothing-to-scale as the floor rather than as NaN", () => {
    expect(niceCeil(Number.NaN, 500, 1500)).toBe(1500);
    expect(niceCeil(-100, 500)).toBe(500);
  });
});
