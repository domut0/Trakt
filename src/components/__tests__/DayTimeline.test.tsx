import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DayTimeline } from "../DayTimeline";
import { dayKey } from "../../lib/daily-log";
import { type FoodEntry, type Meal } from "../../lib/food";
import { emptyPlannedWeek } from "../../lib/plan";
import { useStore, type Exercise, type WorkoutSession } from "../../lib/store";
import { weekdayIndexFor } from "../../lib/targets";

const BREAKFAST: Meal = {
  id: "m_breakfast",
  name: "Breakfast",
  fromMinutes: 360,
  toMinutes: 660,
  rank: 0,
};

const LUNCH: Meal = {
  id: "m_lunch",
  name: "Lunch",
  fromMinutes: 660,
  toMinutes: 900,
  rank: 1,
};

const SQUAT: Exercise = {
  id: "e_squat",
  name: "Back Squat",
  type: "main",
};

function createFoodEntry(
  overrides: Partial<FoodEntry> & { mealId: string; date: string },
): FoodEntry {
  return {
    id: `fe_${Math.random().toString(36).slice(2, 8)}`,
    name: "Test Food",
    calories: 200,
    protein: 20,
    carbs: 20,
    fat: 5,
    quantity: 100,
    unit: "g",
    basisQuantity: 100,
    basisUnit: "g",
    loggedAt: Date.now(),
    ...overrides,
  };
}

