import { fireEvent, render, screen } from "@testing-library/react";
import { format, startOfMonth } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarView } from "../CalendarView";
import { dayKey } from "../../lib/daily-log";
import { useStore } from "../../lib/store";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useRouter: () => ({ navigate: vi.fn(), history: { back: vi.fn() } }),
    Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a {...props}>{children}</a>
    ),
  };
});

describe("CalendarView Today control", () => {
  beforeEach(() => {
    useStore.setState({
      hydrated: true,
      sessions: [],
      dailyLogs: [],
      slots: [],
      exercises: [],
      sets: [],
    });
  });

  it("does not render the Today button when on the current month and today is selected", () => {
    render(<CalendarView />);
    // On first load with no past sessions, today is selected and viewedMonth is current month
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
  });

  it("renders the Today button when stepped to a previous month and returns when tapped", () => {
    render(<CalendarView />);

    const currentMonthLabel = format(startOfMonth(new Date()), "MMMM yyyy");
    expect(screen.getByText(currentMonthLabel)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();

    // Step back to the previous month
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));

    // Month label should have updated and Today button is now visible
    expect(screen.queryByText(currentMonthLabel)).not.toBeInTheDocument();
    const todayBtn = screen.getByRole("button", { name: "Today" });
    expect(todayBtn).toBeInTheDocument();

    // Clicking Today returns viewedMonth to the current month and selects today
    fireEvent.click(todayBtn);

    expect(screen.getByText(currentMonthLabel)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();

    // Today's day cell should be selected
    const todayCell = screen.getByRole("button", {
      name: new RegExp(`^${format(new Date(), "EEEE, MMMM d")}:`),
    });
    expect(todayCell).toHaveAttribute("aria-pressed", "true");
  });

  it("renders the Today button when a non-today cell is selected and returns when tapped", () => {
    // Pick another day in the same month that is not today
    const now = new Date();
    const otherDay =
      now.getDate() > 1
        ? new Date(now.getFullYear(), now.getMonth(), 1)
        : new Date(now.getFullYear(), now.getMonth(), 2);

    render(<CalendarView />);
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();

    const otherCell = screen.getByRole("button", {
      name: new RegExp(`^${format(otherDay, "EEEE, MMMM d")}:`),
    });
    fireEvent.click(otherCell);

    expect(otherCell).toHaveAttribute("aria-pressed", "true");
    const todayBtn = screen.getByRole("button", { name: "Today" });
    expect(todayBtn).toBeInTheDocument();

    fireEvent.click(todayBtn);

    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
    const todayCell = screen.getByRole("button", {
      name: new RegExp(`^${format(now, "EEEE, MMMM d")}:`),
    });
    expect(todayCell).toHaveAttribute("aria-pressed", "true");
  });
});
