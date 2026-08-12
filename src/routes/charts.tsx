import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import {
  computeWindowChange,
  linearRegression,
  niceTicks,
  rollingAverage,
  splitIntoSegments,
} from "../lib/chart-math";
import type { DailyLogNumericField } from "../lib/daily-log";
import { useStore } from "../lib/store";

export const Route = createFileRoute("/charts")({
  head: () => ({
    meta: [
      { title: "Charts" },
      { name: "description", content: "Daily metrics over time." },
      { property: "og:title", content: "Charts" },
      { property: "og:description", content: "Daily metrics over time." },
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
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
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

function ChartsPage() {
  const dailyLogs = useStore((s) => s.dailyLogs);
  const unit = useStore((s) => s.unit);

  const [metricKey, setMetricKey] = useState<DailyLogNumericField>("calories");
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [viewMode, setViewMode] = useState<ViewMode>("daily");

  const metric = METRICS.find((m) => m.key === metricKey)!;
  const metricUnit = typeof metric.unit === "function" ? metric.unit(unit) : metric.unit;

  // Map all logs for the current metric sorted chronologically by timestamp.
  const allMetricLogs = useMemo(() => {
    return dailyLogs
      .filter((log) => log[metricKey] !== undefined)
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
          isCheatDay: log.isCheatDay,
        };
      })
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

  const slopePerWeek = useMemo(() => {
    if (!regression) return null;
    return regression.slope * (7 * 86400000);
  }, [regression]);

  const windowChange = useMemo(() => {
    return computeWindowChange(currentPoints, priorPoints);
  }, [currentPoints, priorPoints]);

  // Formatting helpers for stats row and trend readout.
  const formatMetricVal = (v: number) => {
    if (metricKey === "calories" || metricKey === "steps") {
      return Math.round(v).toLocaleString();
    }
    return (Math.round(v * 10) / 10).toLocaleString();
  };

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
    const arrow = windowChange > 0 ? "↑ " : windowChange < 0 ? "↓ " : "";
    return `${arrow}${sign}${formatMetricVal(Math.abs(windowChange))}`;
  }, [windowChange, metricKey]);

  const rateReadoutText = useMemo(() => {
    if (slopePerWeek === null) return null;
    const sign = slopePerWeek >= 0 ? "+" : "-";
    const val = formatMetricVal(Math.abs(slopePerWeek));
    return `${sign}${val} ${metricUnit} / week`;
  }, [slopePerWeek, metricUnit, metricKey]);

  return (
    <AppShell>
      <header className="px-5 pb-4 pt-14">
        <h1 className="text-[30px] font-semibold tracking-tight">Charts</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">Daily metrics over time.</p>
      </header>

      <div
        data-swipe-ignore
        className="scrollbar-none flex gap-2 overflow-x-auto px-5 pb-2 anim-fade-up"
      >
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetricKey(m.key)}
            className={
              "min-h-[44px] whitespace-nowrap rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors duration-200 flex items-center justify-center " +
              (metricKey === m.key
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground")
            }
          >
            {m.label}
          </button>
        ))}
      </div>

      <div
        data-swipe-ignore
        className="scrollbar-none flex gap-2 overflow-x-auto px-5 pb-4 anim-fade-up"
        style={{ animationDelay: "20ms" }}
      >
        {RANGES.map((r) => (
          <button
            key={r.label}
            onClick={() => setRangeDays(r.days)}
            className={
              "min-h-[44px] whitespace-nowrap rounded-full px-3.5 py-2 text-[11px] font-medium transition-colors duration-200 flex items-center justify-center " +
              (rangeDays === r.days ? "bg-muted text-foreground" : "text-muted-foreground")
            }
          >
            {r.label}
          </button>
        ))}
      </div>

      <div
        className="mx-5 rounded-2xl bg-surface p-5 hairline-t hairline-b anim-fade-up"
        style={{ animationDelay: "40ms" }}
      >
        {/* Inline segmented control on chart card to toggle raw vs smoothed series */}
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[13px] font-medium text-muted-foreground">{metric.label}</span>
          <div className="inline-flex rounded-xl bg-muted p-1 gap-1">
            <button
              onClick={() => setViewMode("daily")}
              className={
                "min-h-[44px] min-w-[60px] px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors duration-150 flex items-center justify-center " +
                (viewMode === "daily"
                  ? "bg-surface text-foreground shadow-xs"
                  : "text-muted-foreground")
              }
            >
              Daily
            </button>
            <button
              onClick={() => setViewMode("avg7")}
              className={
                "min-h-[44px] min-w-[76px] px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors duration-150 flex items-center justify-center " +
                (viewMode === "avg7"
                  ? "bg-surface text-foreground shadow-xs"
                  : "text-muted-foreground")
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
          <div className="mt-3 text-center text-[12px] font-medium text-muted-foreground">
            Trend: {rateReadoutText}
          </div>
        )}

        {/* 4-cell stats row: Latest, Average, Range, Change */}
        <div className="mt-4 grid grid-cols-2 gap-y-4 gap-x-4 pt-4 hairline-t sm:grid-cols-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Latest</div>
            <div className="tnum mt-0.5 text-[20px] font-semibold">
              {latestValStr}
              {currentPoints.length > 0 && (
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  {metricUnit}
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Average</div>
            <div className="tnum mt-0.5 text-[20px] font-semibold">{avgValStr}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Range</div>
            <div className="tnum mt-0.5 text-[20px] font-semibold">{rangeStr}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Change</div>
            <div className="tnum mt-0.5 text-[20px] font-semibold">{changeStr}</div>
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
  displayedPoints: { ts: number; val: number; isCheatDay?: boolean }[];
  rawPoints: { ts: number; val: number; isCheatDay?: boolean }[];
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
  const pointerDownRef = useRef<{ x: number; y: number; index: number; isDrag: boolean } | null>(
    null,
  );

  // 0 points empty state with actionable guidance to log on Today tab.
  if (displayedPoints.length === 0) {
    return (
      <div className="flex h-[180px] flex-col items-center justify-center p-4 text-center">
        <div className="text-[14px] font-medium text-foreground">No data recorded</div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Log your {metricLabel.toLowerCase()} on the Today tab to track progress over time.
        </p>
      </div>
    );
  }

  // 1 point state rendered as a single labelled dot in the chart viewBox.
  const isSinglePoint = displayedPoints.length === 1;
  const allYVals = [...displayedPoints.map((p) => p.val), ...rawPoints.map((p) => p.val)];
  const rawMinY = Math.min(...allYVals);
  const rawMaxY = Math.max(...allYVals);
  const yTicks = niceTicks(rawMinY, rawMaxY, 5);

  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const ySpan = Math.max(1, yMax - yMin);

  const y = (v: number) => pad.t + (1 - (v - yMin) / ySpan) * (H - pad.t - pad.b);

  const xs = displayedPoints.map((p) => p.ts);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = Math.max(1, xMax - xMin);

  const x = (t: number) => {
    if (xSpan === 0) return pad.l + (W - pad.l - pad.r) / 2;
    return pad.l + ((t - xMin) / xSpan) * (W - pad.l - pad.r);
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
    } catch (_) {}
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
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}

    const rect = e.currentTarget.getBoundingClientRect();
    const isOutside =
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom;

    if (isOutside) {
      setSelectedIndex(null);
      setScrubIndex(null);
      pointerDownRef.current = null;
      return;
    }

    if (pointerDownRef.current) {
      const { index: downIdx, isDrag } = pointerDownRef.current;
      const currentIdx = scrubIndex !== null ? scrubIndex : downIdx;

      if (!isDrag) {
        if (selectedIndex === currentIdx) {
          setSelectedIndex(null);
        } else {
          setSelectedIndex(currentIdx);
        }
      } else {
        setSelectedIndex(currentIdx);
      }
    }

    setScrubIndex(null);
    pointerDownRef.current = null;
  };

  const handlePointerCancel = () => {
    setScrubIndex(null);
    pointerDownRef.current = null;
  };

  // Floating pill coordinate calculations clamped within chart bounds.
  let pillX = 0;
  let pillY = 0;
  let pillValStr = "";
  let pillDateStr = "";
  const halfPillW = 60;

  if (activePoint) {
    const px = x(activePoint.ts);
    const py = y(activePoint.val);

    pillX = Math.max(pad.l + halfPillW, Math.min(W - pad.r - halfPillW, px));
    pillY = Math.max(pad.t + 12, py - 18);

    const formatVal = (v: number) =>
      metricKey === "calories" || metricKey === "steps"
        ? Math.round(v).toLocaleString()
        : (Math.round(v * 10) / 10).toLocaleString();

    pillValStr = `${formatVal(activePoint.val)} ${unit}`;
    const d = new Date(activePoint.ts);
    pillDateStr = d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  const formatYLabel = (v: number) => {
    if (Math.abs(v) >= 10000) {
      return `${(v / 1000).toFixed(0)}k`;
    }
    if (v % 1 === 0) {
      return v.toLocaleString();
    }
    return v.toFixed(1);
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full select-none">
      <defs>
        <linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
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
      {renderedXTicks.map((t, i) => (
        <text
          key={`x-tick-${i}`}
          x={t.posX}
          y={H - 6}
          fontSize={9}
          textAnchor="middle"
          fill="var(--color-muted-foreground)"
        >
          {t.label}
        </text>
      ))}

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
        />
      )}

      {/* Raw daily dots drawn faintly behind smoothed line when in 7-day average mode */}
      {viewMode === "avg7" &&
        rawPoints.map((rp, i) => (
          <circle
            key={`raw-dot-${i}`}
            cx={x(rp.ts)}
            cy={y(rp.val)}
            r={1.5}
            fill={
              isCalories && rp.isCheatDay
                ? "var(--color-destructive)"
                : "var(--color-muted-foreground)"
            }
            opacity={0.35}
          />
        ))}

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

      {/* Data dots on displayed series with cheat day recolouring */}
      {displayedPoints.map((p, i) => (
        <circle
          key={`dot-${i}`}
          cx={x(p.ts)}
          cy={y(p.val)}
          r={isSinglePoint ? 4 : 2}
          fill={isCalories && p.isCheatDay ? "var(--color-destructive)" : "var(--color-accent)"}
        />
      ))}

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
          {`${
            metricKey === "calories" || metricKey === "steps"
              ? Math.round(displayedPoints[0].val).toLocaleString()
              : (Math.round(displayedPoints[0].val * 10) / 10).toLocaleString()
          } ${unit}`}
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
            fill={
              isCalories && activePoint.isCheatDay
                ? "var(--color-destructive)"
                : "var(--color-accent)"
            }
            stroke="var(--color-surface)"
            strokeWidth={2}
          />
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
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      />
    </svg>
  );
}
