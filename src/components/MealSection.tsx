import { useMemo, useState } from "react";
import { entryMacros, formatMeasurement, type FoodEntry, type Meal } from "../lib/food";
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

/**
 * Renders one meal on the Today screen.
 *
 * Displays the meal name in group-header, the list of logged food items with
 * portion and macro breakdown, an add control, and a copy from another day shortcut.
 * An unresolved portion shows its own inline error rather than reporting 0.
 */
export function MealSection({
  meal,
  entries,
  date,
}: {
  meal: Meal;
  entries: FoodEntry[];
  date: string;
}) {
  const deleteFoodEntry = useStore((s) => s.deleteFoodEntry);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [copySheetOpen, setCopySheetOpen] = useState(false);

  const mealMacros = useMemo(() => {
    return entries.map((e) => ({
      entry: e,
      macros: entryMacros(e),
    }));
  }, [entries]);

  const mealCalories = useMemo(() => {
    let total = 0;
    let hasAny = false;
    for (const item of mealMacros) {
      if (item.macros.calories !== undefined) {
        total += item.macros.calories;
        hasAny = true;
      }
    }
    return hasAny ? total : undefined;
  }, [mealMacros]);

  return (
    <section className="px-5 section-gap anim-fade-up">
      <div className="flex items-baseline justify-between group-header px-0">
        <h2 className="t-caption">{meal.name}</h2>
        {mealCalories !== undefined && mealCalories > 0 && (
          <span className="t-caption text-muted-foreground">
            {Math.round(mealCalories).toLocaleString()} cal
          </span>
        )}
      </div>

      <ul className="group-list">
        {/*
          An empty meal says nothing at all, deliberately. A line like "no food
          logged yet" would repeat verbatim under every empty meal, so on a
          fresh day the screen would say the same sentence six times. The
          heading and the add row already carry the whole message.
        */}
        {entries.length > 0 &&
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
                    <div className="truncate t-body font-medium text-foreground">{entry.name}</div>
                    <div className="truncate t-label text-muted-foreground">
                      {formatMeasurement(entry, entry.quantity, entry.unit)}
                      {entry.brand ? ` · ${entry.brand}` : ""}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isUnresolved ? (
                      <span className="t-label font-medium text-destructive">
                        Unresolved portion
                      </span>
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        {macros.calories !== undefined && (
                          <span className="t-stat text-foreground">
                            {Math.round(macros.calories)}
                            <span className="ml-1 t-label font-normal text-muted-foreground">
                              cal
                            </span>
                          </span>
                        )}
                        <div className="flex items-center gap-2 t-caption font-semibold">
                          {macros.protein !== undefined && (
                            <span className="text-protein">{Math.round(macros.protein)}g P</span>
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
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                      title="Delete entry"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}

        <li>
          <button
            type="button"
            onClick={() => setAddSheetOpen(true)}
            aria-label={`Add food to ${meal.name}`}
            // No separator above the add row when the meal is empty: a rule
            // with nothing above it reads as a divider between groups.
            className={`group-row w-full text-left t-body font-medium text-accent ${
              entries.length > 0 ? "group-row-sep" : ""
            }`}
          >
            Add food
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={() => setCopySheetOpen(true)}
            aria-label={`Copy ${meal.name} from another day`}
            className="group-row group-row-sep w-full text-left t-body font-medium text-muted-foreground hover:text-foreground"
          >
            Copy from another day
          </button>
        </li>
      </ul>

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
    </section>
  );
}
