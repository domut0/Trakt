import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import {
  recipePerServingMacros,
  resolveDayMacros,
  type Food,
  type Recipe,
  type RecipeIngredient,
} from "../food";
import { useStore } from "../store";

/**
 * Store-level behaviour for food logging.
 *
 * The subject here is not "does the array get an item". It is the handful of
 * rules that protect logged history from edits to the catalogue around it.
 */

const DEFAULT_STATE = {
  unit: "lbs" as const,
  exercises: [],
  slots: [],
  sessions: [],
  sets: [],
  dailyLogs: [],
  habits: [],
  habitEntries: [],
  foods: [],
  foodEntries: [],
  meals: [],
  recipes: [],
  recipeIngredients: [],
  activeSessionId: undefined,
  currentExerciseId: undefined,
  currentBlock: undefined,
  hydrated: false,
};

/** Clears every table, for the reason spelled out in daily-log.persistence.test.ts. */
async function resetDb() {
  await Promise.all([
    db.exercises.clear(),
    db.slots.clear(),
    db.sessions.clear(),
    db.sets.clear(),
    db.dailyLogs.clear(),
    db.habits.clear(),
    db.habitEntries.clear(),
    db.foods.clear(),
    db.foodEntries.clear(),
    db.meals.clear(),
    db.recipes.clear(),
    db.recipeIngredients.clear(),
    db.meta.clear(),
  ]);
}

async function fresh() {
  await resetDb();
  useStore.setState({ ...DEFAULT_STATE });
  await useStore.getState().hydrate();
  useStore.getState().seedMealsIfEmpty();
}

const kimchi = (over: Partial<Food> = {}): Food => ({
  id: "f_kimchi",
  name: "Kimchi",
  brand: "Jongga",
  sourceType: "mfp",
  createdAt: 1,
  basisQuantity: 100,
  basisUnit: "g",
  calories: 35,
  protein: 1.8,
  carbs: 7,
  fat: 0,
  ...over,
});

describe("meal seeding", () => {
  beforeEach(fresh);

  it("seeds a default set on first use", () => {
    expect(useStore.getState().meals.length).toBeGreaterThan(0);
  });

  it("is idempotent, so calling it again never duplicates or resets", () => {
    const before = useStore.getState().meals;
    useStore.getState().seedMealsIfEmpty();
    expect(useStore.getState().meals).toEqual(before);
  });

  it("does not re-seed after the user has deleted down to one meal", () => {
    const st = useStore.getState();
    const keep = [...st.meals].sort((a, b) => a.rank - b.rank)[0];
    for (const m of st.meals) if (m.id !== keep.id) useStore.getState().deleteMeal(m.id);
    expect(useStore.getState().meals).toHaveLength(1);
    useStore.getState().seedMealsIfEmpty();
    expect(useStore.getState().meals).toHaveLength(1);
  });
});

describe("deleting a food", () => {
  beforeEach(fresh);

  it("leaves already-logged entries untouched", () => {
    // Decision 3, at the store level. The entry carries its own basis, so the
    // catalogue row is not load-bearing once something has been logged from it.
    const st = useStore.getState();
    st.upsertFood(kimchi());
    const meal = st.meals[0];
    st.addFoodEntry({
      date: "2026-08-23",
      mealId: meal.id,
      quantity: 200,
      unit: "g",
      name: "Kimchi",
      foodId: "f_kimchi",
      basisQuantity: 100,
      basisUnit: "g",
      calories: 35,
    });

    useStore.getState().deleteFood("f_kimchi");

    const after = useStore.getState();
    expect(after.foods).toHaveLength(0);
    expect(after.foodEntries).toHaveLength(1);
    // And the number it reports is unchanged, which is the point.
    expect(resolveDayMacros(after.foodEntries, undefined).calories).toBeCloseTo(70, 6);
  });

  it("does not change a day's totals when the catalogue food is edited", () => {
    const st = useStore.getState();
    st.upsertFood(kimchi());
    st.addFoodEntry({
      date: "2026-08-23",
      mealId: st.meals[0].id,
      quantity: 100,
      unit: "g",
      name: "Kimchi",
      foodId: "f_kimchi",
      basisQuantity: 100,
      basisUnit: "g",
      calories: 35,
    });

    // An upstream correction, of the kind Open Food Facts ships constantly.
    useStore.getState().upsertFood(kimchi({ calories: 500 }));

    const after = useStore.getState();
    expect(resolveDayMacros(after.foodEntries, undefined).calories).toBe(35);
  });
});

