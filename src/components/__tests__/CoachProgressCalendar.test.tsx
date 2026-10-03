import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CoachProgressCalendar, CoachProgressDay } from "../CoachProgressCalendar";
import { progressWeeks, type ProgressDay } from "../../lib/coach-progress";

const day: ProgressDay = {
  date: "2026-09-21",
  log: {
    date: "2026-09-21",
    steps: 0,
    bodyweight: 80.1,
    calories: 2250,
    protein: 150,
    carbs: 240,
    fat: 65,
  },
  workouts: [
    {
      id: "lift",
      name: "Lower body with a long name",
      startedAt: new Date(2026, 8, 21, 7).getTime(),
      sets: 2,
      details: ["Squat: 100 kg × 5", "Squat: 100 kg × 4"],
    },
  ],
  cardio: [
    {
      id: "bike",
      name: "Bike",
      startedAt: new Date(2026, 8, 21, 8).getTime(),
      durationMinutes: 20,
      distance: 5,
      details: [],
    },
    { id: "walk", name: "Walk", startedAt: new Date(2026, 8, 21, 9).getTime(), details: [] },
  ],
};

describe("compact coach calendars", () => {
  it("makes each whole day accessible, keeps zero, and opens the selected date", () => {
    const onSelectDay = vi.fn();
    const { container } = render(
      <CoachProgressCalendar
        weeks={progressWeeks(day.date, "week")}
        days={new Map([[day.date, day]])}
        unit="kg"
        clientName="Maya"
        onSelectDay={onSelectDay}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(7);
    const button = screen.getByRole("button", { name: /Open Maya, Mon 21 Sep 2026/ });
    expect(button).toHaveAccessibleName(/Steps: 0/);
    expect(button).toHaveAccessibleName(/Bodyweight: 80.1 kg/);
    expect(button).toHaveAccessibleName(/Cardio: Bike, 20 minutes; Walk/);
    expect(button.querySelector('[data-metric="steps"] .ts-value')).toHaveTextContent("0");
    expect(button).toHaveTextContent("+1");
    // A partial 20 minutes plus an unknown duration is not a 20-minute total.
    expect(button.querySelectorAll(".ts-mini-event-detail")[1]).toHaveTextContent("–");
    expect(container.querySelectorAll("input")).toHaveLength(0);
    fireEvent.click(button);
    expect(onSelectDay).toHaveBeenCalledWith(day.date);
  });

  it("adds rows for larger periods without changing the number of columns", () => {
    const { container, rerender } = render(
      <CoachProgressCalendar
        weeks={progressWeeks(day.date, "fortnight")}
        days={new Map()}
        unit="kg"
        clientName="Maya"
        onSelectDay={() => {}}
      />,
    );
    expect(container.querySelectorAll(".ts-week")).toHaveLength(2);
    rerender(
      <CoachProgressCalendar
        weeks={progressWeeks(day.date, "month")}
        days={new Map()}
        unit="kg"
        clientName="Maya"
        onSelectDay={() => {}}
      />,
    );
    const rows = [...container.querySelectorAll(".ts-week")];
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.children.length === 7)).toBe(true);
    expect(screen.getAllByRole("button")).toHaveLength(30);
  });

  it("shows every workout and cardio entry and actual set details in the read-only day", () => {
    const onBack = vi.fn();
    const { container } = render(
      <CoachProgressDay day={day} unit="kg" clientName="Maya" onBack={onBack} />,
    );
    expect(screen.getByText("Lower body with a long name")).toBeInTheDocument();
    expect(screen.getByText("Squat: 100 kg × 5")).toBeInTheDocument();
    expect(screen.getByText("Bike")).toBeInTheDocument();
    expect(screen.getByText("Walk")).toBeInTheDocument();
    expect(screen.getByText(/5 km/)).toBeInTheDocument();
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Previous day" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Back to calendar" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
