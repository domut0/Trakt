import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubstituteSheet } from "../SubstituteSheet";
import { useStore, type Exercise } from "../../lib/store";

const BENCH: Exercise = { id: "e_bench", name: "Bench Press", type: "main" };
const INCLINE: Exercise = { id: "e_incline_bench", name: "Incline Bench Press", type: "main" };
const DB_BENCH: Exercise = { id: "e_db_bench", name: "Dumbbell Bench Press", type: "accessory" };
const DEADLIFT: Exercise = { id: "e_dead", name: "Deadlift", type: "main" };

describe("SubstituteSheet", () => {
  beforeEach(() => {
    useStore.setState({
      exercises: [BENCH, INCLINE, DB_BENCH, DEADLIFT],
      coachManaged: false,
    });
  });

  it("suggests same-group lifts, excluding the current lift and lifts already in the session", () => {
    render(
      <SubstituteSheet
        open
        onClose={() => {}}
        exercise={BENCH}
        sessionExerciseIds={["e_db_bench"]}
        onSubstitute={() => {}}
      />,
    );

    expect(screen.getByText("Suggested alternatives")).toBeInTheDocument();

    // Incline Bench is same-group (Chest), not current, not in session: suggested
    expect(screen.getByRole("button", { name: /^Incline Bench Press/ })).toBeInTheDocument();

    // Bench Press (current lift) and DB Bench (in session) must not be in suggested alternatives
    const suggestionsHeader = screen.getByText("Suggested alternatives");
    const suggestionsSection = suggestionsHeader.closest(".group-header")!.parentElement!;
    expect(suggestionsSection).toHaveTextContent("Incline Bench Press");
    expect(suggestionsSection).not.toHaveTextContent("Dumbbell Bench Press");
    expect(suggestionsSection).not.toHaveTextContent("Deadlift");
  });

  it("renders no suggestions section for a custom exercise with no group", () => {
    const custom: Exercise = { id: "custom_lift", name: "Custom Movement", type: "accessory" };
    useStore.setState({ exercises: [BENCH, INCLINE, custom] });

    render(<SubstituteSheet open onClose={() => {}} exercise={custom} onSubstitute={() => {}} />);

    // No empty heading, no suggestions section, no "no suggestions found" line
    expect(screen.queryByText("Suggested alternatives")).not.toBeInTheDocument();
    expect(screen.queryByText(/no suggestions/i)).not.toBeInTheDocument();
  });

  it("disables both Substitute and Replace everywhere until a replacement is chosen", () => {
    // `onReplaceEverywhere` is what makes that button exist at all: the sheet
    // edits nothing itself, so without a handler the control would be a lie.
    render(
      <SubstituteSheet
        open
        onClose={() => {}}
        exercise={BENCH}
        onSubstitute={() => {}}
        onReplaceEverywhere={() => {}}
      />,
    );

    const subBtn = screen.getByRole("button", { name: "Substitute" });
    const repBtn = screen.getByRole("button", { name: "Replace everywhere" });

    expect(subBtn).toBeDisabled();
    expect(repBtn).toBeDisabled();

    // Selecting a replacement enables both
    fireEvent.click(screen.getByRole("button", { name: /^Incline Bench Press/ }));

    expect(subBtn).toBeEnabled();
    expect(repBtn).toBeEnabled();
  });

  it("does not render Replace everywhere when coachManaged is true", () => {
    useStore.setState({ coachManaged: true });

    // The handler IS passed. Without it the button would be absent anyway and
    // this test would prove nothing about coachManaged -- it has to be the
    // flag that hides the control, not a missing prop.
    render(
      <SubstituteSheet
        open
        onClose={() => {}}
        exercise={BENCH}
        onSubstitute={() => {}}
        onReplaceEverywhere={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Substitute" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace everywhere" })).not.toBeInTheDocument();
  });

  it("calls onSubstitute with the chosen replacement id", () => {
    const onSubstitute = vi.fn();
    render(
      <SubstituteSheet open onClose={() => {}} exercise={BENCH} onSubstitute={onSubstitute} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Incline Bench Press/ }));
    fireEvent.click(screen.getByRole("button", { name: "Substitute" }));

    expect(onSubstitute).toHaveBeenCalledWith("e_incline_bench");
  });

  it("calls onReplaceEverywhere with the chosen replacement id", () => {
    const onReplaceEverywhere = vi.fn();
    render(
      <SubstituteSheet
        open
        onClose={() => {}}
        exercise={BENCH}
        onSubstitute={() => {}}
        onReplaceEverywhere={onReplaceEverywhere}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Incline Bench Press/ }));
    fireEvent.click(screen.getByRole("button", { name: "Replace everywhere" }));

    expect(onReplaceEverywhere).toHaveBeenCalledWith("e_incline_bench");
  });

  /**
   * Found by driving the app, not by reading it: a three-lift day became a
   * two-lift day. The workout log keeps one row per exercise, so choosing a
   * lift the session already contains merges the rows and takes the
   * disappearing row's prescription with it. The fix is to not offer it --
   * in EITHER list, not just the suggestions.
   */
  it("never offers a lift the session already contains", () => {
    render(
      <SubstituteSheet
        open
        onClose={() => {}}
        exercise={BENCH}
        sessionExerciseIds={[BENCH.id, "e_incline_bench"]}
        onSubstitute={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: /^Incline Bench Press/ })).not.toBeInTheDocument();
  });
});
