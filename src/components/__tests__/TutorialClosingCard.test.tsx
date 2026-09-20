import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialClosingCard } from "../TutorialClosingCard";
import * as tutorialState from "../../lib/tutorial-state";
import * as pendingCoach from "../../lib/pending-coach";

describe("TutorialClosingCard", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when tutorial is not done", () => {
    const { container } = render(<TutorialClosingCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders closing card copy once tutorial is done", () => {
    tutorialState.saveTutorialState({ joinedAt: Date.now(), doneAt: Date.now() });
    pendingCoach.savePendingCoach({ name: "Dave" });

    render(<TutorialClosingCard />);

    expect(screen.getByText("Tutorial done")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing you just logged was saved. Your first real one will be."),
    ).toBeInTheDocument();

    expect(screen.getByText("Every morning")).toBeInTheDocument();
    expect(screen.getByText("Bodyweight, on Today.")).toBeInTheDocument();

    expect(screen.getByText("Every night")).toBeInTheDocument();
    expect(
      screen.getByText("Calories, protein, carbs, fat, and steps if you count them."),
    ).toBeInTheDocument();

    expect(screen.getByText("When it arrives")).toBeInTheDocument();
    expect(
      screen.getByText("A plan from Dave shows up as a card. Read it, then accept it."),
    ).toBeInTheDocument();
  });

  it("disappears when dismissed and stays gone across remount", () => {
    tutorialState.saveTutorialState({ joinedAt: Date.now(), doneAt: Date.now() });
    const { unmount } = render(<TutorialClosingCard />);

    expect(screen.getByText("Tutorial done")).toBeInTheDocument();

    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(dismissBtn);

    expect(screen.queryByText("Tutorial done")).not.toBeInTheDocument();
    expect(tutorialState.loadTutorialState()?.closingCardDismissedAt).toBeTypeOf("number");

    unmount();

    render(<TutorialClosingCard />);
    expect(screen.queryByText("Tutorial done")).not.toBeInTheDocument();
  });
});
