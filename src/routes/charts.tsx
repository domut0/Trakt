import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useStore } from "../lib/store";
import type { DailyLogNumericField } from "../lib/daily-log";

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

const METRICS: { key: DailyLogNumericField; label: string; unit: string | ((appUnit: string) => string) }[] = [
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

function ChartsPage() {
  const dailyLogs = useStore((s) => s.dailyLogs);
  const unit = useStore((s) => s.unit);

  const [metricKey, setMetricKey] = useState<DailyLogNumericField>("calories");
  const [rangeDays, setRangeDays] = useState<number>(30);

  const metric = METRICS.find((m) => m.key === metricKey)!;
  const metricUnit = typeof metric.unit === "function" ? metric.unit(unit) : metric.unit;

  const points = useMemo(() => {
    const metricLogs = dailyLogs
      .filter((log) => log[metricKey] !== undefined)
      .map((log) => {
        const parts = log.date.split("-");
        const ts = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])).getTime();
        return { 
          ts, 
          val: log[metricKey]!, 
          isCheatDay: log.isCheatDay,
        };
      })
      .sort((a, b) => a.ts - b.ts);
      
    if (rangeDays === 0) return metricLogs;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = today.getTime() - (rangeDays - 1) * 86400000;
    
    return metricLogs.filter((p) => p.ts >= cutoff);
  }, [dailyLogs, metricKey, rangeDays]);

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
              "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200 " +
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
              "whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium transition-colors duration-200 " +
              (rangeDays === r.days
                ? "bg-muted text-foreground"
                : "text-muted-foreground")
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
        <Chart points={points} unit={metricUnit} isCalories={metricKey === "calories"} />
        <div className="mt-4 flex items-baseline justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Latest {metric.label}
            </div>
            <div className="tnum mt-0.5 text-[26px] font-semibold">
              {points.length > 0 ? points[points.length - 1].val : "—"}
              <span className="ml-1 text-[12px] font-normal text-muted-foreground">{metricUnit}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Average
            </div>
            <div className="tnum mt-0.5 text-[26px] font-semibold">
              {points.length > 0 ? Math.round(points.reduce((acc, p) => acc + p.val, 0) / points.length) : "—"}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Chart({ points, unit, isCalories }: { points: { ts: number; val: number; isCheatDay?: boolean }[]; unit: string; isCalories: boolean }) {
  const W = 320;
  const H = 180;
  const pad = { l: 8, r: 8, t: 12, b: 20 };
  if (points.length < 2) {
    return (
      <div className="flex h-[180px] items-center justify-center text-[13px] text-muted-foreground">
        Not enough data yet.
      </div>
    );
  }
  const xs = points.map((p) => p.ts);
  const ys = points.map((p) => p.val);
  const xMin = Math.min(...xs),
    xMax = Math.max(...xs);
  const yMin = Math.min(...ys),
    yMax = Math.max(...ys);
  const ySpan = Math.max(1, yMax - yMin);
  const xSpan = Math.max(1, xMax - xMin);
  const x = (t: number) => pad.l + ((t - xMin) / xSpan) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - yMin) / ySpan) * (H - pad.t - pad.b);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(1)},${y(p.val).toFixed(1)}`)
    .join(" ");
  const areaD = `${d} L${x(xMax)},${H - pad.b} L${x(xMin)},${H - pad.b} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full">
      <defs>
        <linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#chart-area)" />
      <path
        d={d}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle key={i} cx={x(p.ts)} cy={y(p.val)} r={2} fill={isCalories && p.isCheatDay ? "var(--color-destructive)" : "var(--color-accent)"} />
      ))}
      <text x={pad.l} y={H - 6} fontSize={10} fill="var(--color-muted-foreground)">
        {new Date(xMin).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </text>
      <text
        x={W - pad.r}
        y={H - 6}
        fontSize={10}
        textAnchor="end"
        fill="var(--color-muted-foreground)"
      >
        {new Date(xMax).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </text>
      <text
        x={W - pad.r}
        y={pad.t + 4}
        fontSize={10}
        textAnchor="end"
        fill="var(--color-muted-foreground)"
      >
        {yMax} {unit}
      </text>
    </svg>
  );
}
