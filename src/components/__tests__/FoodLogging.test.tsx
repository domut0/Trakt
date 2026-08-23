import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../../lib/store";
import { MealsEditorSheet } from "../MealsEditorSheet";
import { MealSection } from "../MealSection";
import { AddFoodSheet } from "../AddFoodSheet";
import { DayEditorSheet } from "../DayEditorSheet";

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
