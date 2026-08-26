import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../../lib/store";
import { MealSheet } from "../MealSheet";

describe("MealSheet", () => {
  beforeEach(() => {
    useStore.setState({
      meals: [
        { id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 600, rank: 0 },
        { id: "m2", name: "Lunch", fromMinutes: 660, toMinutes: 900, rank: 1 },
      ],
      foodEntries: [],
      foods: [],
    });
  });

  it("renders null when mealId is null", () => {
    const { container } = render(<MealSheet mealId={null} date="2026-08-23" onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null when mealId does not match any meal", () => {
    const { container } = render(
      <MealSheet mealId="nonexistent" date="2026-08-23" onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("lists only that meal's entries for that date", () => {
    useStore.setState({
      meals: [
        { id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 600, rank: 0 },
        { id: "m2", name: "Lunch", fromMinutes: 660, toMinutes: 900, rank: 1 },
      ],
      foodEntries: [
        {
          id: "e1",
          date: "2026-08-23",
          mealId: "m1",
          name: "Greek Yogurt",
          brand: "Fage",
          quantity: 150,
          unit: "g",
          basisQuantity: 100,
          basisUnit: "g",
          calories: 100,
          protein: 10,
          carbs: 4,
          fat: 0,
          loggedAt: 1,
        },
        {
          id: "e2",
          date: "2026-08-23",
          mealId: "m2",
          name: "Chicken Rice Bowl",
          quantity: 1,
          unit: "serving",
          basisQuantity: 1,
          basisUnit: "serving",
          calories: 550,
          protein: 40,
          carbs: 60,
          fat: 10,
          loggedAt: 2,
        },
        {
          id: "e3",
          date: "2026-08-22",
          mealId: "m1",
          name: "Yesterday Oatmeal",
          quantity: 1,
          unit: "serving",
          basisQuantity: 1,
          basisUnit: "serving",
          calories: 300,
          protein: 10,
          carbs: 50,
          fat: 5,
          loggedAt: 3,
        },
      ],
    });

    render(<MealSheet mealId="m1" date="2026-08-23" onClose={() => {}} />);

    expect(screen.getByText("Greek Yogurt")).toBeInTheDocument();
    expect(screen.getByText("150 g · Fage")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument(); // 100 * 1.5 = 150 cal
    expect(screen.getByText("15g P")).toBeInTheDocument();
    expect(screen.getByText("6g C")).toBeInTheDocument();
    expect(screen.getByText("0g F")).toBeInTheDocument();

    expect(screen.queryByText("Chicken Rice Bowl")).not.toBeInTheDocument();
    expect(screen.queryByText("Yesterday Oatmeal")).not.toBeInTheDocument();
  });

  it("delete calls deleteFoodEntry with the right id", () => {
    useStore.setState({
      meals: [{ id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 600, rank: 0 }],
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
          calories: 70,
          protein: 6,
          carbs: 0,
          fat: 5,
          loggedAt: 1,
        },
      ],
    });

    render(<MealSheet mealId="m1" date="2026-08-23" onClose={() => {}} />);

    expect(screen.getByText("Eggs")).toBeInTheDocument();
    const deleteBtn = screen.getByLabelText("Delete Eggs");
    fireEvent.click(deleteBtn);

    expect(useStore.getState().foodEntries).toHaveLength(0);
  });

  it("the window subtitle formats 06:00 - 10:00 correctly", () => {
    useStore.setState({
      meals: [{ id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 600, rank: 0 }],
      foodEntries: [],
    });

    render(<MealSheet mealId="m1" date="2026-08-23" onClose={() => {}} />);

    expect(screen.getByText("Breakfast")).toBeInTheDocument();
    expect(screen.getByText("06:00 - 10:00")).toBeInTheDocument();
  });

  it("the empty case renders its message", () => {
    useStore.setState({
      meals: [{ id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 600, rank: 0 }],
      foodEntries: [],
    });

    render(<MealSheet mealId="m1" date="2026-08-23" onClose={() => {}} />);

    expect(screen.getByText("Empty so far.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add food to Breakfast" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy Breakfast from another day" }),
    ).toBeInTheDocument();
  });

  it("calls onClose when Cancel button is clicked", () => {
    useStore.setState({
      meals: [{ id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 600, rank: 0 }],
      foodEntries: [],
    });

    const onClose = vi.fn();
    render(<MealSheet mealId="m1" date="2026-08-23" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows inline error when portion cannot resolve", () => {
    useStore.setState({
      meals: [{ id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 600, rank: 0 }],
      foodEntries: [
        {
          id: "e_unresolved",
          date: "2026-08-23",
          mealId: "m1",
          name: "Mystery Item",
          quantity: 2,
          unit: "serving",
          basisQuantity: 100,
          basisUnit: "g",
          calories: 200,
          loggedAt: 1,
        },
      ],
    });

    render(<MealSheet mealId="m1" date="2026-08-23" onClose={() => {}} />);

    expect(screen.getByText("Mystery Item")).toBeInTheDocument();
    expect(screen.getByText("Unresolved portion")).toBeInTheDocument();
  });

  it("opens AddFoodSheet when Add food button is clicked", () => {
    useStore.setState({
      meals: [{ id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 600, rank: 0 }],
      foodEntries: [],
    });

    render(<MealSheet mealId="m1" date="2026-08-23" onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Add food to Breakfast" }));
    expect(screen.getByRole("heading", { name: "Add food" })).toBeInTheDocument();
  });

  it("opens CopyMealSheet when Copy from another day button is clicked", () => {
    useStore.setState({
      meals: [{ id: "m1", name: "Breakfast", fromMinutes: 360, toMinutes: 600, rank: 0 }],
      foodEntries: [],
    });

    render(<MealSheet mealId="m1" date="2026-08-23" onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Breakfast from another day" }));
    expect(screen.getByRole("heading", { name: "Copy from another day" })).toBeInTheDocument();
  });
});
