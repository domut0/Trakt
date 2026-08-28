import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { entryMacros, sumMacros, type FoodEntry, type Meal } from "../lib/food";
import { useStore } from "../lib/store";
import { useToast } from "./Toast";

function formatDateLabel(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    if (!y || !m || !d) return dateStr;
    const date = new Date(y, m - 1, d);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(y, m - 1, d);
    const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) return "Yesterday";
    if (diffDays === 0) return "Today";

    return date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

interface DayMealGroup {
  date: string;
  entries: FoodEntry[];
  totalCalories?: number;
  itemSummary: string;
}

/**
 * Sheet for copying previous entries of a meal from another day.
 *
 * Lists recent days that have entries for the target meal slot, displaying the date,
 * food items, and total calories. Tapping a day duplicates all entries into the target
 * meal on the active date and triggers a toast notification.
 */
export function CopyMealSheet({
  open,
  onClose,
  targetMeal,
  targetDate,
}: {
  open: boolean;
  onClose: () => void;
  targetMeal: Meal;
  targetDate: string;
}) {
  const foodEntries = useStore((s) => s.foodEntries);
  const copyMealFrom = useStore((s) => s.copyMealFrom);
  const showToast = useToast();

  useSheetDismiss(open, onClose);

  const pastGroups = useMemo<DayMealGroup[]>(() => {
    // Only entries for the same meal slot, on days other than the active date
    const relevant = foodEntries.filter((e) => e.mealId === targetMeal.id && e.date !== targetDate);

    const byDate = new Map<string, FoodEntry[]>();
    for (const e of relevant) {
      const list = byDate.get(e.date);
      if (list) list.push(e);
      else byDate.set(e.date, [e]);
    }

    const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

    return dates.map((d) => {
      const entries = byDate.get(d) ?? [];
      const derived = sumMacros(entries.map(entryMacros));
      const names = entries.map((e) => e.name).join(", ");
      return {
        date: d,
        entries,
        totalCalories: derived.calories,
        itemSummary: names,
      };
    });
  }, [foodEntries, targetMeal.id, targetDate]);

  if (!open || typeof document === "undefined") return null;

  const handleCopyDay = (sourceDate: string) => {
    const copiedCount = copyMealFrom(sourceDate, targetMeal.id, targetDate, targetMeal.id);
    onClose();
    showToast({
      message: `Copied ${copiedCount} ${copiedCount === 1 ? "item" : "items"} to ${targetMeal.name}`,
    });
  };

  return createPortal(
    <div
      data-swipe-ignore
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5 anim-backdrop"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col bg-paper rule-heavy-t p-5 anim-popup rounded-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 shrink-0 bg-border" />

        <div className="flex shrink-0 items-center justify-between pb-3">
          <div>
            <div className="t-caption text-ink-2">{targetMeal.name}</div>
            <h2 className="t-heading font-semibold tracking-tight">Copy from another day</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex min-h-[44px] items-center px-2 t-label text-ink-2 hover:text-ink"
          >
            Cancel
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {pastGroups.length === 0 ? (
            <div className="group-list bg-wash p-4 text-center">
              <p className="t-label text-ink-2">No previous entries for {targetMeal.name}.</p>
            </div>
          ) : (
            <div className="group-list bg-wash">
              {pastGroups.map((group, idx) => (
                <button
                  key={group.date}
                  type="button"
                  onClick={() => handleCopyDay(group.date)}
                  className={`group-row w-full text-left transition-colors hover:bg-wash ${
                    idx > 0 ? "group-row-sep" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="truncate t-body font-semibold text-ink">
                      {formatDateLabel(group.date)}
                    </div>
                    <div className="truncate t-label text-ink-2">{group.itemSummary}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    {group.totalCalories !== undefined && (
                      <div className="t-stat text-ink">
                        {Math.round(group.totalCalories)}{" "}
                        <span className="t-label font-normal text-ink-2">cal</span>
                      </div>
                    )}
                    <div className="t-label text-ink">
                      {group.entries.length} {group.entries.length === 1 ? "item" : "items"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
