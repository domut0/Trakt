/**
 * Pure mathematical utilities for chart calculation: tick generation, linear
 * regression, calendar-day rolling averages, and gap segmentation.
 *
 * No React, no DOM, no store imports - strictly input-in, result-out so every
 * function can be thoroughly unit tested. `Date` is used only to read the local
 * calendar fields of a timestamp, which is language, not platform.
 */

export interface Point {
  ts: number;
  val: number;
  [key: string]: unknown;
}

const MS_PER_DAY = 86400000;

/**
 * Relative slack used when snapping a bound onto a tick multiple. Without it,
 * 180.2 / 0.2 evaluates to 900.9999999999999 and `Math.floor` invents a whole
 * spurious tick below the data.
 */
const SNAP_EPSILON = 1e-9;

/**
 * The local calendar day a timestamp falls on, as a day count.
 *
 * Deliberately NOT `Math.floor(ts / MS_PER_DAY)`: consecutive local midnights
 * are 23 or 25 hours apart across a daylight-saving transition, so any window
 * or gap measured in raw milliseconds silently gains or loses a day twice a
 * year. Re-reading the local Y/M/D and re-anchoring it to UTC makes the
 * difference between two of these indices an exact calendar day count in every
 * timezone.
 */
function localDayIndex(ts: number): number {
  const d = new Date(ts);
  const y = d.getFullYear();
  if (!Number.isFinite(y)) return NaN;
  return Math.round(Date.UTC(y, d.getMonth(), d.getDate()) / MS_PER_DAY);
}

/**
 * Number of decimal places needed to write a 1/2/5 x 10^n tick step exactly.
 */
function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.min(15, Math.max(0, -Math.floor(Math.log10(step) + SNAP_EPSILON)));
}

/**
 * Decimal places an axis should render its labels with, derived from the
 * spacing of its own ticks.
 *
 * Formatting each tick independently is what produces an axis reading
 * "180.2 | 180.2 | 180.3 | 180.3": a fixed one-decimal format cannot separate
 * ticks 0.05 apart. Callers pass the tick array back in and get a single
 * precision to use for every label.
 */
export function tickDecimals(ticks: readonly number[]): number {
  if (ticks.length < 2) return 0;
  return stepDecimals(Math.abs(ticks[1] - ticks[0]));
}

/**
 * Computes human-friendly "nice" rounded Y ticks using the 1/2/5 x 10^n
 * algorithm, targeting roughly `count` of them.
 *
 * Raw min/max bounds are extended to clean tick multiples so gridlines enclose
 * the entire dataset without placing data points directly on the chart edge.
 * The returned array always holds at least two distinct, finite, ascending
 * values, so callers can use `ticks[0]` and the last tick as a non-degenerate
 * Y domain without further guarding.
 */
export function niceTicks(min: number, max: number, count: number = 5): number[] {
  let low = Number.isFinite(min) ? min : 0;
  let high = Number.isFinite(max) ? max : 0;

  if (low > high) {
    [low, high] = [high, low];
  }

  // Handle single-point or flat series by inventing a small symmetric margin
  // around the single value so the Y-axis still has vertical breathing room.
  // An all-zero series grows upward only: every metric here is a count, and an
  // axis running below zero would imply negative calories.
  if (low === high) {
    if (low === 0) {
      high = 1;
    } else {
      const margin = Math.abs(low) * 0.05;
      low -= margin;
      high += margin;
    }
  }

  // A margin proportional to the value cannot rescue 0 (or a denormal), and a
  // zero-width domain makes every downstream step 0 or NaN.
  if (!(high > low)) {
    low -= 0.5;
    high += 0.5;
  }

  const targetSegments = Math.max(1, Math.round(count) - 1);
  const rawStep = (high - low) / targetSegments;
  const exponent = Math.floor(Math.log10(rawStep));
  const pow = Math.pow(10, exponent);
  const fraction = rawStep / pow;

  // Rounds the step UP to the next 1/2/5 multiple rather than to the nearest.
  // Rounding down (a raw step of 1.4 becoming 1) stretches the axis past the
  // requested tick count, and extending both bounds afterwards can then double
  // it: a 0.2 lb bodyweight range came out as 6 gridlines.
  let niceFraction: number;
  if (fraction <= 1 + SNAP_EPSILON) {
    niceFraction = 1;
  } else if (fraction <= 2 + SNAP_EPSILON) {
    niceFraction = 2;
  } else if (fraction <= 5 + SNAP_EPSILON) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

  const step = niceFraction * pow;
  if (!Number.isFinite(step) || step <= 0) {
    return [low, high];
  }

  const decimals = stepDecimals(step);
  const firstIndex = Math.floor(low / step + SNAP_EPSILON);
  const lastIndex = Math.ceil(high / step - SNAP_EPSILON);

  const ticks: number[] = [];
  // Multiply out from the tick index instead of accumulating `current += step`,
  // which drifts (0.1 + 0.2 = 0.30000000000000004) across a long axis.
  for (let i = firstIndex; i <= lastIndex && ticks.length < 64; i++) {
    ticks.push(Number((i * step).toFixed(decimals)));
  }

  if (ticks.length < 2) return [low, high];
  return ticks;
}

