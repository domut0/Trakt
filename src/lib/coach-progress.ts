import { addDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import type { ClientSnapshot } from "./client-snapshot";
import { dayKey, parseDayKey } from "./daily-log";
import { isCardioSession, sessionSlotName, type DailyLog } from "./store";

export type ProgressPeriod = "week" | "fortnight" | "month";
export const PROGRESS_FIELDS = [
  { key: "bodyweight", label: "Bodyweight", short: "W" },
  { key: "calories", label: "Calories", short: "Cal" },
  { key: "protein", label: "Protein", short: "P" },
  { key: "carbs", label: "Carbs", short: "C" },
  { key: "fat", label: "Fat", short: "F" },
  { key: "steps", label: "Steps", short: "Steps" },
] as const;

export interface ProgressTraining {
  id: string;
  name: string;
  startedAt: number;
  sets?: number;
  durationMinutes?: number;
  distance?: number;
  note?: string;
  details: string[];
}

export interface ProgressDay {
  date: string;
  log?: DailyLog;
  workouts: ProgressTraining[];
  cardio: ProgressTraining[];
}

/** Local calendar arithmetic keeps seven columns even over DST and month edges. */
export function progressWeeks(anchor: string, period: ProgressPeriod): (string | null)[][] {
  const date = parseDayKey(anchor);
  const first =
    period === "month"
      ? startOfMonth(date)
      : addDays(startOfWeek(date, { weekStartsOn: 1 }), period === "fortnight" ? -7 : 0);
  const last = period === "month" ? endOfMonth(date) : endOfWeek(date, { weekStartsOn: 1 });
  const start = startOfWeek(first, { weekStartsOn: 1 });
  const end = endOfWeek(last, { weekStartsOn: 1 });
  const rows: (string | null)[][] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) {
    rows.push(
      Array.from({ length: 7 }, (_, col) => {
        const day = addDays(cursor, col);
        return day < first || day > last ? null : dayKey(day);
      }),
    );
  }
  return rows;
}

export function shiftProgressAnchor(
  anchor: string,
  period: ProgressPeriod,
  direction: -1 | 1,
): string {
  const date = parseDayKey(anchor);
  if (period === "month")
    return dayKey(new Date(date.getFullYear(), date.getMonth() + direction, 1));
  return dayKey(addDays(date, direction * (period === "fortnight" ? 14 : 7)));
}

/** Build one date index per snapshot, without ever swapping the coach's own store. */
export function progressDays(snapshot: ClientSnapshot): Map<string, ProgressDay> {
  const days = new Map<string, ProgressDay>();
  const ensure = (date: string): ProgressDay => {
    let day = days.get(date);
    if (!day) {
      day = { date, workouts: [], cardio: [] };
      days.set(date, day);
    }
    return day;
  };
  for (const log of snapshot.dailyLogs) ensure(log.date).log = log;
  const setsBySession = new Map<string, typeof snapshot.sets>();
  for (const set of snapshot.sets) {
    const sets = setsBySession.get(set.sessionId) ?? [];
    sets.push(set);
    setsBySession.set(set.sessionId, sets);
  }
  const exercises = new Map(snapshot.exercises.map((ex) => [ex.id, ex.name]));
  for (const session of [...snapshot.sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    // Match Today: unfinished workouts aren't recorded as completed training.
    if (session.endedAt == null) continue;
    const day = ensure(dayKey(new Date(session.startedAt)));
    const cardio = isCardioSession(session);
    const sets = setsBySession.get(session.id) ?? [];
    const training: ProgressTraining = {
      id: session.id,
      name: cardio
        ? (exercises.get(session.cardioExerciseId ?? "") ?? "Cardio")
        : (sessionSlotName(session, snapshot.slots) ?? "Workout"),
      startedAt: session.startedAt,
      ...(cardio
        ? { durationMinutes: session.durationMinutes, distance: session.distance }
        : { sets: sets.length }),
      note: session.note,
      details: cardio
        ? []
        : sets.map(
            (set) =>
              `${exercises.get(set.exerciseId) ?? "Exercise"}: ${set.weight} ${snapshot.unit} × ${set.reps}${set.rpe === undefined ? "" : ` · RPE ${set.rpe}`}`,
          ),
    };
    (cardio ? day.cardio : day.workouts).push(training);
  }
  return days;
}

export function progressValue(value: number | undefined, bodyweight = false, full = false): string {
  if (value === undefined) return "–";
  if (bodyweight) return value.toFixed(1);
  return full ? value.toLocaleString() : String(value);
}
