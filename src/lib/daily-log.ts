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
 * How many workouts count as "trained" in the Monday-start week beginning at
 * `weekStart`.
 *
 * Two different questions, answered on purpose by two different fields:
 *
 * 1. Does the session count at all? `endedAt != null`. A still-running workout
 *    is not yet a trained session, so an in-progress lift never inflates the
 *    week it is happening in. This is a COMPLETENESS filter.
 * 2. Which week does it count in? `startedAt`. The day you began training owns
 *    the session. This is the DATE ASSIGNMENT, and it is a separate decision
 *    from (1) even though only finished sessions ever reach it.
 *
 * `startedAt` does the bucketing because every surface that LISTS sessions
 * buckets them that way: WeeklyView's day cards, CalendarView's grid, and the
 * home route's Today card. Bucketing this count by `endedAt` instead put a
 * workout begun 23:00 Sunday and finished 00:30 Monday into the FOLLOWING
 * week's total while the lists still showed it under the Sunday, and WeeklyView
 * renders that total in the header immediately above that list: the header
 * could read "No sessions" directly over a card naming a workout. Worse, weeks
 * with nothing logged in them are never rendered at all, so the displaced count
 * could vanish from the screen rather than merely land one week late.
 *
 * So agreement with the display surfaces decides this, not the otherwise
 * reasonable claim that a workout becomes "trained" at the instant it ends.
 * Only one date can be right for both the count and the list, and a visible
 * number contradicting the list beneath it is a worse failure than a debatable
 * definition of when the training happened.
 *
 * Midnight crossings are not a hypothetical worth waving away: `logCardio`
 * back-computes `startedAt` from the logged duration, so a bout entered just
 * after midnight lands on the previous day by construction.
 */
export function countSessionsTrained(
  sessions: readonly Pick<WorkoutSession, "startedAt" | "endedAt">[],
  weekStart: string,
): number {
  return sessions.filter(
    (s) => s.endedAt != null && weekStartKey(new Date(s.startedAt)) === weekStart,
  ).length;
}
