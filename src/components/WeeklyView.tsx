import { Link } from "@tanstack/react-router";
import { format, isToday, isYesterday } from "date-fns";
import { useMemo, useState } from "react";
import {
  aggregateDailyLogs,
  countSessionsTrained,
  dayKey,
  groupDayKeysByWeek,
  parseDayKey,
  type DailyLogAggregates,
} from "../lib/daily-log";
import { isCardioSession, useStore, type DailyLog } from "../lib/store";
import { DayEditorSheet } from "./DayEditorSheet";

/** A workout as a day card shows it: which split/exercise, set count or cardio details. */
interface DaySession {
  id: string;
  title: string;
  subtitle?: string;
}

interface DayCardData {
  date: string;
  sessions: DaySession[];
  log: DailyLog | undefined;
}

/** "Wed 4", or the friendlier label for the two days people actually recognise. */
function dayLabel(date: string): string {
  const d = parseDayKey(date);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE d");
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
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
 * The History tab's default (Weekly) view: a continuous, newest-first scroll
 * of one card per day that has ANYTHING on it (a workout, some numbers, or a
 * cheat-day flag), broken up by a summary header for each Monday-start week.
 *
 * Days with nothing logged are skipped rather than rendered blank, so a
 * fortnight off collapses to a gap between two week headers instead of
 * fourteen empty rows.
 */
export function WeeklyView() {
  const sessions = useStore((s) => s.sessions);
  const slots = useStore((s) => s.slots);
  const exercises = useStore((s) => s.exercises);
  const sets = useStore((s) => s.sets);
  const dailyLogs = useStore((s) => s.dailyLogs);
  const unit = useStore((s) => s.unit);

  // Which day the editor is open on. null = closed. The sheet stays mounted
  // with the last date while it animates out, so this is not cleared on close.
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const endedSessions = useMemo(() => sessions.filter((s) => s.endedAt != null), [sessions]);

  /** Day key -> that day's finished workouts, most recent first. */
  const sessionsByDay = useMemo(() => {
    const map = new Map<string, DaySession[]>();
    for (const session of [...endedSessions].sort((a, b) => b.startedAt - a.startedAt)) {
      const key = dayKey(new Date(session.startedAt));
      const isCardio = isCardioSession(session);
      const slot = !isCardio ? slots.find((sl) => sl.id === session.splitSlotId) : undefined;
      const cardioEx = isCardio
        ? exercises.find((e) => e.id === session.cardioExerciseId)
        : undefined;
      const title = isCardio ? (cardioEx?.name ?? "Cardio") : (slot?.name ?? "Untitled");
      const cardioDetails = isCardio
        ? fmtCardioDetails(session.durationMinutes, session.distance, unit)
        : null;
      const subtitle = isCardio
        ? cardioDetails
          ? `· ${cardioDetails}`
          : undefined
        : `· ${sets.filter((x) => x.sessionId === session.id).length} sets`;

      const entry: DaySession = {
        id: session.id,
        title,
        subtitle,
      };
      const bucket = map.get(key);
      if (bucket) bucket.push(entry);
      else map.set(key, [entry]);
    }
    return map;
  }, [endedSessions, slots, exercises, sets, unit]);

  const logsByDay = useMemo(() => new Map(dailyLogs.map((l) => [l.date, l])), [dailyLogs]);

  // Every day with something on it. A stored daily log is never an empty shell
  // (upsertDailyLog deletes those), so its mere presence earns a card.
  const weeks = useMemo(
    () => groupDayKeysByWeek([...sessionsByDay.keys(), ...logsByDay.keys()]),
    [sessionsByDay, logsByDay],
  );

  const openEditor = (date: string) => {
    setEditingDate(date);
    setEditorOpen(true);
  };

  if (weeks.length === 0) {
    return (
      <div className="mx-5 rounded-2xl bg-surface px-5 py-8 text-center space-y-3">
        <h3 className="text-[16px] font-semibold tracking-tight">No history logged</h3>
        <p className="text-[13px] text-muted-foreground">
          Track your bodyweight, steps, or macros to start building your log.
        </p>
        <button
          onClick={() => openEditor(dayKey(new Date()))}
          className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-accent-foreground"
        >
          Log today's numbers
        </button>
      </div>
    );
  }

  let cardIndex = 0;

  return (
    <>
      {weeks.map((week) => {
        const weekLogs = week.days
          .map((d) => logsByDay.get(d))
          .filter((l): l is DailyLog => l !== undefined);
        return (
          <section key={week.weekStart} className="mb-7 last:mb-0">
            <WeekHeader
              weekStart={week.weekStart}
              aggregates={aggregateDailyLogs(weekLogs)}
              sessionCount={countSessionsTrained(endedSessions, week.weekStart)}
              unit={unit}
            />
            <ul className="space-y-3 px-5">
              {week.days.map((date) => (
                <DayCard
                  key={date}
                  data={{
                    date,
                    sessions: sessionsByDay.get(date) ?? [],
                    log: logsByDay.get(date),
                  }}
                  unit={unit}
                  onOpenEditor={openEditor}
                  delayMs={Math.min(cardIndex++, 6) * 35}
                />
              ))}
            </ul>
          </section>
        );
      })}

      <DayEditorSheet
        date={editingDate ?? dayKey(new Date())}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
      />
    </>
  );
}

/**
 * The divider between weeks. Deliberately quiet: small, uppercase and muted,
 * matching the app's other section headings, so it reads as a label over the
 * day cards rather than competing with them.
 */
function WeekHeader({
  weekStart,
  aggregates,
  sessionCount,
  unit,
}: {
  weekStart: string;
  aggregates: DailyLogAggregates;
  sessionCount: number;
  unit: "lbs" | "kg";
}) {
  // Only averages worth glancing at. Macros are per-day detail, not a weekly
  // headline, so they stay on the cards.
  const stats: string[] = [];
  const { calories, steps, bodyweight } = aggregates;
  if (calories) {
    stats.push(
      `${Math.round(calories.average).toLocaleString()} avg cal · ${calories.loggedDays} of 7 days`,
    );
  }
  if (steps) {
    stats.push(
      `${Math.round(steps.average).toLocaleString()} avg steps · ${steps.loggedDays} of 7 days`,
    );
  }
  if (bodyweight) {
    stats.push(`${round1(bodyweight.average)} avg ${unit} · ${bodyweight.loggedDays} of 7 days`);
  }

  return (
    <div className="px-5 pb-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-widest text-muted-foreground">
          Week of {format(parseDayKey(weekStart), "MMM d")}
        </h2>
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {sessionCount === 0
            ? "No sessions"
            : `${sessionCount} session${sessionCount === 1 ? "" : "s"}`}
        </span>
      </div>
      {stats.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-x-4 text-[12px] text-muted-foreground">
          {stats.map((s) => (
            <span key={s} className="tnum">
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One day. Tapping anywhere except a workout row opens the day editor, so any
 * past day can be corrected in place.
 *
 * There is deliberately no swipe-to-delete here. The card is composite: a
 * workout plus macros plus steps plus bodyweight, and one accidental gesture
 * should not be able to take all of that with it. Deleting a workout lives on
 * the session screen; clearing numbers lives in the editor.
 */
function DayCard({
  data,
  unit,
  onOpenEditor,
  delayMs,
}: {
  data: DayCardData;
  unit: "lbs" | "kg";
  onOpenEditor: (date: string) => void;
  delayMs: number;
}) {
  const { date, sessions, log } = data;
  const stats = log ? dayStats(log, unit) : [];

  return (
    <li className="anim-fade-up" style={{ animationDelay: `${delayMs}ms` }}>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Edit ${format(parseDayKey(date), "EEEE, MMMM d")}`}
        onClick={() => onOpenEditor(date)}
        // role="button" promises keyboard activation that a <div> does not
        // provide, so the card was focusable and then did nothing on Enter or
        // Space. It cannot simply BE a <button>: it contains the workout links,
        // and a button may not nest interactive content.
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          // Only the card itself. A key press that reached here by bubbling from
          // a workout link is that link's to handle.
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          onOpenEditor(date);
        }}
        className="cursor-pointer rounded-2xl bg-surface px-5 py-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[16px] font-semibold tracking-tight">{dayLabel(date)}</span>
          {log?.isCheatDay && (
            <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-destructive">
              <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
              Cheat day
            </span>
          )}
        </div>

        {sessions.length > 0 && (
          <ul className="mt-2 space-y-1">
            {sessions.map((session) => (
              <li key={session.id}>
                <Link
                  to="/session/$id"
                  params={{ id: session.id }}
                  // The card behind this opens the editor; a workout row must
                  // not do both.
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-baseline gap-2"
                >
                  <span className="text-[15px] font-medium tracking-tight">{session.title}</span>
                  {session.subtitle && (
                    <span className="text-[12px] text-muted-foreground">{session.subtitle}</span>
                  )}
                  <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {stats.length > 0 && (
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {stats.map((s) => (
              <span key={s.label} className="text-[14px]">
                <span className="tnum font-semibold">{s.value}</span>{" "}
                <span className="text-[12px] text-muted-foreground">{s.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/** Only the fields actually logged, so a bodyweight-only day reads as one
 * clean stat instead of a grid of dashes. Mirrors the Today card's summary. */
function dayStats(log: DailyLog, unit: "lbs" | "kg"): { label: string; value: string }[] {
  const stats: { label: string; value: string }[] = [];
  if (log.calories !== undefined) stats.push({ label: "kcal", value: String(log.calories) });
  if (log.protein !== undefined) stats.push({ label: "P", value: `${log.protein}g` });
  if (log.carbs !== undefined) stats.push({ label: "C", value: `${log.carbs}g` });
  if (log.fat !== undefined) stats.push({ label: "F", value: `${log.fat}g` });
  if (log.steps !== undefined) stats.push({ label: "steps", value: log.steps.toLocaleString() });
  if (log.bodyweight !== undefined) stats.push({ label: unit, value: String(log.bodyweight) });
  return stats;
}
