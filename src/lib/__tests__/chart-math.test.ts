import { describe, expect, it } from "vitest";
import {
  computeWindowChange,
  linearRegression,
  niceTicks,
  rollingAverage,
  splitIntoSegments,
} from "../chart-math";

describe("niceTicks", () => {
  it("generates rounded, clean tick intervals covering the data range", () => {
    const ticks = niceTicks(172.4, 188.1, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks[0]).toBeLessThanOrEqual(172.4);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(188.1);
    const step = ticks[1] - ticks[0];
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 5);
    }
  });

  it("handles large scale metrics like daily steps cleanly", () => {
    const ticks = niceTicks(2150, 8900, 5);
    expect(ticks[0]).toBeLessThanOrEqual(2150);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(8900);
    const step = ticks[1] - ticks[0];
    expect(step % 100).toBe(0);
  });

  it("handles flat or single point series by expanding bounds symmetrically", () => {
    const ticks = niceTicks(180, 180, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]).toBeLessThan(180);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(180);
  });

  it("handles zero bounded series", () => {
    const ticks = niceTicks(0, 0, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]).toBeLessThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(0);
  });
});

describe("linearRegression", () => {
  it("fits a line to perfectly collinear points", () => {
    const DAY = 86400000;
    const base = 1700000000000;
    const points = [
      { ts: base, val: 10 },
      { ts: base + DAY, val: 20 },
      { ts: base + DAY * 2, val: 30 },
    ];
    const res = linearRegression(points);
    expect(res).not.toBeNull();
    if (res) {
      expect(res.slope * DAY).toBeCloseTo(10, 5);
    }
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
});

describe("rollingAverage", () => {
  const DAY = 86400000;
  const base = 100000;

  it("averages over a trailing 7 calendar-day window", () => {
    const points = Array.from({ length: 7 }, (_, i) => ({
      ts: base + i * DAY,
      val: (i + 1) * 10,
    }));
    const avg = rollingAverage(points, 7);
    expect(avg).toHaveLength(7);
    expect(avg[0].val).toBe(10);
    expect(avg[1].val).toBe(15);
    expect(avg[6].val).toBe(40);
  });

  it("respects calendar day gaps by averaging only recorded days in the trailing window", () => {
    const points = [
      { ts: base, val: 10 },
      { ts: base + 6 * DAY, val: 70 },
      { ts: base + 10 * DAY, val: 100 },
    ];
    const avg = rollingAverage(points, 7);
    expect(avg[0].val).toBe(10);
    expect(avg[1].val).toBe(40);
    expect(avg[2].val).toBe(85);
  });

  it("returns empty array when input is empty", () => {
    expect(rollingAverage([], 7)).toEqual([]);
  });
});

describe("splitIntoSegments", () => {
  const DAY = 86400000;
  const base = 100000;

  it("groups contiguous days within maxGapDays into a single segment", () => {
    const points = [
      { ts: base, val: 10 },
      { ts: base + 1 * DAY, val: 20 },
      { ts: base + 2 * DAY, val: 30 },
    ];
    const segments = splitIntoSegments(points, 2);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(3);
  });

  it("splits segments when a gap exceeds maxGapDays", () => {
    const points = [
      { ts: base, val: 10 },
      { ts: base + 1 * DAY, val: 20 },
      { ts: base + 5 * DAY, val: 30 },
      { ts: base + 6 * DAY, val: 40 },
    ];
    const segments = splitIntoSegments(points, 2);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual([
      { ts: base, val: 10 },
      { ts: base + 1 * DAY, val: 20 },
    ]);
    expect(segments[1]).toEqual([
      { ts: base + 5 * DAY, val: 30 },
      { ts: base + 6 * DAY, val: 40 },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(splitIntoSegments([], 2)).toEqual([]);
  });
});

describe("computeWindowChange", () => {
  it("calculates the delta between current and prior window averages", () => {
    const current = [{ val: 180 }, { val: 184 }];
    const prior = [{ val: 186 }, { val: 188 }];
    expect(computeWindowChange(current, prior)).toBe(-5);
  });

  it("returns null when either window is empty", () => {
    expect(computeWindowChange([{ val: 100 }], [])).toBeNull();
    expect(computeWindowChange([], [{ val: 100 }])).toBeNull();
  });
});
