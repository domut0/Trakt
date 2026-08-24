import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { loadUsdaKey } from "../lib/db";
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
import {
  lookupBarcode,
  searchOpenFoodFacts,
  searchUsda,
  type RemoteSearchResult,
} from "../lib/food-sources";
import { useStore } from "../lib/store";
import { BarcodeScannerSheet } from "./BarcodeScannerSheet";
import { RecipeEditorSheet } from "./RecipeEditorSheet";

type SourceTab = "local" | "off" | "usda";

type RemoteQueryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; results: RemoteSearchResult[] }
  | {
      status: "error";
      reason: "offline" | "rateLimited" | "notFound" | "noApiKey" | "network" | "badResponse";
      message: string;
    };

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function toNum(val: string): number | undefined {
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function BarcodeScanIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 8v8" />
      <path d="M12 8v8" />
      <path d="M17 8v8" />
    </svg>
  );
}

/**
 * Sheet for logging food to a specific meal and date.
 *
 * Supports picking from local catalogue foods, saved recipes, remote sources
 * (Open Food Facts and USDA), barcode scanning, or typing a quick-add portion directly.
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
  const upsertFood = useStore((s) => s.upsertFood);

  const [query, setQuery] = useState("");
  const [activeSource, setActiveSource] = useState<SourceTab>("local");
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [recipeEditorOpen, setRecipeEditorOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Remote search states
  const [offState, setOffState] = useState<RemoteQueryState>({ status: "idle" });
  const [usdaState, setUsdaState] = useState<RemoteQueryState>({ status: "idle" });

  // Quick add / custom entry fields
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [barcode, setBarcode] = useState("");
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
    setActiveSource("local");
    setSelectedFood(null);
    setSelectedRecipe(null);
    setOffState({ status: "idle" });
    setUsdaState({ status: "idle" });
    setName("");
    setBrand("");
    setBarcode("");
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

  // Decision 14: typing does not trigger network requests.
  // We reset remote states to idle so any previous results are cleared for the new query.
  const handleQueryChange = (val: string) => {
    setQuery(val);
    setOffState({ status: "idle" });
    setUsdaState({ status: "idle" });
  };

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

  const performOffSearch = async (searchTerm: string) => {
    const trimmed = searchTerm.trim();
    if (!trimmed) return;
    setOffState({ status: "loading" });
    try {
      const res = await searchOpenFoodFacts(trimmed);
      if (res.ok) {
        setOffState({ status: "success", results: res.value });
      } else {
        setOffState({ status: "error", reason: res.reason, message: res.message });
      }
    } catch (err) {
      setOffState({
        status: "error",
        reason: "network",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  const performUsdaSearch = async (searchTerm: string) => {
    const trimmed = searchTerm.trim();
    if (!trimmed) return;
    setUsdaState({ status: "loading" });
    try {
      const apiKey = await loadUsdaKey();
      const res = await searchUsda(trimmed, apiKey);
      if (res.ok) {
        setUsdaState({ status: "success", results: res.value });
      } else {
        setUsdaState({ status: "error", reason: res.reason, message: res.message });
      }
    } catch (err) {
      setUsdaState({
        status: "error",
        reason: "network",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  // Decision 14: tapping a remote chip fires its query on demand.
  const handleTabClick = (tab: SourceTab) => {
    setActiveSource(tab);
    const q = query.trim();
    if (tab === "off") {
      if (q && (offState.status === "idle" || activeSource === "off")) {
        performOffSearch(q);
      }
    } else if (tab === "usda") {
      if (q && (usdaState.status === "idle" || activeSource === "usda")) {
        performUsdaSearch(q);
      }
    }
  };

  const handleSelectFood = (food: Food) => {
    setSelectedFood(food);
    setSelectedRecipe(null);
    setName(food.name);
    setBrand(food.brand ?? "");
    setBarcode(food.barcode ?? "");
    setQuantity(String(food.basisQuantity));
    setUnit(food.basisUnit);
    setCalories(food.calories !== undefined ? String(food.calories) : "");
    setProtein(food.protein !== undefined ? String(food.protein) : "");
    setCarbs(food.carbs !== undefined ? String(food.carbs) : "");
    setFat(food.fat !== undefined ? String(food.fat) : "");
  };

  // Selecting a remote result caches it locally via upsertFood so future lookups are offline.
  const handleSelectRemoteFood = (remoteFood: Omit<Food, "id" | "createdAt">) => {
    const existing = foods.find(
      (f) =>
        (remoteFood.barcode && f.barcode === remoteFood.barcode) ||
        (f.name.toLowerCase() === remoteFood.name.toLowerCase() && f.brand === remoteFood.brand),
    );

    let foodToSelect: Food;
    if (existing) {
      foodToSelect = existing;
    } else {
      foodToSelect = {
        ...remoteFood,
        id: `f_${uid()}`,
        createdAt: Date.now(),
      };
      upsertFood(foodToSelect);
    }
    handleSelectFood(foodToSelect);
  };

  // Barcode detection: check local catalogue first, then query remote, and fall back to quick entry.
  const handleBarcodeDetected = async (detectedCode: string) => {
    const cleanCode = detectedCode.trim();
    if (!cleanCode) return;

    // 1. Look in the local catalogue FIRST
    const localMatch = foods.find((f) => f.barcode && f.barcode.trim() === cleanCode);
    if (localMatch) {
      handleSelectFood(localMatch);
      return;
    }

    // 2. Miss calls lookupBarcode
    try {
      const res = await lookupBarcode(cleanCode);
      if (res.ok && res.value) {
        const remoteFood = res.value.food;
        const cachedFood: Food = {
          ...remoteFood,
          id: `f_${uid()}`,
          createdAt: Date.now(),
        };
        upsertFood(cachedFood);
        handleSelectFood(cachedFood);
      } else {
        // Decision 15: unrecognised barcode drops into quick entry with barcode prefilled
        setActiveSource("local");
        setSelectedFood(null);
        setSelectedRecipe(null);
        setBarcode(cleanCode);
        setName("");
        setBrand("");
        setQuantity("1");
        setUnit("serving");
        setCalories("");
        setProtein("");
        setCarbs("");
        setFat("");
      }
    } catch {
      setActiveSource("local");
      setSelectedFood(null);
      setSelectedRecipe(null);
      setBarcode(cleanCode);
      setName("");
      setBrand("");
      setQuantity("1");
      setUnit("serving");
      setCalories("");
      setProtein("");
      setCarbs("");
      setFat("");
    }
  };

  const handleSelectRecipe = (recipe: Recipe) => {
    setSelectedRecipe(recipe);
    setSelectedFood(null);
    setName(recipe.name);
    setBrand("");
    setBarcode("");
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
      // If a barcode was scanned/typed in quick entry, cache the food into local catalogue
      if (barcode.trim()) {
        const newFood: Food = {
          id: `f_${uid()}`,
          name: entryName,
          brand: brand.trim() || undefined,
          barcode: barcode.trim(),
          sourceType: "user",
          basisQuantity: q,
          basisUnit: unit === "g" || unit === "ml" ? unit : "serving",
          calories: toNum(calories),
          protein: toNum(protein),
          carbs: toNum(carbs),
          fat: toNum(fat),
          createdAt: Date.now(),
        };
        upsertFood(newFood);
        addFoodEntry({
          date,
          mealId: meal.id,
          name: entryName,
          brand: brand.trim() || undefined,
          foodId: newFood.id,
          quantity: q,
          unit,
          basisQuantity: q,
          basisUnit: unit === "g" || unit === "ml" ? unit : "serving",
          calories: toNum(calories),
          protein: toNum(protein),
          carbs: toNum(carbs),
          fat: toNum(fat),
        });
      } else {
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
    }
    onClose();
  };

  if (!open || typeof document === "undefined") return null;

  const hasSelection = selectedFood !== null || selectedRecipe !== null;
  const localCount = filteredFoods.length + filteredRecipes.length;

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
              {/* Search field with barcode scan button */}
              <div className="relative flex items-center">
                <input
                  ref={inputRef}
                  type="text"
                  aria-label="Search or enter food name"
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  placeholder="Search food or type a name"
                  className="min-h-[44px] w-full rounded-xl bg-muted pl-3 pr-12 t-body text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-accent"
                />
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  aria-label="Scan barcode"
                  className="absolute right-1 flex min-h-[44px] min-w-[44px] items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <BarcodeScanIcon />
                </button>
              </div>

              {/* Source chips row */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => handleTabClick("local")}
                  className={`flex min-h-[44px] shrink-0 items-center rounded-full px-3 py-2 t-label font-medium transition-colors ${
                    activeSource === "local"
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Your food ({localCount})
                </button>
                <button
                  type="button"
                  onClick={() => handleTabClick("off")}
                  className={`flex min-h-[44px] shrink-0 items-center rounded-full px-3 py-2 t-label font-medium transition-colors ${
                    activeSource === "off"
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Open Food Facts
                  {offState.status === "success" ? ` (${offState.results.length})` : ""}
                </button>
                <button
                  type="button"
                  onClick={() => handleTabClick("usda")}
                  className={`flex min-h-[44px] shrink-0 items-center rounded-full px-3 py-2 t-label font-medium transition-colors ${
                    activeSource === "usda"
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  USDA{usdaState.status === "success" ? ` (${usdaState.results.length})` : ""}
                </button>
              </div>

              {/* Source Results Content */}
              {activeSource === "local" && (
                <>
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
                      <div className="px-3 pt-2 pb-1 t-caption text-muted-foreground">
                        Food library
                      </div>
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
                            <div className="truncate t-body font-medium text-foreground">
                              {f.name}
                            </div>
                            {f.brand && (
                              <div className="truncate t-label text-muted-foreground">
                                {f.brand}
                              </div>
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

                  {/* Local empty state: names remote chips and invites a tap */}
                  {filteredFoods.length === 0 && filteredRecipes.length === 0 && query.trim() && (
                    <div className="flex flex-col items-center justify-center rounded-2xl bg-muted p-5 text-center">
                      <p className="t-body font-medium text-foreground">
                        No matching food in your catalogue
                      </p>
                      <p className="mt-1 t-label text-muted-foreground">
                        Tap Open Food Facts or USDA above to search online, or enter details below.
                      </p>
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

                    {barcode && (
                      <div>
                        <label
                          htmlFor="food-barcode-input"
                          className="block t-caption text-muted-foreground mb-1"
                        >
                          Barcode
                        </label>
                        <input
                          id="food-barcode-input"
                          type="text"
                          aria-label="Barcode"
                          value={barcode}
                          onChange={(e) => setBarcode(e.target.value)}
                          className="min-h-[44px] w-full rounded-lg bg-surface px-3 t-body font-mono outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                    )}

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
                        <label
                          htmlFor="food-prot-input"
                          className="block t-caption text-protein mb-1"
                        >
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
                        <label
                          htmlFor="food-carb-input"
                          className="block t-caption text-carbs mb-1"
                        >
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
              )}

              {/* Open Food Facts Tab */}
              {activeSource === "off" && (
                <div className="space-y-3">
                  {offState.status === "idle" && (
                    <div className="flex min-h-[140px] flex-col items-center justify-center rounded-2xl bg-muted p-5 text-center space-y-3">
                      <p className="t-body font-medium text-foreground">
                        {query.trim()
                          ? `Search Open Food Facts for "${query.trim()}"`
                          : "Search Open Food Facts"}
                      </p>
                      <p className="t-label text-muted-foreground">
                        Tap below to search the Open Food Facts online database.
                      </p>
                      {query.trim() && (
                        <button
                          type="button"
                          onClick={() => performOffSearch(query.trim())}
                          className="flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-4 t-body font-semibold text-accent-foreground"
                        >
                          Search Open Food Facts
                        </button>
                      )}
                    </div>
                  )}

                  {offState.status === "loading" && (
                    <div className="flex min-h-[140px] flex-col items-center justify-center rounded-2xl bg-muted p-5 text-center">
                      <p className="t-body font-medium text-foreground">
                        Searching Open Food Facts...
                      </p>
                    </div>
                  )}

                  {offState.status === "success" && (
                    <>
                      {offState.results.length === 0 ? (
                        <div className="flex min-h-[140px] flex-col items-center justify-center rounded-2xl bg-muted p-5 text-center">
                          <p className="t-body font-medium text-foreground">
                            No matching foods found
                          </p>
                          <p className="mt-1 t-label text-muted-foreground">
                            Open Food Facts returned no products for this search.
                          </p>
                        </div>
                      ) : (
                        <div className="group-list bg-muted">
                          <div className="flex items-center justify-between px-3 pt-2 pb-1">
                            <span className="t-caption text-muted-foreground">Open Food Facts</span>
                            <span className="t-caption text-muted-foreground">
                              {offState.results.length} results
                            </span>
                          </div>
                          {offState.results.map((res, idx) => {
                            const f = res.food;
                            return (
                              <button
                                key={`${f.barcode || f.name}-${idx}`}
                                type="button"
                                onClick={() => handleSelectRemoteFood(f)}
                                className={`group-row w-full text-left transition-colors hover:bg-surface/50 ${
                                  idx > 0 ? "group-row-sep" : ""
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate t-body font-medium text-foreground">
                                    {f.name}
                                  </div>
                                  {f.brand && (
                                    <div className="truncate t-label text-muted-foreground">
                                      {f.brand}
                                    </div>
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
                            );
                          })}
                          <div className="px-3 py-2 t-caption text-muted-foreground">
                            Data from Open Food Facts (ODbL).
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {offState.status === "error" && (
                    <div className="flex min-h-[140px] flex-col items-center justify-center rounded-2xl bg-muted p-5 text-center">
                      {offState.reason === "offline" && (
                        <>
                          <p className="t-body font-semibold text-destructive">Device is offline</p>
                          <p className="mt-1 t-label text-muted-foreground">
                            Connect to the internet to search Open Food Facts.
                          </p>
                        </>
                      )}
                      {offState.reason === "rateLimited" && (
                        <>
                          <p className="t-body font-semibold text-destructive">
                            Rate limit exceeded
                          </p>
                          <p className="mt-1 t-label text-muted-foreground">
                            Open Food Facts request limit reached. Please wait a moment before
                            retrying.
                          </p>
                        </>
                      )}
                      {offState.reason === "notFound" && (
                        <>
                          <p className="t-body font-medium text-foreground">No foods found</p>
                          <p className="mt-1 t-label text-muted-foreground">
                            No matching products were found on Open Food Facts.
                          </p>
                        </>
                      )}
                      {offState.reason === "network" && (
                        <>
                          <p className="t-body font-semibold text-destructive">Network error</p>
                          <p className="mt-1 t-label text-muted-foreground">
                            {offState.message || "Check your connection and try again."}
                          </p>
                          <button
                            type="button"
                            onClick={() => performOffSearch(query.trim())}
                            className="mt-3 flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-4 t-body font-semibold text-accent-foreground"
                          >
                            Try again
                          </button>
                        </>
                      )}
                      {offState.reason === "badResponse" && (
                        <>
                          <p className="t-body font-semibold text-destructive">Invalid response</p>
                          <p className="mt-1 t-label text-muted-foreground">
                            {offState.message ||
                              "Received an unexpected response from Open Food Facts."}
                          </p>
                          <button
                            type="button"
                            onClick={() => performOffSearch(query.trim())}
                            className="mt-3 flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-4 t-body font-semibold text-accent-foreground"
                          >
                            Try again
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* USDA Tab */}
              {activeSource === "usda" && (
                <div className="space-y-3">
                  {usdaState.status === "idle" && (
                    <div className="flex min-h-[140px] flex-col items-center justify-center rounded-2xl bg-muted p-5 text-center space-y-3">
                      <p className="t-body font-medium text-foreground">
                        {query.trim()
                          ? `Search USDA FoodData Central for "${query.trim()}"`
                          : "Search USDA FoodData Central"}
                      </p>
                      <p className="t-label text-muted-foreground">
                        Tap below to search the USDA FoodData Central database.
                      </p>
                      {query.trim() && (
                        <button
                          type="button"
                          onClick={() => performUsdaSearch(query.trim())}
                          className="flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-4 t-body font-semibold text-accent-foreground"
                        >
                          Search USDA
                        </button>
                      )}
                    </div>
                  )}

                  {usdaState.status === "loading" && (
                    <div className="flex min-h-[140px] flex-col items-center justify-center rounded-2xl bg-muted p-5 text-center">
                      <p className="t-body font-medium text-foreground">
                        Searching USDA FoodData Central...
                      </p>
                    </div>
                  )}

                  {usdaState.status === "success" && (
                    <>
                      {usdaState.results.length === 0 ? (
                        <div className="flex min-h-[140px] flex-col items-center justify-center rounded-2xl bg-muted p-5 text-center">
                          <p className="t-body font-medium text-foreground">
                            No matching foods found
                          </p>
                          <p className="mt-1 t-label text-muted-foreground">
                            USDA FoodData Central returned no foods for this search.
                          </p>
                        </div>
                      ) : (
                        <div className="group-list bg-muted">
                          <div className="flex items-center justify-between px-3 pt-2 pb-1">
                            <span className="t-caption text-muted-foreground">
                              USDA FoodData Central
                            </span>
                            <span className="t-caption text-muted-foreground">
                              {usdaState.results.length} results
                            </span>
                          </div>
                          {usdaState.results.map((res, idx) => {
                            const f = res.food;
                            return (
                              <button
                                key={`${f.barcode || f.name}-${idx}`}
                                type="button"
                                onClick={() => handleSelectRemoteFood(f)}
                                className={`group-row w-full text-left transition-colors hover:bg-surface/50 ${
                                  idx > 0 ? "group-row-sep" : ""
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate t-body font-medium text-foreground">
                                    {f.name}
                                  </div>
                                  {f.brand && (
                                    <div className="truncate t-label text-muted-foreground">
                                      {f.brand}
                                    </div>
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
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}

                  {usdaState.status === "error" && (
                    <div className="flex min-h-[140px] flex-col items-center justify-center rounded-2xl bg-muted p-5 text-center">
                      {usdaState.reason === "noApiKey" && (
                        <>
                          <p className="t-body font-semibold text-destructive">
                            USDA API key required
                          </p>
                          <p className="mt-1 t-label text-muted-foreground">
                            Add your USDA API key in Settings under Data to search USDA FoodData
                            Central.
                          </p>
                        </>
                      )}
                      {usdaState.reason === "offline" && (
                        <>
                          <p className="t-body font-semibold text-destructive">Device is offline</p>
                          <p className="mt-1 t-label text-muted-foreground">
                            Connect to the internet to search USDA FoodData Central.
                          </p>
                        </>
                      )}
                      {usdaState.reason === "rateLimited" && (
                        <>
                          <p className="t-body font-semibold text-destructive">
                            Rate limit exceeded
                          </p>
                          <p className="mt-1 t-label text-muted-foreground">
                            USDA API rate limit reached. Please wait a moment before retrying.
                          </p>
                        </>
                      )}
                      {usdaState.reason === "notFound" && (
                        <>
                          <p className="t-body font-medium text-foreground">No foods found</p>
                          <p className="mt-1 t-label text-muted-foreground">
                            No matching foods found in USDA FoodData Central.
                          </p>
                        </>
                      )}
                      {usdaState.reason === "network" && (
                        <>
                          <p className="t-body font-semibold text-destructive">Network error</p>
                          <p className="mt-1 t-label text-muted-foreground">
                            {usdaState.message || "Check your connection and try again."}
                          </p>
                          <button
                            type="button"
                            onClick={() => performUsdaSearch(query.trim())}
                            className="mt-3 flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-4 t-body font-semibold text-accent-foreground"
                          >
                            Try again
                          </button>
                        </>
                      )}
                      {usdaState.reason === "badResponse" && (
                        <>
                          <p className="t-body font-semibold text-destructive">Invalid response</p>
                          <p className="mt-1 t-label text-muted-foreground">
                            {usdaState.message ||
                              "Received an unexpected response from USDA FoodData Central."}
                          </p>
                          <button
                            type="button"
                            onClick={() => performUsdaSearch(query.trim())}
                            className="mt-3 flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-4 t-body font-semibold text-accent-foreground"
                          >
                            Try again
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
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

      <BarcodeScannerSheet
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleBarcodeDetected}
      />
    </div>,
    document.body,
  );
}
