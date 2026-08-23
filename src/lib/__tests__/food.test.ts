import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEALS,
  entriesByMeal,
  entryMacros,
  formatMeasurement,
  measurementFactor,
  mealForTime,
  resolveDayMacros,
  scaleMacros,
  sumMacros,
  type Food,
  type FoodEntry,
  type MacroBasis,
  type Meal,
} from "../food";
import type { DailyLog } from "../store";

/** Per-100g, the shape Open Food Facts and USDA hand back. */
const per100g: MacroBasis = {
  basisQuantity: 100,
  basisUnit: "g",
  calories: 305,
  protein: 0,
  carbs: 80,
  fat: 0,
};

/** Per-count, the shape most MyFitnessPal foods import as: no gram equivalent. */
const perCake: MacroBasis = {
  basisQuantity: 1,
  basisUnit: "serving",
  servingLabel: "cake",
  calories: 34.667,
  protein: 0.667,
  carbs: 7.333,
  fat: 0.333,
};

describe("measurementFactor", () => {
  it("scales a per-100g basis by grams", () => {
    const f = measurementFactor(per100g, 20, "g");
    expect(f).toEqual({ ok: true, factor: 0.2 });
  });

  it("converts ounces to grams before scaling", () => {
    const f = measurementFactor(per100g, 1, "oz");
    expect(f.ok).toBe(true);
    if (f.ok) expect(f.factor).toBeCloseTo(0.283495, 6);
  });

  it("scales a per-count basis by serving count", () => {
    expect(measurementFactor(perCake, 3, "serving")).toEqual({ ok: true, factor: 3 });
  });

  it("asks for a serving weight rather than guessing one", () => {
    // The whole of decision 11: this is a question, not a failure. 56% of
    // imported foods land here, so it has to be a prompt and not a dead end.
    expect(measurementFactor(perCake, 50, "g")).toEqual({
      ok: false,
      reason: "needsServingWeight",
    });
  });

  it("resolves grams against a per-count basis once the serving weight is known", () => {
    // 13g per cake, so 39g is 3 cakes.
    const withWeight: MacroBasis = { ...perCake, servingWeight: 13 };
    const f = measurementFactor(withWeight, 39, "g");
    expect(f.ok).toBe(true);
    if (f.ok) expect(f.factor).toBeCloseTo(3, 10);
  });

  it("resolves servings against a per-100g basis using the serving weight", () => {
    const withWeight: MacroBasis = { ...per100g, servingWeight: 20 };
    const f = measurementFactor(withWeight, 2, "serving");
    expect(f.ok).toBe(true);
    if (f.ok) expect(f.factor).toBeCloseTo(0.4, 10);
  });

  it("asks for a package weight rather than guessing one", () => {
    expect(measurementFactor(per100g, 1, "package")).toEqual({
      ok: false,
      reason: "needsPackageWeight",
    });
  });

  it("refuses grams against a millilitre basis instead of assuming water", () => {
    // Assuming 1 g/ml would silently invent a density and produce a number
    // that looks entirely legitimate. Refusing is the honest answer.
    const perMl: MacroBasis = { basisQuantity: 100, basisUnit: "ml", calories: 50 };
    expect(measurementFactor(perMl, 100, "g")).toEqual({
      ok: false,
      reason: "incompatibleUnit",
    });
  });

  it("rejects a negative or non-finite quantity", () => {
    expect(measurementFactor(per100g, -1, "g").ok).toBe(false);
    expect(measurementFactor(per100g, Number.NaN, "g").ok).toBe(false);
  });

  it("rejects a basis quantity of zero rather than dividing by it", () => {
    const broken: MacroBasis = { ...per100g, basisQuantity: 0 };
    expect(measurementFactor(broken, 10, "g").ok).toBe(false);
  });
});

describe("scaleMacros", () => {
  it("leaves an absent macro absent", () => {
    // An unknown macro is not zero. Scaling it to 0 would let a food with no
    // recorded protein read as a food with confirmed zero protein.
    const partial = { calories: 100 };
    expect(scaleMacros(partial, 2)).toEqual({
      calories: 200,
      protein: undefined,
      carbs: undefined,
      fat: undefined,
    });
  });
});

const entry = (over: Partial<FoodEntry>): FoodEntry => ({
  id: "fe_1",
  date: "2026-08-23",
  mealId: "m_1",
  quantity: 1,
  unit: "serving",
  name: "Thing",
  loggedAt: 0,
  basisQuantity: 1,
  basisUnit: "serving",
  calories: 100,
  protein: 10,
  carbs: 5,
  fat: 2,
  ...over,
});

describe("entryMacros", () => {
  it("resolves from the entry's own frozen basis", () => {
    const e = entry({ quantity: 20, unit: "g", ...per100g });
    expect(entryMacros(e).calories).toBeCloseTo(61, 6);
  });

  it("does not consult any food record", () => {
    // Decision 3. The entry carries everything it needs, which is what stops an
    // upstream correction from rewriting what you ate last month.
    const e = entry({ foodId: "does-not-exist", quantity: 2 });
    expect(entryMacros(e)).toEqual({ calories: 200, protein: 20, carbs: 10, fat: 4 });
  });

  it("contributes nothing when the portion cannot resolve", () => {
    // The day still has to render. The offending row shows its own error state.
    const e = entry({ quantity: 50, unit: "g", ...perCake });
    expect(entryMacros(e)).toEqual({});
  });
});

