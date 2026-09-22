import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExerciseScreen } from "../ExerciseScreen";
import { useStore, type Exercise, type WorkoutSession, type WorkoutSet } from "../../lib/store";

describe("ExerciseScreen Done button", () => {
  const bench: Exercise = { id: "bench", name: "Bench Press", type: "main" };
  const session: WorkoutSession = { id: "s1", startedAt: Date.now() };

  beforeEach(() => {
    useStore.setState({
      exercises: [bench],
      sessions: [session],
      sets: [],
      activeSessionId: "s1",
    });
  });

  it("shows Back but not Done when no work has been done yet", () => {
    const onDone = vi.fn();
    render(<ExerciseScreen exerciseId="bench" stopwatch="0:00" onDone={onDone} />);

    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  });

  it("shows Done once a set is logged in this session and clicking it calls onDone", () => {
    const onDone = vi.fn();
    const set1: WorkoutSet = {
      id: "set_1",
      sessionId: "s1",
      exerciseId: "bench",
      weight: 185,
      reps: 5,
      loggedAt: Date.now(),
    };
    useStore.setState({ sets: [set1] });

    render(<ExerciseScreen exerciseId="bench" stopwatch="0:00" onDone={onDone} />);

    const doneButton = screen.getByRole("button", { name: "Done" });
    expect(doneButton).toBeInTheDocument();
    expect(doneButton).toHaveAttribute("data-tutorial", "exercise-done");

    fireEvent.click(doneButton);
    expect(onDone).toHaveBeenCalledWith(true);

    // Back remains present too
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("shows Done after editing the setup note during this visit", () => {
    const onDone = vi.fn();
    render(<ExerciseScreen exerciseId="bench" stopwatch="0:00" onDone={onDone} />);

    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();

    // Click the setup note button to edit
    const noteButton = screen.getByRole("button", { name: "Edit setup note" });
    fireEvent.click(noteButton);

    const input = screen.getByLabelText("Setup note");
    fireEvent.change(input, { target: { value: "pins 4" } });
    fireEvent.blur(input);

    const doneButton = screen.getByRole("button", { name: "Done" });
    expect(doneButton).toBeInTheDocument();
    expect(doneButton).toHaveAttribute("data-tutorial", "exercise-done");

    fireEvent.click(doneButton);
    expect(onDone).toHaveBeenCalled();
  });
});
