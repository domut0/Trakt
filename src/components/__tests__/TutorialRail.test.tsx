import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialRail } from "../TutorialRail";
import { useTutorialStore } from "../../lib/tutorial-store";
import { useStore } from "../../lib/store";

describe("TutorialRail", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--rail-h");
    useTutorialStore.setState({
      active: false,
      step: 0,
      chooserOpen: false,
      startSheetOpen: false,
    });
    useStore.setState({
      hydrated: true,
      unit: "lbs",
      exercises: [],
      slots: [],
      sessions: [],
      sets: [],
      dailyLogs: [],
      nutritionPhases: [],
      plannedDays: [],
      activeSessionId: undefined,
      currentExerciseId: undefined,
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--rail-h");
    vi.restoreAllMocks();
  });

  it("renders nothing and keeps --rail-h at 0px when tutorial is inactive", () => {
    const { container } = render(<TutorialRail />);
    expect(container).toBeEmptyDOMElement();
    expect(document.documentElement.style.getPropertyValue("--rail-h")).toBe("0px");
  });

  it("renders the current step line and Show me button when active, and sets --rail-h", () => {
    useTutorialStore.setState({ active: true, step: 0 });

    render(<TutorialRail />);

    expect(screen.getByText("Tap Add activity.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show me" })).toBeInTheDocument();

    const railH = document.documentElement.style.getPropertyValue("--rail-h");
    expect(railH).toMatch(/\d+px/);
  });

  it("dispatches tutorial-show-me event when Show me is clicked", () => {
    useTutorialStore.setState({ active: true, step: 0 });
    const showMeListener = vi.fn();
    window.addEventListener("tutorial-show-me", showMeListener);

    render(<TutorialRail />);

    const button = screen.getByRole("button", { name: "Show me" });
    fireEvent.click(button);

    expect(showMeListener).toHaveBeenCalledTimes(1);
    window.removeEventListener("tutorial-show-me", showMeListener);
  });

  it("advances step when predicate is satisfied", () => {
    useTutorialStore.setState({ active: true, step: 0, chooserOpen: false });

    const { rerender } = render(<TutorialRail />);
    expect(screen.getByText("Tap Add activity.")).toBeInTheDocument();

    // Satisfy step 1 condition (chooserOpen becomes true)
    useTutorialStore.setState({ chooserOpen: true });
    rerender(<TutorialRail />);

    // Step should advance to 1 ("Pick Strength.")
    expect(useTutorialStore.getState().step).toBe(1);
    expect(screen.getByText("Pick Strength.")).toBeInTheDocument();
  });
});
