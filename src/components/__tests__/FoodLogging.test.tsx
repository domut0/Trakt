import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../../lib/store";
import { MealsEditorSheet } from "../MealsEditorSheet";
import { MealSection } from "../MealSection";
import { AddFoodSheet } from "../AddFoodSheet";
import { DayEditorSheet } from "../DayEditorSheet";
import { RecipeEditorSheet } from "../RecipeEditorSheet";
import { CopyMealSheet } from "../CopyMealSheet";
import { ToastProvider } from "../Toast";

describe("MealsEditorSheet", () => {
  beforeEach(() => {
    useStore.setState({
      meals: [
        { id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 660, rank: 0 },
        { id: "m2", name: "Lunch", fromMinutes: 660, toMinutes: 900, rank: 1 },
        { id: "m3", name: "Snack", fromMinutes: 0, toMinutes: 0, rank: 2 },
      ],
      foodEntries: [],
      foods: [],
    });
  });

  it("renders meals in rank order and displays 'All day' when from === to", () => {
    render(<MealsEditorSheet open={true} onClose={() => {}} />);
    expect(screen.getByText("Breakfast")).toBeInTheDocument();
    expect(screen.getByText("Lunch")).toBeInTheDocument();
    expect(screen.getByText("Snack")).toBeInTheDocument();
    expect(screen.getByText("All day")).toBeInTheDocument();
  });

  it("reorders meals when moving up or down", () => {
    render(<MealsEditorSheet open={true} onClose={() => {}} />);
    const moveDownButtons = screen.getAllByLabelText(/Move .* down/);
    fireEvent.click(moveDownButtons[0]); // Move Breakfast down

    const meals = useStore.getState().meals;
    const sorted = [...meals].sort((a, b) => a.rank - b.rank);
    expect(sorted[0].name).toBe("Lunch");
    expect(sorted[1].name).toBe("Breakfast");
  });

  it("shows fallback meal name in delete confirmation and reassigns entries upon delete", () => {
    useStore.setState({
      meals: [
        { id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 660, rank: 0 },
        { id: "m2", name: "Lunch", fromMinutes: 660, toMinutes: 900, rank: 1 },
      ],
      foodEntries: [
        {
          id: "e1",
          date: "2026-08-23",
          mealId: "m1",
          name: "Oats",
          quantity: 100,
          unit: "g",
          basisQuantity: 100,
          basisUnit: "g",
          calories: 380,
          loggedAt: 1,
        },
      ],
    });

    render(<MealsEditorSheet open={true} onClose={() => {}} />);
    const deleteButtons = screen.getAllByLabelText(/Delete/);
    fireEvent.click(deleteButtons[0]); // Delete Breakfast

    expect(screen.getByText(/Entries will move to Lunch\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete meal" }));
    const remainingMeals = useStore.getState().meals;
    expect(remainingMeals).toHaveLength(1);
    expect(remainingMeals[0].name).toBe("Lunch");

    const entries = useStore.getState().foodEntries;
    expect(entries[0].mealId).toBe("m2");
  });

  it("disables delete when only one meal remains", () => {
    useStore.setState({
      meals: [{ id: "m1", name: "Only Meal", fromMinutes: 0, toMinutes: 0, rank: 0 }],
      foodEntries: [],
    });

    render(<MealsEditorSheet open={true} onClose={() => {}} />);
    const deleteBtn = screen.getByLabelText("Cannot delete only meal");
    expect(deleteBtn).toBeDisabled();
  });

  it("adds a new meal", () => {
    render(<MealsEditorSheet open={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText("Add meal (e.g. Snack)");
    fireEvent.change(input, { target: { value: "Dinner" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const meals = useStore.getState().meals;
    expect(meals.some((m) => m.name === "Dinner")).toBe(true);
  });
});

describe("MealSection", () => {
  const meal = { id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 660, rank: 0 };

  it("says nothing at all when a meal is empty", () => {
    // DESIGN.md forbids empty states that share a shape, and a per-meal line
    // would print the same sentence under every meal on a fresh day. The
    // heading and the add row carry the message on their own.
    render(<MealSection meal={meal} entries={[]} date="2026-08-23" />);
    expect(screen.getByText("Breakfast")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add food to Breakfast" })).toBeInTheDocument();
    expect(screen.queryByText(/no food/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing/i)).not.toBeInTheDocument();
  });

  it("renders entry rows with portion and macros", () => {
    const entries = [
      {
        id: "e1",
        date: "2026-08-23",
        mealId: "m1",
        name: "Greek Yogurt",
        brand: "Fage",
        quantity: 150,
        unit: "g" as const,
        basisQuantity: 100,
        basisUnit: "g" as const,
        calories: 100,
        protein: 10,
        carbs: 4,
        fat: 0,
        loggedAt: 1,
      },
    ];

    render(<MealSection meal={meal} entries={entries} date="2026-08-23" />);
    expect(screen.getByText("Greek Yogurt")).toBeInTheDocument();
    expect(screen.getByText("150 g · Fage")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument(); // 100 * 1.5 = 150 cal
    expect(screen.getByText("15g P")).toBeInTheDocument();
    expect(screen.getByText("6g C")).toBeInTheDocument();
    expect(screen.getByText("0g F")).toBeInTheDocument();
  });

  it("shows inline error when portion cannot resolve", () => {
    const entries = [
      {
        id: "e2",
        date: "2026-08-23",
        mealId: "m1",
        name: "Mystery Portion Item",
        quantity: 2,
        unit: "serving" as const,
        basisQuantity: 100,
        basisUnit: "g" as const, // serving cannot convert to grams without servingWeight
        calories: 200,
        loggedAt: 1,
      },
    ];

    render(<MealSection meal={meal} entries={entries} date="2026-08-23" />);
    expect(screen.getByText("Mystery Portion Item")).toBeInTheDocument();
    expect(screen.getByText("Unresolved portion")).toBeInTheDocument();
  });
});

describe("AddFoodSheet", () => {
  beforeEach(() => {
    useStore.setState({
      foods: [
        {
          id: "f1",
          name: "Whey Protein",
          brand: "Optimum Nutrition",
          basisQuantity: 1,
          basisUnit: "serving",
          servingLabel: "scoop",
          calories: 120,
          protein: 24,
          carbs: 3,
          fat: 1,
          sourceType: "user",
          createdAt: 1,
        },
      ],
      foodEntries: [],
    });
  });

  it("can log a quick custom entry", () => {
    const meal = { id: "m1", name: "Lunch", fromMinutes: 660, toMinutes: 900, rank: 0 };
    render(<AddFoodSheet open={true} onClose={() => {}} meal={meal} date="2026-08-23" />);

    fireEvent.change(screen.getByLabelText("Food name"), { target: { value: "Chicken Breast" } });
    fireEvent.change(screen.getByLabelText("Calories"), { target: { value: "165" } });
    fireEvent.change(screen.getByLabelText("Protein"), { target: { value: "31" } });

    fireEvent.click(screen.getByRole("button", { name: "Add to Lunch" }));

    const entries = useStore.getState().foodEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Chicken Breast");
    expect(entries[0].calories).toBe(165);
    expect(entries[0].protein).toBe(31);
  });

  it("can pick from catalogue foods", () => {
    const meal = { id: "m1", name: "Lunch", fromMinutes: 660, toMinutes: 900, rank: 0 };
    render(<AddFoodSheet open={true} onClose={() => {}} meal={meal} date="2026-08-23" />);

    fireEvent.click(screen.getByText("Whey Protein"));
    expect(screen.getByText("Optimum Nutrition")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add to Lunch" }));

    const entries = useStore.getState().foodEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Whey Protein");
    expect(entries[0].protein).toBe(24);
  });
});

describe("DayEditorSheet with food entries", () => {
  beforeEach(() => {
    useStore.setState({
      dailyLogs: [],
      foodEntries: [
        {
          id: "e1",
          date: "2026-08-23",
          mealId: "m1",
          name: "Eggs",
          quantity: 2,
          unit: "serving",
          basisQuantity: 1,
          basisUnit: "serving",
          calories: 140,
          protein: 12,
          carbs: 1,
          fat: 10,
          loggedAt: 1,
        },
      ],
    });
  });

  it("does not offer macro fields for editing when macros are derived from food entries", () => {
    render(<DayEditorSheet date="2026-08-23" open={true} onClose={() => {}} />);

    // Macro inputs are hidden
    expect(screen.queryByLabelText("Calories")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Protein")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Carbs")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fat")).not.toBeInTheDocument();

    // Summary info row is shown
    expect(screen.getByText("Calculated from food entries")).toBeInTheDocument();
    expect(screen.getByText("280")).toBeInTheDocument(); // 140 * 2 = 280 cal

    // Steps, Bodyweight and Cheat day remain editable
    expect(screen.getByLabelText("Steps")).toBeInTheDocument();
    expect(screen.getByLabelText("Bodyweight")).toBeInTheDocument();
    expect(screen.getByLabelText("Cheat day")).toBeInTheDocument();
  });
});

describe("RecipeEditorSheet", () => {
  beforeEach(() => {
    useStore.setState({
      foods: [
        {
          id: "f_oats",
          name: "Oats",
          basisQuantity: 100,
          basisUnit: "g",
          calories: 380,
          protein: 13,
          carbs: 68,
          fat: 7,
          sourceType: "user",
          createdAt: 1,
        },
        {
          id: "f_milk",
          name: "Almond Milk",
          basisQuantity: 100,
          basisUnit: "ml",
          calories: 15,
          protein: 0.5,
          carbs: 0.3,
          fat: 1.2,
          sourceType: "user",
          createdAt: 1,
        },
      ],
      recipes: [],
      recipeIngredients: [],
    });
  });

  it("creates a recipe with ingredients and live per-serving macros", () => {
    render(<RecipeEditorSheet open={true} onClose={() => {}} />);

    // Name and Servings
    fireEvent.change(screen.getByLabelText("Recipe name"), {
      target: { value: "Oat Porridge" },
    });
    fireEvent.change(screen.getByLabelText("Servings"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Recipe note"), { target: { value: "Warm breakfast" } });

    // Add first ingredient (Oats: 100g -> 380 cal)
    fireEvent.click(screen.getByRole("button", { name: "+ Add ingredient" }));
    fireEvent.click(screen.getByText("Oats"));

    // Add second ingredient (Almond Milk: 200ml -> 30 cal)
    fireEvent.click(screen.getByRole("button", { name: "+ Add ingredient" }));
    fireEvent.click(screen.getByText("Almond Milk"));

    const qtyInputs = screen.getAllByLabelText(/Quantity for/);
    fireEvent.change(qtyInputs[1], { target: { value: "200" } });

    // Total: 380 + 30 = 410 cal. Per serving (2 servings): 205 cal.
    expect(screen.getByText("205")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));

    const recipes = useStore.getState().recipes;
    expect(recipes).toHaveLength(1);
    expect(recipes[0].name).toBe("Oat Porridge");
    expect(recipes[0].servings).toBe(2);
    expect(recipes[0].note).toBe("Warm breakfast");

    const ingredients = useStore.getState().recipeIngredients;
    expect(ingredients).toHaveLength(2);
    expect(ingredients[0].recipeId).toBe(recipes[0].id);
  });
});

describe("AddFoodSheet with recipes", () => {
  beforeEach(() => {
    useStore.setState({
      foods: [
        {
          id: "f_egg",
          name: "Egg",
          basisQuantity: 1,
          basisUnit: "serving",
          calories: 70,
          protein: 6,
          carbs: 0,
          fat: 5,
          sourceType: "user",
          createdAt: 1,
        },
      ],
      recipes: [
        {
          id: "r_omelette",
          name: "3-Egg Omelette",
          servings: 1,
          note: "Easy lunch",
          createdAt: 1,
        },
      ],
      recipeIngredients: [
        { id: "ri_1", recipeId: "r_omelette", foodId: "f_egg", quantity: 3, unit: "serving" },
      ],
      foodEntries: [],
    });
  });

  it("can log a recipe with frozen per-serving macros and recipeId soft link", () => {
    const meal = { id: "m1", name: "Lunch", fromMinutes: 660, toMinutes: 900, rank: 0 };
    render(<AddFoodSheet open={true} onClose={() => {}} meal={meal} date="2026-08-23" />);

    // Recipe is visible in recipes group
    expect(screen.getByText("3-Egg Omelette")).toBeInTheDocument();
    expect(screen.getByText("210 cal")).toBeInTheDocument(); // 3 * 70 = 210 cal

    fireEvent.click(screen.getByText("3-Egg Omelette"));

    // Form switches to recipe portion
    expect(screen.getByText("1 serving recipe")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add to Lunch" }));

    const entries = useStore.getState().foodEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("3-Egg Omelette");
    expect(entries[0].recipeId).toBe("r_omelette");
    expect(entries[0].basisQuantity).toBe(1);
    expect(entries[0].basisUnit).toBe("serving");
    expect(entries[0].servingLabel).toBe("serving");
    expect(entries[0].calories).toBe(210);
    expect(entries[0].protein).toBe(18);
  });
});

describe("CopyMealSheet", () => {
  beforeEach(() => {
    useStore.setState({
      meals: [
        { id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 660, rank: 0 },
        { id: "m2", name: "Lunch", fromMinutes: 660, toMinutes: 900, rank: 1 },
      ],
      foodEntries: [
        {
          id: "e1",
          date: "2026-08-22",
          mealId: "m1",
          name: "Oatmeal",
          quantity: 1,
          unit: "serving",
          basisQuantity: 1,
          basisUnit: "serving",
          calories: 300,
          protein: 10,
          carbs: 50,
          fat: 5,
          loggedAt: 1,
        },
        {
          id: "e2",
          date: "2026-08-22",
          mealId: "m1",
          name: "Banana",
          quantity: 1,
          unit: "serving",
          basisQuantity: 1,
          basisUnit: "serving",
          calories: 100,
          protein: 1,
          carbs: 27,
          fat: 0.3,
          loggedAt: 2,
        },
      ],
    });
  });

  it("lists past days with entries in that meal slot and copies them on tap", () => {
    const meal = { id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 660, rank: 0 };
    render(
      <ToastProvider>
        <CopyMealSheet open={true} onClose={() => {}} targetMeal={meal} targetDate="2026-08-23" />
      </ToastProvider>,
    );

    expect(screen.getByText("Copy from another day")).toBeInTheDocument();
    expect(screen.getByText("Oatmeal, Banana")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument(); // 300 + 100 = 400 cal
    expect(screen.getByText("2 items")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Oatmeal, Banana"));

    const entries = useStore.getState().foodEntries;
    const todayEntries = entries.filter((e) => e.date === "2026-08-23");
    expect(todayEntries).toHaveLength(2);
    expect(todayEntries[0].name).toBe("Oatmeal");
    expect(todayEntries[1].name).toBe("Banana");
    expect(todayEntries[0].id).not.toBe("e1");
  });

  it("shows empty state when no previous entries exist for this meal", () => {
    const meal = { id: "m2", name: "Lunch", fromMinutes: 660, toMinutes: 900, rank: 1 };
    render(
      <ToastProvider>
        <CopyMealSheet open={true} onClose={() => {}} targetMeal={meal} targetDate="2026-08-23" />
      </ToastProvider>,
    );

    expect(screen.getByText("No previous entries for Lunch.")).toBeInTheDocument();
  });
});
