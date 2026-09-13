import { dayKey } from "./daily-log";
import { isCardioSession } from "./store";
import type { DailyLog, Exercise, SplitSlot, WorkoutSession, WorkoutSet } from "./store";

/**
 * Tabular serialisation of the domain objects.
 *
 * Two consumers share the column definitions below: Settings' CSV export
 * (`toCsv`) and the Google Sheets sync payload (`toRows`). Keeping both on one
 * set of `ColumnSpec`s is the point of the split -- the denormalisation that
 * turns an `exerciseId` into a readable exercise name is fiddly enough that
 * having two copies of it drift apart is a real risk, and a sheet that
 * disagreed with the CSV about what a row means would be worse than either.
 */

/** A single serialised cell, before any CSV stringification. */
export type CellValue = string | number | boolean | null | undefined;

/**
 * Column specification for the serialisers `toCsv` and `toRows`.
 * `header` is the column header text.
 * `accessor` is either a property key of row `T` or a function returning the cell value.
 */
export interface ColumnSpec<T> {
  header: string;
  accessor: keyof T | ((row: T) => CellValue);
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
 * Generic serialiser producing a 2D array: the header row, then one array per row.
 *
 * Cells come back as their RAW values rather than strings. That matters for the
 * Google Sheets payload, which carries JSON: a number stays a number and lands
 * in the sheet right-aligned and arithmetic-ready, where `String(raw)` would
 * make every cell text and quietly break any formula the user writes over it.
 * `toCsv` does its own stringification on top, since CSV has no such notion.
 */
export function toRows<T>(rows: readonly T[], columns: readonly ColumnSpec<T>[]): CellValue[][] {
  const headerRow: CellValue[] = columns.map((col) => col.header);
  const dataRows = rows.map((row) =>
    columns.map((col) =>
      typeof col.accessor === "function" ? col.accessor(row) : (row[col.accessor] as CellValue),
    ),
  );
  return [headerRow, ...dataRows];
}

/**
 * Generic CSV serialiser producing RFC 4180 compliant CSV string with CRLF line endings.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly ColumnSpec<T>[]): string {
  return toRows(rows, columns)
    .map((cells) =>
      cells
        .map((raw) => {
          if (raw === null || raw === undefined) {
            return "";
          }
          return escapeCsvField(String(raw));
        })
        .join(","),
    )
    .join("\r\n");
}

/**
 * Chronological row order for the sets table, ascending by `loggedAt`.
 * Exported so the CSV export and the sheet tab cannot drift apart on ordering.
 */
export function sortSetsByLoggedAt(sets: readonly WorkoutSet[]): WorkoutSet[] {
  return [...sets].sort((a, b) => a.loggedAt - b.loggedAt);
}

/**
 * Column definitions for one logged set, with session/exercise/slot ids
 * resolved to their display names.
 */
export function setColumns(
  sessions: readonly WorkoutSession[],
  exercises: readonly Exercise[],
  slots: readonly SplitSlot[],
  unit: "lbs" | "kg",
): ColumnSpec<WorkoutSet>[] {
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  const exerciseMap = new Map(exercises.map((e) => [e.id, e]));
  const slotMap = new Map(slots.map((s) => [s.id, s]));

  return [
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
 * consequence, worth stating: cardio is absent from BOTH CSV exports. The
 * sheet sync does carry it (see `cardioColumns`), so the JSON backup is no
 * longer the only complete record of it, but a CSV export still is not one.
 */
export function setsToCsv(
  sets: readonly WorkoutSet[],
  sessions: readonly WorkoutSession[],
  exercises: readonly Exercise[],
  slots: readonly SplitSlot[],
  unit: "lbs" | "kg",
): string {
  return toCsv(sortSetsByLoggedAt(sets), setColumns(sessions, exercises, slots, unit));
}

/**
 * Chronological row order for the daily log table, ascending by date.
 * Day keys are zero-padded `yyyy-MM-dd`, so a lexicographic sort is chronological.
 */
export function sortDailyLogsByDate(logs: readonly DailyLog[]): DailyLog[] {
  return [...logs].sort((a, b) => a.date.localeCompare(b.date));
}

/** Column definitions for one calendar day of nutrition and bodyweight. */
export function dailyLogColumns(unit: "lbs" | "kg"): ColumnSpec<DailyLog>[] {
  return [
    { header: "Date", accessor: "date" },
    { header: "Calories", accessor: "calories" },
    { header: "Protein (g)", accessor: "protein" },
    { header: "Carbs (g)", accessor: "carbs" },
    { header: "Fat (g)", accessor: "fat" },
    { header: "Steps", accessor: "steps" },
    { header: "Bodyweight", accessor: "bodyweight" },
    { header: "Unit", accessor: () => unit },
    { header: "Untracked", accessor: "isUntracked" },
  ];
}

/**
 * Serialises daily logs into CSV rows.
 * One row per calendar day, sorted chronologically by date ascending.
 * Absent numeric fields produce EMPTY cells, never 0.
 */
export function dailyLogsToCsv(logs: readonly DailyLog[], unit: "lbs" | "kg"): string {
  return toCsv(sortDailyLogsByDate(logs), dailyLogColumns(unit));
}

// --- Sheet-only tables ---------------------------------------------------
//
// The three below have no CSV export behind them today. They exist because the
// sheet is meant to be a COMPLETE picture for something reading it to make
// training and diet decisions, and cardio in particular is load that a strength
// log alone cannot account for.

/** Strength sessions only, oldest first. */
export function strengthSessionsInOrder(sessions: readonly WorkoutSession[]): WorkoutSession[] {
  return sessions.filter((s) => !isCardioSession(s)).sort((a, b) => a.startedAt - b.startedAt);
}

/** Cardio sessions only, oldest first. */
export function cardioSessionsInOrder(sessions: readonly WorkoutSession[]): WorkoutSession[] {
  return sessions.filter(isCardioSession).sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Column definitions for one strength session.
 *
 * `Sets` is a count rather than a list: the sets table already holds the detail,
 * and a session row exists here mainly to carry the free-text `note`, which is
 * the one field of a session a human plausibly wants to write from a keyboard.
 */
export function sessionColumns(
  slots: readonly SplitSlot[],
  sets: readonly WorkoutSet[],
): ColumnSpec<WorkoutSession>[] {
  const slotMap = new Map(slots.map((s) => [s.id, s]));
  const setCounts = new Map<string, number>();
  for (const set of sets) {
    setCounts.set(set.sessionId, (setCounts.get(set.sessionId) ?? 0) + 1);
  }

  return [
    { header: "Date", accessor: (s) => dayKey(new Date(s.startedAt)) },
    {
      header: "Split Slot",
      accessor: (s) => (s.splitSlotId == null ? "" : (slotMap.get(s.splitSlotId)?.name ?? "")),
    },
    { header: "Started", accessor: (s) => formatLocalTime(s.startedAt) },
    { header: "Ended", accessor: (s) => (s.endedAt == null ? "" : formatLocalTime(s.endedAt)) },
    {
      header: "Duration (min)",
      // An in-progress session has no endedAt. Leave the cell empty rather than
      // computing against Date.now(), which would make the sheet's contents
      // depend on when it happened to be synced.
      accessor: (s) =>
        s.endedAt == null ? undefined : Math.round((s.endedAt - s.startedAt) / 60000),
    },
    { header: "Sets", accessor: (s) => setCounts.get(s.id) ?? 0 },
    { header: "Note", accessor: (s) => s.note },
  ];
}

/**
 * Column definitions for one cardio bout.
 *
 * Distance carries its own unit column because `WorkoutSession.distance` is
 * miles under lbs and km under kg, so the number alone is ambiguous.
 */
export function cardioColumns(
  exercises: readonly Exercise[],
  unit: "lbs" | "kg",
): ColumnSpec<WorkoutSession>[] {
  const exerciseMap = new Map(exercises.map((e) => [e.id, e]));

  return [
    { header: "Date", accessor: (s) => dayKey(new Date(s.startedAt)) },
    { header: "Time", accessor: (s) => formatLocalTime(s.startedAt) },
    {
      header: "Exercise",
      accessor: (s) =>
        s.cardioExerciseId == null ? "" : (exerciseMap.get(s.cardioExerciseId)?.name ?? ""),
    },
    { header: "Duration (min)", accessor: (s) => s.durationMinutes },
    { header: "Distance", accessor: (s) => s.distance },
    { header: "Distance Unit", accessor: () => (unit === "kg" ? "km" : "mi") },
    { header: "Setup Note", accessor: (s) => s.setupNote },
    { header: "Note", accessor: (s) => s.note },
  ];
}
