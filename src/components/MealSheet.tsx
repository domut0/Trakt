import { useMemo, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { entryMacros, formatMeasurement, type Meal } from "../lib/food";
import { useStore } from "../lib/store";
import { AddFoodSheet } from "./AddFoodSheet";
import { CopyMealSheet } from "./CopyMealSheet";

function TrashIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatMealWindow(fromMinutes: number, toMinutes: number): string {
  return `${formatTime(fromMinutes)} - ${formatTime(toMinutes)}`;
}

/**
 * Bottom sheet for viewing, logging, and copying food entries for a specific meal.
 */
export function MealSheet({
  mealId,
  date,
  onClose,
}: {
  mealId: string | null;
  date: string;
  onClose: () => void;
}): JSX.Element | null {
  const meals = useStore((s) => s.meals);
  const foodEntries = useStore((s) => s.foodEntries);
  const deleteFoodEntry = useStore((s) => s.deleteFoodEntry);

  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [copySheetOpen, setCopySheetOpen] = useState(false);

  const meal = useMemo(() => {
    if (!mealId) return undefined;
    return meals.find((m) => m.id === mealId);
  }, [meals, mealId]);

  const entries = useMemo(() => {
    if (!mealId) return [];
    return foodEntries.filter((e) => e.date === date && e.mealId === mealId);
  }, [foodEntries, date, mealId]);

  const mealMacros = useMemo(() => {
    return entries.map((e) => ({
      entry: e,
      macros: entryMacros(e),
    }));
  }, [entries]);

  const isOpen = mealId !== null && meal !== undefined;
  useSheetDismiss(isOpen, onClose);

  if (!isOpen || typeof document === "undefined") return null;

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
        className="flex max-h-[85vh] w-full max-w-sm flex-col bg-paper rule-heavy-t p-5 anim-popup"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 shrink-0 bg-border" />

        <div className="flex shrink-0 items-center justify-between pb-3">
          <div>
            <h2 className="t-heading font-semibold tracking-tight">{meal.name}</h2>
            <div className="t-label text-ink-2">
              {formatMealWindow(meal.fromMinutes, meal.toMinutes)}
            </div>
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
          <ul className="group-list bg-wash">
            {entries.length === 0 ? (
              <li className="p-4 text-center">
                <p className="t-label text-ink-2">Empty so far.</p>
              </li>
            ) : (
              mealMacros.map(({ entry, macros }, idx) => {
                const isUnresolved =
                  macros.calories === undefined &&
                  macros.protein === undefined &&
                  macros.carbs === undefined &&
                  macros.fat === undefined;

                return (
                  <li key={entry.id}>
                    <div className={`group-row ${idx > 0 ? "group-row-sep" : ""}`}>
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="truncate t-body font-medium text-ink">{entry.name}</div>
                        <div className="truncate t-label text-ink-2">
                          {formatMeasurement(entry, entry.quantity, entry.unit)}
                          {entry.brand ? ` · ${entry.brand}` : ""}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isUnresolved ? (
                          <span className="t-label font-medium text-signal">
                            Unresolved portion
                          </span>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            {macros.calories !== undefined && (
                              <span className="t-stat text-ink">
                                {Math.round(macros.calories)}
                                <span className="ml-1 t-label font-normal text-ink-2">cal</span>
                              </span>
                            )}
                            <div className="flex items-center gap-2 t-caption font-semibold">
                              {macros.protein !== undefined && (
                                <span className="text-protein">
                                  {Math.round(macros.protein)}g P
                                </span>
                              )}
                              {macros.carbs !== undefined && (
                                <span className="text-carbs">{Math.round(macros.carbs)}g C</span>
                              )}
                              {macros.fat !== undefined && (
                                <span className="text-fat">{Math.round(macros.fat)}g F</span>
                              )}
                            </div>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => deleteFoodEntry(entry.id)}
                          aria-label={`Delete ${entry.name}`}
                          className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-2 hover:text-signal"
                          title="Delete entry"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })
            )}

            <li>
              <button
                type="button"
                onClick={() => setAddSheetOpen(true)}
                aria-label={`Add food to ${meal.name}`}
                className="group-row group-row-sep w-full text-left t-body t-action"
              >
                Add food
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => setCopySheetOpen(true)}
                aria-label={`Copy ${meal.name} from another day`}
                className="group-row group-row-sep w-full text-left t-body font-medium text-ink-2 hover:text-ink"
              >
                Copy from another day
              </button>
            </li>
          </ul>
        </div>
      </div>

      <AddFoodSheet
        open={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        meal={meal}
        date={date}
      />

      <CopyMealSheet
        open={copySheetOpen}
        onClose={() => setCopySheetOpen(false)}
        targetMeal={meal}
        targetDate={date}
      />
    </div>,
    document.body,
  );
}
