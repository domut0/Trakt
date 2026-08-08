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

/** One week's worth of day keys, as produced by `groupDayKeysByWeek`. */
export interface DailyLogWeek {
  /** The Monday that starts the week, as a day key. */
  weekStart: string;
  /** The week's day keys, newest first. Deduplicated. */
  days: string[];
}

/**
 * Buckets day keys into Monday-start weeks, newest week first and newest day
 * first within each week. Only weeks that actually contain a day are returned:
 * a gap of untracked weeks collapses rather than rendering as empty headers.
 */
export function groupDayKeysByWeek(keys: Iterable<string>): DailyLogWeek[] {
  const buckets = new Map<string, string[]>();
  for (const key of new Set(keys)) {
    const start = weekStartKey(key);
    const bucket = buckets.get(start);
    if (bucket) bucket.push(key);
    else buckets.set(start, [key]);
  }
  // Day keys are zero-padded, so lexicographic order IS chronological order.
  return [...buckets.entries()]
    .map(([weekStart, days]) => ({ weekStart, days: days.sort().reverse() }))
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

/**
 * One field's summary over a set of days. `average` is the mean over
 * `loggedDays` only — see `aggregateDailyLogs` for why.
 */
export interface DailyLogFieldAggregate {
  average: number;
  /** How many days actually carried the field. Always at least 1. */
  loggedDays: number;
}

/** Per-field aggregates. `null` means the field appears on no day at all. */
export type DailyLogAggregates = Record<DailyLogNumericField, DailyLogFieldAggregate | null>;

/**
 * Averages each numeric field over ONLY the days where it was actually set.
 *
 * A missing day is not a zero. Averaging over all seven days would make a
 * week someone tracked on three days read as a crash diet, which is worse
 * than useless — it is wrong in a direction that looks alarming.
 *
 * Each field carries its own count, because tracking is rarely uniform: steps
 * may come from a phone every day while macros get logged when there's time.
 *
 * A logged `0` is real data and counts toward both the sum and the count.
 * Only `undefined` is absent, matching `isDailyLogEmpty`.
 */
export function aggregateDailyLogs(logs: readonly DailyLog[]): DailyLogAggregates {
  const out = {} as DailyLogAggregates;
  for (const field of DAILY_LOG_NUMERIC_FIELDS) {
    let sum = 0;
    let loggedDays = 0;
    for (const log of logs) {
      const value = log[field];
      if (value === undefined) continue;
      sum += value;
      loggedDays += 1;
    }
    out[field] = loggedDays === 0 ? null : { average: sum / loggedDays, loggedDays };
  }
  return out;
}

/**
 * How many workouts were finished in the Monday-start week beginning at
 * `weekStart`. Unfinished (still-running) sessions don't count — a workout is
 * "trained" once it has ended, which is also the moment it gets a day.
 */
export function countSessionsTrained(
  sessions: readonly Pick<WorkoutSession, "endedAt">[],
  weekStart: string,
): number {
  return sessions.filter(
    (s) => s.endedAt != null && weekStartKey(new Date(s.endedAt)) === weekStart,
  ).length;
}