describe("DayTimeline", () => {
  const today = dayKey(new Date());
  const otherDate = "2026-03-15";

  beforeEach(() => {
    useStore.setState({
      hydrated: true,
      foodEnabled: true,
      meals: [BREAKFAST, LUNCH],
      foodEntries: [],
      sessions: [],
      sets: [],
      exercises: [SQUAT],
      slots: [],
      unit: "lbs",
      plannedWeek: undefined,
    });
  });

  it("renders a meal window dashed when empty and filled when it has entries", () => {
    useStore.setState({
      foodEntries: [
        createFoodEntry({
          id: "fe_1",
          date: today,
          mealId: "m_lunch",
          name: "Oatmeal",
          calories: 300,
        }),
      ],
    });

    const onOpenMeal = vi.fn();
    render(
      <DayTimeline
        date={today}
        onOpenMeal={onOpenMeal}
        onOpenSession={() => {}}
        onOpenPlan={() => {}}
      />,
    );

    const breakfastBtn = screen.getByRole("button", { name: /^Breakfast/i });
    const lunchBtn = screen.getByRole("button", { name: /^Lunch/i });

    // Breakfast has no entries: planned state -> dashed outline, no solid fill
    expect(breakfastBtn).toHaveClass("border-dashed");
    expect(breakfastBtn).not.toHaveClass("bg-muted");

    // Lunch has entries: actual state -> solid fill, no dashed outline
    expect(lunchBtn).toHaveClass("bg-muted");
    expect(lunchBtn).not.toHaveClass("border-dashed");

    // Tapping a meal zone opens that meal
    fireEvent.click(breakfastBtn);
    expect(onOpenMeal).toHaveBeenCalledWith("m_breakfast");

    fireEvent.click(lunchBtn);
    expect(onOpenMeal).toHaveBeenCalledWith("m_lunch");
  });

  it("insets a training block from the left while a meal zone is not inset", () => {
    const session: WorkoutSession = {
      id: "s_1",
      startedAt: new Date(`${today}T08:00:00`).getTime(),
      endedAt: new Date(`${today}T09:00:00`).getTime(),
    };

    useStore.setState({
      sessions: [session],
      foodEntries: [
        createFoodEntry({
          id: "fe_1",
          date: today,
          mealId: "m_lunch",
          name: "Rice",
          calories: 200,
        }),
      ],
    });

    render(
      <DayTimeline
        date={today}
        onOpenMeal={() => {}}
        onOpenSession={() => {}}
        onOpenPlan={() => {}}
      />,
    );

    const mealBtn = screen.getByRole("button", { name: /^Breakfast/i });
    const sessionBtn = screen.getByRole("button", { name: /^Workout/i });

    // Meal zone is not inset
    expect(mealBtn).toHaveClass("left-0");
    expect(mealBtn).not.toHaveClass("left-5");

    // Training block is inset from the left
    expect(sessionBtn).toHaveClass("left-5");
    expect(sessionBtn).not.toHaveClass("left-0");
  });

  it("renders the now line on today and does not render on another date", () => {
    const { unmount } = render(
      <DayTimeline
        date={today}
        onOpenMeal={() => {}}
        onOpenSession={() => {}}
        onOpenPlan={() => {}}
      />,
    );

    expect(screen.getByTestId("now-line")).toBeInTheDocument();
    unmount();

    render(
      <DayTimeline
        date={otherDate}
        onOpenMeal={() => {}}
        onOpenSession={() => {}}
        onOpenPlan={() => {}}
      />,
    );

    expect(screen.queryByTestId("now-line")).not.toBeInTheDocument();
  });

  it("renders an openEnded band with no bottom edge", () => {
    const inProgressSession: WorkoutSession = {
      id: "s_running",
      startedAt: new Date(`${today}T07:30:00`).getTime(),
      endedAt: undefined,
    };

    useStore.setState({
      sessions: [inProgressSession],
    });

    render(
      <DayTimeline
        date={today}
        onOpenMeal={() => {}}
        onOpenSession={() => {}}
        onOpenPlan={() => {}}
      />,
    );

    const runningBtn = screen.getByRole("button", { name: /^Workout/i });
    expect(runningBtn).toHaveClass("rounded-b-none");
    expect(runningBtn).toHaveClass("border-b-0");
  });

  it("carries overscroll-behavior-y contain on the scroll container", () => {
    render(
      <DayTimeline
        date={today}
        onOpenMeal={() => {}}
        onOpenSession={() => {}}
        onOpenPlan={() => {}}
      />,
    );

    const scroller = screen.getByTestId("timeline-scroll-container");
    expect(scroller.style.overscrollBehaviorY).toBe("contain");
  });

  it("clears the timer interval on unmount", () => {
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    const { unmount } = render(
      <DayTimeline
        date={today}
        onOpenMeal={() => {}}
        onOpenSession={() => {}}
        onOpenPlan={() => {}}
      />,
    );

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it("calls onOpenSession when tapping an actual workout", () => {
    const session: WorkoutSession = {
      id: "s_actual",
      startedAt: new Date(`${today}T14:00:00`).getTime(),
      endedAt: new Date(`${today}T15:00:00`).getTime(),
    };

    useStore.setState({ sessions: [session] });

    const onOpenSession = vi.fn();
    render(
      <DayTimeline
        date={today}
        onOpenMeal={() => {}}
        onOpenSession={onOpenSession}
        onOpenPlan={() => {}}
      />,
    );

    const sessionBtn = screen.getByRole("button", { name: /^Workout/i });
    fireEvent.click(sessionBtn);
    expect(onOpenSession).toHaveBeenCalledWith("s_actual");
  });

  it("calls onOpenPlan when tapping a planned workout", () => {
    const onOpenPlan = vi.fn();
    const week = emptyPlannedWeek();
    week[weekdayIndexFor(new Date())] = {
      name: "Leg Day",
      exerciseIds: ["e_squat"],
      atMinutes: 600,
      durationMinutes: 60,
    };
    useStore.setState({ plannedWeek: week });

    render(
      <DayTimeline
        date={today}
        onOpenMeal={() => {}}
        onOpenSession={() => {}}
        onOpenPlan={onOpenPlan}
      />,
    );

    const plannedBtn = screen.getByRole("button", { name: /^Leg Day/i });
    fireEvent.click(plannedBtn);
    expect(onOpenPlan).toHaveBeenCalledTimes(1);
  });

  it("renders empty day note and hour rules when timeline is empty", () => {
    render(
      <DayTimeline
        date={otherDate}
        onOpenMeal={() => {}}
        onOpenSession={() => {}}
        onOpenPlan={() => {}}
      />,
    );

    // otherDate is in the past, so the note says the day went by unrecorded
    // rather than claiming it is still ahead.
    expect(screen.getByText("This one went unrecorded.")).toBeInTheDocument();

    // Still renders hour labels
    expect(screen.getByText("00:00")).toBeInTheDocument();
    expect(screen.getByText("12:00")).toBeInTheDocument();

    // The intent layer still draws. A day with nothing logged is exactly the
    // day the dashed windows are worth seeing, so "empty" suppresses the note's
    // absence, never the bands.
    const breakfast = screen.getByRole("button", { name: /^Breakfast/i });
    expect(breakfast).toBeInTheDocument();
    expect(breakfast.className).toContain("border-dashed");
  });

  it("says the day is still ahead when it has not happened yet", () => {
    render(
      <DayTimeline
        date="2099-01-01"
        onOpenMeal={() => {}}
        onOpenSession={() => {}}
        onOpenPlan={() => {}}
      />,
    );
    expect(screen.getByText("Still ahead of you.")).toBeInTheDocument();
  });

  it("draws no meal zones at all when food logging is switched off", () => {
    useStore.setState({ foodEnabled: false });
    render(
      <DayTimeline
        date={today}
        onOpenMeal={() => {}}
        onOpenSession={() => {}}
        onOpenPlan={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Breakfast/i })).not.toBeInTheDocument();
  });
});