describe("sumMacros", () => {
  it("keeps a field absent only when no entry supplied it", () => {
    const summed = sumMacros([{ calories: 100 }, { calories: 50, protein: 3 }]);
    expect(summed).toEqual({ calories: 150, protein: 3 });
  });

  it("returns an empty object for no entries", () => {
    expect(sumMacros([])).toEqual({});
  });
});

describe("resolveDayMacros", () => {
  const typed: DailyLog = { date: "2026-08-23", calories: 1800, protein: 150 };

  it("prefers entries and ignores typed macros entirely", () => {
    // Decision 6. Not a merge: an average of the two would be a number the user
    // never entered and the app never computed.
    const e = entry({ quantity: 1 });
    const out = resolveDayMacros([e], typed);
    expect(out.source).toBe("entries");
    expect(out.calories).toBe(100);
  });

  it("falls back to typed macros on a day with no entries", () => {
    const out = resolveDayMacros([], typed);
    expect(out.source).toBe("typed");
    expect(out.calories).toBe(1800);
  });

  it("reports none when a day has neither", () => {
    expect(resolveDayMacros([], { date: "2026-08-23", steps: 9000 }).source).toBe("none");
    expect(resolveDayMacros([], undefined).source).toBe("none");
  });

  it("treats a day with only steps or bodyweight as having no macros", () => {
    // Those fields still live on DailyLog and are untouched by food logging.
    const stepsOnly: DailyLog = { date: "2026-08-23", steps: 12000, bodyweight: 180 };
    expect(resolveDayMacros([], stepsOnly).source).toBe("none");
  });
});

describe("mealForTime", () => {
  const meals: Meal[] = DEFAULT_MEALS.map((m, i) => ({ ...m, id: `m_${i}` }));

  it("picks the meal whose window contains the time", () => {
    expect(mealForTime(meals, 8 * 60)?.name).toBe("Breakfast");
    expect(mealForTime(meals, 12 * 60)?.name).toBe("Lunch");
    expect(mealForTime(meals, 19 * 60)?.name).toBe("Dinner");
  });

  it("never lets an all-day meal swallow the others", () => {
    // Snacks is seeded 0 to 0. If all-day won, nothing else could ever match.
    expect(mealForTime(meals, 8 * 60)?.name).not.toBe("Snacks");
  });

  it("falls back to the first meal outside every window", () => {
    // 03:00 sits in no seeded window.
    expect(mealForTime(meals, 3 * 60)?.name).toBe("Breakfast");
  });

  it("handles a window that wraps past midnight", () => {
    const late: Meal[] = [
      { id: "m_a", name: "Late", fromMinutes: 22 * 60, toMinutes: 2 * 60, rank: 0 },
      { id: "m_b", name: "Other", fromMinutes: 9 * 60, toMinutes: 10 * 60, rank: 1 },
    ];
    expect(mealForTime(late, 23 * 60)?.name).toBe("Late");
    expect(mealForTime(late, 1 * 60)?.name).toBe("Late");
    // 09:30 is inside Other's window, and outside the wrapping one.
    expect(mealForTime(late, 9 * 60 + 30)?.name).toBe("Other");
    // 12:00 is in neither, so the first meal takes it.
    expect(mealForTime(late, 12 * 60)?.name).toBe("Late");
  });

  it("returns undefined when there are no meals at all", () => {
    expect(mealForTime([], 600)).toBeUndefined();
  });
});

describe("entriesByMeal", () => {
  const meals: Meal[] = [
    { id: "m_2", name: "Lunch", fromMinutes: 0, toMinutes: 0, rank: 1 },
    { id: "m_1", name: "Breakfast", fromMinutes: 0, toMinutes: 0, rank: 0 },
  ];

  it("returns meals in rank order, including empty ones", () => {
    const grouped = entriesByMeal(meals, []);
    expect(grouped.map((g) => g.meal.name)).toEqual(["Breakfast", "Lunch"]);
    expect(grouped[0].entries).toEqual([]);
  });

  it("orders entries within a meal by when they were logged", () => {
    const a = entry({ id: "a", mealId: "m_1", loggedAt: 200 });
    const b = entry({ id: "b", mealId: "m_1", loggedAt: 100 });
    const grouped = entriesByMeal(meals, [a, b]);
    expect(grouped[0].entries.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("drops entries whose meal no longer exists", () => {
    // A deleted meal must not strand its entries in an invisible group.
    const orphan = entry({ mealId: "gone" });
    const grouped = entriesByMeal(meals, [orphan]);
    expect(grouped.flatMap((g) => g.entries)).toEqual([]);
  });
});

describe("formatMeasurement", () => {
  it("uses the food's own serving noun", () => {
    // "3 cake" is what MyFitnessPal showed, and it is the muscle memory worth keeping.
    expect(formatMeasurement(perCake, 3, "serving")).toBe("3 cake");
  });

  it("falls back to 'serving' when a food has no label", () => {
    expect(formatMeasurement(per100g, 1, "serving")).toBe("1 serving");
  });

  it("renders mass and volume units plainly", () => {
    expect(formatMeasurement(per100g, 150, "g")).toBe("150 g");
    expect(formatMeasurement(per100g, 1.5, "floz")).toBe("1.5 fl oz");
  });
});

describe("Food type wiring", () => {
  it("carries provenance so an imported food is distinguishable", () => {
    const f: Food = {
      id: "f_1",
      name: "Kimchi",
      brand: "Jongga",
      sourceType: "mfp",
      createdAt: 0,
      ...per100g,
    };
    expect(f.sourceType).toBe("mfp");
  });
});