describe("deleting a meal", () => {
  beforeEach(fresh);

  it("reassigns its entries instead of destroying them", () => {
    // Tidying up a meal slot must not rewrite the days logged under it.
    const st = useStore.getState();
    const [first, second] = [...st.meals].sort((a, b) => a.rank - b.rank);
    st.addFoodEntry({
      date: "2026-08-23",
      mealId: second.id,
      quantity: 1,
      unit: "serving",
      name: "Quick add",
      basisQuantity: 1,
      basisUnit: "serving",
      calories: 900,
    });

    const before = resolveDayMacros(useStore.getState().foodEntries, undefined).calories;
    useStore.getState().deleteMeal(second.id);
    const after = useStore.getState();

    expect(after.meals.find((m) => m.id === second.id)).toBeUndefined();
    expect(after.foodEntries).toHaveLength(1);
    expect(after.foodEntries[0].mealId).toBe(first.id);
    expect(resolveDayMacros(after.foodEntries, undefined).calories).toBe(before);
  });

  it("refuses to delete the last remaining meal", () => {
    // Structural, not a guard against a stray click: an entry with no meal
    // could never be rendered again.
    const st = useStore.getState();
    const keep = [...st.meals].sort((a, b) => a.rank - b.rank)[0];
    for (const m of st.meals) if (m.id !== keep.id) useStore.getState().deleteMeal(m.id);
    expect(useStore.getState().meals).toHaveLength(1);

    useStore.getState().deleteMeal(keep.id);
    expect(useStore.getState().meals).toHaveLength(1);
  });
});

describe("food entries", () => {
  beforeEach(fresh);

  it("supports a quick add with no food behind it", () => {
    // The "ate out, no idea, log 900" escape hatch. Decision 6 depends on this
    // existing, because day totals are derived and there is no override field.
    const st = useStore.getState();
    const e = st.addFoodEntry({
      date: "2026-08-23",
      mealId: st.meals[0].id,
      quantity: 1,
      unit: "serving",
      name: "Dinner out",
      basisQuantity: 1,
      basisUnit: "serving",
      calories: 900,
      protein: 40,
    });
    expect(e.foodId).toBeUndefined();
    expect(resolveDayMacros(useStore.getState().foodEntries, undefined)).toMatchObject({
      calories: 900,
      protein: 40,
      source: "entries",
    });
  });

  it("keeps an edited quantity resolving off the frozen basis", () => {
    const st = useStore.getState();
    const e = st.addFoodEntry({
      date: "2026-08-23",
      mealId: st.meals[0].id,
      quantity: 100,
      unit: "g",
      name: "Kimchi",
      basisQuantity: 100,
      basisUnit: "g",
      calories: 35,
    });
    useStore.getState().updateFoodEntry(e.id, { quantity: 250 });
    expect(resolveDayMacros(useStore.getState().foodEntries, undefined).calories).toBeCloseTo(
      87.5,
      6,
    );
  });
});

