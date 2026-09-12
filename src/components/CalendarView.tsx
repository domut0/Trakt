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
  // Same reason as Today: a day tracked only through food entries must not
  // render as an untracked day on the calendar.
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
          className="flex h-11 w-11 shrink-0 items-center justify-center bg-wash t-heading text-ink"
          aria-label="Previous month"
        >
          <span aria-hidden="true">‹</span>
        </button>
        {/* Announced on change: stepping the month replaces the whole grid below
            but moves no focus, so without this the change is silent. */}
        <span aria-live="polite" className="t-body font-semibold tracking-tight text-ink">
          {monthLabel}
        </span>
        <button
          onClick={() => setViewedMonth((m) => startOfMonth(addMonths(m, 1)))}
          className="flex h-11 w-11 shrink-0 items-center justify-center bg-wash t-heading text-ink"
          aria-label="Next month"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      {/* Hidden from assistive tech: as single letters these are ambiguous
          ("T" twice, "S" twice) and they are redundant anyway, because each day
          cell below names its own weekday in full. */}
      <div
        aria-hidden="true"
        className="mx-5 grid grid-cols-7 text-center t-caption text-ink-2 py-1"
      >
        {WEEKDAYS.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>

      <div
        key={monthLabel}
        className="mx-5 grid grid-cols-7 gap-px overflow-hidden bg-border anim-fade-up"
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
          // A cheat day is a label the user put on their own day, so it counts
          // as a logged day in its own right. It used to be invisible unless
          // macros happened to be logged too, which made a day someone
          // deliberately marked look exactly like a day they never opened.
          const isCheatDay = log?.isCheatDay === true;
          const hasAnyDot =
            workouts.length > 0 || showNutrition || showSteps || showBodyweight || isCheatDay;
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
          if (isCheatDay) logged.push("cheat day");
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
                (isSelected ? "ring-1 ring-inset ring-ink" : "")
              }
            >
              <span
                aria-hidden="true"
                className={
                  "t-body tnum flex h-7 w-7 items-center justify-center font-medium " +
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
                      its nutrition colour and the cheat day adds a hollow mark
                      beside it. Outline against filled, so the mark is not
                      carried by hue. */}
                  {isCheatDay && (
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
              <div className="group-list mx-5 p-6 text-center space-y-3 anim-fade-up">
                <h3 className="t-body font-semibold tracking-tight text-ink">Empty day</h3>
                <button
                  onClick={() => setEditorOpen(true)}
                  className="w-full min-h-[44px] bg-wash py-2.5 t-body font-semibold text-ink transition-colors active:opacity-80"
                >
                  Log daily numbers
                </button>
              </div>
            );
          }

          return (
            <div className="group-list mx-5 anim-fade-up">
              {hasLog ? (
                <button
                  onClick={() => setEditorOpen(true)}
                  className="group-row w-full flex-col !items-start gap-2 py-4 text-left cursor-pointer transition-colors active:bg-wash"
                >
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="t-body font-semibold tracking-tight text-ink">
                      Daily numbers
                    </span>
                    {selectedLog.isCheatDay && (
                      <span className="flex shrink-0 items-center gap-1.5 bg-wash px-2 py-0.5 t-caption text-ink-2">
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full border border-muted-foreground"
                        />
                        Cheat day
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 t-label">
                    {selectedLog.calories !== undefined && (
                      <div>
                        <span className="text-ink-2">Cal:</span>{" "}
                        <span className="tnum font-medium text-ink">{selectedLog.calories}</span>
                      </div>
                    )}
                    {selectedLog.protein !== undefined && (
                      <div>
                        <span className="text-ink-2">P:</span>{" "}
                        <span className="tnum font-medium text-ink">{selectedLog.protein}g</span>
                      </div>
                    )}
                    {selectedLog.carbs !== undefined && (
                      <div>
                        <span className="text-ink-2">C:</span>{" "}
                        <span className="tnum font-medium text-ink">{selectedLog.carbs}g</span>
                      </div>
                    )}
                    {selectedLog.fat !== undefined && (
                      <div>
                        <span className="text-ink-2">F:</span>{" "}
                        <span className="tnum font-medium text-ink">{selectedLog.fat}g</span>
                      </div>
                    )}
                    {selectedLog.steps !== undefined && (
                      <div>
                        <span className="text-ink-2">Steps:</span>{" "}
                        <span className="tnum font-medium text-ink">
                          {selectedLog.steps.toLocaleString()}
                        </span>
                      </div>
                    )}
                    {selectedLog.bodyweight !== undefined && (
                      <div>
                        <span className="text-ink-2">BW:</span>{" "}
                        <span className="tnum font-medium text-ink">
                          {selectedLog.bodyweight} {unit}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              ) : (
                <button
                  onClick={() => setEditorOpen(true)}
                  className="group-row w-full justify-center py-3.5 t-body font-semibold t-action"
                >
                  Log daily numbers
                </button>
              )}

              {hasSessions &&
                selectedSessions.map((session, i) => {
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
          );
        })()}
      </section>

      <DayEditorSheet date={selectedKey} open={editorOpen} onClose={() => setEditorOpen(false)} />
    </>
  );
}
