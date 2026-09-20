import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CardioLogCard } from "../CardioLogCard";
import { dayKey } from "../../lib/daily-log";
import { useStore, type Exercise } from "../../lib/store";

/**
 * Logging cardio after the fact.
 *
 * Like a backdated strength workout, cardio can be logged for a past day
 * when you forgot to record it at the time. The date picker mirrors
 * StartWorkoutSheet: defaults to today, caps at today (no future bouts),
 * and leaves `on` undefined when saved on today so the present-moment
 * timestamp is preserved.
 */

const TREADMILL: Exercise = { id: "e_treadmill", name: "Treadmill", type: "cardio" };

describe("CardioLogCard", () => {
  beforeEach(() => {
    useStore.setState({
      hydrated: true,
      exercises: [TREADMILL],
      sessions: [],
      sets: [],
      dailyLogs: [],
      activeSessionId: undefined,
      currentExerciseId: undefined,
    });
  });

  it("defaults to today's date and passes undefined on when logged on today", () => {
    const today = dayKey(new Date());
    const onDone = vi.fn();
    const logCardioSpy = vi.spyOn(useStore.getState(), "logCardio");
    render(<CardioLogCard onBack={() => {}} onDone={onDone} />);

    // Select the existing cardio exercise to open the details view
    fireEvent.click(screen.getByRole("button", { name: "Treadmill" }));

    const dateInput = screen.getByLabelText("Cardio date") as HTMLInputElement;
    expect(dateInput).toBeInTheDocument();
    expect(dateInput.value).toBe(today);
    expect(dateInput.max).toBe(today);

    // Save with default today date
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onDone).toHaveBeenCalledTimes(1);

    expect(logCardioSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        exerciseId: "e_treadmill",
        on: undefined,
      }),
    );
  });

  it("passes backdated day key to logCardio when past date is chosen", () => {
    const onDone = vi.fn();
    const logCardioSpy = vi.spyOn(useStore.getState(), "logCardio");
    render(<CardioLogCard onBack={() => {}} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Treadmill" }));

    const dateInput = screen.getByLabelText("Cardio date");
    fireEvent.change(dateInput, { target: { value: "2026-08-01" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onDone).toHaveBeenCalledTimes(1);

    expect(logCardioSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        exerciseId: "e_treadmill",
        on: "2026-08-01",
      }),
    );
  });
});
