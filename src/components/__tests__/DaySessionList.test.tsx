import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DaySessionList } from "../DaySessionList";
import { dayKey } from "../../lib/daily-log";
import { useStore } from "../../lib/store";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a {...props}>{children}</a>
    ),
  };
});

const today = dayKey(new Date());
const at = (hour: number) => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};

describe("DaySessionList", () => {
  beforeEach(() => {
    useStore.setState({
      hydrated: true,
      sessions: [],
      slots: [{ id: "upper", name: "Upper", rotationOrder: 0 }],
      exercises: [
        { id: "bench", name: "Bench Press", type: "main" },
        { id: "tread", name: "Treadmill", type: "cardio" },
      ],
      sets: [],
      dailyLogs: [],
      unit: "lbs",
    });
  });

  it("renders nothing on a day with nothing logged", () => {
    const { container } = render(<DaySessionList date={today} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names a strength session after its card and counts its sets", () => {
    useStore.setState({
      sessions: [{ id: "s1", splitSlotId: "upper", startedAt: at(9), endedAt: at(10) }],
      sets: [
        { id: "x1", sessionId: "s1", exerciseId: "bench", weight: 135, reps: 8, loggedAt: at(9) },
        { id: "x2", sessionId: "s1", exerciseId: "bench", weight: 135, reps: 8, loggedAt: at(9) },
      ],
    });

    render(<DaySessionList date={today} />);

    expect(screen.getByText("Upper")).toBeInTheDocument();
    expect(screen.getByText("· 2 sets")).toBeInTheDocument();
  });

  it("names a cardio session after its activity and shows its duration", () => {
    useStore.setState({
      sessions: [
        {
          id: "c1",
          kind: "cardio",
          cardioExerciseId: "tread",
          durationMinutes: 20,
          distance: 2,
          startedAt: at(7),
          endedAt: at(7),
        },
      ],
    });

    render(<DaySessionList date={today} />);

    expect(screen.getByText("Treadmill")).toBeInTheDocument();
    expect(screen.getByText("· 20 min · 2 mi")).toBeInTheDocument();
  });

  it("leaves out a session that has not ended, and one on another day", () => {
    useStore.setState({
      sessions: [
        { id: "running", splitSlotId: "upper", startedAt: at(9) },
        {
          id: "yesterday",
          splitSlotId: "upper",
          startedAt: at(9) - 86_400_000,
          endedAt: at(10) - 86_400_000,
        },
      ],
    });

    const { container } = render(<DaySessionList date={today} />);
    expect(container).toBeEmptyDOMElement();
  });
});