describe("recipes and decision 18", () => {
  beforeEach(fresh);

  const egg: Food = {
    id: "f_egg",
    name: "Egg",
    sourceType: "user",
    createdAt: 1,
    basisQuantity: 1,
    basisUnit: "serving",
    calories: 70,
    protein: 6,
    carbs: 0,
    fat: 5,
  };

  const toast: Food = {
    id: "f_toast",
    name: "Toast",
    sourceType: "user",
    createdAt: 1,
    basisQuantity: 1,
    basisUnit: "serving",
    calories: 80,
    protein: 3,
    carbs: 15,
    fat: 1,
  };

  it("freezes per-serving macros onto the entry at log time", () => {
    const st = useStore.getState();
    st.upsertFood(egg);
    st.upsertFood(toast);

    const recipe: Recipe = {
      id: "r_breakfast",
      name: "Eggs and Toast",
      servings: 2, // 2 servings
      createdAt: 1,
    };
    st.upsertRecipe(recipe);

    const ingredients: RecipeIngredient[] = [
      { id: "ri_1", recipeId: "r_breakfast", foodId: "f_egg", quantity: 2, unit: "serving" }, // 140 cal, 12 P, 0 C, 10 F
      { id: "ri_2", recipeId: "r_breakfast", foodId: "f_toast", quantity: 2, unit: "serving" }, // 160 cal, 6 P, 30 C, 2 F
    ];
    // Total for recipe: 300 cal, 18 P, 30 C, 12 F
    // Per serving (2 servings): 150 cal, 9 P, 15 C, 6 F
    st.setRecipeIngredients("r_breakfast", ingredients);

    const foods = useStore.getState().foods;
    const allIngs = useStore.getState().recipeIngredients;
    const perServing = recipePerServingMacros(recipe, allIngs, foods);

    const logged = st.addFoodEntry({
      date: "2026-08-23",
      mealId: st.meals[0].id,
      name: recipe.name,
      recipeId: recipe.id,
      quantity: 1,
      unit: "serving",
      basisQuantity: 1,
      basisUnit: "serving",
      servingLabel: "serving",
      calories: perServing.calories,
      protein: perServing.protein,
      carbs: perServing.carbs,
      fat: perServing.fat,
    });

    expect(logged.recipeId).toBe("r_breakfast");
    expect(logged.basisQuantity).toBe(1);
    expect(logged.basisUnit).toBe("serving");
    expect(logged.calories).toBe(150);
    expect(logged.protein).toBe(9);
    expect(logged.carbs).toBe(15);
    expect(logged.fat).toBe(6);

    const dayMacros = resolveDayMacros(useStore.getState().foodEntries, undefined);
    expect(dayMacros.calories).toBe(150);
    expect(dayMacros.protein).toBe(9);
  });

  it("does not change a past logged entry when the recipe is edited or deleted later", () => {
    // Decision 18: Never a deep snapshot of the ingredient list, and editing a recipe
    // later must NOT change past entries.
    const st = useStore.getState();
    st.upsertFood(egg);
    st.upsertFood(toast);

    const recipe: Recipe = {
      id: "r_breakfast",
      name: "Eggs and Toast",
      servings: 2,
      createdAt: 1,
    };
    st.upsertRecipe(recipe);

    const ingredients: RecipeIngredient[] = [
      { id: "ri_1", recipeId: "r_breakfast", foodId: "f_egg", quantity: 2, unit: "serving" },
      { id: "ri_2", recipeId: "r_breakfast", foodId: "f_toast", quantity: 2, unit: "serving" },
    ];
    st.setRecipeIngredients("r_breakfast", ingredients);

    const perServing = recipePerServingMacros(
      recipe,
      useStore.getState().recipeIngredients,
      useStore.getState().foods,
    );

    st.addFoodEntry({
      date: "2026-08-23",
      mealId: st.meals[0].id,
      name: recipe.name,
      recipeId: recipe.id,
      quantity: 1,
      unit: "serving",
      basisQuantity: 1,
      basisUnit: "serving",
      servingLabel: "serving",
      calories: perServing.calories,
      protein: perServing.protein,
      carbs: perServing.carbs,
      fat: perServing.fat,
    });

    // Upstream recipe modification: change servings to 10 (which would reduce per-serving calories from 150 to 30)
    useStore.getState().upsertRecipe({ ...recipe, servings: 10 });
    // And add more ingredients to recipe
    useStore
      .getState()
      .setRecipeIngredients("r_breakfast", [
        { id: "ri_1", recipeId: "r_breakfast", foodId: "f_egg", quantity: 10, unit: "serving" },
      ]);

    // Past entry macros and day macros MUST remain intact (150 cal)
    const after = useStore.getState();
    expect(after.foodEntries[0].calories).toBe(150);
    expect(resolveDayMacros(after.foodEntries, undefined).calories).toBe(150);

    // Even deleting the recipe entirely leaves history intact
    useStore.getState().deleteRecipe("r_breakfast");
    const afterDelete = useStore.getState();
    expect(afterDelete.recipes).toHaveLength(0);
    expect(afterDelete.foodEntries).toHaveLength(1);
    expect(resolveDayMacros(afterDelete.foodEntries, undefined).calories).toBe(150);
  });
});

