import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowUp, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { DayEditorSheet } from "../components/DayEditorSheet";
import { HabitsCard } from "../components/HabitsCard";
import { MealSection } from "../components/MealSection";
import { dayKey, isDailyLogEmpty } from "../lib/daily-log";
import { entriesByDate, entriesByMeal, type ResolvedDayMacros } from "../lib/food";
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
  type TargetStatus,
} from "../lib/targets";
import { useDayMacros, useEffectiveDailyLogs } from "../lib/use-day-macros";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Anything But The Notes App" },
      {
        name: "description",
        content:
          "A frictionless workout logger for lifters. Weight and reps, nothing else in the way.",
      },
      { property: "og:title", content: "Anything But The Notes App" },
      {
        property: "og:description",
        content:
          "A frictionless workout logger for lifters. Weight and reps, nothing else in the way.",
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
  // The projection, not the raw table: a day logged purely through food
  // entries has no typed macros, so reading s.dailyLogs here would report it as
  // untracked while the ring directly above showed its calories.
  const dailyLogs = useEffectiveDailyLogs();
  const unit = useStore((s) => s.unit);
  const exercises = useStore((s) => s.exercises);
  const targetsEnabled = useStore((s) => s.targetsEnabled);
  const habitsEnabled = useStore((s) => s.habitsEnabled);
  const foodEnabled = useStore((s) => s.foodEnabled);
  const meals = useStore((s) => s.meals);
  const foodEntries = useStore((s) => s.foodEntries);
  const targetProfileForDate = useStore((s) => s.targetProfileForDate);
  const upsertDailyLog = useStore((s) => s.upsertDailyLog);

  // Recomputed per render rather than memoised: the app can sit open across
  // midnight, and a stale key would silently edit yesterday.
  const todayKey = dayKey(new Date());
  const todayLog = dailyLogs.find((l) => l.date === todayKey);
  const todayProfile = targetsEnabled ? targetProfileForDate(todayKey) : undefined;
  const todayMacros = useDayMacros(todayKey);

  const todayFoodEntries = useMemo(
    () => entriesByDate(foodEntries).get(todayKey) ?? [],
    [foodEntries, todayKey],
  );
  const mealGroups = useMemo(
    () => entriesByMeal(meals, todayFoodEntries),
    [meals, todayFoodEntries],
  );

  // Yesterday date calculation for the "Copy Yesterday" shortcut action.
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = dayKey(yesterdayDate);
  const yesterdayLog = dailyLogs.find((l) => l.date === yesterdayKey && !isDailyLogEmpty(l));

  const hasTodayLog =
    todayMacros.source !== "none" || (todayLog !== undefined && !isDailyLogEmpty(todayLog));
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
        <h2 className="group-header px-0 t-caption">Daily numbers</h2>
        {/*
          The one elevated surface on the screen, and it is elevated with FILL,
          which is what DESIGN.md asks for: no border, no shadow. `--muted`
          #232b36 over `--surface` #1a2029 is the same kind of step `--surface`
          already makes over `--background` #0e1217, so the ladder is
          background / everything else / this. Every other container on Today
          stays `group-list` at `--surface`; if a second card ever takes this
          fill, the step stops meaning anything and both should go back.

          `bg-muted` after `group-list` is the override: Tailwind emits core
          colour utilities after custom `@utility` blocks, so the later rule
          wins. Verified in the built stylesheet and in the screenshots.
        */}
        <div className="group-list bg-muted p-5">
          {hasTodayLog ? (
            <button
              onClick={() => setEditingDate(todayKey)}
              className="w-full text-left focus:outline-none min-h-[44px]"
            >
              <DayLogSummary
                log={todayLog}
                macros={todayMacros}
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
                Nothing logged today.
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

      {/* Render meals in rank order below the calorie ring, only when foodEnabled is on */}
      {foodEnabled && (
        <div>
          {mealGroups.map(({ meal, entries }) => (
            <MealSection key={meal.id} meal={meal} entries={entries} date={todayKey} />
          ))}
        </div>
      )}

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
            <p className="t-label text-muted-foreground">You haven't trained yet.</p>
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
            if (d.hasWorkout && d.hasLog) statusText = "Workout and daily numbers logged";
            else if (d.hasWorkout) statusText = "Workout logged";
            else if (d.hasLog) statusText = "Daily numbers logged";

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

                {/* 10px, not 6px. These two dots are the entire payload of the
                    strip and a 6px disc is too small for a hue to register as
                    a hue: at that size accent blue and nutrition green were
                    reading as two grey specks. The day button keeps its 44px
                    hit area regardless, since the dots sit inside it. */}
                <div className="flex h-2.5 items-center justify-center gap-1">
                  <span
                    className={`h-2.5 w-2.5 rounded-full transition-colors ${
                      d.hasWorkout ? "bg-accent" : "bg-muted"
                    }`}
                  />
                  <span
                    className={`h-2.5 w-2.5 rounded-full transition-colors ${
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
  macros,
  unit,
  targetsEnabled,
  profile,
}: {
  log: DailyLog | undefined;
  macros: ResolvedDayMacros;
  unit: "lbs" | "kg";
  targetsEnabled: boolean;
  profile: TargetProfile | undefined;
}) {
  const calories = macros.calories ?? log?.calories;
  const protein = macros.protein ?? log?.protein;
  const carbs = macros.carbs ?? log?.carbs;
  const fat = macros.fat ?? log?.fat;

  const carbCal = (carbs ?? 0) * 4;
  const proteinCal = (protein ?? 0) * 4;
  const fatCal = (fat ?? 0) * 9;
  const macroTotal = carbCal + proteinCal + fatCal;

  const hasMacros = carbs !== undefined || protein !== undefined || fat !== undefined;
  const hasCalories = calories !== undefined;

  const showRing = hasCalories || hasMacros;

  const effectiveLog: DailyLog = useMemo(
    () => ({
      ...(log ?? { date: "" }),
      calories,
      protein,
      carbs,
      fat,
    }),
    [log, calories, protein, carbs, fat],
  );

  const progressRows = useMemo(
    () => (targetsEnabled && profile ? targetProgressFor(effectiveLog, profile) : []),
    [effectiveLog, targetsEnabled, profile],
  );

  const calProgress = progressRows.find((p) => p.field === "calories");
  const otherProgressRows = progressRows.filter((p) => p.field !== "calories");

  const stats: { label: string; value: string }[] = [];
  if (log?.steps !== undefined) stats.push({ label: "steps", value: log.steps.toLocaleString() });
  if (log?.bodyweight !== undefined) stats.push({ label: unit, value: String(log.bodyweight) });

  return (
    <div className="flex flex-col gap-4">
      {/* The subject of the screen. The ring is centred and sized around the
          calorie number rather than the number being shrunk to fit the ring,
          so the one figure the user opened this screen for is the first thing
          the eye lands on. The macros read underneath it as its parts. */}
      {showRing && (
        <div className="flex flex-col items-center gap-4">
          {targetsEnabled && calProgress ? (
            <CalorieTargetRing progress={calProgress} />
          ) : (
            <MacroRing
              calories={calories}
              carbCal={carbCal}
              proteinCal={proteinCal}
              fatCal={fatCal}
              macroTotal={macroTotal}
            />
          )}
          {hasMacros && macroTotal > 0 && (
            <div className="flex w-full items-start justify-around gap-3">
              <MacroColumn name="Carbs" grams={carbs ?? 0} colorClass="text-carbs" />
              <MacroColumn name="Fat" grams={fat ?? 0} colorClass="text-fat" />
              <MacroColumn name="Protein" grams={protein ?? 0} colorClass="text-protein" />
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

      {(stats.length > 0 || log?.isCheatDay) && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {stats.map((s) => (
            <span key={s.label} className="t-body">
              <span className="t-stat font-semibold">{s.value}</span>{" "}
              <span className="t-label text-muted-foreground">{s.label}</span>
            </span>
          ))}
          {/* A label the user applies to themselves, not a fault the app found.
              It was red, which made a deliberate choice look like an error and
              collided with the goal states above it; state colour belongs to a
              value measured against a goal, and this is neither. */}
          {log?.isCheatDay && (
            <span className="t-label font-medium text-muted-foreground">Cheat day</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The colour a goal's state earns.
 *
 * `progress` deliberately keeps the field's own identity colour. A day in flight
 * is the common case, and a screen where every row is shouting has no way left
 * to say "this one matters"; only reaching or breaking a goal changes colour.
 *
 * Note what is absent: `--destructive`. Falling short of a goal is not an error,
 * and passing one is frequently the entire point. See DESIGN.md: red is for
 * things that break, not for numbers that are large.
 */
function goalStateColor(status: TargetStatus, fieldColor: string): string {
  switch (status) {
    case "met":
      return "var(--color-success)";
    case "exceeded":
      return "var(--color-warning)";
    case "progress":
      return fieldColor;
  }
}

/** Signed distance from target, rounded for display. Logged values are whole
 * numbers in practice, but a hand-typed 62.5g of fat must not print as +0.5000001g. */
function overBy(progress: TargetProgress): number {
  return Math.round(progress.delta);
}

interface GoalNote {
  text: string;
  /** The non-colour half of the signal. See `GoalStateNote`. */
  mark: "check" | "over";
  tone: string;
}

/**
 * The words and the mark a reached or broken goal earns.
 *
 * A beaten floor reads as a gain (`+26g`), a broken ceiling reads as a quantity
 * (`26g over`), and a day still in flight says nothing at all. The distinction is
 * the whole point of this change: the same +26 is a good day on protein and a bad
 * one on fat, and only the goal's direction knows which.
 *
 * Every state returns TEXT, never a bare colour, because success and warning are
 * far apart to most eyes but collapse to nearly the same olive under protanopia
 * (37.9 to about 10 in CIEDE2000). The words carry the meaning; the hue only
 * agrees with them.
 */
function goalStateNote(progress: TargetProgress, unitSuffix: string): GoalNote | null {
  const over = overBy(progress);
  switch (progress.status) {
    case "exceeded":
      return {
        text: over > 0 ? `${over.toLocaleString()}${unitSuffix} over` : "Over",
        mark: "over",
        tone: "var(--color-warning)",
      };
    case "met":
      // A floor beaten has a surplus worth naming. A band landed on does not:
      // 3g of carbs inside the tolerance is noise, and printing "+3g" next to a
      // met goal invites reading it as a miss.
      return {
        text:
          progress.direction === "floor" && over > 0
            ? `+${over.toLocaleString()}${unitSuffix}`
            : "Goal met",
        mark: "check",
        tone: "var(--color-success)",
      };
    case "progress":
      return null;
  }
}

/**
 * The note as rendered: a glyph and then the words.
 *
 * The glyph is not decoration. It is the carrier that survives a display, a
 * simulation or an eye that cannot separate the two state hues, and it is the
 * only thing distinguishing a goal met exactly (no surplus to print) from a
 * small overage.
 */
function GoalStateNote({ note, className = "" }: { note: GoalNote; className?: string }) {
  const Icon = note.mark === "check" ? Check : ArrowUp;
  return (
    <span
      className={`flex items-center gap-1 whitespace-nowrap font-semibold ${className}`}
      style={{ color: note.tone }}
    >
      <Icon size={12} strokeWidth={3} aria-hidden="true" />
      {note.text}
    </span>
  );
}

/**
 * What a screen reader hears in place of the bar or the ring.
 *
 * These sit inside the day-log card, which is one big button, so the reader
 * announces the button's name and never walks into the widgets. A `progressbar`
 * role would take its value with it into a name computation that ignores values;
 * an `img` with a written-out label is what actually reaches the user, and it is
 * the same sentence a sighted user reads off the row.
 */
function goalAriaLabel(label: string, progress: TargetProgress, unitSuffix: string): string {
  const value =
    `${label}: ${progress.logged.toLocaleString()}${unitSuffix} ` +
    `of ${progress.target.toLocaleString()}${unitSuffix}`;
  const over = overBy(progress);
  switch (progress.status) {
    case "met":
      return over > 0
        ? `${value}, goal met, ${over.toLocaleString()}${unitSuffix} over`
        : `${value}, goal met`;
    case "exceeded":
      return `${value}, ${over.toLocaleString()}${unitSuffix} over`;
    case "progress":
      return value;
  }
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

  const unitSuffix = progress.field === "steps" ? "" : "g";
  const label = fieldLabels[progress.field] ?? progress.field;
  const fieldColor = fieldColors[progress.field] ?? "var(--color-accent)";
  const fill = goalStateColor(progress.status, fieldColor);
  const note = goalStateNote(progress, unitSuffix);

  // A goal that is done fills the bar. Only a day still in flight renders short,
  // so "full" is a state the eye can read at a glance and does not have to
  // measure. A band met at 97% is met, and stopping the fill three pixels shy of
  // the end would say the opposite of the green it is painted in.
  const fillPct = progress.status === "progress" ? Math.max(0, progress.fraction) * 100 : 100;

  // Past the goal the bar is full and the TARGET slides back to where it
  // actually falls, marked by a notch: the further left the notch, the bigger
  // the day. Clamping the width was throwing away the only interesting thing
  // about a big day, so 9,400 and 14,000 steps against an 8,000 goal drew the
  // same full bar. They now notch at 85% and at 57%.
  const notchPct = progress.delta > 0 ? 100 / progress.fraction : null;

  return (
    <div
      className="flex flex-col gap-1"
      role="img"
      aria-label={goalAriaLabel(label, progress, unitSuffix)}
    >
      <div className="flex items-center justify-between gap-2 t-label">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1.5 font-semibold">
          <span>
            {progress.logged.toLocaleString()}
            {unitSuffix}
            <span className="text-muted-foreground font-normal">
              {" "}
              / {progress.target.toLocaleString()}
              {unitSuffix}
            </span>
          </span>
          {note && <GoalStateNote note={note} />}
        </span>
      </div>
      {/* Track is `--surface`, one step DOWN from the daily-log card's `--muted`
          fill, so it reads as a groove cut into the card. It used to be
          `--muted` on a `--surface` card, which lit the empty part of the bar
          brighter than the card holding it. This bar only ever renders inside
          that card. */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${fillPct}%`, backgroundColor: fill }}
        />
        {/* Where the target sat, once the bar has run past it. Cut in the card's
            own fill so it reads as a gap in the bar rather than another colour. */}
        {notchPct !== null && (
          <div className="absolute inset-y-0 w-0.5 bg-muted" style={{ left: `${notchPct}%` }} />
        )}
      </div>
    </div>
  );
}

