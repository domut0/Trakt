import { Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  addMonths,
  format,
  getDay,
  getDaysInMonth,
  isToday,
  startOfMonth,
  subMonths,
} from "date-fns";
import { dayKey } from "../lib/daily-log";
import { DayStatsCard } from "./DayStatsCard";
import { StartWorkoutSheet } from "./StartWorkoutSheet";
import { Plus } from "./icons";
import { isCardioSession, sessionSlotName, useStore, type WorkoutSession } from "../lib/store";

/**
 * Monday-start, matching `weekStartKey` in daily-log.ts and therefore the
 * "Week of ..." headers the Weekly view renders in this same tab. The grid used
 * to start on Sunday, so flipping between Weekly and Calendar moved which days
 * counted as one week.
 */
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric" });
}

function fmtCardioDetails(
  durationMinutes?: number,
  distance?: number,
  unit: "lbs" | "kg" = "lbs",
): string {
  const parts: string[] = [];
  if (durationMinutes != null) {
    parts.push(`${durationMinutes} min`);
  }
  if (distance != null) {
    parts.push(`${distance} ${unit === "lbs" ? "mi" : "km"}`);
  }
  return parts.join(" · ");
}

/**
 * The History tab's Calendar view: month stepper, weekday header, day-cell
 * grid with workout dots, and the selected day's session list. Moved here
 * verbatim from the old standalone /calendar route.
 */
