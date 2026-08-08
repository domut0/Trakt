import { format } from "date-fns";
import type { DailyLog } from "./store";

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
 * Deliberately strict about two cases:
 * - `0` is a real logged value (0 steps is a meaningful thing to record), so a
 *   present zero makes the record NON-empty. Only `undefined` counts as absent.
 * - `isCheatDay: false` carries no information either — it is the default — so
 *   it does NOT keep an otherwise-blank record alive. Only `true` does.
 *
 * `upsertDailyLog` uses this to delete rather than store an empty shell.
 */
export function isDailyLogEmpty(log: DailyLog): boolean {
  if (log.isCheatDay === true) return false;
  return DAILY_LOG_NUMERIC_FIELDS.every((f) => log[f] === undefined);
}
