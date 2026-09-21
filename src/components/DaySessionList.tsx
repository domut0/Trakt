import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { dayKey } from "../lib/daily-log";
import { isCardioSession, sessionSlotName, useStore, type WorkoutSession } from "../lib/store";

/**
 * What was actually logged on a day, as rows you can open.
 *
 * Lifted out of CalendarView so Today can show the same thing. The two screens
 * are one screen with a different date picker above them -- Today has a week
 * strip, History has a month grid -- and a day that lists its sessions on one
 * of them and hides them on the other is the divergence DayActions already had
 * to be written to undo.
 *
 * Renders nothing on a day with nothing on it. An empty state here would be a
 * second empty state on a screen that already has one: the stats card's six
 * blank rows waiting to be typed into.
 */
export function DaySessionList({ date }: { date: string }) {
  const sessions = useStore((s) => s.sessions);
  const slots = useStore((s) => s.slots);
  const exercises = useStore((s) => s.exercises);
  const sets = useStore((s) => s.sets);
  const unit = useStore((s) => s.unit);

  // Finished sessions only, newest first. A session still running is the one on
  // the /workout screen, and it is not a thing that happened yet.
  const onDay = useMemo(
    () =>
      sessions
        .filter((s) => s.endedAt != null && dayKey(new Date(s.startedAt)) === date)
        .sort((a, b) => b.startedAt - a.startedAt),
    [sessions, date],
  );

  if (onDay.length === 0) return null;

  return (
    <div className="group-list">
      {onDay.map((session, i) => (
        <SessionRow
          key={session.id}
          session={session}
          index={i}
          title={titleOf(session, slots, exercises)}
          subtitle={subtitleOf(session, sets, unit)}
        />
      ))}
    </div>
  );
}

function titleOf(
  session: WorkoutSession,
  slots: ReturnType<typeof useStore.getState>["slots"],
  exercises: ReturnType<typeof useStore.getState>["exercises"],
): string {
  if (isCardioSession(session)) {
    return exercises.find((e) => e.id === session.cardioExerciseId)?.name ?? "Cardio";
  }
  return sessionSlotName(session, slots) ?? "Untitled";
}

function subtitleOf(
  session: WorkoutSession,
  sets: ReturnType<typeof useStore.getState>["sets"],
  unit: "lbs" | "kg",
): string | undefined {
  if (!isCardioSession(session)) {
    return `· ${sets.filter((x) => x.sessionId === session.id).length} sets`;
  }
  const parts: string[] = [];
  if (session.durationMinutes != null) parts.push(`${session.durationMinutes} min`);
  if (session.distance != null) {
    parts.push(`${session.distance} ${unit === "lbs" ? "mi" : "km"}`);
  }
  return parts.length > 0 ? `· ${parts.join(" · ")}` : undefined;
}

function SessionRow({
  session,
  index,
  title,
  subtitle,
}: {
  session: WorkoutSession;
  index: number;
  title: string;
  subtitle?: string;
}) {
  return (
    <Link
      to="/session/$id"
      params={{ id: session.id }}
      className="group-row group-row-sep w-full items-center justify-between py-4"
      style={{ animationDelay: `${Math.min(index, 6) * 35}ms` }}
    >
      <div className="min-w-0 flex-1 pr-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate t-body font-semibold tracking-tight text-ink">{title}</span>
          {subtitle && <span className="t-label shrink-0 text-ink-2">{subtitle}</span>}
        </div>
      </div>
      <span className="t-label shrink-0 text-ink-2">{fmtTime(session.startedAt)}</span>
    </Link>
  );
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric" });
}
