import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp } from "../components/icons";
import { useCallback, useMemo, useRef, useState } from "react";
import { useDismissOnOutside } from "../hooks/useDismissOnOutside";
import { AppShell } from "../components/AppShell";
import {
  computeWindowChange,
  linearRegression,
  niceTicks,
  rollingAverage,
  splitIntoSegments,
  tickDecimals,
} from "../lib/chart-math";
import type { DailyLogNumericField } from "../lib/daily-log";
import { useStore } from "../lib/store";

export const Route = createFileRoute("/charts")({
  head: () => ({
    meta: [
      { title: "Charts" },
      { name: "description", content: "Your daily numbers over time." },
      { property: "og:title", content: "Charts" },
      { property: "og:description", content: "Your daily numbers over time." },
    ],
  }),
  component: ChartsPage,
});

const METRICS: {
  key: DailyLogNumericField;
  label: string;
  unit: string | ((appUnit: string) => string);
}[] = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "steps", label: "Steps", unit: "steps" },
  { key: "bodyweight", label: "Bodyweight", unit: (u) => u },
];

const RANGES = [
  { label: "7", days: 7 },
  { label: "30", days: 30 },
  { label: "90", days: 90 },
  { label: "All", days: 0 },
];

type ViewMode = "daily" | "avg7";

/**
 * Rounds a metric value for display: counts read as whole numbers, everything
 * else to one decimal. Shared by the stats row, the scrub pill and the
 * single-point label so the same number never renders two ways.
 */
function formatMetricValue(metricKey: DailyLogNumericField, v: number): string {
  if (metricKey === "calories" || metricKey === "steps") {
    return Math.round(v).toLocaleString();
  }
  return (Math.round(v * 10) / 10).toLocaleString();
}

