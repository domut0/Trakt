import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeekStrip } from "../WeekStrip";

describe("WeekStrip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders seven cells starting with Sunday", () => {
    const onSelectDate = vi.fn();
    render(<WeekStrip selectedDate="2026-08-25" onSelectDate={onSelectDate} />);

    // Week containing Tuesday Aug 25, 2026 starts on Sunday Aug 23, 2026
    const expectedInitials = ["S", "M", "T", "W", "T", "F", "S"];
    const expectedDates = ["23", "24", "25", "26", "27", "28", "29"];

    const dayButtons = screen.getAllByRole("button").filter((btn) => {
      return btn.getAttribute("aria-label")?.includes("August");
    });

    expect(dayButtons).toHaveLength(7);

    dayButtons.forEach((btn, index) => {
      expect(btn).toHaveTextContent(expectedInitials[index]);
      expect(btn).toHaveTextContent(expectedDates[index]);
    });
  });

  it("marks the selected day with a filled accent disc", () => {
    const onSelectDate = vi.fn();
    render(<WeekStrip selectedDate="2026-08-25" onSelectDate={onSelectDate} />);

    const day25Button = screen.getByRole("button", {
      name: "Tuesday, August 25, 2026",
    });
    expect(day25Button).toHaveAttribute("aria-pressed", "true");

    // The selected day is an inked COLUMN, not a disc inside the cell: the
    // button itself carries the fill, so the mark runs the full height of the
    // band the way a timetable marks the column you are reading.
    expect(day25Button).toHaveClass("bg-ink");
    expect(day25Button).toHaveClass("text-paper");
    expect(day25Button).toHaveTextContent("25");

    const day24Button = screen.getByRole("button", {
      name: "Monday, August 24, 2026",
    });
    expect(day24Button).toHaveAttribute("aria-pressed", "false");
    expect(day24Button).not.toHaveClass("bg-ink");
  });

  it("marks today with accent text and no filled disc when not selected", () => {
    const onSelectDate = vi.fn();
    // Selected is Monday Aug 24, while today is Tuesday Aug 25
    render(<WeekStrip selectedDate="2026-08-24" onSelectDate={onSelectDate} />);

    // Day 24 is selected: inked column
    const day24Button = screen.getByRole("button", {
      name: "Monday, August 24, 2026",
    });
    expect(day24Button).toHaveClass("bg-ink");
    expect(day24Button).toHaveClass("text-paper");

    // Day 25 is today but not selected: underscored, never a second fill.
    // Two filled things in one strip would be two selections.
    const day25Button = screen.getByRole("button", {
      name: "Tuesday, August 25, 2026",
    });
    expect(day25Button).not.toHaveClass("bg-ink");
    expect(day25Button.querySelector(".border-ink")).not.toBeNull();
    const num25 = day25Button.querySelector(".border-ink");
    expect(num25).toHaveTextContent("25");

    // Day 26 is neither: text-foreground, no fill, no accent text
    const day26Button = screen.getByRole("button", {
      name: "Wednesday, August 26, 2026",
    });
    // An ordinary day carries neither mark: not inked, not underscored.
    expect(day26Button).not.toHaveClass("bg-ink");
    expect(day26Button.querySelector(".border-ink")).toBeNull();
  });

  it("calls onSelectDate with that day's yyyy-MM-dd key when tapped", () => {
    const onSelectDate = vi.fn();
    render(<WeekStrip selectedDate="2026-08-25" onSelectDate={onSelectDate} />);

    const day24Button = screen.getByRole("button", {
      name: "Monday, August 24, 2026",
    });
    fireEvent.click(day24Button);
    expect(onSelectDate).toHaveBeenCalledTimes(1);
    expect(onSelectDate).toHaveBeenCalledWith("2026-08-24");

    const day28Button = screen.getByRole("button", {
      name: "Friday, August 28, 2026",
    });
    fireEvent.click(day28Button);
    expect(onSelectDate).toHaveBeenCalledTimes(2);
    expect(onSelectDate).toHaveBeenCalledWith("2026-08-28");
  });

  it("paging right then left returns to the original week", () => {
    const onSelectDate = vi.fn();
    render(<WeekStrip selectedDate="2026-08-25" onSelectDate={onSelectDate} />);

    // Initial week dates: 23 to 29
    expect(screen.getByRole("button", { name: "Sunday, August 23, 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saturday, August 29, 2026" })).toBeInTheDocument();

    // Page right (Next week)
    const nextButton = screen.getByRole("button", { name: "Next week" });
    fireEvent.click(nextButton);

    // Should now show next week: Aug 30 to Sep 5
    expect(screen.getByRole("button", { name: "Sunday, August 30, 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saturday, September 5, 2026" })).toBeInTheDocument();
    expect(onSelectDate).not.toHaveBeenCalled();

    // Page left (Previous week)
    const prevButton = screen.getByRole("button", { name: "Previous week" });
    fireEvent.click(prevButton);

    // Should return to the original week: Aug 23 to Aug 29
    expect(screen.getByRole("button", { name: "Sunday, August 23, 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saturday, August 29, 2026" })).toBeInTheDocument();
    expect(onSelectDate).not.toHaveBeenCalled();
  });

  it("carries no month caption and no Today button", () => {
    const onSelectDate = vi.fn();
    render(<WeekStrip selectedDate="2026-08-24" onSelectDate={onSelectDate} />);

    // The screen title above already names the day, so a month label under it
    // made the header two competing texts. The dates in the strip say which
    // month it is.
    expect(screen.queryByText(/August 2026/i)).not.toBeInTheDocument();

    // Returning to today is the bottom nav's Today tab, which navigates to bare
    // "/" and clears the date param. A second control for it in here was a
    // duplicate of something more discoverable.
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();

    // Paging still works, from the chevrons that now flank the week.
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByRole("button", { name: "Tuesday, September 1, 2026" })).toBeInTheDocument();
  });
});
