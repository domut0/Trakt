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

    const disc25 = day25Button.querySelector(".bg-accent");
    expect(disc25).not.toBeNull();
    expect(disc25).toHaveTextContent("25");
    expect(disc25).toHaveClass("text-accent-foreground");

    const day24Button = screen.getByRole("button", {
      name: "Monday, August 24, 2026",
    });
    expect(day24Button).toHaveAttribute("aria-pressed", "false");
    const disc24 = day24Button.querySelector(".bg-accent");
    expect(disc24).toBeNull();
  });

  it("marks today with accent text and no filled disc when not selected", () => {
    const onSelectDate = vi.fn();
    // Selected is Monday Aug 24, while today is Tuesday Aug 25
    render(<WeekStrip selectedDate="2026-08-24" onSelectDate={onSelectDate} />);

    // Day 24 is selected: filled accent disc
    const day24Button = screen.getByRole("button", {
      name: "Monday, August 24, 2026",
    });
    const disc24 = day24Button.querySelector(".bg-accent");
    expect(disc24).not.toBeNull();
    expect(disc24).toHaveClass("text-accent-foreground");

    // Day 25 is today, not selected: accent text, no fill
    const day25Button = screen.getByRole("button", {
      name: "Tuesday, August 25, 2026",
    });
    const disc25 = day25Button.querySelector(".bg-accent");
    expect(disc25).toBeNull();
    const num25 = day25Button.querySelector(".text-accent");
    expect(num25).not.toBeNull();
    expect(num25).toHaveTextContent("25");

    // Day 26 is neither: text-foreground, no fill, no accent text
    const day26Button = screen.getByRole("button", {
      name: "Wednesday, August 26, 2026",
    });
    const num26 = day26Button.querySelector(".text-foreground");
    expect(num26).not.toBeNull();
    expect(num26).not.toHaveClass("bg-accent");
    expect(num26).not.toHaveClass("text-accent");
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

  it("shows the Today button when the week or selected date is not today, and clicking it restores today", () => {
    const onSelectDate = vi.fn();
    const { rerender } = render(
      <WeekStrip selectedDate="2026-08-25" onSelectDate={onSelectDate} />,
    );

    // Viewing current week and selectedDate is today: Today button is hidden
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();

    // Case 1: Page to another week while selectedDate is today
    const nextButton = screen.getByRole("button", { name: "Next week" });
    fireEvent.click(nextButton);

    const todayButtonAfterPaging = screen.getByRole("button", { name: "Today" });
    expect(todayButtonAfterPaging).toBeInTheDocument();

    fireEvent.click(todayButtonAfterPaging);
    expect(onSelectDate).toHaveBeenCalledWith("2026-08-25");
    // Strip returns to current week
    expect(screen.getByRole("button", { name: "Tuesday, August 25, 2026" })).toBeInTheDocument();

    // Case 2: In current week, but a different day is selected
    rerender(<WeekStrip selectedDate="2026-08-24" onSelectDate={onSelectDate} />);
    const todayButtonDifferentDate = screen.getByRole("button", { name: "Today" });
    expect(todayButtonDifferentDate).toBeInTheDocument();

    fireEvent.click(todayButtonDifferentDate);
    expect(onSelectDate).toHaveBeenCalledWith("2026-08-25");
  });

  it("displays the month name of the displayed week as a label", () => {
    const onSelectDate = vi.fn();
    render(<WeekStrip selectedDate="2026-08-25" onSelectDate={onSelectDate} />);

    expect(screen.getByText("August 2026")).toBeInTheDocument();

    // Page forward 2 weeks to September
    const nextButton = screen.getByRole("button", { name: "Next week" });
    fireEvent.click(nextButton);
    fireEvent.click(nextButton);

    expect(screen.getByText("September 2026")).toBeInTheDocument();
  });
});
