import { Link } from "@tanstack/react-router";
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
import { DayEditorSheet } from "./DayEditorSheet";
import { isCardioSession, useStore, type WorkoutSession } from "../lib/store";

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
  const dailyLogs = useStore((s) => s.dailyLogs);
  const unit = useStore((s) => s.unit);

  const [viewedMonth, setViewedMonth] = useState(() => startOfMonth(new Date()));
  // null until the user taps a day, which lets the default track newly-hydrated
  // data instead of freezing at whatever was loaded on first render.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

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
      <div className="mx-5 mb-3 flex items-center justify-between">
        <button
          onClick={() => setViewedMonth((m) => startOfMonth(subMonths(m, 1)))}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-[18px] text-foreground"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="text-[16px] font-semibold tracking-tight">{monthLabel}</span>
        <button
          onClick={() => setViewedMonth((m) => startOfMonth(addMonths(m, 1)))}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-[18px] text-foreground"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {/* Hidden from assistive tech: as single letters these are ambiguous
          ("T" twice, "S" twice) and they are redundant anyway, because each day
          cell below names its own weekday in full. */}
      <div
        aria-hidden="true"
        className="mx-5 grid grid-cols-7 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
      >
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div
        key={monthLabel}
        className="mx-5 grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border anim-fade-up"
      >
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} className="min-h-[64px] bg-surface" />;
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
          const hasAnyDot = workouts.length > 0 || showNutrition || showSteps || showBodyweight;
          const isSelected = cell.key === selectedKey;
          const todayCell = isToday(cell.date);
          // The dots are the only thing distinguishing one cell from another,
          // and a colour is not an accessible name. Spell out what the day
          // holds, otherwise the whole grid reads as a run of bare numbers.
          const logged: string[] = [];
          if (workouts.length > 0) {
            logged.push(`${workouts.length} workout${workouts.length === 1 ? "" : "s"}`);
          }
          if (showNutrition) logged.push(log.isCheatDay ? "macros, cheat day" : "macros");
          if (showSteps) logged.push("steps");
          if (showBodyweight) logged.push("bodyweight");
          return (
            <button
              key={cell.key}
              onClick={() => setPickedKey(cell.key)}
              aria-pressed={isSelected}
              aria-label={`${format(cell.date, "EEEE, MMMM d")}${
                logged.length > 0 ? `: ${logged.join(", ")}` : ": nothing logged"
              }`}
              className={
                "relative flex min-h-[64px] flex-col items-center gap-1 bg-surface pb-1 pt-2 " +
                (isSelected ? "ring-1 ring-inset ring-accent" : "")
              }
            >
              <span
                className={
                  "flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-medium " +
                  (todayCell ? "bg-accent text-accent-foreground" : "text-foreground")
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
                        "h-1.5 w-1.5 rounded-full " +
                        (isCardioSession(w) ? "bg-cardio" : "bg-accent")
                      }
                    />
                  ))}
                  {showNutrition && (
                    <span
                      className={
                        "h-1.5 w-1.5 rounded-full " +
                        (log.isCheatDay ? "bg-destructive" : "bg-nutrition")
                      }
                    />
                  )}
                  {showSteps && <span className="h-1.5 w-1.5 rounded-full bg-steps" />}
                  {showBodyweight && <span className="h-1.5 w-1.5 rounded-full bg-bodyweight" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <section className="mt-6 pb-6" key={selectedKey}>
        <div className="px-5 pb-2 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-widest text-muted-foreground">
            {format(selectedDate, "EEEE, MMMM d")}
          </h2>
        </div>

        {(() => {
          const selectedLog = dailyLogs.find((l) => l.date === selectedKey);
          const hasSessions = selectedSessions.length > 0;
          const hasLog =
            selectedLog &&
            (selectedLog.calories !== undefined ||
              selectedLog.protein !== undefined ||
              selectedLog.carbs !== undefined ||
              selectedLog.fat !== undefined ||
              selectedLog.steps !== undefined ||
              selectedLog.bodyweight !== undefined ||
              selectedLog.isCheatDay);

          if (!hasSessions && !hasLog) {
            return (
              <div className="mx-5 rounded-2xl bg-surface px-5 py-8 text-center space-y-3 anim-fade-up">
                <h3 className="text-[16px] font-semibold tracking-tight">No entry for this date</h3>
                <p className="text-[13px] text-muted-foreground">
                  Record your daily numbers or complete a workout to fill this day.
                </p>
                <button
                  onClick={() => setEditorOpen(true)}
                  className="w-full min-h-[44px] rounded-2xl bg-muted py-3.5 text-center text-[14px] font-semibold text-accent"
                >
                  Log daily numbers
                </button>
              </div>
            );
          }

          return (
            <div className="space-y-4">
              {hasLog ? (
                <button
                  onClick={() => setEditorOpen(true)}
                  className="mx-5 flex flex-col gap-2 rounded-2xl bg-surface px-5 py-4 text-left anim-fade-up w-[calc(100%-40px)]"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[16px] font-semibold tracking-tight">Daily Summary</span>
                    {selectedLog.isCheatDay && (
                      <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-destructive">
                        Cheat Day
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13px]">
                    {selectedLog.calories !== undefined && (
                      <div>
                        <span className="text-muted-foreground">Cal:</span>{" "}
                        <span className="font-medium tnum">{selectedLog.calories}</span>
                      </div>
                    )}
                    {selectedLog.protein !== undefined && (
                      <div>
                        <span className="text-muted-foreground">P:</span>{" "}
                        <span className="font-medium tnum">{selectedLog.protein}g</span>
                      </div>
                    )}
                    {selectedLog.carbs !== undefined && (
                      <div>
                        <span className="text-muted-foreground">C:</span>{" "}
                        <span className="font-medium tnum">{selectedLog.carbs}g</span>
                      </div>
                    )}
                    {selectedLog.fat !== undefined && (
                      <div>
                        <span className="text-muted-foreground">F:</span>{" "}
                        <span className="font-medium tnum">{selectedLog.fat}g</span>
                      </div>
                    )}
                    {selectedLog.steps !== undefined && (
                      <div>
                        <span className="text-muted-foreground">Steps:</span>{" "}
                        <span className="font-medium tnum">{selectedLog.steps}</span>
                      </div>
                    )}
                    {selectedLog.bodyweight !== undefined && (
                      <div>
                        <span className="text-muted-foreground">BW:</span>{" "}
                        <span className="font-medium tnum">
                          {selectedLog.bodyweight} {unit}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              ) : (
                <div className="px-5">
                  <button
                    onClick={() => setEditorOpen(true)}
                    className="w-full rounded-2xl bg-surface py-4 text-center text-[14px] font-medium text-accent anim-fade-up"
                  >
                    Log daily numbers
                  </button>
                </div>
              )}

              {hasSessions && (
                <ul className="space-y-3 px-5">
                  {selectedSessions.map((session, i) => {
                    const isCardio = isCardioSession(session);
                    const slot = !isCardio
                      ? slots.find((sl) => sl.id === session.splitSlotId)
                      : undefined;
                    const cardioEx = isCardio
                      ? exercises.find((e) => e.id === session.cardioExerciseId)
                      : undefined;
                    const title = isCardio
                      ? (cardioEx?.name ?? "Cardio")
                      : (slot?.name ?? "Untitled");
                    const cardioDetails = isCardio
                      ? fmtCardioDetails(session.durationMinutes, session.distance, unit)
                      : null;
                    const subtitle = isCardio
                      ? cardioDetails
                        ? `· ${cardioDetails}`
                        : undefined
                      : `· ${sets.filter((x) => x.sessionId === session.id).length} sets`;

                    return (
                      <li key={session.id}>
                        <Link
                          to="/session/$id"
                          params={{ id: session.id }}
                          className="flex items-center justify-between rounded-2xl bg-surface px-5 py-4 anim-fade-up"
                          style={{ animationDelay: `${Math.min(i, 6) * 35}ms` }}
                        >
                          <div className="min-w-0 flex-1 pr-3">
                            <div className="flex items-baseline gap-2">
                              <span className="text-[16px] font-semibold tracking-tight">
                                {title}
                              </span>
                              {subtitle && (
                                <span className="text-[12px] text-muted-foreground">
                                  {subtitle}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-[12px] text-muted-foreground">
                            {fmtTime(session.startedAt)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })()}
      </section>

      <DayEditorSheet date={selectedKey} open={editorOpen} onClose={() => setEditorOpen(false)} />
    </>
  );
}
