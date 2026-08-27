import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import {
  MEASUREMENT_UNITS,
  UNIT_LABELS,
  measurementFactor,
  recipePerServingMacros,
  scaleMacros,
  type Food,
  type MeasurementUnit,
  type Recipe,
  type RecipeIngredient,
} from "../lib/food";
import { useStore } from "../lib/store";

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

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function toNum(val: string): number | undefined {
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

interface LocalIngredient {
  id: string;
  foodId: string;
  quantity: number;
  unit: MeasurementUnit;
}

/**
 * Sheet for creating and editing recipes.
 *
 * Provides inputs for recipe name, servings (min 1), optional note, liquid flag,
 * and a flat list of ingredients chosen from catalogue foods. Computes and displays
 * live per-serving macros as ingredients or servings are modified.
 */
export function RecipeEditorSheet({
  open,
  onClose,
  initialRecipe,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initialRecipe?: Recipe | null;
  onSaved?: (recipe: Recipe) => void;
}) {
  const foods = useStore((s) => s.foods);
  const recipes = useStore((s) => s.recipes);
  const storeIngredients = useStore((s) => s.recipeIngredients);
  const upsertRecipe = useStore((s) => s.upsertRecipe);
  const deleteRecipe = useStore((s) => s.deleteRecipe);
  const setRecipeIngredients = useStore((s) => s.setRecipeIngredients);

  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [servings, setServings] = useState("1");
  const [note, setNote] = useState("");
  const [isLiquid, setIsLiquid] = useState(false);
  const [ingredients, setIngredients] = useState<LocalIngredient[]>([]);

  // Ingredient picker sub-state
  const [isAddingIngredient, setIsAddingIngredient] = useState(false);
  const [foodSearchQuery, setFoodSearchQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const foodSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setIsAddingIngredient(false);
    setFoodSearchQuery("");

    if (initialRecipe) {
      setActiveRecipeId(initialRecipe.id);
      setIsCreatingNew(false);
      setName(initialRecipe.name);
      setServings(String(initialRecipe.servings));
      setNote(initialRecipe.note ?? "");
      setIsLiquid(!!initialRecipe.isLiquid);
      const existing = storeIngredients
        .filter((ri) => ri.recipeId === initialRecipe.id)
        .map((ri) => ({
          id: ri.id,
          foodId: ri.foodId,
          quantity: ri.quantity,
          unit: ri.unit,
        }));
      setIngredients(existing);
    } else if (recipes.length === 0) {
      setActiveRecipeId(null);
      setIsCreatingNew(true);
      setName("");
      setServings("1");
      setNote("");
      setIsLiquid(false);
      setIngredients([]);
    } else {
      setActiveRecipeId(null);
      setIsCreatingNew(false);
      setName("");
      setServings("1");
      setNote("");
      setIsLiquid(false);
      setIngredients([]);
    }

    const timer = setTimeout(() => nameInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open, initialRecipe, recipes.length, storeIngredients]);

  useSheetDismiss(open, onClose);

  const startEditRecipe = (recipe: Recipe) => {
    setActiveRecipeId(recipe.id);
    setIsCreatingNew(false);
    setName(recipe.name);
    setServings(String(recipe.servings));
    setNote(recipe.note ?? "");
    setIsLiquid(!!recipe.isLiquid);
    const existing = storeIngredients
      .filter((ri) => ri.recipeId === recipe.id)
      .map((ri) => ({
        id: ri.id,
        foodId: ri.foodId,
        quantity: ri.quantity,
        unit: ri.unit,
      }));
    setIngredients(existing);
    setIsAddingIngredient(false);
    setConfirmDelete(false);
  };

  const startCreateNew = () => {
    setActiveRecipeId(null);
    setIsCreatingNew(true);
    setName("");
    setServings("1");
    setNote("");
    setIsLiquid(false);
    setIngredients([]);
    setIsAddingIngredient(false);
    setConfirmDelete(false);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const filteredFoods = useMemo(() => {
    const q = foodSearchQuery.trim().toLowerCase();
    if (!q) return foods.slice(0, 8);
    return foods
      .filter(
        (f) => f.name.toLowerCase().includes(q) || (f.brand && f.brand.toLowerCase().includes(q)),
      )
      .slice(0, 10);
  }, [foods, foodSearchQuery]);

  const servingsCount = useMemo(() => {
    const parsed = toNum(servings);
    return parsed !== undefined && parsed >= 1 ? parsed : 1;
  }, [servings]);

  // Live per-serving macros for the recipe as currently configured
  const livePerServingMacros = useMemo(() => {
    const recipeStub: Recipe = {
      id: activeRecipeId ?? "temp",
      name: name.trim() || "Recipe",
      servings: servingsCount,
      note: note.trim() || undefined,
      isLiquid,
      createdAt: 0,
    };
    const ingStubs: RecipeIngredient[] = ingredients.map((ing) => ({
      id: ing.id,
      recipeId: recipeStub.id,
      foodId: ing.foodId,
      quantity: ing.quantity,
      unit: ing.unit,
    }));
    return recipePerServingMacros(recipeStub, ingStubs, foods);
  }, [activeRecipeId, name, servingsCount, note, isLiquid, ingredients, foods]);

  const handleAddIngredient = (food: Food) => {
    const newIng: LocalIngredient = {
      id: `ri_${uid()}`,
      foodId: food.id,
      quantity: food.basisQuantity,
      unit: food.basisUnit,
    };
    setIngredients((prev) => [...prev, newIng]);
    setIsAddingIngredient(false);
    setFoodSearchQuery("");
  };

  const handleUpdateIngredient = (
    id: string,
    patch: Partial<{ quantity: number; unit: MeasurementUnit }>,
  ) => {
    setIngredients((prev) => prev.map((ing) => (ing.id === id ? { ...ing, ...patch } : ing)));
  };

  const handleRemoveIngredient = (id: string) => {
    setIngredients((prev) => prev.filter((ing) => ing.id !== id));
  };

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const recipeId = activeRecipeId ?? `r_${uid()}`;
    const recipeToSave: Recipe = {
      id: recipeId,
      name: trimmedName,
      servings: servingsCount,
      note: note.trim() || undefined,
      isLiquid,
      createdAt: activeRecipeId
        ? (recipes.find((r) => r.id === activeRecipeId)?.createdAt ?? Date.now())
        : Date.now(),
    };

    upsertRecipe(recipeToSave);
    const finalIngredients: RecipeIngredient[] = ingredients.map((ing) => ({
      id: ing.id.startsWith("ri_") ? ing.id : `ri_${uid()}`,
      recipeId,
      foodId: ing.foodId,
      quantity: ing.quantity,
      unit: ing.unit,
    }));
    setRecipeIngredients(recipeId, finalIngredients);

    onSaved?.(recipeToSave);
    onClose();
  };

  const handleDelete = () => {
    if (!activeRecipeId) return;
    deleteRecipe(activeRecipeId);
    onClose();
  };

  if (!open || typeof document === "undefined") return null;

  const isEditing = activeRecipeId !== null || isCreatingNew;

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

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between pb-3">
          <div>
            <div className="t-caption text-ink-2">
              {isEditing ? (activeRecipeId ? "Edit recipe" : "New recipe") : "Recipes"}
            </div>
            <h2 className="t-heading font-semibold tracking-tight">
              {isEditing ? name.trim() || "Recipe" : "Manage recipes"}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isEditing && recipes.length > 0 && !initialRecipe) {
                setActiveRecipeId(null);
                setIsCreatingNew(false);
              } else {
                onClose();
              }
            }}
            className="-mr-2 flex min-h-[44px] items-center px-2 t-label font-medium text-ink-2 hover:text-ink"
          >
            {isEditing && recipes.length > 0 && !initialRecipe ? "Back" : "Done"}
          </button>
        </div>

        {/* Recipe list when not in create/edit mode */}
        {!isEditing ? (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            <div className="flex items-center justify-between">
              <span className="t-label text-ink-2">Your custom recipes</span>
              <button
                type="button"
                onClick={startCreateNew}
                className="flex min-h-[44px] items-center px-2 t-label t-action"
              >
                + New recipe
              </button>
            </div>

            <div className="group-list bg-wash">
              {recipes.map((r, idx) => {
                const perServing = recipePerServingMacros(r, storeIngredients, foods);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => startEditRecipe(r)}
                    className={`group-row w-full text-left transition-colors ${
                      idx > 0 ? "group-row-sep" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate t-body font-medium text-ink">{r.name}</div>
                      <div className="truncate t-label text-ink-2">
                        {r.servings} {r.servings === 1 ? "serving" : "servings"}
                        {r.note ? ` · ${r.note}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {perServing.calories !== undefined && (
                        <div className="t-body font-semibold text-ink">
                          {Math.round(perServing.calories)} cal
                        </div>
                      )}
                      <div className="t-label text-ink-2">per serving</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* Recipe create / edit form */
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {/* Live Per-Serving Macros Summary Banner */}
            <div className="group-list bg-wash p-3">
              <div className="flex items-center justify-between pb-1">
                <span className="t-caption text-ink-2">Per serving preview</span>
                <span className="t-caption text-ink-2">
                  {servingsCount} {servingsCount === 1 ? "serving" : "servings"}
                </span>
              </div>
              <div className="flex items-baseline justify-between pt-1">
                <div className="t-stat text-ink">
                  {livePerServingMacros.calories !== undefined
                    ? Math.round(livePerServingMacros.calories)
                    : 0}{" "}
                  <span className="t-label font-normal text-ink-2">cal</span>
                </div>
                <div className="flex items-center gap-2 t-caption font-semibold">
                  <span className="text-protein">
                    {livePerServingMacros.protein !== undefined
                      ? Math.round(livePerServingMacros.protein)
                      : 0}
                    g P
                  </span>
                  <span className="text-carbs">
                    {livePerServingMacros.carbs !== undefined
                      ? Math.round(livePerServingMacros.carbs)
                      : 0}
                    g C
                  </span>
                  <span className="text-fat">
                    {livePerServingMacros.fat !== undefined
                      ? Math.round(livePerServingMacros.fat)
                      : 0}
                    g F
                  </span>
                </div>
              </div>
            </div>

            {/* Basic details */}
            <div className="space-y-3">
              <div>
                <label htmlFor="recipe-name-input" className="block t-caption text-ink-2 mb-1">
                  Recipe name
                </label>
                <input
                  id="recipe-name-input"
                  ref={nameInputRef}
                  type="text"
                  aria-label="Recipe name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Protein Overnight Oats"
                  className="min-h-[44px] w-full bg-wash px-3 t-body outline-none placeholder:text-ink-2 focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="recipe-servings-input"
                    className="block t-caption text-ink-2 mb-1"
                  >
                    Servings (min 1)
                  </label>
                  <input
                    id="recipe-servings-input"
                    type="text"
                    inputMode="decimal"
                    aria-label="Servings"
                    value={servings}
                    onChange={(e) => setServings(e.target.value)}
                    className="min-h-[44px] w-full bg-wash px-3 t-body outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <span className="block t-caption text-ink-2 mb-1">Liquid recipe</span>
                  <label className="flex min-h-[44px] items-center gap-2 bg-wash px-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isLiquid}
                      onChange={(e) => setIsLiquid(e.target.checked)}
                      className="h-4 w-4 accent-accent"
                      aria-label="Liquid or beverage recipe"
                    />
                    <span className="t-label text-ink">Drink / liquid</span>
                  </label>
                </div>
              </div>

              <div>
                <label htmlFor="recipe-note-input" className="block t-caption text-ink-2 mb-1">
                  Note (optional)
                </label>
                <input
                  id="recipe-note-input"
                  type="text"
                  aria-label="Recipe note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. 4 containers batch prep"
                  className="min-h-[44px] w-full bg-wash px-3 t-body outline-none placeholder:text-ink-2 focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            {/* Ingredients Section */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <span className="t-caption text-ink-2">Ingredients (foods only)</span>
                {!isAddingIngredient && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingIngredient(true);
                      setTimeout(() => foodSearchInputRef.current?.focus(), 50);
                    }}
                    className="flex min-h-[44px] items-center px-2 t-label t-action"
                  >
                    + Add ingredient
                  </button>
                )}
              </div>

              {/* Inline Food Picker for Ingredients */}
              {isAddingIngredient && (
                <div className="group-list bg-wash p-3 space-y-3 anim-fade-up">
                  <div className="flex items-center justify-between">
                    <span className="t-caption text-ink-2">Select food from library</span>
                    <button
                      type="button"
                      onClick={() => setIsAddingIngredient(false)}
                      className="flex min-h-[44px] items-center px-2 t-label font-medium text-ink-2 hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                  <input
                    ref={foodSearchInputRef}
                    type="text"
                    aria-label="Search food to add as ingredient"
                    value={foodSearchQuery}
                    onChange={(e) => setFoodSearchQuery(e.target.value)}
                    placeholder="Search food"
                    className="min-h-[44px] w-full px-3 t-body outline-none placeholder:text-ink-2 focus:ring-1 focus:ring-accent"
                  />

                  {filteredFoods.length > 0 ? (
                    <div className="group-list">
                      {filteredFoods.map((f, idx) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => handleAddIngredient(f)}
                          className={`group-row w-full text-left transition-colors hover:bg-wash ${
                            idx > 0 ? "group-row-sep" : ""
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate t-body font-medium text-ink">{f.name}</div>
                            {f.brand && (
                              <div className="truncate t-label text-ink-2">{f.brand}</div>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            {f.calories !== undefined && (
                              <div className="t-body font-semibold text-ink">
                                {Math.round(f.calories)} cal
                              </div>
                            )}
                            <div className="t-label text-ink-2">
                              per {f.basisQuantity} {f.basisUnit}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="py-2 text-center t-label text-ink-2">
                      No foods found. Add foods in your catalogue first.
                    </p>
                  )}
                </div>
              )}

              {/* List of current ingredients */}
              {ingredients.length === 0 ? (
                <div className="group-list bg-wash p-4 text-center">
                  <p className="t-label text-ink-2">No ingredients added yet.</p>
                </div>
              ) : (
                <div className="group-list bg-wash">
                  {ingredients.map((ing, idx) => {
                    const food = foods.find((f) => f.id === ing.foodId);
                    const factorRes = food
                      ? measurementFactor(food, ing.quantity, ing.unit)
                      : { ok: false as const, reason: "incompatibleUnit" as const };
                    const ingMacros =
                      food && factorRes.ok ? scaleMacros(food, factorRes.factor) : {};

                    return (
                      <div
                        key={ing.id}
                        className={`group-row flex-col items-stretch p-3 ${
                          idx > 0 ? "group-row-sep" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 pb-1">
                          <div className="min-w-0 flex-1">
                            <div className="truncate t-body font-medium text-ink">
                              {food?.name ?? "Unknown food"}
                            </div>
                            {food?.brand && (
                              <div className="truncate t-label text-ink-2">{food.brand}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {ingMacros.calories !== undefined ? (
                              <span className="t-label font-semibold text-ink">
                                {Math.round(ingMacros.calories)} cal
                              </span>
                            ) : (
                              <span className="t-label font-medium text-signal">
                                Unresolved unit
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveIngredient(ing.id)}
                              aria-label={`Remove ${food?.name ?? "ingredient"}`}
                              className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-2 hover:text-signal"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>

                        {/* Quantity and unit inputs */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Quantity for ${food?.name ?? "ingredient"}`}
                            value={ing.quantity}
                            onChange={(e) => {
                              const q = toNum(e.target.value) ?? 0;
                              handleUpdateIngredient(ing.id, { quantity: q });
                            }}
                            className="min-h-[44px] px-3 t-body outline-none focus:ring-1 focus:ring-accent"
                          />
                          <select
                            aria-label={`Unit for ${food?.name ?? "ingredient"}`}
                            value={ing.unit}
                            onChange={(e) =>
                              handleUpdateIngredient(ing.id, {
                                unit: e.target.value as MeasurementUnit,
                              })
                            }
                            className="min-h-[44px] px-3 t-body text-ink outline-none focus:ring-1 focus:ring-accent"
                          >
                            {MEASUREMENT_UNITS.map((u) => (
                              <option key={u} value={u}>
                                {UNIT_LABELS[u]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Delete confirmation when editing an existing recipe */}
            {activeRecipeId && (
              <div className="pt-2">
                {confirmDelete ? (
                  <div className="group-list bg-wash p-3 space-y-2">
                    <p className="t-label font-medium text-signal">
                      Delete recipe? Past food entries will remain intact.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDelete}
                        className="min-h-[44px] flex-1 bg-signal px-3 t-label font-semibold text-white"
                      >
                        Delete recipe
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="min-h-[44px] flex-1 px-3 t-label font-medium text-ink-2"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="flex min-h-[44px] w-full items-center justify-center bg-wash px-4 t-label font-medium text-signal hover:bg-wash"
                  >
                    Delete recipe
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer save button when editing */}
        {isEditing && (
          <div className="pt-3 shrink-0">
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim()}
              className="flex min-h-[44px] w-full items-center justify-center bg-ink px-4 py-3 t-body font-semibold text-paper disabled:opacity-40"
            >
              Save recipe
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
