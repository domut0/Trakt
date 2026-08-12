/**
 * Pure mathematical utilities for chart calculation: tick generation, linear
 * regression, calendar-day rolling averages, and gap segmentation.
 *
 * No React, no DOM, no store imports - strictly input-in, result-out so every
 * function can be thoroughly unit tested.
 */

export interface Point {
  ts: number;
  val: number;
  [key: string]: unknown;
}

/**
 * Computes 4 to 5 human-friendly "nice" rounded Y ticks using the 1/2/5 x 10^n
 * algorithm.
 *
 * Raw min/max bounds are extended to clean tick multiples so gridlines enclose
 * the entire dataset without placing data points directly on the chart edge.
 */
export function niceTicks(min: number, max: number, count: number = 5): number[] {
  let low = min;
  let high = max;

  if (low > high) {
    [low, high] = [high, low];
  }

  // Handle single-point or flat series by inventing a small symmetric margin
  // around the single value so the Y-axis still has vertical breathing room.
  if (low === high) {
    if (low === 0) {
      high = 1;
    } else {
      const margin = Math.abs(low) * 0.1 || 1;
      low = low - margin;
      high = high + margin;
    }
  }

  const range = high - low;
  const targetSegments = Math.max(1, count - 1);
  const rawStep = range / targetSegments;

  const exponent = Math.floor(Math.log10(rawStep));
  const fraction = rawStep / Math.pow(10, exponent);

  let niceFraction: number;
  if (fraction < 1.5) {
    niceFraction = 1;
  } else if (fraction < 3) {
    niceFraction = 2;
  } else if (fraction < 7) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

  const step = niceFraction * Math.pow(10, exponent);
  const tickMin = Math.floor(low / step) * step;
  const tickMax = Math.ceil(high / step) * step;

  const ticks: number[] = [];
  const decimals = Math.max(0, -exponent + 2);

  // Use fixed-precision rounding to prevent standard IEEE 754 float drift
  // (e.g. 0.30000000000000004) from polluting axis labels.
  let current = tickMin;
  while (current <= tickMax + step * 0.5) {
    ticks.push(Number(current.toFixed(decimals)));
    current += step;
  }

  return ticks;
}

/**
 * Fits a least-squares linear regression line (y = slope * ts + intercept) to
 * a series of points.
 *
 * Returns null when fewer than 2 points are provided or when all timestamps
 * are identical, since slope is undefined without X variation.
 */
export function linearRegression<T extends Point>(
  points: readonly T[],
): { slope: number; intercept: number } | null {
  if (points.length < 2) return null;

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.ts;
    sumY += p.val;
  }

  const n = points.length;
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let denominator = 0;
  for (const p of points) {
    const dx = p.ts - meanX;
    const dy = p.val - meanY;
    numerator += dx * dy;
    denominator += dx * dx;
  }

  if (denominator === 0) return null;

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;

  return { slope, intercept };
}

/**
 * Calculates a true calendar-day trailing rolling average over `windowDays`.
 *
 * Unlike a trailing-N-points window which distorts averages across logging
 * gaps, this window spans `[p.ts - (windowDays - 1) * 86400000, p.ts]`. Missing
 * days are omitted from both sum and count rather than assumed to be zero.
 */
export function rollingAverage<T extends Point>(points: readonly T[], windowDays: number): T[] {
  if (points.length === 0) return [];

  const windowMs = (windowDays - 1) * 86400000;

  return points.map((p) => {
    const windowStart = p.ts - windowMs;
    let sum = 0;
    let count = 0;

    for (const q of points) {
      if (q.ts >= windowStart && q.ts <= p.ts) {
        sum += q.val;
        count += 1;
      }
    }

    const avgVal = count > 0 ? sum / count : p.val;
    return { ...p, val: avgVal };
  });
}

/**
 * Groups consecutive points into segments where adjacent points are separated by
 * at most `maxGapDays` days.
 *
 * Gaps larger than `maxGapDays` cause a new segment to start, allowing the SVG
 * line renderer to draw solid paths within dense clusters and faded dashed lines
 * across missing periods.
 */
export function splitIntoSegments<T extends Point>(
  points: readonly T[],
  maxGapDays: number = 2,
): T[][] {
  if (points.length === 0) return [];

  const maxGapMs = maxGapDays * 86400000;
  const segments: T[][] = [];
  let currentSegment: T[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    if (curr.ts - prev.ts <= maxGapMs) {
      currentSegment.push(curr);
    } else {
      segments.push(currentSegment);
      currentSegment = [curr];
    }
  }

  segments.push(currentSegment);
  return segments;
}

/**
 * Calculates the delta between the average of the current window and the average
 * of the immediately preceding window of equal duration.
 *
 * Returns null if the prior window contains no data points.
 */
// Takes only the `val` half of a Point, not a whole Point: this compares two
// window AVERAGES and never looks at a timestamp, so demanding `ts` would force
// callers (and tests) to invent data the function cannot use.
export function computeWindowChange(
  currentPoints: readonly Pick<Point, "val">[],
  priorPoints: readonly Pick<Point, "val">[],
): number | null {
  if (currentPoints.length === 0 || priorPoints.length === 0) return null;

  const currentSum = currentPoints.reduce((acc, p) => acc + p.val, 0);
  const priorSum = priorPoints.reduce((acc, p) => acc + p.val, 0);

  const currentAvg = currentSum / currentPoints.length;
  const priorAvg = priorSum / priorPoints.length;

  return currentAvg - priorAvg;
}
