import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WeekPlanner } from "../WeekPlanner";
import { useCoachStore } from "../../lib/coach-store";
import { useStore } from "../../lib/store";

const MON = 1;

describe("WeekPlanner while a coach manages the plan", () => {
  beforeEach(() => {
    useCoachStore.setState({ viewing: undefined });
    useStore.setState({
      hydrated: true,
      coachManaged: true,
      planningMode: "week",
      exercises: [{ id: "bench", name: "Bench Press", type: "main" }],
      slots: [
        {
          id: "upper",
          name: "Upper",
          rotationOrder: 0,
          weekday: MON,
          plannedLifts: [{ exerciseId: "bench", sets: 3, reps: "8" }],
        },
      ],
    });
  });

  it("still opens a day that has a card on it", () => {
    const onEdit = vi.fn();
    render(<WeekPlanner onEdit={onEdit} />);

    const row = screen.getByText("Upper").closest("button");
    expect(row).not.toBeDisabled();

    fireEvent.click(row!);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "upper" }));
  });

  it("does nothing on a day with nothing on it, because there is nothing to open", () => {
    render(<WeekPlanner onEdit={vi.fn()} />);

    // Tuesday holds no card, so its row is the one place a locked week is inert.
    const tuesday = screen.getByText("Tuesday").closest("button");
    expect(tuesday).toBeDisabled();
  });

  it("offers no way to clear the day", () => {
    render(<WeekPlanner onEdit={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Clear Monday" })).not.toBeInTheDocument();
  });
});