/**
 * Fits a least-squares linear regression line (y = slope * ts + intercept) to
 * a series of points.
 *
 * `slope` is per MILLISECOND, because that is the unit of `ts`. Callers wanting
 * a per-week rate multiply by 7 * 86400000.
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

  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;

  return { slope, intercept };
}

/**
 * The mean of a window with its single highest and lowest readings discarded.
 *
 * This is a cuber's average of five, and it is here for the same reason it
 * exists there: one bad solve should not be allowed to describe the session.
 * A day on the scale after a late meal, or a day you logged 900 calories
 * because you stopped logging at lunch, is a measurement of the logging, not
 * of the week - and a plain mean lets exactly one of those days drag the line
 * it is supposed to be smoothing.
 *
 * Trimming needs something left over to average, so it starts at three
 * readings. Below that the window is too thin for an outlier to be
 * distinguishable from the signal, and dropping anything would leave a mean of
 * one value or of none.
 */
function trimmedMean(vals: readonly number[]): number {
  if (vals.length < 3) {
    return vals.reduce((acc, v) => acc + v, 0) / vals.length;
  }
  // A copy, sorted: the caller's window is in date order and must stay that
  // way. Windows are a week wide, so this sorts at most seven numbers.
  const middle = [...vals].sort((a, b) => a - b).slice(1, -1);
  return middle.reduce((acc, v) => acc + v, 0) / middle.length;
}

/**
 * Calculates a true calendar-day trailing rolling average over `windowDays`,
 * trimming the extremes out of each window (see `trimmedMean`).
 *
 * Unlike a trailing-N-points window, which distorts averages across logging
 * gaps, the window spans the `windowDays` calendar days ending on each point's
 * own day. Missing days are omitted rather than assumed to be zero, and days
 * are compared as calendar days rather than millisecond offsets so a daylight
 * saving transition inside the window cannot quietly shorten it.
 *
 * The trim is applied to whatever the window actually holds, not to a notional
 * seven: a week with four readings in it averages the middle two. That keeps
 * the line continuous across the gaps that are the normal state of this data,
 * rather than changing method silently at a threshold nobody can see.
 */
export function rollingAverage<T extends Point>(points: readonly T[], windowDays: number): T[] {
  if (points.length === 0) return [];

  const span = Math.max(0, Math.floor(windowDays) - 1);
  const days = points.map((p) => localDayIndex(p.ts));

  return points.map((p, i) => {
    const endDay = days[i];
    const startDay = endDay - span;
    const vals: number[] = [];

    for (let j = 0; j < points.length; j++) {
      if (days[j] >= startDay && days[j] <= endDay) {
        vals.push(points[j].val);
      }
    }

    const avgVal = vals.length > 0 ? trimmedMean(vals) : p.val;
    return { ...p, val: avgVal };
  });
}

/**
 * Groups chronologically ordered points into segments where adjacent points are
 * at most `maxGapDays` calendar days apart. A gap of exactly `maxGapDays` stays
 * within one segment; anything wider starts a new one.
 *
 * Larger gaps become separate segments so the SVG line renderer draws solid
 * paths within logged stretches and a faded dashed connector across untracked
 * periods, instead of one solid line implying data that was never recorded.
 */
export function splitIntoSegments<T extends Point>(
  points: readonly T[],
  maxGapDays: number = 2,
): T[][] {
  if (points.length === 0) return [];

  const maxGap = Math.max(0, maxGapDays);
  const segments: T[][] = [];
  let currentSegment: T[] = [points[0]];
  let prevDay = localDayIndex(points[0].ts);

  for (let i = 1; i < points.length; i++) {
    const currDay = localDayIndex(points[i].ts);

    if (currDay - prevDay <= maxGap) {
      currentSegment.push(points[i]);
    } else {
      segments.push(currentSegment);
      currentSegment = [points[i]];
    }
    prevDay = currDay;
  }

  segments.push(currentSegment);
  return segments;
}

/**
 * Calculates the delta between the average of the current window and the average
 * of the immediately preceding window of equal duration.
 *
 * Returns null if either window contains no data points.
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

/**
 * The smallest multiple of `step` that is not below `value`, with a floor.
 *
 * What an axis maximum is for: a chart drawn to its own data's exact maximum
 * puts one bar flush against the top edge and labels the axis with whatever
 * that day happened to be. Rounding up to a round number gives a label anyone
 * can read at a glance and leaves the tallest bar visibly short of the ceiling.
 *
 * The floor matters on a nearly-empty chart: without it, a single 300-calorie
 * day would scale the axis to 500 and draw itself as a full-height bar, which
 * reads as an enormous day rather than a small one.
 */
export function niceCeil(value: number, step: number, floor = step): number {
  if (!Number.isFinite(value) || value <= 0) return floor;
  return Math.max(floor, Math.ceil(value / step) * step);
}
