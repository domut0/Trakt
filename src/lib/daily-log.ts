import { format, parse, startOfWeek } from "date-fns";
import type { DailyLog, WorkoutSession } from "./store";

/**
 * Pure helpers for daily numeric logging. No store, no IndexedDB, no DOM —
 * everything here is directly unit-testable.
 *
 * NOTE: `import type` above is deliberate. store.ts imports `isDailyLogEmpty`
 * from this module, so a value import back into store.ts would be a real
 * runtime cycle; a type-only import is erased at compile time and is not.
 */

/**
 * The canonical daily-log key: a LOCAL calendar date as "yyyy-MM-dd".
 *
 * Local, not UTC — `toISOString().slice(0, 10)` would roll the date over at
 * the wrong moment for anyone west of UTC, so late-evening entries would land
 * on tomorrow.
 *
 * CalendarView.tsx currently carries its own private copy of this helper; a
 * later slice consolidates the two.
 */
export function dayKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** The numeric fields of a DailyLog, in the order the editor and summary show them. */
export const DAILY_LOG_NUMERIC_FIELDS = [
  "calories",
  "protein",
  "carbs",
  "fat",
  "steps",
  "bodyweight",
] as const satisfies readonly (keyof DailyLog)[];

export type DailyLogNumericField = (typeof DAILY_LOG_NUMERIC_FIELDS)[number];

/**
 * True when a record carries no information worth keeping.
 *
 * Deliberately strict about `0`: it is a real logged value (0 steps is a
 * meaningful thing to record), so a present zero makes the record NON-empty.
 * Only `undefined` counts as absent.
 *
 * There used to be a second case here, an `isUntracked` flag that kept an
 * otherwise-blank day alive so the app could tell "deliberately not tracking"
 * from "nothing logged". Those are the same day. A day with no numbers on it
 * says so by having no numbers on it, and the flag only ever added a second
 * way to be empty.
 *
 * `upsertDailyLog` uses this to delete rather than store an empty shell.
 */
export function isDailyLogEmpty(log: DailyLog): boolean {
  return DAILY_LOG_NUMERIC_FIELDS.every((f) => log[f] === undefined);
}

// ---------------------------------------------------------------------------
// Weekly grouping and aggregation. All pure and all keyed on the same
// "yyyy-MM-dd" local day key `dayKey` produces, so nothing here needs a Date
// to travel through the UI.
// ---------------------------------------------------------------------------

/**
 * "2026-08-07" -> a LOCAL Date at midnight. The inverse of `dayKey`.
 *
 * Deliberately not `new Date(key)`, which parses a bare yyyy-MM-dd as UTC and
 * so lands on the previous day for anyone west of UTC.
 */
export function parseDayKey(key: string): Date {
  return parse(key, "yyyy-MM-dd", new Date());
}

/**
 * The day key of the MONDAY that starts the week containing `day`.
 *
 * Monday-start is the app's convention, so a Sunday belongs to the week that
 * began six days earlier, not to the one starting the next morning. That
 * off-by-one is the whole reason this is a named, tested helper rather than
 * an inline `startOfWeek` call at each call site.
 */
export function weekStartKey(day: string | Date): string {
  const d = typeof day === "string" ? parseDayKey(day) : day;
  return dayKey(startOfWeek(d, { weekStartsOn: 1 }));
}
