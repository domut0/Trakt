import { useMemo } from "react";
import {
  effectiveDailyLogs,
  entriesByDate,
  resolveDayMacros,
  type ResolvedDayMacros,
} from "./food";
import { useStore } from "./store";
import type { DailyLog } from "./store";

/**
 * The single way a screen asks what a day's macros are.
 *
 * Decision 6 makes that a computed question, and the plan is explicit that
 * Today, the charts, the weekly averages and the sheet push all have to answer
 * it identically. Routing them through these two hooks is what makes that true
 * by construction rather than by everyone remembering.
 *
 * Both are memoised on the two arrays they read, so the projection is built
 * once per change rather than once per component.
 */

/** Daily logs with derived macros substituted in wherever food entries exist. */
export function useEffectiveDailyLogs(): DailyLog[] {
  const dailyLogs = useStore((s) => s.dailyLogs);
  const foodEntries = useStore((s) => s.foodEntries);
  return useMemo(() => effectiveDailyLogs(dailyLogs, foodEntries), [dailyLogs, foodEntries]);
}

/**
 * One day's macros, plus how they were arrived at.
 *
 * The `source` matters to the UI and not just to the maths: a day showing
 * derived totals must not also offer the typed macro fields for editing, or the
 * user would type a number that silently does nothing.
 */
export function useDayMacros(date: string): ResolvedDayMacros {
  const dailyLogs = useStore((s) => s.dailyLogs);
  const foodEntries = useStore((s) => s.foodEntries);
  return useMemo(() => {
    const forDay = entriesByDate(foodEntries).get(date) ?? [];
    return resolveDayMacros(
      forDay,
      dailyLogs.find((l) => l.date === date),
    );
  }, [dailyLogs, foodEntries, date]);
}
