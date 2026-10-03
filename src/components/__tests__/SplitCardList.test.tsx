import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SplitCardList } from "../SplitCardList";
import { useStore } from "../../lib/store";
import { useCoachStore } from "../../lib/coach-store";

describe("reading rotation workouts", () => {
  const slot = { id: "upper", name: "Upper", rotationOrder: 0 };
  beforeEach(() => {
    useStore.setState({ hydrated: true, coachManaged: false, slots: [slot], exercises: [] });
    useCoachStore.setState({ viewing: undefined });
  });
  it("opens the overview from a semantic button once", () => {
    const open = vi.fn();
    render(<SplitCardList onEdit={open} />);
    const button = screen.getByRole("button", { name: "View Upper" });
    button.focus();
    fireEvent.click(button, { detail: 0 });
    expect(open).toHaveBeenCalledExactlyOnceWith(slot);
  });
  it("keeps options separate from opening the overview", () => {
    const open = vi.fn();
    render(<SplitCardList onEdit={open} />);
    const options = screen.getByRole("button", { name: "Options for Upper" });
    fireEvent.click(options);
    expect(options).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Do this today" })).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });
  it("lets a coach-managed client read without management controls", () => {
    useStore.setState({ coachManaged: true });
    const open = vi.fn();
    render(<SplitCardList onEdit={open} />);
    fireEvent.click(screen.getByRole("button", { name: "View Upper" }));
    expect(open).toHaveBeenCalledExactlyOnceWith(slot);
    expect(screen.queryByRole("button", { name: "Options for Upper" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move Upper up" })).not.toBeInTheDocument();
  });
});
