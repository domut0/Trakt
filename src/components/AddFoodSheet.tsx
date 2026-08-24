import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import {
  entryMacros,
  MEASUREMENT_UNITS,
  recipePerServingMacros,
  UNIT_LABELS,
  type Food,
  type FoodEntry,
  type Meal,
  type MeasurementUnit,
  type Recipe,
} from "../lib/food";
import { useStore } from "../lib/store";
import { RecipeEditorSheet } from "./RecipeEditorSheet";

function toNum(val: string): number | undefined {
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Sheet for logging food to a specific meal and date.
 *
 * Supports picking from catalogue foods, saved recipes, or typing a quick-add portion directly.
 */
export function AddFoodSheet({
  open,
  onClose,
  meal,
  date,
}: {
  open: boolean;
  onClose: () => void;
  meal: Meal;
  date: string;
}) {
  const foods = useStore((s) => s.foods);
  const recipes = useStore((s) => s.recipes);
  const recipeIngredients = useStore((s) => s.recipeIngredients);
  const addFoodEntry = useStore((s) => s.addFoodEntry);

  const [query, setQuery] = useState("");
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [recipeEditorOpen, setRecipeEditorOpen] = useState(false);

  // Quick add / custom entry fields
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState<MeasurementUnit>("serving");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedFood(null);
    setSelectedRecipe(null);
    setName("");
    setBrand("");
    setQuantity("1");
    setUnit("serving");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  useSheetDismiss(open, onClose);

  const filteredFoods = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return foods.slice(0, 8);
    return foods
      .filter(
        (f) => f.name.toLowerCase().includes(q) || (f.brand && f.brand.toLowerCase().includes(q)),
      )
      .slice(0, 10);
  }, [foods, query]);

  const filteredRecipes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes.slice(0, 5);
    return recipes
      .filter(
        (r) => r.name.toLowerCase().includes(q) || (r.note && r.note.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [recipes, query]);

  const handleSelectFood = (food: Food) => {
    setSelectedFood(food);
    setSelectedRecipe(null);
    setName(food.name);
    setBrand(food.brand ?? "");
    setQuantity(String(food.basisQuantity));
    setUnit(food.basisUnit);
    setCalories(food.calories !== undefined ? String(food.calories) : "");
    setProtein(food.protein !== undefined ? String(food.protein) : "");
    setCarbs(food.carbs !== undefined ? String(food.carbs) : "");
    setFat(food.fat !== undefined ? String(food.fat) : "");
  };

  const handleSelectRecipe = (recipe: Recipe) => {
    setSelectedRecipe(recipe);
    setSelectedFood(null);
    setName(recipe.name);
    setBrand("");
    setQuantity("1");
    setUnit("serving");
    const perServing = recipePerServingMacros(recipe, recipeIngredients, foods);
    setCalories(perServing.calories !== undefined ? String(perServing.calories) : "");
    setProtein(perServing.protein !== undefined ? String(perServing.protein) : "");
    setCarbs(perServing.carbs !== undefined ? String(perServing.carbs) : "");
    setFat(perServing.fat !== undefined ? String(perServing.fat) : "");
  };

  const previewEntry: FoodEntry = useMemo(() => {
    const q = toNum(quantity) ?? 1;
    if (selectedRecipe) {
      const perServing = recipePerServingMacros(selectedRecipe, recipeIngredients, foods);
      return {
        id: "preview",
        date,
        mealId: meal.id,
        name: selectedRecipe.name,
        recipeId: selectedRecipe.id,
        quantity: q,
        unit,
        basisQuantity: 1,
        basisUnit: "serving",
        servingLabel: "serving",
        calories: perServing.calories,
        protein: perServing.protein,
        carbs: perServing.carbs,
        fat: perServing.fat,
        loggedAt: 0,
      };
    }
    if (selectedFood) {
      return {
        id: "preview",
        date,
        mealId: meal.id,
        name: selectedFood.name,
        brand: selectedFood.brand,
        foodId: selectedFood.id,
        quantity: q,
        unit,
        basisQuantity: selectedFood.basisQuantity,
        basisUnit: selectedFood.basisUnit,
        servingLabel: selectedFood.servingLabel,
        servingWeight: selectedFood.servingWeight,
        packageWeight: selectedFood.packageWeight,
        calories: selectedFood.calories,
        protein: selectedFood.protein,
        carbs: selectedFood.carbs,
        fat: selectedFood.fat,
        loggedAt: 0,
      };
    }
    return {
      id: "preview",
      date,
      mealId: meal.id,
      name: name.trim() || query.trim() || "Quick add",
      brand: brand.trim() || undefined,
      quantity: q,
      unit,
      basisQuantity: q,
      basisUnit: unit === "g" || unit === "ml" ? unit : "serving",
      calories: toNum(calories),
      protein: toNum(protein),
      carbs: toNum(carbs),
      fat: toNum(fat),
      loggedAt: 0,
    };
  }, [
    selectedRecipe,
    selectedFood,
    recipeIngredients,
    foods,
    date,
    meal.id,
    name,
    query,
    brand,
    quantity,
    unit,
    calories,
    protein,
    carbs,
    fat,
  ]);

  const calculatedMacros = useMemo(() => entryMacros(previewEntry), [previewEntry]);

  const handleSave = () => {
    const q = toNum(quantity) ?? 1;
    if (selectedRecipe) {
      // Decision 18: Logging a recipe freezes resolved per-serving macros as its own basis.
      // Soft link recipeId is preserved, but past entries never recompute when the recipe is edited.
      const perServing = recipePerServingMacros(selectedRecipe, recipeIngredients, foods);
      addFoodEntry({
        date,
        mealId: meal.id,
        name: selectedRecipe.name,
        recipeId: selectedRecipe.id,
        quantity: q,
        unit,
        basisQuantity: 1,
        basisUnit: "serving",
        servingLabel: "serving",
        calories: perServing.calories,
        protein: perServing.protein,
        carbs: perServing.carbs,
        fat: perServing.fat,
      });
    } else if (selectedFood) {
      addFoodEntry({
        date,
        mealId: meal.id,
        name: selectedFood.name,
        brand: selectedFood.brand,
        foodId: selectedFood.id,
        quantity: q,
        unit,
        basisQuantity: selectedFood.basisQuantity,
        basisUnit: selectedFood.basisUnit,
        servingLabel: selectedFood.servingLabel,
        servingWeight: selectedFood.servingWeight,
        packageWeight: selectedFood.packageWeight,
        calories: selectedFood.calories,
        protein: selectedFood.protein,
        carbs: selectedFood.carbs,
        fat: selectedFood.fat,
      });
    } else {
      const entryName = name.trim() || query.trim() || "Quick add";
      addFoodEntry({
        date,
        mealId: meal.id,
        name: entryName,
        brand: brand.trim() || undefined,
        quantity: q,
        unit,
        basisQuantity: q,
        basisUnit: unit === "g" || unit === "ml" ? unit : "serving",
        calories: toNum(calories),
        protein: toNum(protein),
        carbs: toNum(carbs),
        fat: toNum(fat),
      });
    }
    onClose();
  };

  if (!open || typeof document === "undefined") return null;

  const hasSelection = selectedFood !== null || selectedRecipe !== null;

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
        className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-3xl bg-surface p-5 anim-popup"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-border" />

        <div className="flex shrink-0 items-center justify-between pb-3">
          <div>
            <div className="t-caption text-muted-foreground">{meal.name}</div>
            <h2 className="t-heading font-semibold tracking-tight">Add food</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex min-h-[44px] items-center px-2 t-label font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {!hasSelection ? (
            <>
              {/* Search or quick name input */}
              <div>
                <input
                  ref={inputRef}
                  type="text"
                  aria-label="Search or enter food name"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search food or type a name"
                  className="min-h-[44px] w-full rounded-xl bg-muted px-3 t-body text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* Recipe results if available */}
              {filteredRecipes.length > 0 && (
                <div className="group-list bg-muted">
                  <div className="flex items-center justify-between px-3 pt-2 pb-1">
                    <span className="t-caption text-muted-foreground">Recipes</span>
                    <button
                      type="button"
                      onClick={() => setRecipeEditorOpen(true)}
                      className="flex min-h-[44px] items-center px-1 t-label font-semibold text-accent"
                    >
                      + New recipe
                    </button>
                  </div>
                  {filteredRecipes.map((r, idx) => {
                    const perServing = recipePerServingMacros(r, recipeIngredients, foods);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => handleSelectRecipe(r)}
                        className={`group-row w-full text-left transition-colors hover:bg-surface/50 ${
                          idx > 0 ? "group-row-sep" : ""
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate t-body font-medium text-foreground">
                            {r.name}
                          </div>
                          <div className="truncate t-label text-muted-foreground">
                            {r.servings} {r.servings === 1 ? "serving" : "servings"}
                            {r.note ? ` · ${r.note}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          {perServing.calories !== undefined && (
                            <div className="t-body font-semibold text-foreground">
                              {Math.round(perServing.calories)} cal
                            </div>
                          )}
                          <div className="t-label text-muted-foreground">per serving</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Catalogue results if matched */}
              {filteredFoods.length > 0 && (
                <div className="group-list bg-muted">
                  <div className="px-3 pt-2 pb-1 t-caption text-muted-foreground">Food library</div>
                  {filteredFoods.map((f, idx) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => handleSelectFood(f)}
                      className={`group-row w-full text-left transition-colors hover:bg-surface/50 ${
                        idx > 0 ? "group-row-sep" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate t-body font-medium text-foreground">{f.name}</div>
                        {f.brand && (
                          <div className="truncate t-label text-muted-foreground">{f.brand}</div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        {f.calories !== undefined && (
                          <div className="t-body font-semibold text-foreground">
                            {Math.round(f.calories)} cal
                          </div>
                        )}
                        <div className="t-label text-muted-foreground">
                          per {f.basisQuantity} {f.basisUnit}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Quick custom entry */}
              <div className="space-y-3">
                <div className="group-header px-0">
                  <span className="t-caption">Quick entry</span>
                </div>

                <div>
                  <label htmlFor="food-name-input" className="sr-only">
                    Food name
                  </label>
                  <input
                    id="food-name-input"
                    type="text"
                    aria-label="Food name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={query.trim() || "Food name (e.g. Rice)"}
                    className="min-h-[44px] w-full rounded-lg bg-surface px-3 t-body outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label
                      htmlFor="portion-qty-input"
                      className="block t-caption text-muted-foreground mb-1"
                    >
                      Quantity
                    </label>
                    <input
                      id="portion-qty-input"
                      type="text"
                      inputMode="decimal"
                      aria-label="Quantity"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg bg-surface px-3 t-body outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="portion-unit-select"
                      className="block t-caption text-muted-foreground mb-1"
                    >
                      Unit
                    </label>
                    <select
                      id="portion-unit-select"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value as MeasurementUnit)}
                      className="min-h-[44px] w-full rounded-lg bg-surface px-3 t-body text-foreground outline-none focus:ring-1 focus:ring-accent"
                    >
                      {MEASUREMENT_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {UNIT_LABELS[u]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1">
                  <div>
                    <label
                      htmlFor="food-cal-input"
                      className="block t-caption text-muted-foreground mb-1"
                    >
                      Calories
                    </label>
                    <input
                      id="food-cal-input"
                      type="text"
                      inputMode="numeric"
                      aria-label="Calories"
                      value={calories}
                      onChange={(e) => setCalories(e.target.value)}
                      placeholder="0"
                      className="min-h-[44px] w-full rounded-lg bg-surface px-2 text-center t-body outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label htmlFor="food-prot-input" className="block t-caption text-protein mb-1">
                      Protein
                    </label>
                    <input
                      id="food-prot-input"
                      type="text"
                      inputMode="decimal"
                      aria-label="Protein"
                      value={protein}
                      onChange={(e) => setProtein(e.target.value)}
                      placeholder="0g"
                      className="min-h-[44px] w-full rounded-lg bg-surface px-2 text-center t-body outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label htmlFor="food-carb-input" className="block t-caption text-carbs mb-1">
                      Carbs
                    </label>
                    <input
                      id="food-carb-input"
                      type="text"
                      inputMode="decimal"
                      aria-label="Carbs"
                      value={carbs}
                      onChange={(e) => setCarbs(e.target.value)}
                      placeholder="0g"
                      className="min-h-[44px] w-full rounded-lg bg-surface px-2 text-center t-body outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label htmlFor="food-fat-input" className="block t-caption text-fat mb-1">
                      Fat
                    </label>
                    <input
                      id="food-fat-input"
                      type="text"
                      inputMode="decimal"
                      aria-label="Fat"
                      value={fat}
                      onChange={(e) => setFat(e.target.value)}
                      placeholder="0g"
                      className="min-h-[44px] w-full rounded-lg bg-surface px-2 text-center t-body outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* Selected food or recipe portion config */
            <div className="space-y-3">
              <div className="pb-1">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="t-body font-semibold text-foreground">
                      {selectedRecipe?.name ?? selectedFood?.name}
                    </div>
                    {selectedFood?.brand && (
                      <div className="t-label text-muted-foreground">{selectedFood.brand}</div>
                    )}
                    {selectedRecipe && (
                      <div className="t-label text-muted-foreground">
                        {selectedRecipe.servings}{" "}
                        {selectedRecipe.servings === 1 ? "serving" : "servings"} recipe
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFood(null);
                      setSelectedRecipe(null);
                    }}
                    className="flex min-h-[44px] items-center px-2 t-label font-medium text-accent"
                  >
                    Change
                  </button>
                </div>
              </div>

              <div className="group-list bg-muted p-3 space-y-3">
                <div className="t-caption text-muted-foreground">Portion</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label
                      htmlFor="sel-portion-qty"
                      className="block t-caption text-muted-foreground mb-1"
                    >
                      Quantity
                    </label>
                    <input
                      id="sel-portion-qty"
                      type="text"
                      inputMode="decimal"
                      aria-label="Quantity"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg bg-surface px-3 t-body outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="sel-portion-unit"
                      className="block t-caption text-muted-foreground mb-1"
                    >
                      Unit
                    </label>
                    <select
                      id="sel-portion-unit"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value as MeasurementUnit)}
                      className="min-h-[44px] w-full rounded-lg bg-surface px-3 t-body text-foreground outline-none focus:ring-1 focus:ring-accent"
                    >
                      {MEASUREMENT_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {UNIT_LABELS[u]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Macro readout preview */}
                <div className="pt-2 hairline-t flex items-center justify-between">
                  <span className="t-label text-muted-foreground">Estimated macros:</span>
                  <div className="flex items-center gap-2 t-caption font-semibold">
                    {calculatedMacros.calories !== undefined && (
                      <span className="text-foreground">
                        {Math.round(calculatedMacros.calories)} cal
                      </span>
                    )}
                    {calculatedMacros.protein !== undefined && (
                      <span className="text-protein">
                        {Math.round(calculatedMacros.protein)}g P
                      </span>
                    )}
                    {calculatedMacros.carbs !== undefined && (
                      <span className="text-carbs">{Math.round(calculatedMacros.carbs)}g C</span>
                    )}
                    {calculatedMacros.fat !== undefined && (
                      <span className="text-fat">{Math.round(calculatedMacros.fat)}g F</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="pt-3 shrink-0">
          <button
            type="button"
            onClick={handleSave}
            className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-accent px-4 py-3 t-body font-semibold text-accent-foreground"
          >
            Add to {meal.name}
          </button>
        </div>
      </div>

      <RecipeEditorSheet
        open={recipeEditorOpen}
        onClose={() => setRecipeEditorOpen(false)}
        onSaved={(newRecipe) => handleSelectRecipe(newRecipe)}
      />
    </div>,
    document.body,
  );
}
