import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { estimated1RM, useStore } from "../lib/store";

export const Route = createFileRoute("/charts")({
  head: () => ({
    meta: [
      { title: "Charts" },
      { name: "description", content: "Estimated 1RM trend per exercise." },
      { property: "og:title", content: "Charts" },
      { property: "og:description", content: "Estimated 1RM trend per exercise." },
    ],
  }),
  component: ChartsPage,
});

function ChartsPage() {
  const exercises = useStore((s) => s.exercises);
  const sets = useStore((s) => s.sets);
  const unit = useStore((s) => s.unit);

  const withData = useMemo(() => exercises.filter((e) => sets.some((s) => s.exerciseId === e.id)), [exercises, sets]);
  const [selectedId, setSelectedId] = useState<string>(withData[0]?.id ?? "");

  const points = useMemo(() => {
    if (!selectedId) return [];
    const byDay = new Map<string, number>();
    for (const s of sets.filter((x) => x.exerciseId === selectedId)) {
      const day = new Date(s.loggedAt);
      day.setHours(0, 0, 0, 0);
      const k = String(day.getTime());
      const e1rm = estimated1RM(s.weight, s.reps);
      if (!byDay.has(k) || byDay.get(k)! < e1rm) byDay.set(k, e1rm);
    }
    return [...byDay.entries()]
      .map(([ts, e1rm]) => ({ ts: Number(ts), e1rm }))
      .sort((a, b) => a.ts - b.ts);
  }, [selectedId, sets]);

  return (
    <AppShell>
      <header className="px-5 pb-4 pt-14">
        <h1 className="text-[30px] font-semibold tracking-tight">Charts</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">Estimated 1RM over time.</p>
      </header>

      <div data-swipe-ignore className="scrollbar-none flex gap-2 overflow-x-auto px-5 pb-4 anim-fade-up">
        {withData.map((e) => (
          <button
            key={e.id}
            onClick={() => setSelectedId(e.id)}
            className={
              "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200 " +
              (selectedId === e.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground")
            }
          >
            {e.name}
          </button>
        ))}
      </div>

      <div className="mx-5 rounded-2xl bg-surface p-5 hairline-t hairline-b anim-fade-up" style={{ animationDelay: "40ms" }}>
        <Chart points={points} unit={unit} />
        <div className="mt-4 flex items-baseline justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Current e1RM</div>
            <div className="tnum mt-0.5 text-[26px] font-semibold">
              {points.length > 0 ? points[points.length - 1].e1rm : "—"}
              <span className="ml-1 text-[12px] font-normal text-muted-foreground">{unit}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Sessions</div>
            <div className="tnum mt-0.5 text-[26px] font-semibold">{points.length}</div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Chart({ points, unit }: { points: { ts: number; e1rm: number }[]; unit: string }) {
  const W = 320;
  const H = 180;
  const pad = { l: 8, r: 8, t: 12, b: 20 };
  if (points.length < 2) {
    return <div className="flex h-[180px] items-center justify-center text-[13px] text-muted-foreground">Not enough data yet.</div>;
  }
  const xs = points.map((p) => p.ts);
  const ys = points.map((p) => p.e1rm);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const ySpan = Math.max(1, yMax - yMin);
  const xSpan = Math.max(1, xMax - xMin);
  const x = (t: number) => pad.l + ((t - xMin) / xSpan) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - yMin) / ySpan) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(1)},${y(p.e1rm).toFixed(1)}`).join(" ");
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
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(p.ts)} cy={y(p.e1rm)} r={2} fill="var(--color-accent)" />
      ))}
      <text x={pad.l} y={H - 6} fontSize={10} fill="var(--color-muted-foreground)">
        {new Date(xMin).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </text>
      <text x={W - pad.r} y={H - 6} fontSize={10} textAnchor="end" fill="var(--color-muted-foreground)">
        {new Date(xMax).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </text>
      <text x={W - pad.r} y={pad.t + 4} fontSize={10} textAnchor="end" fill="var(--color-muted-foreground)">
        {yMax} {unit}
      </text>
    </svg>
  );
}