/** Geometry shared by both rings, so the state-aware ring and the no-targets
 * fallback are the same object on the screen and only their arcs differ. */
const RING_SIZE = 124;
const RING_STROKE = 10;

function CalorieTargetRing({ progress }: { progress: TargetProgress }) {
  const { logged, target, fraction, status } = progress;
  // Sized around the number, not the other way round. `t-hero` is 32px tabular,
  // so "2,180" measures about 82px; a 124px ring with a 10px stroke leaves an
  // inner diameter of 104px, which clears it with room for the target beneath.
  // The old 72px ring is why the number inside it was set at row-label size.
  const size = RING_SIZE;
  const strokeWidth = RING_STROKE;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Once a goal is reached the ring CLOSES, and how far past it you went is told
  // in words underneath rather than by a second arc. At 72px a two-arc ring read
  // as one ring in two arbitrary colours; a closed ring is unambiguous, and it
  // is also the state carrier that survives when the two hues cannot be told
  // apart. The magnitude it was trying to draw is a number, and there is a
  // number right there.
  const arcFraction = status === "progress" ? Math.min(Math.max(fraction, 0), 1) : 1;
  const arcDash = `${arcFraction * circumference} ${circumference * (1 - arcFraction)}`;
  const arcColor = goalStateColor(status, "var(--color-accent)");
  const note = goalStateNote(progress, "");

  return (
    <div
      className="flex shrink-0 flex-col items-center gap-2"
      role="img"
      aria-label={goalAriaLabel("Calories", progress, "")}
    >
      <div
        className="relative flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
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
            stroke={arcColor}
            strokeWidth={strokeWidth}
            strokeDasharray={arcDash}
            strokeDashoffset={0}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {/* Only a reached or broken goal recolours the number. In flight it stays
              plain, so the colour keeps meaning "something happened here". */}
          <span className="t-hero" style={status === "progress" ? undefined : { color: arcColor }}>
            {logged.toLocaleString()}
          </span>
          {/* The target stays put in every state. It is the thing the number is
              being compared against, so a ring that hides it once you go over
              leaves the reading with nothing to sit against. */}
          <span className="mt-1 t-label leading-none text-muted-foreground">
            / {target.toLocaleString()}
          </span>
        </div>
      </div>
      {note && <GoalStateNote note={note} className="t-label" />}
    </div>
  );
}

