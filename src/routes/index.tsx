import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { DayEditorSheet } from "../components/DayEditorSheet";
import { HabitsCard } from "../components/HabitsCard";
import { dayKey, isDailyLogEmpty } from "../lib/daily-log";
import {
  isCardioSession,
  useStore,
  type DailyLog,
  type TargetProfile,
  type WorkoutSession,
} from "../lib/store";
import {
  targetProgressFor,
  WEEKDAY_LABELS,
  weekdayIndexFor,
  type TargetProgress,
} from "../lib/targets";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Anything But The Notes App" },
      {
        name: "description",
        content:
          "A frictionless workout logger for lifters. Weight and reps - nothing else in the way.",
      },
      { property: "og:title", content: "Anything But The Notes App" },
      {
        property: "og:description",
        content:
          "A frictionless workout logger for lifters. Weight and reps - nothing else in the way.",
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

function formatYesterdaySummary(log: DailyLog): string {
  const parts: string[] = [];
  if (log.calories !== undefined) parts.push(`${log.calories.toLocaleString()} cal`);
  if (log.protein !== undefined) parts.push(`${log.protein}g P`);
  if (log.carbs !== undefined) parts.push(`${log.carbs}g C`);
  if (log.fat !== undefined) parts.push(`${log.fat}g F`);
  return parts.join(" · ");
}

function Home() {
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const router = useRouter();
  const sessions = useStore((s) => s.sessions);
  const slots = useStore((s) => s.slots);
  const sets = useStore((s) => s.sets);
  const dailyLogs = useStore((s) => s.dailyLogs);
  const unit = useStore((s) => s.unit);
  const exercises = useStore((s) => s.exercises);
  const targetsEnabled = useStore((s) => s.targetsEnabled);
  const habitsEnabled = useStore((s) => s.habitsEnabled);
  const targetProfileForDate = useStore((s) => s.targetProfileForDate);
  const upsertDailyLog = useStore((s) => s.upsertDailyLog);

  // Recomputed per render rather than memoised: the app can sit open across
  // midnight, and a stale key would silently edit yesterday.
  const todayKey = dayKey(new Date());
  const todayLog = dailyLogs.find((l) => l.date === todayKey);
  const todayProfile = targetsEnabled ? targetProfileForDate(todayKey) : undefined;

  // Yesterday date calculation for the "Copy Yesterday" shortcut action.
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = dayKey(yesterdayDate);
  const yesterdayLog = dailyLogs.find((l) => l.date === yesterdayKey && !isDailyLogEmpty(l));

  const hasTodayLog = todayLog !== undefined && !isDailyLogEmpty(todayLog);
  const canCopyYesterday =
    !hasTodayLog &&
    yesterdayLog !== undefined &&
    (yesterdayLog.calories !== undefined ||
      yesterdayLog.protein !== undefined ||
      yesterdayLog.carbs !== undefined ||
      yesterdayLog.fat !== undefined);

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
      <header className="px-5 pt-14 pb-2">
        <h1 className="t-title">Today</h1>
      </header>

      {/* Consistency strip: visual status and backfill entry for the last 7 calendar days */}
      <ConsistencyStrip
        dailyLogs={dailyLogs}
        sessions={sessions}
        todayKey={todayKey}
        onSelectDate={(key) => setEditingDate(key)}
      />

      {/*
        First card on the screen, ahead of the daily log, because this is the
        one thing that gets tapped every single morning and it needs to sit at
        the same y-offset every time. Below the daily log its position would
        drift by 100px or more depending on whether macros, target bars and the
        copy-yesterday button happen to be showing, so the thumb could not
        learn it.

        No HabitEditorSheet here on purpose: HabitsCard already owns the sheet
        and its open state internally, so mounting one here too would give the
        screen a second, independent editor.
      */}
      {habitsEnabled && (
        <section className="px-5 section-gap anim-fade-up">
          <h2 className="group-header px-0 t-caption">Habits</h2>
          <HabitsCard date={todayKey} />
        </section>
      )}

      <section className="px-5 section-gap anim-fade-up">
        <h2 className="group-header px-0 t-caption">Daily log</h2>
        <div className="group-list p-5">
          {hasTodayLog ? (
            <button
              onClick={() => setEditingDate(todayKey)}
              className="w-full text-left focus:outline-none min-h-[44px]"
            >
              <DayLogSummary
                log={todayLog!}
                unit={unit}
                targetsEnabled={targetsEnabled}
                profile={todayProfile}
              />
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setEditingDate(todayKey)}
                className="flex min-h-[44px] w-full items-center text-left t-label text-muted-foreground focus:outline-none"
              >
                Nothing logged today. Tap to add calories, macros, steps or bodyweight.
              </button>

              {canCopyYesterday && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    upsertDailyLog(todayKey, {
                      calories: yesterdayLog.calories,
                      protein: yesterdayLog.protein,
                      carbs: yesterdayLog.carbs,
                      fat: yesterdayLog.fat,
                    });
                  }}
                  className="flex min-h-[44px] w-full items-center justify-between border-t border-border pt-3 text-left transition-colors active:opacity-70"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                    <span className="t-label font-semibold text-accent shrink-0">
                      Copy yesterday
                    </span>
                    <span className="t-label truncate text-muted-foreground">
                      ({formatYesterdaySummary(yesterdayLog)})
                    </span>
                  </div>
                  <span className="t-label font-semibold text-accent shrink-0">Copy</span>
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="px-5 section-gap pb-8 anim-fade-up">
        <h2 className="group-header px-0 t-caption">Workouts</h2>
        {todaysSessions.length > 0 ? (
          <div className="group-list">
            {todaysSessions.map(({ session, title, subtitle }, idx) => (
              <button
                key={session.id}
                onClick={() => router.navigate({ to: "/session/$id", params: { id: session.id } })}
                className={`group-row w-full text-left focus:outline-none ${
                  idx > 0 ? "group-row-sep" : ""
                }`}
              >
                <div className="min-w-0 flex-1 pr-3">
                  {/* The subtitle and the time need shrink-0 for the title's
                      `truncate` to be the thing that gives: otherwise flex
                      compresses "· 12 sets" and "3 PM" first and a long split
                      name still pushes the row wide. */}
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate t-body font-semibold tracking-tight">{title}</span>
                    {subtitle && (
                      <span className="shrink-0 t-label text-muted-foreground">· {subtitle}</span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 t-label text-muted-foreground">
                  {fmtTime(session.startedAt)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="group-list px-5 py-4">
            <p className="t-label text-muted-foreground">No workouts logged today</p>
          </div>
        )}
      </section>

      <DayEditorSheet
        date={editingDate ?? todayKey}
        open={editingDate !== null}
        onClose={() => setEditingDate(null)}
      />
    </AppShell>
  );
}

/**
 * Visual consistency strip showing status indicators for the last 7 calendar days.
 *
 * Each day is tappable to open the day editor and backfill missing entries.
 * Indicator dots show whether a daily log was recorded (green), a workout was
 * trained (blue), or both. Today is highlighted with an accent ring.
 */
function ConsistencyStrip({
  dailyLogs,
  sessions,
  todayKey,
  onSelectDate,
}: {
  dailyLogs: DailyLog[];
  sessions: WorkoutSession[];
  /**
   * Passed in rather than derived here, and it is what keeps this memo honest.
   *
   * The window below is relative to "now", but a useMemo keyed only on the data
   * has no reason to re-run when the DATE changes. Left to compute its own key,
   * this strip would sit on yesterday's seven days and mark the wrong cell as
   * today for as long as the app stayed open across midnight, while the parent's
   * own `todayKey` moved on correctly. Taking it as a prop puts the date in the
   * dependency list, so midnight invalidates the memo like any other input.
   */
  todayKey: string;
  onSelectDate: (dateKey: string) => void;
}) {
  const days = useMemo(() => {
    const result = [];
    const now = new Date();
    const todayK = todayKey;
    // 7 days ending with today (i=6 down to 0)
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = dayKey(d);
      const hasLog = dailyLogs.some((l) => l.date === key && !isDailyLogEmpty(l));
      const hasWorkout = sessions.some((s) => {
        if (!s.endedAt) return false;
        return dayKey(new Date(s.startedAt)) === key;
      });
      const weekdayLabel = WEEKDAY_LABELS[weekdayIndexFor(d)];
      const isToday = key === todayK;
      result.push({ key, date: d, weekdayLabel, hasLog, hasWorkout, isToday });
    }
    return result;
  }, [dailyLogs, sessions, todayKey]);

  return (
    <section className="px-5 section-gap anim-fade-up">
      <div className="group-header flex items-center justify-between px-0">
        <h2 className="t-caption">Consistency</h2>
        <span className="t-label text-muted-foreground">Last 7 days</span>
      </div>
      <div className="group-list p-3">
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => {
            let statusText = "Nothing tracked";
            if (d.hasWorkout && d.hasLog) statusText = "Workout trained and daily log recorded";
            else if (d.hasWorkout) statusText = "Workout trained";
            else if (d.hasLog) statusText = "Daily log recorded";

            return (
              <button
                key={d.key}
                type="button"
                onClick={() => onSelectDate(d.key)}
                aria-label={`Log for ${d.weekdayLabel} ${d.date.getDate()}: ${statusText}${d.isToday ? " (Today)" : ""}`}
                className="flex flex-col items-center justify-center min-h-[44px] py-1.5 px-0.5 rounded-xl transition-colors hover:bg-muted/40 active:scale-95 text-center focus:outline-none"
              >
                <span
                  className={`t-caption ${
                    d.isToday ? "text-accent font-bold" : "text-muted-foreground"
                  }`}
                >
                  {d.weekdayLabel}
                </span>

                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full t-body font-semibold my-1 ${
                    d.isToday
                      ? "ring-2 ring-accent ring-offset-2 ring-offset-surface text-foreground"
                      : "text-foreground"
                  }`}
                >
                  {d.date.getDate()}
                </div>

                <div className="flex items-center justify-center gap-1 h-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full transition-colors ${
                      d.hasWorkout ? "bg-accent" : "bg-muted"
                    }`}
                  />
                  <span
                    className={`h-1.5 w-1.5 rounded-full transition-colors ${
                      d.hasLog ? "bg-nutrition" : "bg-muted"
                    }`}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function DayLogSummary({
  log,
  unit,
  targetsEnabled,
  profile,
}: {
  log: DailyLog;
  unit: "lbs" | "kg";
  targetsEnabled: boolean;
  profile: TargetProfile | undefined;
}) {
  const carbCal = (log.carbs ?? 0) * 4;
  const proteinCal = (log.protein ?? 0) * 4;
  const fatCal = (log.fat ?? 0) * 9;
  const macroTotal = carbCal + proteinCal + fatCal;

  const hasMacros = log.carbs !== undefined || log.protein !== undefined || log.fat !== undefined;
  const hasCalories = log.calories !== undefined;

  const showRing = hasCalories || hasMacros;

  const progressRows = useMemo(
    () => (targetsEnabled && profile ? targetProgressFor(log, profile) : []),
    [log, targetsEnabled, profile],
  );

  const calProgress = progressRows.find((p) => p.field === "calories");
  const otherProgressRows = progressRows.filter((p) => p.field !== "calories");

  const stats: { label: string; value: string }[] = [];
  if (log.steps !== undefined) stats.push({ label: "steps", value: log.steps.toLocaleString() });
  if (log.bodyweight !== undefined) stats.push({ label: unit, value: String(log.bodyweight) });

  return (
    <div className="flex flex-col gap-4">
      {showRing && (
        <div className="flex items-center gap-4">
          {targetsEnabled && calProgress ? (
            <CalorieTargetRing
              logged={calProgress.logged}
              target={calProgress.target}
              fraction={calProgress.fraction}
            />
          ) : (
            <MacroRing
              log={log}
              carbCal={carbCal}
              proteinCal={proteinCal}
              fatCal={fatCal}
              macroTotal={macroTotal}
            />
          )}
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

      {targetsEnabled && otherProgressRows.length > 0 && (
        <div className="flex flex-col gap-2.5 pt-3 border-t border-border">
          {otherProgressRows.map((p) => (
            <SlimProgressBar key={p.field} progress={p} />
          ))}
        </div>
      )}

      {(stats.length > 0 || log.isCheatDay) && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {stats.map((s) => (
            <span key={s.label} className="t-body">
              <span className="t-stat font-semibold">{s.value}</span>{" "}
              <span className="t-label text-muted-foreground">{s.label}</span>
            </span>
          ))}
          {log.isCheatDay && (
            <span className="t-label font-medium text-destructive">Cheat day</span>
          )}
        </div>
      )}
    </div>
  );
}

function SlimProgressBar({ progress }: { progress: TargetProgress }) {
  const fieldColors: Record<string, string> = {
    protein: "var(--color-protein)",
    carbs: "var(--color-carbs)",
    fat: "var(--color-fat)",
    steps: "var(--color-steps)",
  };

  const fieldLabels: Record<string, string> = {
    protein: "Protein",
    carbs: "Carbs",
    fat: "Fat",
    steps: "Steps",
  };

  const isOver = progress.fraction > 1;
  const unitSuffix = progress.field === "steps" ? "" : "g";
  const label = fieldLabels[progress.field] ?? progress.field;
  const color = fieldColors[progress.field] ?? "var(--color-accent)";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between t-label">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="t-label font-semibold">
          {progress.logged.toLocaleString()}
          {unitSuffix}
          <span className="text-muted-foreground font-normal">
            {" "}
            / {progress.target.toLocaleString()}
            {unitSuffix}
          </span>
          {isOver && <span className="ml-1.5 t-caption text-destructive">OVER</span>}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(progress.fraction * 100, 100)}%`,
            backgroundColor: isOver ? "var(--color-destructive)" : color,
          }}
        />
      </div>
    </div>
  );
}

function CalorieTargetRing({
  logged,
  target,
  fraction,
}: {
  logged: number;
  target: number;
  fraction: number;
}) {
  const size = 72;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const isOver = fraction > 1;
  const clampedFraction = Math.min(fraction, 1);
  const mainDash = `${clampedFraction * circumference} ${circumference * (1 - clampedFraction)}`;

  const excessFraction = isOver ? Math.min(fraction - 1, 1) : 0;
  const excessDash = `${excessFraction * circumference} ${circumference * (1 - excessFraction)}`;

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
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={strokeWidth}
          strokeDasharray={mainDash}
          strokeDashoffset={0}
          strokeLinecap="round"
        />
        {isOver && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-destructive)"
            strokeWidth={strokeWidth}
            strokeDasharray={excessDash}
            strokeDashoffset={0}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-0.5 text-center">
        <span className={`t-body font-bold leading-none ${isOver ? "text-destructive" : ""}`}>
          {logged.toLocaleString()}
        </span>
        <span className="mt-0.5 t-caption leading-none text-muted-foreground font-normal">
          / {target.toLocaleString()}
        </span>
      </div>
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
      <span className={`t-label font-semibold ${colorClass}`}>{pct}%</span>
      <span className="t-stat mt-0.5 leading-none">{grams}g</span>
      <span className="mt-1 t-label text-muted-foreground">{name}</span>
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
        <span className="t-body font-bold leading-none">{centerText}</span>
        <span className="mt-1 t-caption leading-none text-muted-foreground font-normal">cal</span>
      </div>
    </div>
  );
}
