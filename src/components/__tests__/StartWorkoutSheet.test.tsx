import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StartWorkoutSheet } from "../StartWorkoutSheet";
import { emptyPlannedWeek } from "../../lib/plan";
import { useStore, type Exercise } from "../../lib/store";
import { weekdayIndexFor } from "../../lib/targets";

/**
 * Starting a workout on a planned day, and - the case that matters more -
 * starting one on any other day.
 *
 * The plan is opt-in and most days are rest days, so the unplanned path is the
 * one nearly every start takes. It is pinned here first: no planning surface in
 * the sheet, and no exercise preloaded, exactly as before plans existed.
 */

const SQUAT: Exercise = { id: "e_squat", name: "Back Squat", type: "main" };
const BENCH: Exercise = { id: "e_bench", name: "Bench Press", type: "main" };

/** The plan is a weekly template, so a plan for "today" has to be written at
 * today's Monday-first weekday index rather than at a fixed one. */
function planToday(exerciseIds: string[], name = "Heavy day") {
  const week = emptyPlannedWeek();
  week[weekdayIndexFor(new Date())] = { name, exerciseIds };
  useStore.setState({ planEnabled: true, plannedWeek: week });
}

function renderSheet() {
  const onStart = vi.fn();
  render(<StartWorkoutSheet open onClose={() => {}} onStart={onStart} />);
  return onStart;
}

function start(name = "Push day") {
  fireEvent.change(screen.getByLabelText("Today's session name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
}

describe("StartWorkoutSheet", () => {
  beforeEach(() => {
    useStore.setState({
      hydrated: true,
      exercises: [SQUAT, BENCH],
      slots: [],
      sessions: [],
      sets: [],
      activeSessionId: undefined,
      currentExerciseId: undefined,
      currentBlock: undefined,
      planEnabled: false,
      plannedWeek: undefined,
    });
  });

  it("starts with nothing preloaded and no plan shown on an unplanned day", () => {
    const onStart = renderSheet();

    expect(screen.queryByText("Planned")).not.toBeInTheDocument();

    start();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(useStore.getState().activeSessionId).toBeDefined();
    expect(useStore.getState().currentExerciseId).toBeUndefined();
  });

  it("shows the day's plan and preloads its first lift", () => {
    planToday(["e_squat", "e_bench"]);
    const onStart = renderSheet();

    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.getByText("Heavy day")).toBeInTheDocument();
    expect(screen.getByText("Back Squat")).toBeInTheDocument();
    expect(screen.getByText("Bench Press")).toBeInTheDocument();

    start();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(useStore.getState().currentExerciseId).toBe("e_squat");
    // Preloading is a selection, never a log.
    expect(useStore.getState().sets).toHaveLength(0);
  });

  it("preloads the plan's first lift, not the library's", () => {
    planToday(["e_bench", "e_squat"]);
    renderSheet();
    start();

    expect(useStore.getState().currentExerciseId).toBe("e_bench");
  });

  it("ignores the plan while the feature is switched off", () => {
    planToday(["e_squat"]);
    useStore.setState({ planEnabled: false });
    renderSheet();

    expect(screen.queryByText("Planned")).not.toBeInTheDocument();

    start();

    expect(useStore.getState().currentExerciseId).toBeUndefined();
  });

  it("treats a plan whose lifts have all been deleted as no plan", () => {
    planToday(["e_gone"]);
    renderSheet();

    expect(screen.queryByText("Planned")).not.toBeInTheDocument();

    start();

    expect(useStore.getState().currentExerciseId).toBeUndefined();
  });

  it("keeps the session name the user's own, never the plan's", () => {
    planToday(["e_squat"], "Heavy day");
    renderSheet();
    start("Push day");

    const { sessions, slots } = useStore.getState();
    const slot = slots.find((s) => s.id === sessions[0].splitSlotId);
    expect(slot?.name).toBe("Push day");
  });
});
