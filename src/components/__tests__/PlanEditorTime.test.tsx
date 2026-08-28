import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanEditorSheet } from "../PlanEditorSheet";
import {
  DEFAULT_PLANNED_DURATION_MINUTES,
  emptyPlannedWeek,
  plannedWorkoutFor,
} from "../../lib/plan";
import { useStore, type Exercise } from "../../lib/store";

const BENCH: Exercise = { id: "e_bench", name: "Bench Press", type: "main" };
const SQUAT: Exercise = { id: "e_squat", name: "Squat", type: "main" };

describe("PlanEditorSheet time and duration controls", () => {
  beforeEach(() => {
    useStore.setState({
      hydrated: true,
      exercises: [BENCH, SQUAT],
      plannedWeek: emptyPlannedWeek(),
    });
  });

  it("setting a time saves atMinutes as minutes past midnight", () => {
    useStore.getState().setPlannedDay(0, { name: "Bench day", exerciseIds: ["e_bench"] });
    const onClose = vi.fn();
    render(
      <PlanEditorSheet
        open
        weekdayIndex={0}
        dayName="Monday"
        workout={useStore.getState().plannedWeek?.[0] ?? undefined}
        onClose={onClose}
      />,
    );

    const timeInput = screen.getByLabelText("Start time");
    fireEvent.change(timeInput, { target: { value: "14:30" } });

    const saved = useStore.getState().plannedWeek?.[0];
    expect(saved?.atMinutes).toBe(14 * 60 + 30); // 870
    expect(saved?.name).toBe("Bench day");
    expect(saved?.exerciseIds).toEqual(["e_bench"]);
  });

  it("setting midnight (00:00) saves atMinutes as 0", () => {
    useStore.getState().setPlannedDay(0, { name: "Late Night Lift", exerciseIds: ["e_bench"] });
    const onClose = vi.fn();
    render(
      <PlanEditorSheet
        open
        weekdayIndex={0}
        dayName="Monday"
        workout={useStore.getState().plannedWeek?.[0] ?? undefined}
        onClose={onClose}
      />,
    );

    const timeInput = screen.getByLabelText("Start time");
    fireEvent.change(timeInput, { target: { value: "00:00" } });

    const saved = useStore.getState().plannedWeek?.[0];
    expect(saved?.atMinutes).toBe(0);
  });

  it("clearing the time field sets atMinutes back to undefined, not to 0", () => {
    useStore
      .getState()
      .setPlannedDay(0, { name: "Bench day", exerciseIds: ["e_bench"], atMinutes: 0 });
    const onClose = vi.fn();
    render(
      <PlanEditorSheet
        open
        weekdayIndex={0}
        dayName="Monday"
        workout={useStore.getState().plannedWeek?.[0] ?? undefined}
        onClose={onClose}
      />,
    );

    const timeInput = screen.getByLabelText("Start time");
    expect((timeInput as HTMLInputElement).value).toBe("00:00");

    fireEvent.change(timeInput, { target: { value: "" } });

    const saved = useStore.getState().plannedWeek?.[0];
    expect(saved?.atMinutes).toBeUndefined();
    expect(saved?.atMinutes).not.toBe(0);
    expect(saved).toEqual({ name: "Bench day", exerciseIds: ["e_bench"] });
  });

  it("disables duration when there is no start time", () => {
    useStore.getState().setPlannedDay(0, { name: "Bench day", exerciseIds: ["e_bench"] });
    const onClose = vi.fn();
    render(
      <PlanEditorSheet
        open
        weekdayIndex={0}
        dayName="Monday"
        workout={useStore.getState().plannedWeek?.[0] ?? undefined}
        onClose={onClose}
      />,
    );

    const durationInput = screen.getByLabelText("Duration in minutes");
    expect(durationInput).toBeDisabled();
    expect((durationInput as HTMLInputElement).placeholder).toBe(
      String(DEFAULT_PLANNED_DURATION_MINUTES),
    );
  });

  it("enables duration when a start time is set", () => {
    useStore.getState().setPlannedDay(0, { name: "Bench day", exerciseIds: ["e_bench"] });
    const onClose = vi.fn();
    render(
      <PlanEditorSheet
        open
        weekdayIndex={0}
        dayName="Monday"
        workout={useStore.getState().plannedWeek?.[0] ?? undefined}
        onClose={onClose}
      />,
    );

    const timeInput = screen.getByLabelText("Start time");
    const durationInput = screen.getByLabelText("Duration in minutes");

    expect(durationInput).toBeDisabled();

    fireEvent.change(timeInput, { target: { value: "17:00" } });
    expect(durationInput).not.toBeDisabled();
  });

  it("a duration saves as durationMinutes", () => {
    useStore
      .getState()
      .setPlannedDay(0, { name: "Bench day", exerciseIds: ["e_bench"], atMinutes: 1020 });
    const onClose = vi.fn();
    render(
      <PlanEditorSheet
        open
        weekdayIndex={0}
        dayName="Monday"
        workout={useStore.getState().plannedWeek?.[0] ?? undefined}
        onClose={onClose}
      />,
    );

    const durationInput = screen.getByLabelText("Duration in minutes");
    fireEvent.change(durationInput, { target: { value: "75" } });

    const saved = useStore.getState().plannedWeek?.[0];
    expect(saved?.durationMinutes).toBe(75);
    expect(saved?.atMinutes).toBe(1020);
  });

  it("clearing duration sets durationMinutes to undefined", () => {
    useStore.getState().setPlannedDay(0, {
      name: "Bench day",
      exerciseIds: ["e_bench"],
      atMinutes: 1020,
      durationMinutes: 75,
    });
    const onClose = vi.fn();
    render(
      <PlanEditorSheet
        open
        weekdayIndex={0}
        dayName="Monday"
        workout={useStore.getState().plannedWeek?.[0] ?? undefined}
        onClose={onClose}
      />,
    );

    const durationInput = screen.getByLabelText("Duration in minutes");
    fireEvent.change(durationInput, { target: { value: "" } });

    const saved = useStore.getState().plannedWeek?.[0];
    expect(saved?.durationMinutes).toBeUndefined();
    expect(saved?.atMinutes).toBe(1020);
  });

  it("clearing start time disables duration and clears durationMinutes", () => {
    useStore.getState().setPlannedDay(0, {
      name: "Bench day",
      exerciseIds: ["e_bench"],
      atMinutes: 1020,
      durationMinutes: 75,
    });
    const onClose = vi.fn();
    render(
      <PlanEditorSheet
        open
        weekdayIndex={0}
        dayName="Monday"
        workout={useStore.getState().plannedWeek?.[0] ?? undefined}
        onClose={onClose}
      />,
    );

    const timeInput = screen.getByLabelText("Start time");
    const durationInput = screen.getByLabelText("Duration in minutes");

    expect(durationInput).not.toBeDisabled();

    fireEvent.change(timeInput, { target: { value: "" } });

    expect(durationInput).toBeDisabled();
    const saved = useStore.getState().plannedWeek?.[0];
    expect(saved?.atMinutes).toBeUndefined();
    expect(saved?.durationMinutes).toBeUndefined();
  });

  it("reopening shows both start time and duration", () => {
    const savedWorkout = {
      name: "Squat day",
      exerciseIds: ["e_squat"],
      atMinutes: 17 * 60 + 45, // 1065 -> "17:45"
      durationMinutes: 90,
    };
    useStore.getState().setPlannedDay(1, savedWorkout);

    const onClose = vi.fn();
    const { unmount } = render(
      <PlanEditorSheet
        open
        weekdayIndex={1}
        dayName="Tuesday"
        workout={useStore.getState().plannedWeek?.[1] ?? undefined}
        onClose={onClose}
      />,
    );

    let timeInput = screen.getByLabelText("Start time") as HTMLInputElement;
    let durationInput = screen.getByLabelText("Duration in minutes") as HTMLInputElement;

    expect(timeInput.value).toBe("17:45");
    expect(durationInput.value).toBe("90");
    expect(durationInput).not.toBeDisabled();

    unmount();

    // Reopen
    render(
      <PlanEditorSheet
        open
        weekdayIndex={1}
        dayName="Tuesday"
        workout={useStore.getState().plannedWeek?.[1] ?? undefined}
        onClose={onClose}
      />,
    );

    timeInput = screen.getByLabelText("Start time") as HTMLInputElement;
    durationInput = screen.getByLabelText("Duration in minutes") as HTMLInputElement;

    expect(timeInput.value).toBe("17:45");
    expect(durationInput.value).toBe("90");
    expect(durationInput).not.toBeDisabled();
  });

  it("reopening with midnight shows 00:00 and duration", () => {
    const savedWorkout = {
      name: "Midnight Session",
      exerciseIds: ["e_bench"],
      atMinutes: 0,
      durationMinutes: 45,
    };
    useStore.getState().setPlannedDay(2, savedWorkout);

    const onClose = vi.fn();
    render(
      <PlanEditorSheet
        open
        weekdayIndex={2}
        dayName="Wednesday"
        workout={useStore.getState().plannedWeek?.[2] ?? undefined}
        onClose={onClose}
      />,
    );

    const timeInput = screen.getByLabelText("Start time") as HTMLInputElement;
    const durationInput = screen.getByLabelText("Duration in minutes") as HTMLInputElement;

    expect(timeInput.value).toBe("00:00");
    expect(durationInput.value).toBe("45");
    expect(durationInput).not.toBeDisabled();
  });

  it("a planned day with no time still saves and resolves", () => {
    const onClose = vi.fn();
    render(
      <PlanEditorSheet
        open
        weekdayIndex={0}
        dayName="Monday"
        workout={undefined}
        onClose={onClose}
      />,
    );

    const nameInput = screen.getByPlaceholderText("Name this day");
    fireEvent.change(nameInput, { target: { value: "Legs" } });

    const addSquatButton = screen.getByRole("button", { name: /Squat/ });
    fireEvent.click(addSquatButton);

    const saved = useStore.getState().plannedWeek?.[0];
    expect(saved).toEqual({ name: "Legs", exerciseIds: ["e_squat"] });
    expect(saved?.atMinutes).toBeUndefined();
    expect(saved?.durationMinutes).toBeUndefined();

    // Resolves cleanly through plannedWorkoutFor on 2026-08-10 (Monday)
    const resolved = plannedWorkoutFor("2026-08-10", useStore.getState().plannedWeek);
    expect(resolved).toEqual({ name: "Legs", exerciseIds: ["e_squat"] });
    expect(resolved?.atMinutes).toBeUndefined();
    expect(resolved?.durationMinutes).toBeUndefined();
  });

  it("clicking Make this a rest day clears the day completely", () => {
    useStore.getState().setPlannedDay(0, {
      name: "Bench day",
      exerciseIds: ["e_bench"],
      atMinutes: 1020,
      durationMinutes: 60,
    });
    const onClose = vi.fn();
    render(
      <PlanEditorSheet
        open
        weekdayIndex={0}
        dayName="Monday"
        workout={useStore.getState().plannedWeek?.[0] ?? undefined}
        onClose={onClose}
      />,
    );

    const restButton = screen.getByRole("button", { name: "Make this a rest day" });
    fireEvent.click(restButton);

    expect(useStore.getState().plannedWeek?.[0]).toBeNull();
    expect(plannedWorkoutFor("2026-08-10", useStore.getState().plannedWeek)).toBeUndefined();
  });
});
