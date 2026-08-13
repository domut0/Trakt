import { dayKey } from "./daily-log";
import type { DailyLog, Exercise, SplitSlot, WorkoutSession, WorkoutSet } from "./store";

/**
 * Column specification for the generic CSV serialiser `toCsv`.
 * `header` is the column header text.
 * `accessor` is either a property key of row `T` or a function returning the cell value.
 */
export interface ColumnSpec<T> {
  header: string;
  accessor: keyof T | ((row: T) => string | number | boolean | null | undefined);
}

/**
 * Escapes a single string field according to RFC 4180 rules.
 * Any field containing a comma, double quote, carriage return, or newline is wrapped
 * in double quotes, with internal double quotes doubled ("").
 */
export function escapeCsvField(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\r") || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Formats a timestamp (ms) as a 24-hour HH:mm string in local time.
 */
function formatLocalTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${mins}`;
}

/**
 * Generic CSV serialiser producing RFC 4180 compliant CSV string with CRLF line endings.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly ColumnSpec<T>[]): string {
  const headerRow = columns.map((col) => escapeCsvField(col.header)).join(",");
  const dataRows = rows.map((row) =>
    columns
      .map((col) => {
        const raw = typeof col.accessor === "function" ? col.accessor(row) : row[col.accessor];
        if (raw === null || raw === undefined) {
          return "";
        }
        return escapeCsvField(String(raw));
      })
      .join(","),
  );
  return [headerRow, ...dataRows].join("\r\n");
}

/**
 * Serialises logged sets into CSV rows.
 * One row per logged set, sorted chronologically by loggedAt ascending.
 *
 * There is deliberately no cardio filter. `logCardio` writes a session and no
 * sets at all, so a cardio bout contributes nothing to this file by
 * construction rather than by exclusion. Adding a guard here would instead
 * risk dropping real strength data whenever `kind` grew a third value, and an
 * export is the one place where silently losing a row is unrecoverable. The
 * consequence, worth stating: cardio is absent from BOTH CSV exports, so the
 * JSON backup is currently the only complete record of it.
 */
export function setsToCsv(
  sets: readonly WorkoutSet[],
  sessions: readonly WorkoutSession[],
  exercises: readonly Exercise[],
  slots: readonly SplitSlot[],
  unit: "lbs" | "kg",
): string {
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  const exerciseMap = new Map(exercises.map((e) => [e.id, e]));
  const slotMap = new Map(slots.map((s) => [s.id, s]));

  const sortedSets = [...sets].sort((a, b) => a.loggedAt - b.loggedAt);

  const columns: ColumnSpec<WorkoutSet>[] = [
    {
      header: "Date",
      accessor: (set) => dayKey(new Date(set.loggedAt)),
    },
    {
      header: "Time",
      accessor: (set) => formatLocalTime(set.loggedAt),
    },
    {
      header: "Split Slot",
      accessor: (set) => {
        const sess = sessionMap.get(set.sessionId);
        // `== null`, not falsy: a slot id is a string and the only absent value
        // is undefined, which is what every cardio session carries. Matching
        // the `!= null` convention used by store.ts's slot guards keeps the two
        // readings of "has no slot" identical.
        if (sess == null || sess.splitSlotId == null) return "";
        return slotMap.get(sess.splitSlotId)?.name ?? "";
      },
    },
    {
      header: "Exercise",
      accessor: (set) => exerciseMap.get(set.exerciseId)?.name ?? "",
    },
    {
      header: "Exercise Type",
      accessor: (set) => exerciseMap.get(set.exerciseId)?.type ?? "",
    },
    {
      header: "Weight",
      accessor: "weight",
    },
    {
      header: "Unit",
      accessor: () => unit,
    },
    {
      header: "Reps",
      accessor: "reps",
    },
    {
      header: "RPE",
      accessor: (set) => set.rpe,
    },
    {
      header: "Setup Note",
      accessor: (set) => set.setupNote,
    },
  ];

  return toCsv(sortedSets, columns);
}

/**
 * Serialises daily logs into CSV rows.
 * One row per calendar day, sorted chronologically by date ascending.
 * Absent numeric fields produce EMPTY cells, never 0.
 */
export function dailyLogsToCsv(logs: readonly DailyLog[], unit: "lbs" | "kg"): string {
  const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date));

  const columns: ColumnSpec<DailyLog>[] = [
    { header: "Date", accessor: "date" },
    { header: "Calories", accessor: "calories" },
    { header: "Protein (g)", accessor: "protein" },
    { header: "Carbs (g)", accessor: "carbs" },
    { header: "Fat (g)", accessor: "fat" },
    { header: "Steps", accessor: "steps" },
    { header: "Bodyweight", accessor: "bodyweight" },
    { header: "Unit", accessor: () => unit },
    { header: "Cheat Day", accessor: "isCheatDay" },
  ];

  return toCsv(sortedLogs, columns);
}
