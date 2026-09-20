import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StartWorkoutSheet } from "../StartWorkoutSheet";
import { useStore, type Exercise, type SplitSlot } from "../../lib/store";
import { dayKey } from "../../lib/daily-log";

/**
 * Choosing what to train, and preloading what it is for.
 *
 * The plan used to be a weekly template, so "today's plan" meant a weekday
 * lookup. It lives on the SPLIT SLOT now, because the rotation it plans has no
 * weekdays in it: UL×infinity advances when you train. So these tests set up
 * slots, not weeks, and nothing here asks what day it is.
 */

const SQUAT: Exercise = { id: "e_squat", name: "Back Squat", type: "main" };
const BENCH: Exercise = { id: "e_bench", name: "Bench Press", type: "main" };

function slot(name: string, exerciseIds?: string[], rotationOrder = 0): SplitSlot {
  return {
    id: `s_${name.toLowerCase()}`,
    name,
    rotationOrder,
    plannedLifts: exerciseIds?.map((exerciseId) => ({ exerciseId })),
  };
}

function renderSheet() {
  const onStart = vi.fn();
  render(<StartWorkoutSheet open onClose={() => {}} onStart={onStart} />);
  return onStart;
}

function typeAndStart(name: string) {
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
      plannedDays: [],
      activeSessionId: undefined,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
  });

  it("starts with nothing preloaded when the slot has no lifts", () => {
    const onStart = renderSheet();
    expect(screen.queryByText("Planned")).not.toBeInTheDocument();

    typeAndStart("Push day");

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(useStore.getState().activeSessionId).toBeDefined();
    expect(useStore.getState().currentExerciseId).toBeUndefined();
  });

  it("shows a slot's lifts and preloads the first", () => {
    useStore.setState({ slots: [slot("Upper", ["e_squat", "e_bench"])] });
    const onStart = renderSheet();

    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.getByText("Back Squat")).toBeInTheDocument();
    expect(screen.getByText("Bench Press")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Upper" }));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(useStore.getState().currentExerciseId).toBe("e_squat");
    // Preloading is a selection, never a log.
    expect(useStore.getState().sets).toHaveLength(0);
  });

  it("preloads in the order the lifts were chosen, not the library's", () => {
    useStore.setState({ slots: [slot("Upper", ["e_bench", "e_squat"])] });
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Upper" }));

    expect(useStore.getState().currentExerciseId).toBe("e_bench");
  });

  it("treats a slot whose lifts have all been deleted as unplanned", () => {
    useStore.setState({ slots: [slot("Upper", ["e_gone"])] });
    renderSheet();

    expect(screen.queryByText("Planned")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Upper" }));
    expect(useStore.getState().currentExerciseId).toBeUndefined();
  });

  describe("choosing between slots", () => {
    beforeEach(() => {
      // UL×infinity with the split pointing at Lower. The cursor is explicit
      // now: it moves when a card is consumed, rather than being re-derived
      // from whichever slot was logged most recently.
      useStore.setState({
        slots: [slot("Upper", ["e_bench"], 0), slot("Lower", ["e_squat"], 1)],
        nextSlotId: "s_lower",
      });
    });

    it("lists every slot with an empty field", () => {
      renderSheet();
      // The bug this fixes: suggestions used to be gated on the input being
      // non-empty, so an untouched sheet showed a lone grey placeholder and
      // picking anything but the suggestion meant typing it from memory.
      expect(screen.getByRole("button", { name: "Upper" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Lower" })).toBeInTheDocument();
    });

    it("lets you take the one the rotation did not suggest", () => {
      // The rest-day case. After a break the next slot is a free choice, and it
      // has to cost one tap rather than knowing what to type.
      renderSheet();
      fireEvent.click(screen.getByRole("button", { name: "Upper" }));

      const { sessions, slots } = useStore.getState();
      expect(slots.find((s) => s.id === sessions[0].splitSlotId)?.name).toBe("Upper");
    });

    it("defaults to the rotation's suggestion when Start is pressed bare", () => {
      const onStart = renderSheet();
      fireEvent.click(screen.getByRole("button", { name: "Start" }));

      expect(onStart).toHaveBeenCalledTimes(1);
      const { sessions, slots } = useStore.getState();
      expect(slots.find((s) => s.id === sessions[0].splitSlotId)?.name).toBe("Lower");
    });

    it("prefers a pin for today over the rotation", () => {
      // A pin is a fact the user recorded about this day, so it outranks a guess.
      // The LOCAL date, as the app computes it. `toISOString` is UTC, which is
      // already tomorrow every evening west of Greenwich.
      const today = dayKey(new Date());
      useStore.setState({ plannedDays: [{ date: today, splitSlotId: "s_upper" }] });
      renderSheet();
      fireEvent.click(screen.getByRole("button", { name: "Start" }));

      const { sessions, slots } = useStore.getState();
      expect(slots.find((s) => s.id === sessions[0].splitSlotId)?.name).toBe("Upper");
    });
  });

  it("keeps the session name the user's own", () => {
    useStore.setState({ slots: [slot("Upper", ["e_squat"])] });
    renderSheet();
    typeAndStart("Push day");

    const { sessions, slots } = useStore.getState();
    expect(slots.find((s) => s.id === sessions[0].splitSlotId)?.name).toBe("Push day");
  });
});