describe("copyMealFrom", () => {
  beforeEach(fresh);

  it("duplicates every entry from the source meal into target without mutating the source", () => {
    const st = useStore.getState();
    const [breakfast, lunch] = [...st.meals].sort((a, b) => a.rank - b.rank);

    const sourceEntry1 = st.addFoodEntry({
      date: "2026-08-22",
      mealId: breakfast.id,
      name: "Oats",
      quantity: 50,
      unit: "g",
      basisQuantity: 100,
      basisUnit: "g",
      calories: 380,
      protein: 13,
      carbs: 68,
      fat: 7,
    });

    const sourceEntry2 = st.addFoodEntry({
      date: "2026-08-22",
      mealId: breakfast.id,
      name: "Coffee",
      quantity: 1,
      unit: "serving",
      basisQuantity: 1,
      basisUnit: "serving",
      calories: 5,
    });

    const count = useStore
      .getState()
      .copyMealFrom("2026-08-22", breakfast.id, "2026-08-23", lunch.id);
    expect(count).toBe(2);

    const allEntries = useStore.getState().foodEntries;
    expect(allEntries).toHaveLength(4);

    // Source entries remain untouched
    const sourceEntries = allEntries.filter((e) => e.date === "2026-08-22");
    expect(sourceEntries).toHaveLength(2);
    expect(sourceEntries[0].id).toBe(sourceEntry1.id);
    expect(sourceEntries[1].id).toBe(sourceEntry2.id);

    // Target entries are fresh duplicates with new IDs and new date/mealId
    const targetEntries = allEntries.filter((e) => e.date === "2026-08-23");
    expect(targetEntries).toHaveLength(2);
    expect(targetEntries[0].id).not.toBe(sourceEntry1.id);
    expect(targetEntries[1].id).not.toBe(sourceEntry2.id);
    expect(targetEntries[0].date).toBe("2026-08-23");
    expect(targetEntries[0].mealId).toBe(lunch.id);
    expect(targetEntries[0].name).toBe("Oats");
    expect(targetEntries[0].calories).toBe(380);
    expect(targetEntries[0].basisQuantity).toBe(100);
    expect(targetEntries[0].basisUnit).toBe("g");
    expect(targetEntries[0].quantity).toBe(50);
    expect(targetEntries[0].unit).toBe("g");
    expect(targetEntries[0].loggedAt).toBeGreaterThanOrEqual(sourceEntry1.loggedAt);

    expect(targetEntries[1].name).toBe("Coffee");
    expect(targetEntries[1].calories).toBe(5);
  });

  it("returns 0 when source meal has no entries", () => {
    const st = useStore.getState();
    const meal = st.meals[0];
    const count = st.copyMealFrom("2026-08-01", meal.id, "2026-08-23", meal.id);
    expect(count).toBe(0);
    expect(useStore.getState().foodEntries).toHaveLength(0);
  });
});