function ChartsPage() {
  const dailyLogs = useStore((s) => s.dailyLogs);
  const unit = useStore((s) => s.unit);

  const [metricKey, setMetricKey] = useState<DailyLogNumericField>("calories");
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [viewMode, setViewMode] = useState<ViewMode>("daily");

  const metric = METRICS.find((m) => m.key === metricKey)!;
  const metricUnit = typeof metric.unit === "function" ? metric.unit(unit) : metric.unit;

  // Map all logs for the current metric sorted chronologically by timestamp.
  // Non-finite values are dropped rather than plotted: a single NaN from a bad
  // CSV import makes the whole SVG path string invalid, which blanks the line.
  const allMetricLogs = useMemo(() => {
    return dailyLogs
      .filter((log) => Number.isFinite(log[metricKey]))
      .map((log) => {
        const parts = log.date.split("-");
        const ts = new Date(
          parseInt(parts[0]),
          parseInt(parts[1]) - 1,
          parseInt(parts[2]),
        ).getTime();
        return {
          ts,
          val: log[metricKey]!,
          isUntracked: log.isUntracked,
        };
      })
      .filter((p) => Number.isFinite(p.ts))
      .sort((a, b) => a.ts - b.ts);
  }, [dailyLogs, metricKey]);

  // Current window points based on range selection.
  const currentPoints = useMemo(() => {
    if (rangeDays === 0) return allMetricLogs;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = today.getTime() - (rangeDays - 1) * 86400000;

    return allMetricLogs.filter((p) => p.ts >= cutoff);
  }, [allMetricLogs, rangeDays]);

  // Immediately preceding window of equal length for window-vs-window comparison.
  const priorPoints = useMemo(() => {
    if (rangeDays === 0) return [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = today.getTime() - (rangeDays - 1) * 86400000;
    const priorCutoff = cutoff - rangeDays * 86400000;

    return allMetricLogs.filter((p) => p.ts >= priorCutoff && p.ts < cutoff);
  }, [allMetricLogs, rangeDays]);

  // Displayed series: raw points or trailing 7-day rolling average.
  const displayedPoints = useMemo(() => {
    if (viewMode === "avg7") {
      return rollingAverage(currentPoints, 7);
    }
    return currentPoints;
  }, [currentPoints, viewMode]);

  // Linear regression computed over raw points to reflect true trajectory.
  const regression = useMemo(() => {
    return linearRegression(currentPoints);
  }, [currentPoints]);

  // slope is per MILLISECOND (ts is in ms), so one week is 7 * 86400000.
  //
  // Withheld for very short samples: extrapolating two readings a day apart to
  // a weekly rate multiplies their difference by seven, which reads as a
  // confident trend that the data does not support.
  const slopePerWeek = useMemo(() => {
    if (!regression) return null;
    if (currentPoints.length < 3) return null;
    const spanMs = currentPoints[currentPoints.length - 1].ts - currentPoints[0].ts;
    if (spanMs < 5 * 86400000) return null;
    return regression.slope * (7 * 86400000);
  }, [regression, currentPoints]);

  const windowChange = useMemo(() => {
    return computeWindowChange(currentPoints, priorPoints);
  }, [currentPoints, priorPoints]);

  // Formatting helper for stats row and trend readout.
  // Memoised on metricKey rather than left as a plain arrow so the useMemo hooks
  // below can depend on the function itself. They previously listed `metricKey`
  // as a stand-in for it, which was correct but invisible to the exhaustive-deps
  // lint, and a proxy dependency stops being correct the moment the formatter
  // closes over anything else.
  const formatMetricVal = useCallback((v: number) => formatMetricValue(metricKey, v), [metricKey]);

  const latestValStr =
    currentPoints.length > 0 ? formatMetricVal(currentPoints[currentPoints.length - 1].val) : "-";

  const avgValStr =
    currentPoints.length > 0
      ? formatMetricVal(currentPoints.reduce((acc, p) => acc + p.val, 0) / currentPoints.length)
      : "-";

  const minVal = currentPoints.length > 0 ? Math.min(...currentPoints.map((p) => p.val)) : 0;
  const maxVal = currentPoints.length > 0 ? Math.max(...currentPoints.map((p) => p.val)) : 0;
  const rangeStr =
    currentPoints.length > 0 ? `${formatMetricVal(minVal)} - ${formatMetricVal(maxVal)}` : "-";

  const changeStr = useMemo(() => {
    if (windowChange === null) return "-";
    const sign = windowChange > 0 ? "+" : windowChange < 0 ? "-" : "";
    // The direction used to be a Unicode arrow glued to the front of this
    // string. A character is not an icon: it takes the text metrics, it is a
    // different shape in every font fallback, and it belongs to no system. The
    // caller draws the mark now and this returns only the figure.
    return `${sign}${formatMetricVal(Math.abs(windowChange))}`;
  }, [windowChange, formatMetricVal]);

  const rateReadoutText = useMemo(() => {
    if (slopePerWeek === null) return null;
    const sign = slopePerWeek >= 0 ? "+" : "-";
    const val = formatMetricVal(Math.abs(slopePerWeek));
    return `${sign}${val} ${metricUnit} / week`;
  }, [slopePerWeek, metricUnit, formatMetricVal]);

  return (
    <AppShell>
      <header className="pl-4 pr-12 pb-4 pt-14">
        <h1 className="t-title">Charts</h1>
      </header>

      {/* Metric and date range selection cluster tightened into a single calm block */}
      <div className="mb-4 flex flex-col gap-2.5">
        <div role="group" aria-label="Metric" className="flex gap-2 overflow-x-auto px-4">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetricKey(m.key)}
              aria-pressed={metricKey === m.key}
              className={
                "flex min-h-[44px] items-center justify-center whitespace-nowrap px-4 py-2 t-label font-medium transition-colors duration-150 " +
                (metricKey === m.key ? "rounded-md bg-ink text-paper" : "text-ink-2")
              }
            >
              {m.label}
            </button>
          ))}
        </div>

        <div role="group" aria-label="Date range" className="flex gap-2 overflow-x-auto px-4">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => setRangeDays(r.days)}
              aria-pressed={rangeDays === r.days}
              // A bare "7" or "90" names nothing out loud, so the visible chip
              // stays terse and the accessible name spells out the range.
              aria-label={r.days === 0 ? "All time" : `Last ${r.days} days`}
              className={
                // min-w matters as much as min-h here: the "7" chip is a single
                // character and would otherwise be a 34px-wide tap target.
                "flex min-h-[44px] min-w-[44px] items-center justify-center whitespace-nowrap px-3.5 py-2 t-label font-medium transition-colors duration-150 tnum " +
                (rangeDays === r.days ? "rounded-md bg-ink text-paper" : "text-ink-2")
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-4 rounded-lg bg-surface p-4" style={{ animationDelay: "40ms" }}>
        {/* Inline segmented control on chart card to toggle raw vs smoothed series */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="t-caption text-ink-2 truncate">{metric.label}</h2>
          <div
            role="group"
            aria-label="Series"
            // Two chips in a track, matching the Metric and Date range rows
            // directly above. It used to be one 1.5px-ruled box split down the
            // middle, which was correct on paper - where a rule was the only
            // way to group two things - and is a heavy outlined object here,
            // where the same job is done by a quiet track and a filled chip.
            className="inline-flex gap-1 rounded-md bg-wash p-1"
          >
            <button
              type="button"
              onClick={() => setViewMode("daily")}
              aria-pressed={viewMode === "daily"}
              className={
                "flex min-h-[36px] min-w-[60px] items-center justify-center rounded-sm px-3 py-1.5 t-label font-medium transition-colors duration-150 " +
                (viewMode === "daily" ? "bg-ink text-paper" : "text-ink-2")
              }
            >
              Daily
            </button>
            <button
              type="button"
              onClick={() => setViewMode("avg7")}
              aria-pressed={viewMode === "avg7"}
              className={
                "flex min-h-[36px] min-w-[76px] items-center justify-center rounded-sm px-3 py-1.5 t-label font-medium transition-colors duration-150 " +
                (viewMode === "avg7" ? "bg-ink text-paper" : "text-ink-2")
              }
            >
              7-day avg
            </button>
          </div>
        </div>

        <Chart
          displayedPoints={displayedPoints}
          rawPoints={currentPoints}
          unit={metricUnit}
          isCalories={metricKey === "calories"}
          viewMode={viewMode}
          regression={regression}
          metricLabel={metric.label}
          metricKey={metricKey}
        />

        {/* Rate readout derived from linear regression slope */}
        {rateReadoutText && (
          <div className="mt-3 text-center t-label font-medium text-ink-2 tnum">
            Trend: {rateReadoutText}
          </div>
        )}

        {/* Grouped 2x2 stats grid with hairline separators: Latest, Average, Range, Change */}
        <div className="mt-4 grid grid-cols-2 pt-4 hairline-t">
          <div className="pr-3 pb-3">
            <div className="t-caption text-ink-2">Latest</div>
            <div className="t-stat mt-1">
              {latestValStr}
              {currentPoints.length > 0 && (
                <span className="ml-1 t-label text-ink-2">{metricUnit}</span>
              )}
            </div>
          </div>
          <div className="border-l border-rule pl-3 pb-3">
            <div className="t-caption text-ink-2">Average</div>
            <div className="t-stat mt-1">{avgValStr}</div>
          </div>
          <div className="hairline-t pr-3 pt-3">
            <div className="t-caption text-ink-2">Range</div>
            <div className="t-stat mt-1">{rangeStr}</div>
          </div>
          <div className="hairline-t border-l border-rule pl-3 pt-3">
            <div className="t-caption text-ink-2">Change</div>
            <div className="mt-1 flex items-center gap-1.5">
              {windowChange !== null && windowChange !== 0 && (
                <span className="shrink-0 text-ink">
                  {windowChange > 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                </span>
              )}
              <span className="t-stat">{changeStr}</span>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Chart({
  displayedPoints,
  rawPoints,
  unit,
  isCalories,
  viewMode,
  regression,
  metricLabel,
  metricKey,
}: {
  displayedPoints: { ts: number; val: number; isUntracked?: boolean }[];
  rawPoints: { ts: number; val: number; isUntracked?: boolean }[];
  unit: string;
  isCalories: boolean;
  viewMode: ViewMode;
  regression: { slope: number; intercept: number } | null;
  metricLabel: string;
  metricKey: DailyLogNumericField;
}) {
  const W = 320;
  const H = 180;
  // Left gutter widened to 42px to make ample room for right-aligned numeric Y tick labels.
  const pad = { l: 42, r: 12, t: 16, b: 24 };

  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const clearSelection = useCallback(() => setSelectedIndex(null), []);

  // A tap on the plot leaves a point selected with its pill showing, and the
  // SVG's own pointer handling only clears it for presses that land back inside
  // the chart. A press anywhere else on the page never reached it.
  useDismissOnOutside(svgRef, selectedIndex !== null, clearSelection);
  const pointerDownRef = useRef<{ x: number; y: number; index: number; isDrag: boolean } | null>(
    null,
  );

  // 0 points empty state. Names the metric and points at the range chips,
  // because "no data" here usually means the window is too narrow rather than
  // that nothing was ever logged.
  if (displayedPoints.length === 0) {
    return (
      <div className="flex h-[180px] flex-col items-center justify-center p-4 text-center">
        <h3 className="t-heading">No {metricLabel.toLowerCase()} in this range</h3>
      </div>
    );
  }

  // 1 point state rendered as a single labelled dot in the chart viewBox.
  const isSinglePoint = displayedPoints.length === 1;
  const allYVals = [...displayedPoints.map((p) => p.val), ...rawPoints.map((p) => p.val)];
  const rawMinY = Math.min(...allYVals);
  const rawMaxY = Math.max(...allYVals);
  const yTicks = niceTicks(rawMinY, rawMaxY, 5);
  const yDecimals = tickDecimals(yTicks);

  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  // NOT Math.max(1, ...): niceTicks already guarantees yMax > yMin, and a floor
  // of 1 silently rescales every bodyweight chart whose ticks span less than a
  // pound (180.2 to 180.8 spans 0.6), squashing the whole series and its
  // gridlines into the bottom of the plot area.
  const ySpan = yMax > yMin ? yMax - yMin : 1;

  const y = (v: number) => pad.t + (1 - (v - yMin) / ySpan) * (H - pad.t - pad.b);

  const xs = displayedPoints.map((p) => p.ts);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = xMax - xMin;
  const plotW = W - pad.l - pad.r;

  // Every point sharing one timestamp gets centred rather than stacked on the
  // left edge. The old Math.max(1, xSpan) guard made this branch unreachable.
  const x = (t: number) => {
    if (xSpan <= 0) return pad.l + plotW / 2;
    return pad.l + ((t - xMin) / xSpan) * plotW;
  };

  // Adaptive X ticks depending on day span to prevent text collision.
  const spanDays = xSpan / 86400000;
  const xTickItems = (() => {
    if (isSinglePoint) {
      const d = new Date(xMin);
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return [{ ts: xMin, label }];
    }
    if (spanDays <= 7) {
      return displayedPoints.map((p) => {
        const d = new Date(p.ts);
        const label = d.toLocaleDateString("en-US", { weekday: "short" })[0];
        return { ts: p.ts, label };
      });
    }
    if (spanDays <= 31) {
      const step = xSpan / 4;
      const ticks: { ts: number; label: string }[] = [];
      let lastTs = -Infinity;
      for (let i = 0; i <= 4; i++) {
        const targetTs = xMin + i * step;
        const closest = displayedPoints.reduce((prev, curr) =>
          Math.abs(curr.ts - targetTs) < Math.abs(prev.ts - targetTs) ? curr : prev,
        );
        if (closest.ts - lastTs >= 4 * 86400000) {
          const d = new Date(closest.ts);
          const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          ticks.push({ ts: closest.ts, label });
          lastTs = closest.ts;
        }
      }
      return ticks;
    }
    const ticks: { ts: number; label: string }[] = [];
    let lastMonth = -1;
    let lastTs = -Infinity;
    for (const p of displayedPoints) {
      const d = new Date(p.ts);
      const m = d.getMonth();
      if (m !== lastMonth && p.ts - lastTs >= 20 * 86400000) {
        const label = d.toLocaleDateString("en-US", { month: "short" });
        ticks.push({ ts: p.ts, label });
        lastMonth = m;
        lastTs = p.ts;
      }
    }
    return ticks;
  })();

  // Filter X ticks so label bounds never collide visually.
  const renderedXTicks: { posX: number; label: string }[] = [];
  let lastPosX = -Infinity;
  const minSpacing = spanDays <= 7 ? 14 : 32;

  for (const item of xTickItems) {
    const posX = x(item.ts);
    if (posX >= pad.l && posX <= W - pad.r && posX - lastPosX >= minSpacing) {
      renderedXTicks.push({ posX, label: item.label });
      lastPosX = posX;
    }
  }

  // Split path into segments across gaps larger than 2 days.
  const segments = splitIntoSegments(displayedPoints, 2);

  // Active point determination: scrubbing drag takes priority over persistent tap selection.
  const activeIndex = scrubIndex !== null ? scrubIndex : selectedIndex;
  const activePoint = activeIndex !== null ? displayedPoints[activeIndex] : null;

  const getNearestIndex = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    let closestIdx = 0;
    let minDist = Infinity;
    displayedPoints.forEach((p, idx) => {
      const px = x(p.ts);
      const dist = Math.abs(px - svgX);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = idx;
      }
    });
    return closestIdx;
  };

  const handlePointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Deliberately swallowed. Capture is an optimisation for keeping the
      // scrub alive when the finger leaves the SVG, and it throws if the
      // pointer has already been released (a fast tap, or a touch cancelled by
      // the system). Scrubbing still works without it, so a failure here must
      // not break the gesture.
    }
    const idx = getNearestIndex(e);
    setScrubIndex(idx);
    pointerDownRef.current = { x: e.clientX, y: e.clientY, index: idx, isDrag: false };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (pointerDownRef.current) {
      const dx = Math.abs(e.clientX - pointerDownRef.current.x);
      const dy = Math.abs(e.clientY - pointerDownRef.current.y);
      if (dx > 4 || dy > 4) {
        pointerDownRef.current.isDrag = true;
      }
      const idx = getNearestIndex(e);
      setScrubIndex(idx);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGRectElement>) => {
    // Snapshot the gesture BEFORE releasing capture: releasePointerCapture
    // dispatches lostpointercapture synchronously, and that handler clears this
    // very ref, which would otherwise swallow every tap.
    const down = pointerDownRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const isOutside =
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom;

    pointerDownRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Also deliberately swallowed, and the guard above is not enough on its
      // own: the pointer can be invalidated between the hasPointerCapture check
      // and the release. Crucially, scrubIndex is cleared AFTER this block, so a
      // throw here can never leave the crosshair stuck on screen.
    }

    setScrubIndex(null);

    if (isOutside) {
      setSelectedIndex(null);
      return;
    }

    if (down) {
      const currentIdx = scrubIndex !== null ? scrubIndex : down.index;
      // A tap on the already-selected point dismisses it; a drag always leaves
      // the point it ended on selected.
      if (!down.isDrag && selectedIndex === currentIdx) {
        setSelectedIndex(null);
      } else {
        setSelectedIndex(currentIdx);
      }
    }
  };

  // Covers both pointercancel (which fires often on mobile: the browser takes
  // the gesture over as a vertical page scroll) and any other capture loss, so
  // the crosshair can never be left stuck under a finger that is gone.
  const handlePointerCancel = () => {
    setScrubIndex(null);
    pointerDownRef.current = null;
  };

  // Floating pill coordinate calculations clamped within chart bounds.
  let pillX = 0;
  let pillY = 0;
  let pillValStr = "";
  let pillDateStr = "";
  // Wide enough for the longest real label ("10,000 steps - Wed, Sep 10") at
  // fontSize 9 without the text spilling out of the rounded rect.
  const halfPillW = 66;

  if (activePoint) {
    const px = x(activePoint.ts);
    const py = y(activePoint.val);

    pillX = Math.max(pad.l + halfPillW, Math.min(W - pad.r - halfPillW, px));
    // Sits above the point, or below it when the point is too near the top for
    // the pill to clear the highlighted dot.
    pillY = py - 18 >= pad.t + 12 ? py - 18 : Math.min(H - pad.b - 12, py + 20);

    pillValStr = `${formatMetricValue(metricKey, activePoint.val)} ${unit}`;
    const d = new Date(activePoint.ts);
    pillDateStr = d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  // Every Y label is formatted from the SHARED tick precision. Formatting each
  // tick on its own produced axes reading "180.2 | 180.2 | 180.3 | 180.3", and
  // abbreviating per tick mixed "8,000" with "10k" on one axis.
  const peakY = Math.max(Math.abs(yMin), Math.abs(yMax));
  const useThousands = peakY >= 10000;
  const yStep = yTicks.length > 1 ? Math.abs(yTicks[1] - yTicks[0]) : 1;
  const kDecimals = Math.min(2, Math.max(0, -Math.floor(Math.log10(yStep / 1000) + 1e-9)));

  // Untrackeds are marked on the DAILY series only. In 7-day-average mode a
  // plotted value is a mean ending on that day, not that day's intake, so
  // marking it would attribute the untracked day to the wrong number. The faint raw
  // dots behind the smoothed line keep carrying the signal.
  //
  // The mark is a ring around the dot, not a different fill: an untracked day is a
  // label the user chose for their own day, so it annotates the point rather
  // than repainting it, and the ring reads without depending on hue.
  const isUntrackedDot = (p: { isUntracked?: boolean }) =>
    isCalories && viewMode === "daily" && p.isUntracked === true;
  const hasUntrackedDots = displayedPoints.some(isUntrackedDot);

  const formatYLabel = (v: number) => {
    if (v === 0) return "0";
    if (useThousands) return `${(v / 1000).toFixed(kDecimals)}k`;
    return v.toLocaleString(undefined, {
      minimumFractionDigits: yDecimals,
      maximumFractionDigits: yDecimals,
    });
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="h-[180px] w-full select-none"
      role="img"
      aria-label={
        hasUntrackedDots
          ? `${metricLabel} over time. Untracked days are ringed.`
          : `${metricLabel} over time`
      }
    >
      <defs>
        {/*
            A flat wash, and deliberately a flat one.

            Two previous versions are worth recording, because the obvious third
            option is one of them. It began as a gradient fading from 18% ink to
            nothing, which is a grey ramp and the stock charting-library look.
            It then became a hatch - 0.6px rules at 135 degrees - because a
            one-colour press fills an area by ruling it, which was right for a
            printed page and is wrong here: white scratches over a black ground
            fight the trace sitting on top of them.

            Flat 16% states the area once, at one value, and gets out of the way.
            A gradient here would be the first one in the app.
          */}
        <linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-ink)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--color-ink)" stopOpacity="0.16" />
        </linearGradient>
        {/* Least-squares fitted values can fall outside the data range, so the
            trend line is clipped to the plot box instead of drawing over the X
            axis labels. */}
        <clipPath id="chart-plot-clip">
          <rect x={pad.l} y={pad.t} width={plotW} height={H - pad.t - pad.b} />
        </clipPath>
      </defs>

      {/* Horizontal Y gridlines and right-aligned numeric Y labels in left gutter */}
      {yTicks.map((t) => (
        <g key={`y-tick-${t}`}>
          <line
            x1={pad.l}
            y1={y(t)}
            x2={W - pad.r}
            y2={y(t)}
            stroke="var(--color-border)"
            strokeWidth={1}
            strokeOpacity={0.4}
          />
          <text
            x={pad.l - 6}
            y={y(t) + 3}
            fontSize={9}
            textAnchor="end"
            fill="var(--color-muted-foreground)"
            className="tnum"
          >
            {formatYLabel(t)}
          </text>
        </g>
      ))}

      {/* X axis tick labels */}
      {renderedXTicks.map((t, i) => {
        // A middle-anchored label on the last tick hangs half its width past
        // the plot and gets clipped by the viewBox, which is why the right-hand
        // date read "Aug 2C". The outermost ticks anchor inwards instead.
        const isFirst = i === 0;
        const isLast = i === renderedXTicks.length - 1;
        const anchor = isLast ? "end" : isFirst ? "start" : "middle";
        return (
          <text
            key={`x-tick-${i}`}
            x={t.posX}
            y={H - 6}
            fontSize={9}
            textAnchor={anchor}
            fill="var(--color-muted-foreground)"
            className="tnum"
          >
            {t.label}
          </text>
        );
      })}

      {/* Linear regression trend line overlay */}
      {regression && !isSinglePoint && (
        <line
          x1={x(xMin)}
          y1={y(regression.slope * xMin + regression.intercept)}
          x2={x(xMax)}
          y2={y(regression.slope * xMax + regression.intercept)}
          stroke="var(--color-muted-foreground)"
          strokeWidth={1.25}
          strokeDasharray="4 4"
          opacity={0.6}
          clipPath="url(#chart-plot-clip)"
        />
      )}

      {/* Raw daily dots drawn faintly behind smoothed line when in 7-day average mode */}
      {viewMode === "avg7" &&
        rawPoints.map((rp, i) => {
          // Same annotation as the daily series: an untracked day opens the dot out
          // into a ring instead of painting it another colour.
          const untracked = isCalories && rp.isUntracked === true;
          return (
            <circle
              key={`raw-dot-${i}`}
              cx={x(rp.ts)}
              cy={y(rp.val)}
              r={untracked ? 2.5 : 1.5}
              fill={untracked ? "none" : "var(--color-muted-foreground)"}
              stroke={untracked ? "var(--color-muted-foreground)" : "none"}
              strokeWidth={1}
              opacity={0.35}
            />
          );
        })}

      {/* Solid line segments and gradient area fills */}
      {segments.map((seg, sIdx) => {
        if (seg.length < 2) return null;
        const dStr = seg
          .map((p, pIdx) => `${pIdx === 0 ? "M" : "L"}${x(p.ts).toFixed(1)},${y(p.val).toFixed(1)}`)
          .join(" ");
        const areaStr = `${dStr} L${x(seg[seg.length - 1].ts).toFixed(1)},${H - pad.b} L${x(
          seg[0].ts,
        ).toFixed(1)},${H - pad.b} Z`;

        return (
          <g key={`seg-${sIdx}`}>
            <path d={areaStr} fill="url(#chart-area)" />
            <path
              d={dStr}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}

      {/* Dashed faded connectors rendered across gaps larger than 2 days */}
      {segments.map((seg, sIdx) => {
        if (sIdx === segments.length - 1) return null;
        const lastP = seg[seg.length - 1];
        const nextP = segments[sIdx + 1][0];
        return (
          <line
            key={`gap-${sIdx}`}
            x1={x(lastP.ts)}
            y1={y(lastP.val)}
            x2={x(nextP.ts)}
            y2={y(nextP.val)}
            stroke="var(--color-muted-foreground)"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.4}
          />
        );
      })}

      {/* Data dots on displayed series */}
      {displayedPoints.map((p, i) => (
        <circle
          key={`dot-${i}`}
          cx={x(p.ts)}
          cy={y(p.val)}
          r={isSinglePoint ? 4 : 2}
          fill="var(--color-accent)"
        />
      ))}

      {/* Untracked rings, drawn around the dot they annotate */}
      {displayedPoints.map((p, i) =>
        isUntrackedDot(p) ? (
          <circle
            key={`untracked-dot-${i}`}
            cx={x(p.ts)}
            cy={y(p.val)}
            r={isSinglePoint ? 7 : 4.5}
            fill="none"
            stroke="var(--color-muted-foreground)"
            strokeWidth={1}
          />
        ) : null,
      )}

      {/* Label for single point state */}
      {isSinglePoint && (
        <text
          x={x(displayedPoints[0].ts)}
          y={y(displayedPoints[0].val) - 10}
          fontSize={10}
          fontWeight={500}
          textAnchor="middle"
          fill="var(--color-foreground)"
          className="tnum"
        >
          {`${formatMetricValue(metricKey, displayedPoints[0].val)} ${unit}`}
        </text>
      )}

      {/* Active point crosshair line, dot highlight, and clamped value pill */}
      {activePoint && (
        <g className="pointer-events-none">
          <line
            x1={x(activePoint.ts)}
            y1={pad.t}
            x2={x(activePoint.ts)}
            y2={H - pad.b}
            stroke="var(--color-muted-foreground)"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.7}
          />
          <circle
            cx={x(activePoint.ts)}
            cy={y(activePoint.val)}
            r={5}
            fill="var(--color-accent)"
            stroke="var(--color-surface)"
            strokeWidth={2}
          />
          {isUntrackedDot(activePoint) && (
            <circle
              cx={x(activePoint.ts)}
              cy={y(activePoint.val)}
              r={8}
              fill="none"
              stroke="var(--color-muted-foreground)"
              strokeWidth={1}
            />
          )}
          <g>
            <rect
              x={pillX - halfPillW}
              y={pillY - 11}
              width={halfPillW * 2}
              height={22}
              rx={6}
              ry={6}
              fill="var(--color-surface)"
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <text
              x={pillX}
              y={pillY + 3}
              fontSize={9}
              fontWeight={500}
              textAnchor="middle"
              fill="var(--color-foreground)"
              className="tnum"
            >
              {pillValStr} - {pillDateStr}
            </text>
          </g>
        </g>
      )}

      {/* Full area rect for pointer scrubbing with setPointerCapture */}
      <rect
        x={0}
        y={0}
        width={W}
        height={H}
        fill="transparent"
        // pan-y, not none: the chart is 180px of a scrolling page, and
        // touch-action: none would trap every vertical swipe that happens to
        // start on it. Horizontal movement still reaches us for scrubbing;
        // vertical movement scrolls the page and cancels the scrub.
        style={{ touchAction: "pan-y" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
      />
    </svg>
  );
}