/**
 * One macro, as a value and a name.
 *
 * The metric colour is on the GRAMS, which is the number the user logged. It
 * used to sit on a percentage-of-calories that the app derived, above a plain
 * white gram value, which inverted the emphasis and spent a data encoding on
 * decoration (DESIGN.md: metric colours identify a metric, never decorate).
 *
 * The percentage is gone rather than demoted. It is a restatement of the three
 * grams beside it, the ring already draws the same split as arcs when there
 * are no targets, and the progress bars below state it against a goal when
 * there are. Three renderings of one fact is what flattened this card.
 */
function MacroColumn({
  name,
  grams,
  colorClass,
}: {
  name: string;
  grams: number;
  colorClass: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`t-stat ${colorClass}`}>{grams}g</span>
      <span className="t-label text-muted-foreground">{name}</span>
    </div>
  );
}

function MacroRing({
  calories,
  carbCal,
  proteinCal,
  fatCal,
  macroTotal,
}: {
  calories?: number;
  carbCal: number;
  proteinCal: number;
  fatCal: number;
  macroTotal: number;
}) {
  const size = RING_SIZE;
  const strokeWidth = RING_STROKE;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Grouped, like the target ring's number. At hero size an ungrouped "2180"
  // reads as four loose digits next to a "2,700" two lines away in the bars.
  const centerText = (calories !== undefined ? calories : macroTotal).toLocaleString();
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
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="t-hero">{centerText}</span>
        <span className="mt-1 t-caption leading-none text-muted-foreground font-normal">cal</span>
      </div>
    </div>
  );
}
