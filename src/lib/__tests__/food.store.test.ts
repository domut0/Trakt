import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { resolveDayMacros, type Food } from "../food";
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