export function CalendarView() {
  const sessions = useStore((s) => s.sessions);
  const slots = useStore((s) => s.slots);
  const exercises = useStore((s) => s.exercises);
  const sets = useStore((s) => s.sets);
  // Same reason as Today: a day tracked only through food entries must not
  // render as an untracked day on the calendar.
  const dailyLogs = useStore((s) => s.dailyLogs);
  const unit = useStore((s) => s.unit);

  const [viewedMonth, setViewedMonth] = useState(() => startOfMonth(new Date()));
  // null until the user taps a day, which lets the default track newly-hydrated
  // data instead of freezing at whatever was loaded on first render.
  const [pickedKey, setPickedKey] = useState<string | null>(null);

  const loggedSessions = useMemo(() => sessions.filter((s) => s.endedAt != null), [sessions]);

  const byDay = useMemo(() => {
    const map = new Map<string, WorkoutSession[]>();
    for (const session of loggedSessions) {
      const key = dayKey(new Date(session.startedAt));
      const arr = map.get(key);
      if (arr) arr.push(session);
      else map.set(key, [session]);
    }
    for (const arr of map.values()) arr.sort((a, b) => b.startedAt - a.startedAt);
    return map;
  }, [loggedSessions]);

  const defaultKey = useMemo(() => {
    const todayKey = dayKey(new Date());
    if (byDay.has(todayKey) || dailyLogs.some((l) => l.date === todayKey)) return todayKey;
    const allKeys = Array.from(new Set([...byDay.keys(), ...dailyLogs.map((l) => l.date)])).sort(
      (a, b) => b.localeCompare(a),
    );
    return allKeys[0] ?? todayKey;
  }, [byDay, dailyLogs]);

  const selectedKey = pickedKey ?? defaultKey;
  const selectedDate = useMemo(() => {
    const [y, m, d] = selectedKey.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [selectedKey]);
  const selectedSessions = byDay.get(selectedKey) ?? [];
  const todayKey = dayKey(new Date());
  const selectedIsToday = selectedKey === todayKey;
  const selectedIsFuture = selectedKey > todayKey;
  const [adding, setAdding] = useState(false);
  const router = useRouter();

  const now = new Date();
  const isCurrentMonth =
    viewedMonth.getFullYear() === now.getFullYear() && viewedMonth.getMonth() === now.getMonth();
  const canGoToToday = !isCurrentMonth || !selectedIsToday;

  // Return to the current month and select today. Rendered only when it would
  // do something — either the calendar is scrolled away from the present month,
  // or a different day within the month is selected. The month label sits on an
  // absolute centre so showing or hiding this button never jostles the header.
  const goToToday = () => {
    setViewedMonth(startOfMonth(new Date()));
    setPickedKey(todayKey);
  };

  const monthLabel = format(viewedMonth, "MMMM yyyy");
  const cells = useMemo(() => {
    // `getDay` is 0=Sunday..6=Saturday; the grid's first column is Monday, so
    // shift by 6 to get the number of leading blanks. Sunday needs 6 blanks, not
    // 0, which is precisely the off-by-one that a bare `getDay` produced.
    const firstWeekday = (getDay(viewedMonth) + 6) % 7;
    const daysInMonth = getDaysInMonth(viewedMonth);
    const out: Array<{ date: Date; key: string } | null> = [];
    for (let i = 0; i < firstWeekday; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth(), d);
      out.push({ date, key: dayKey(date) });
    }
    return out;
  }, [viewedMonth]);

  return (
    <>
      <div className="relative mx-4 mb-3 flex items-center justify-between">
        <button
          onClick={() => setViewedMonth((m) => startOfMonth(subMonths(m, 1)))}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-2 active:bg-wash"
          aria-label="Previous month"
        >
          <span aria-hidden="true">‹</span>
        </button>
        {/* Announced on change: stepping the month replaces the whole grid below
            but moves no focus, so without this the change is silent. */}
        <span
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 text-center t-body font-semibold tracking-tight text-ink"
        >
          {monthLabel}
        </span>
        <div className="flex items-center">
          {canGoToToday && (
            <button
              type="button"
              onClick={goToToday}
              className="flex min-h-[44px] items-center px-2 t-label font-medium t-action"
            >
              Today
            </button>
          )}
          <button
            onClick={() => setViewedMonth((m) => startOfMonth(addMonths(m, 1)))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-2 active:bg-wash"
            aria-label="Next month"
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      {/* Hidden from assistive tech: as single letters these are ambiguous
          ("T" twice, "S" twice) and they are redundant anyway, because each day
          cell below names its own weekday in full. */}
      <div
        aria-hidden="true"
        className="mx-4 grid grid-cols-7 text-center t-caption text-ink-2 py-1"
      >
        {WEEKDAYS.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>

      <div
        key={monthLabel}
        // A card, not a ruled lattice. This used to be a 1px grid gap over a
        // border-coloured background, which drew a hairline between all 35
        // cells: on paper that was the grid the month is printed on, and on a
        // dark ground it is 70 bright lines fighting the dots they surround.
        className="mx-4 grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-surface"
      >
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} className="min-h-[64px] " />;
          const workouts = byDay.get(cell.key) ?? [];
          const log = dailyLogs.find((l) => l.date === cell.key);
          const showNutrition =
            log &&
            (log.calories !== undefined ||
              log.protein !== undefined ||
              log.carbs !== undefined ||
              log.fat !== undefined);
          const showSteps = log?.steps !== undefined;
          const showBodyweight = log?.bodyweight !== undefined;
          // An untracked day is a label the user put on their own day, so it counts
          // as a logged day in its own right. It used to be invisible unless
          // macros happened to be logged too, which made a day someone
          // deliberately marked look exactly like a day they never opened.
          const isUntracked = log?.isUntracked === true;
          const hasAnyDot =
            workouts.length > 0 || showNutrition || showSteps || showBodyweight || isUntracked;
          const isSelected = cell.key === selectedKey;
          const todayCell = isToday(cell.date);
          // The dots are the only thing distinguishing one cell from another,
          // and a colour is not an accessible name. Spell out what the day
          // holds, otherwise the whole grid reads as a run of bare numbers.
          const logged: string[] = [];
          if (workouts.length > 0) {
            logged.push(`${workouts.length} workout${workouts.length === 1 ? "" : "s"}`);
          }
          if (showNutrition) logged.push("macros");
          if (showSteps) logged.push("steps");
          if (showBodyweight) logged.push("bodyweight");
          if (isUntracked) logged.push("untracked day");
          return (
            <button
              key={cell.key}
              onClick={() => setPickedKey(cell.key)}
              aria-pressed={isSelected}
              aria-label={`${format(cell.date, "EEEE, MMMM d")}${
                logged.length > 0 ? `: ${logged.join(", ")}` : ": nothing logged"
              }`}
              className={
                "relative flex min-h-[64px] flex-col items-center gap-1 pb-1 pt-2 transition-colors " +
                (isSelected ? "bg-wash" : "")
              }
            >
              <span
                aria-hidden="true"
                className={
                  "t-body tnum flex h-7 w-7 items-center justify-center rounded-full font-medium " +
                  (todayCell ? "bg-ink text-paper" : "text-ink")
                }
              >
                {cell.date.getDate()}
              </span>
              {hasAnyDot && (
                <span className="flex gap-0.5">
                  {workouts.slice(0, 2).map((w) => (
                    <span
                      key={w.id}
                      className={
                        "h-1.5 w-1.5 rounded-full " + (isCardioSession(w) ? "bg-cardio" : "bg-ink")
                      }
                    />
                  ))}
                  {showNutrition && <span className="h-1.5 w-1.5 rounded-full bg-nutrition" />}
                  {/* Annotates the day, never replaces a dot: the food dot keeps
                      its nutrition colour and the untracked day adds a hollow mark
                      beside it. Outline against filled, so the mark is not
                      carried by hue. */}
                  {isUntracked && (
                    <span className="h-1.5 w-1.5 rounded-full border border-muted-foreground" />
                  )}
                  {showSteps && <span className="h-1.5 w-1.5 rounded-full bg-steps" />}
                  {showBodyweight && <span className="h-1.5 w-1.5 rounded-full bg-bodyweight" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <section className="section-gap pb-6" key={selectedKey}>
        <div className="group-header">
          <h2 className="t-caption text-ink-2">{format(selectedDate, "EEEE, MMMM d")}</h2>
        </div>

        {/* The same editable card the Today screen uses, rather than a second,
            denser copy of the same six numbers behind a sheet. The empty-day
            state went with it: a card of six rows waiting to be typed into IS
            the empty state, and it is the one that lets you do something. */}
        <div className="mx-4 space-y-3">
          <DayStatsCard date={selectedKey} editable />

          {selectedSessions.length > 0 && (
            <div className="group-list">
              {selectedSessions.map((session, i) => {
                const isCardio = isCardioSession(session);
                const slotName = !isCardio ? sessionSlotName(session, slots) : undefined;
                const cardioEx = isCardio
                  ? exercises.find((e) => e.id === session.cardioExerciseId)
                  : undefined;
                const title = isCardio ? (cardioEx?.name ?? "Cardio") : (slotName ?? "Untitled");
                const cardioDetails = isCardio
                  ? fmtCardioDetails(session.durationMinutes, session.distance, unit)
                  : null;
                const subtitle = isCardio
                  ? cardioDetails
                    ? `· ${cardioDetails}`
                    : undefined
                  : `· ${sets.filter((x) => x.sessionId === session.id).length} sets`;

                return (
                  <Link
                    key={session.id}
                    to="/session/$id"
                    params={{ id: session.id }}
                    className="group-row group-row-sep w-full items-center justify-between py-4"
                    style={{ animationDelay: `${Math.min(i, 6) * 35}ms` }}
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate t-body font-semibold tracking-tight text-ink">
                          {title}
                        </span>
                        {subtitle && (
                          <span className="t-label shrink-0 text-ink-2">{subtitle}</span>
                        )}
                      </div>
                    </div>
                    <span className="t-label shrink-0 text-ink-2">
                      {fmtTime(session.startedAt)}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          {/* The other half of backdating. The Start Workout sheet carries a
              date, but the place you NOTICE a missing workout is the day
              itself, so the day offers it. Today's own column says Start
              instead, because that is what it is. */}
          {!selectedIsFuture && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex min-h-[44px] w-full items-center gap-2 t-action t-body"
            >
              <Plus size={18} />
              {selectedIsToday ? "Start a workout" : "Add a workout"}
            </button>
          )}
        </div>
      </section>

      <StartWorkoutSheet
        open={adding}
        on={selectedKey}
        onClose={() => setAdding(false)}
        onStart={() => {
          setAdding(false);
          router.navigate({ to: "/workout" });
        }}
      />
    </>
  );
}
