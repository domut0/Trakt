import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { DayEditorSheet } from "../components/DayEditorSheet";
import { dayKey } from "../lib/daily-log";
import { isCardioSession, useStore, type DailyLog } from "../lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Anything But The Notes App" },
      {
        name: "description",
        content:
          "A frictionless workout logger for lifters. Weight and reps — nothing else in the way.",
      },
      { property: "og:title", content: "Anything But The Notes App" },
      {
        property: "og:description",
        content:
          "A frictionless workout logger for lifters. Weight and reps — nothing else in the way.",
      },
    ],
  }),
  component: Home,
});

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric" });
}

function isSameLocalDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function Home() {
  const [openDayEditor, setOpenDayEditor] = useState(false);
  const router = useRouter();
  const sessions = useStore((s) => s.sessions);
  const slots = useStore((s) => s.slots);
  const sets = useStore((s) => s.sets);
  const dailyLogs = useStore((s) => s.dailyLogs);
  const unit = useStore((s) => s.unit);
  const exercises = useStore((s) => s.exercises);

  // Recomputed per render rather than memoised: the app can sit open across
  // midnight, and a stale key would silently edit yesterday.
  const todayKey = dayKey(new Date());
  const todayLog = dailyLogs.find((l) => l.date === todayKey);

  const todaysSessions = useMemo(() => {
    const now = new Date();
    return (
      [...sessions]
        // Bucketed by startedAt, matching CalendarView and WeeklyView. A session
        // running past midnight belongs to the day you started training, and all
        // three surfaces must agree or the same workout appears on two dates.
        .filter((s) => s.endedAt && isSameLocalDay(new Date(s.startedAt), now))
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((s) => {
          if (isCardioSession(s)) {
            const ex = exercises.find((e) => e.id === s.cardioExerciseId);
            const subtitleElements: string[] = [];
            if (s.durationMinutes !== undefined) subtitleElements.push(`${s.durationMinutes} min`);
            if (s.distance !== undefined)
              subtitleElements.push(`${s.distance} ${unit === "lbs" ? "mi" : "km"}`);
            return {
              session: s,
              title: ex?.name ?? "Cardio",
              subtitle: subtitleElements.length > 0 ? subtitleElements.join(" · ") : null,
            };
          }
          const slot = slots.find((sl) => sl.id === s.splitSlotId);
          const setCount = sets.filter((x) => x.sessionId === s.id).length;
          return {
            session: s,
            title: slot?.name ?? "Untitled",
            subtitle: `${setCount} sets`,
          };
        })
    );
  }, [sessions, slots, sets, exercises, unit]);

  return (
    <AppShell>
      <header className="px-5 pb-4 pt-14">
        <h1 className="text-[34px] font-semibold leading-none tracking-tight">Today</h1>
      </header>

      <div className="mt-2 px-5 anim-fade-up">
        <h2 className="pb-2 text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">
          Daily log
        </h2>
        <button
          onClick={() => setOpenDayEditor(true)}
          className="block w-full rounded-2xl bg-surface px-5 py-4 text-left"
        >
          {todayLog ? (
            <DayLogSummary log={todayLog} unit={unit} />
          ) : (
            <div className="text-[13px] text-muted-foreground">
              Nothing logged today. Tap to add calories, macros, steps or bodyweight.
            </div>
          )}
        </button>
      </div>

      <div className="mt-8 px-5 anim-fade-up">
        <h2 className="pb-2 text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">
          Workouts
        </h2>
        {todaysSessions.length > 0 ? (
          <ul className="space-y-3">
            {todaysSessions.map(({ session, title, subtitle }) => (
              <li key={session.id}>
                <button
                  onClick={() =>
                    router.navigate({ to: "/session/$id", params: { id: session.id } })
                  }
                  className="flex w-full items-center justify-between rounded-2xl bg-surface px-5 py-4 text-left"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[16px] font-semibold tracking-tight">{title}</span>
                      {subtitle && (
                        <span className="text-[12px] text-muted-foreground">· {subtitle}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-[12px] text-muted-foreground">
                    {fmtTime(session.startedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[13px] text-muted-foreground">No workouts logged today</div>
        )}
      </div>

      <DayEditorSheet
        date={todayKey}
        open={openDayEditor}
        onClose={() => setOpenDayEditor(false)}
      />
    </AppShell>
  );
}

function DayLogSummary({ log, unit }: { log: DailyLog; unit: "lbs" | "kg" }) {
  const carbCal = (log.carbs ?? 0) * 4;
  const proteinCal = (log.protein ?? 0) * 4;
  const fatCal = (log.fat ?? 0) * 9;
  const macroTotal = carbCal + proteinCal + fatCal;

  const hasMacros = log.carbs !== undefined || log.protein !== undefined || log.fat !== undefined;
  const hasCalories = log.calories !== undefined;

  const showRing = hasCalories || hasMacros;

  const stats: { label: string; value: string }[] = [];
  if (log.steps !== undefined) stats.push({ label: "steps", value: log.steps.toLocaleString() });
  if (log.bodyweight !== undefined) stats.push({ label: unit, value: String(log.bodyweight) });

  return (
    <div className="flex flex-col gap-5">
      {showRing && (
        <div className="flex items-center gap-6">
          <MacroRing
            log={log}
            carbCal={carbCal}
            proteinCal={proteinCal}
            fatCal={fatCal}
            macroTotal={macroTotal}
          />
          {hasMacros && macroTotal > 0 && (
            <div className="flex flex-1 justify-between gap-2 pr-2">
              <MacroColumn
                name="Carbs"
                grams={log.carbs ?? 0}
                cal={carbCal}
                total={macroTotal}
                colorClass="text-carbs"
              />
              <MacroColumn
                name="Fat"
                grams={log.fat ?? 0}
                cal={fatCal}
                total={macroTotal}
                colorClass="text-fat"
              />
              <MacroColumn
                name="Protein"
                grams={log.protein ?? 0}
                cal={proteinCal}
                total={macroTotal}
                colorClass="text-protein"
              />
            </div>
          )}
        </div>
      )}
      {(stats.length > 0 || log.isCheatDay) && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {stats.map((s) => (
            <span key={s.label} className="text-[15px]">
              <span className="tnum font-semibold">{s.value}</span>{" "}
              <span className="text-[12px] text-muted-foreground">{s.label}</span>
            </span>
          ))}
          {log.isCheatDay && (
            <span className="text-[13px] font-medium text-destructive">Cheat day</span>
          )}
        </div>
      )}
    </div>
  );
}

function MacroColumn({
  name,
  grams,
  cal,
  total,
  colorClass,
}: {
  name: string;
  grams: number;
  cal: number;
  total: number;
  colorClass: string;
}) {
  const pct = Math.round((cal / total) * 100);
  return (
    <div className="flex flex-col items-center">
      <span className={`text-[12px] font-semibold ${colorClass}`}>{pct}%</span>
      <span className="tnum mt-0.5 text-[18px] font-bold leading-none">{grams}g</span>
      <span className="mt-1 text-[12px] text-muted-foreground">{name}</span>
    </div>
  );
}

function MacroRing({
  log,
  carbCal,
  proteinCal,
  fatCal,
  macroTotal,
}: {
  log: DailyLog;
  carbCal: number;
  proteinCal: number;
  fatCal: number;
  macroTotal: number;
}) {
  const size = 72;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const centerText = log.calories !== undefined ? log.calories : macroTotal;
  const isNeutralRing = macroTotal === 0;

  let offset = 0;

  const segments = [
    { cal: carbCal, color: "var(--color-carbs)" },
    { cal: fatCal, color: "var(--color-fat)" },
    { cal: proteinCal, color: "var(--color-protein)" },
  ];

  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-muted-foreground)"
          opacity="0.2"
          strokeWidth={strokeWidth}
        />
        {!isNeutralRing &&
          segments.map((seg, i) => {
            if (seg.cal === 0) return null;
            const fraction = seg.cal / macroTotal;
            const dasharray = `${fraction * circumference} ${circumference - fraction * circumference}`;
            const dashoffset = -offset * circumference;
            offset += fraction;
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={dasharray}
                strokeDashoffset={dashoffset}
                strokeLinecap="butt"
              />
            );
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-0.5">
        <span className="tnum text-[15px] font-bold leading-none">{centerText}</span>
        <span className="mt-1 text-[11px] font-medium leading-none text-muted-foreground">cal</span>
      </div>
    </div>
  );
}
