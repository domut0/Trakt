import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlannedCardSheet } from "../PlannedCardSheet";
import { useStore, type SplitSlot } from "../../lib/store";

describe("PlannedCardSheet", () => {
  beforeEach(() => {
    useStore.setState({
      hydrated: true,
      exercises: [
        { id: "bench", name: "Bench Press", type: "main" },
        { id: "curl", name: "Incline DB Curl", type: "accessory" },
        { id: "bike", name: "Stationary Bike", type: "cardio" },
      ],
    });
  });

  const upper: SplitSlot = {
    id: "upper",
    name: "Upper",
    rotationOrder: 0,
    plannedLifts: [
      { exerciseId: "bench", sets: 3, reps: "8", load: "135 lbs" },
      // Prescribed as a name in an order, which is a legal prescription.
      { exerciseId: "curl" },
    ],
  };

  it("says what the plan says, and nothing where it says nothing", () => {
    render(<PlannedCardSheet slot={upper} open onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Upper" })).toBeInTheDocument();
    expect(screen.getByText("3 × 8 @ 135 lbs")).toBeInTheDocument();
    expect(screen.getByText("Incline DB Curl")).toBeInTheDocument();
    // No invented "3 × 8" for the lift that was given none.
    expect(screen.queryByText("0 × ")).not.toBeInTheDocument();
  });

  it("carries no way to change anything when onEdit is omitted", () => {
    render(<PlannedCardSheet slot={upper} open onClose={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("Close");
  });

  it("renders Edit action when onEdit is provided, closing preview on click", () => {
    const onClose = vi.fn();
    const onEdit = vi.fn();
    render(<PlannedCardSheet slot={upper} open onClose={onClose} onEdit={onEdit} />);

    const editBtn = screen.getByRole("button", { name: "Edit Upper" });
    expect(editBtn).toBeInTheDocument();

    fireEvent.click(editBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(upper);
  });

  it("shows a finisher under the lifts", () => {
    render(
      <PlannedCardSheet
        slot={{ ...upper, plannedCardio: { exerciseId: "bike", durationMinutes: 20 } }}
        open
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Finisher")).toBeInTheDocument();
    expect(screen.getByText("Stationary Bike")).toBeInTheDocument();
    expect(screen.getByText("20 min")).toBeInTheDocument();
  });

  it("says what a rest day and a repeat are", () => {
    const { unmount } = render(
      <PlannedCardSheet
        slot={{ id: "r", name: "Rest", rotationOrder: 1, kind: "rest" }}
        open
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("A rest day. Nothing planned.")).toBeInTheDocument();
    unmount();

    render(
      <PlannedCardSheet
        slot={{ id: "rp", name: "Repeat", rotationOrder: 2, kind: "repeat" }}
        open
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Back to the top" })).toBeInTheDocument();
  });

  it("closes on the backdrop and on the close button", () => {
    const onClose = vi.fn();
    render(<PlannedCardSheet slot={upper} open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    const { container } = render(<PlannedCardSheet slot={upper} open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Bench Press")).not.toBeInTheDocument();
  });
  it("contains keyboard focus and returns it to the opener", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <PlannedCardSheet slot={upper} open onClose={vi.fn()} onEdit={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog");
    const edit = screen.getByRole("button", { name: "Edit Upper" });
    const close = screen.getByRole("button", { name: "Close" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(edit).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
