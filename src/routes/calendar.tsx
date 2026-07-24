import { createFileRoute, Link } from "@tanstack/react-router";
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
import { AppShell } from "../components/AppShell";
import { useStore, type WorkoutSession } from "../lib/store";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar" },
      { name: "description", content: "Month view of your logged workouts." },
      { property: "og:title", content: "Calendar" },
      { property: "og:description", content: "Month view of your logged workouts." },
    ],
  }),
  component: CalendarPage,
});

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function dayKey(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric" });
}

function CalendarPage() {
  const sessions = useStore((s) => s.sessions);
  const slots = useStore((s) => s.slots);
  const sets = useStore((s) => s.sets);

  const [viewedMonth, setViewedMonth] = useState(() => startOfMonth(new Date()));
  // null until the user taps a day — lets the default track newly-hydrated
  // data instead of freezing at whatever was loaded on first render.
  const [pickedKey, setPickedKey] = useState<string | null>(null);

  const loggedSessions = useMemo(() => sessions.filter((s) => s.endedAt != null), [sessions]);

  const byDay = useMemo(() => {
    const map = new Map<string, WorkoutSession[]>();
    for (const session of loggedSessions) {
      const key = dayKey(new Date(session.endedAt!));
      const arr = map.get(key);
      if (arr) arr.push(session);
      else map.set(key, [session]);
    }
    for (const arr of map.values()) arr.sort((a, b) => b.startedAt - a.startedAt);
    return map;
  }, [loggedSessions]);

  const defaultKey = useMemo(() => {
    const todayKey = dayKey(new Date());
    if (byDay.has(todayKey)) return todayKey;
    const mostRecent = [...loggedSessions].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
    return mostRecent ? dayKey(new Date(mostRecent.endedAt!)) : todayKey;
  }, [byDay, loggedSessions]);

  const selectedKey = pickedKey ?? defaultKey;
  const selectedDate = useMemo(() => {
    const [y, m, d] = selectedKey.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [selectedKey]);
  const selectedSessions = byDay.get(selectedKey) ?? [];

  const monthLabel = format(viewedMonth, "MMMM yyyy");
  const cells = useMemo(() => {
    const firstWeekday = getDay(viewedMonth);
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
    <AppShell>
      <header className="px-5 pb-4 pt-14">
        <h1 className="text-[30px] font-semibold tracking-tight">Calendar</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">Your logged workouts by day.</p>
      </header>

      <div className="mx-5 mb-3 flex items-center justify-between">
        <button
          onClick={() => setViewedMonth((m) => startOfMonth(subMonths(m, 1)))}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-[18px] text-foreground"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="text-[16px] font-semibold tracking-tight">{monthLabel}</span>
        <button
          onClick={() => setViewedMonth((m) => startOfMonth(addMonths(m, 1)))}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-[18px] text-foreground"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="mx-5 grid grid-cols-7 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div key={monthLabel} className="mx-5 grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border anim-fade-up">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} className="min-h-[64px] bg-surface" />;
          const workouts = byDay.get(cell.key) ?? [];
          const isSelected = cell.key === selectedKey;
          const todayCell = isToday(cell.date);
          return (
            <button
              key={cell.key}
              onClick={() => setPickedKey(cell.key)}
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
              {workouts.length > 0 && (
                <span className="flex gap-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {workouts.length > 1 && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <section className="mt-6" key={selectedKey}>
        <div className="px-5 pb-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-widest text-muted-foreground">
            {format(selectedDate, "EEEE, MMMM d")}
          </h2>
        </div>

        {selectedSessions.length === 0 ? (
          <div className="mx-5 rounded-xl bg-muted px-4 py-8 text-center text-[14px] text-muted-foreground anim-fade-up">
            No workout logged.
          </div>
        ) : (
          <ul className="space-y-3 px-5">
            {selectedSessions.map((session, i) => {
              const slot = slots.find((sl) => sl.id === session.splitSlotId);
              const setCount = sets.filter((x) => x.sessionId === session.id).length;
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
                        <span className="text-[16px] font-semibold tracking-tight">{slot?.name ?? "Untitled"}</span>
                        <span className="text-[12px] text-muted-foreground">· {setCount} sets</span>
                      </div>
                    </div>
                    <span className="text-[12px] text-muted-foreground">{fmtTime(session.startedAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
