import { describe, expect, it } from "vitest";
import { KCAL_PER_GRAM, macroKcal, macrosExceedCalories, suggestMacroGrams } from "../targets";

/**
 * Macros against the calorie target.
 *
 * The suggestion is offered and never written: the Atwater factors are averages
 * over food rather than constants, so a number derived from them is a starting
 * point the user can overtype, not a fact the app knows.
 */

describe("macroKcal", () => {
  it("adds up what is set and ignores what is not", () => {
    expect(macroKcal({ protein: 200, carbs: 300, fat: 80 })).toBe(200 * 4 + 300 * 4 + 80 * 9);
    expect(macroKcal({ protein: 200 })).toBe(800);
    expect(macroKcal({})).toBe(0);
  });

  it("counts a deliberate zero, which is not the same as unset", () => {
    expect(macroKcal({ protein: 0, carbs: 100, fat: 0 })).toBe(400);
  });
});

describe("suggestMacroGrams", () => {
  it("fills the one missing macro from what the calorie target has left", () => {
    // 2,700 kcal, 200p and 80f spoken for -> 800 + 720 = 1,520, leaving 1,180
    // for carbs at 4 kcal/g.
    expect(suggestMacroGrams({ calories: 2700, protein: 200, fat: 80 }, "carbs")).toBe(295);
    expect(suggestMacroGrams({ calories: 2700, protein: 200, carbs: 295 }, "fat")).toBe(
      Math.round((2700 - 800 - 1180) / KCAL_PER_GRAM.fat),
    );
  });

  it("says nothing when the field already has a number", () => {
    expect(suggestMacroGrams({ calories: 2700, protein: 200, carbs: 300, fat: 80 }, "fat")).toBe(
      undefined,
    );
  });

  it("says nothing with two unknowns and one equation", () => {
    expect(suggestMacroGrams({ calories: 2700, protein: 200 }, "carbs")).toBe(undefined);
  });

  it("says nothing without a calorie target", () => {
    expect(suggestMacroGrams({ protein: 200, fat: 80 }, "carbs")).toBe(undefined);
  });

  it("says nothing rather than zero or negative grams when the budget is spent", () => {
    // A suggestion of "0g of carbs" is not help, and a negative one is not a
    // quantity. The red warning is what speaks in this case.
    expect(suggestMacroGrams({ calories: 1000, protein: 200, fat: 80 }, "carbs")).toBe(undefined);
    expect(suggestMacroGrams({ calories: 1520, protein: 200, fat: 80 }, "carbs")).toBe(undefined);
  });
});

describe("macrosExceedCalories", () => {
  it("is true only when the macros spend strictly more", () => {
    expect(macrosExceedCalories({ calories: 2700, protein: 200, carbs: 300, fat: 80 })).toBe(true);
    // 1,520 against 1,520: the plan working, not a problem.
    expect(macrosExceedCalories({ calories: 1520, protein: 200, fat: 80 })).toBe(false);
    expect(macrosExceedCalories({ calories: 2700, protein: 200, fat: 80 })).toBe(false);
  });

  it("is false with no calorie target, there being nothing to exceed", () => {
    expect(macrosExceedCalories({ protein: 900, carbs: 900, fat: 900 })).toBe(false);
  });

  it("warns on a partial set, not just a complete one", () => {
    // Typing 400g of fat into an empty phase with a 2,000 target is wrong the
    // moment it is typed, whether or not protein has been filled in yet.
    expect(macrosExceedCalories({ calories: 2000, fat: 400 })).toBe(true);
  });
});
