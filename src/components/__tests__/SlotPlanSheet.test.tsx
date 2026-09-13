import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SlotPlanSheet } from "../SlotPlanSheet";
import { useStore, type Exercise } from "../../lib/store";

/**
 * Choosing the lifts a split card opens on.
 *
 * The picker's job is an ORDERED list: the workout starts on whatever sits at
 * the top of it. So these tests are about the two things that order depends on
 * - what can get into the list, and what can move within it.
 */

const SQUAT: Exercise = { id: "e_squat", name: "Back Squat", type: "main" };
const BENCH: Exercise = { id: "e_bench", name: "Bench Press", type: "main" };
const ROW: Exercise = { id: "e_row", name: "Rowing Machine", type: "cardio" };

function renderSheet() {
  render(<SlotPlanSheet slot={undefined} open onClose={() => {}} />);
}

const search = () => screen.getByLabelText("Search exercises");

describe("SlotPlanSheet", () => {
  beforeEach(() => {
    useStore.setState({
      hydrated: true,
      exercises: [SQUAT, BENCH, ROW],
      slots: [],
      sessions: [],
      sets: [],
      nextSlotId: undefined,
    });
  });

  describe("creating an exercise", () => {
    it("offers to add a name the library does not have", () => {
      // The gap this closes: planning a card around a lift you have not done
      // before is the ordinary case, and the only way through it used to be to
      // abandon the card and go log a set of it somewhere.
      renderSheet();
      fireEvent.change(search(), { target: { value: "Pendlay Row" } });

      const add = screen.getByRole("button", { name: /Add .*Pendlay Row/ });
      fireEvent.click(add);

      const created = useStore.getState().exercises.find((e) => e.name === "Pendlay Row");
      expect(created).toBeDefined();
      expect(created?.type).toBe("accessory");
    });

    it("puts the new exercise straight into the chosen list", () => {
      renderSheet();
      fireEvent.change(search(), { target: { value: "Pendlay Row" } });
      fireEvent.click(screen.getByRole("button", { name: /Add .*Pendlay Row/ }));

      expect(screen.getByRole("button", { name: "Remove Pendlay Row" })).toBeInTheDocument();
      // And the box is cleared, so the next name can be typed without selecting
      // and deleting the last one.
      expect((search() as HTMLInputElement).value).toBe("");
    });

    it("does not offer to create a name that already exists", () => {
      renderSheet();
      fireEvent.change(search(), { target: { value: "bench press" } });
      expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
    });

    it("does not offer to create one that is merely already chosen", () => {
      // The library hides chosen lifts, so matching on what is VISIBLE would
      // offer a duplicate the moment the first copy was ticked.
      renderSheet();
      fireEvent.change(search(), { target: { value: "Bench" } });
      fireEvent.click(screen.getByRole("button", { name: /Bench Press/ }));

      fireEvent.change(search(), { target: { value: "Bench Press" } });
      expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
    });

    it("does not offer to create a cardio exercise's name", () => {
      // Cardio never appears in this picker at all - a bout produces no sets -
      // so it is invisible here, but it is still taken.
      renderSheet();
      fireEvent.change(search(), { target: { value: "Rowing Machine" } });
      expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
    });

    it("offers nothing on an empty box", () => {
      renderSheet();
      expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
    });
  });

  describe("ordering the chosen lifts", () => {
    it("moves one up, because the order is what the workout opens on", () => {
      renderSheet();
      fireEvent.click(screen.getByRole("button", { name: /Back Squat/ }));
      fireEvent.click(screen.getByRole("button", { name: /Bench Press/ }));

      fireEvent.click(screen.getByRole("button", { name: "Move Bench Press up" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      const card = useStore.getState().slots[0];
      expect(card.plannedExerciseIds).toEqual(["e_bench", "e_squat"]);
    });

    it("cannot move the ends off the list", () => {
      renderSheet();
      fireEvent.click(screen.getByRole("button", { name: /Back Squat/ }));
      fireEvent.click(screen.getByRole("button", { name: /Bench Press/ }));

      expect(screen.getByRole("button", { name: "Move Back Squat up" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Move Bench Press down" })).toBeDisabled();
    });
  });
});
