import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GettingStartedCard } from "../GettingStartedCard";
import { useStore } from "../../lib/store";
import { useCoachStore } from "../../lib/coach-store";
import { useTutorialStore } from "../../lib/tutorial-store";
import { loadTutorialState, saveTutorialState } from "../../lib/tutorial-state";
import { dayKey } from "../../lib/daily-log";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, useRouter: () => ({ navigate }) };
});

vi.mock("../../lib/install-prompt", async () => {
  const actual = await vi.importActual<typeof import("../../lib/install-prompt")>(
    "../../lib/install-prompt",
  );
  return { ...actual, useInstallMode: () => ({ kind: "unavailable" }) };
});

const today = dayKey(new Date());

beforeEach(() => {
  navigate.mockClear();
  localStorage.clear();
  useCoachStore.setState({ viewing: undefined });
  useTutorialStore.getState().skip();
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
  });
  localStorage.clear();
});

afterEach(() => {
  // Restored here rather than at the end of the one test that fakes them: a
  // failure before that line left every later test waiting on a clock that
  // never moves.
  vi.useRealTimers();
  useTutorialStore.getState().skip();
});

describe("the three tasks", () => {
  it("names them, and nothing else", () => {
    render(<GettingStartedCard />);

    expect(screen.getByText("Complete the tutorial")).toBeInTheDocument();
    expect(screen.getByText("Log a day's nutrition")).toBeInTheDocument();
    expect(screen.getByText("Log a day's steps")).toBeInTheDocument();
    // The sheet and the share are the tutorial's job now, not the card's.
    expect(screen.queryByText(/Google Sheet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/home screen/)).not.toBeInTheDocument();
  });

  it("counts nothing done on a fresh install", () => {
    render(<GettingStartedCard />);
    expect(screen.getByRole("img", { name: "0 of 3 tasks complete" })).toBeInTheDocument();
    expect(screen.queryAllByTestId("status-met")).toHaveLength(0);
  });

  it("ticks the tutorial from the record of having finished it", () => {
    saveTutorialState({ joinedAt: 1, doneAt: 2 });
    render(<GettingStartedCard />);

    expect(screen.getByText("Tutorial done")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 of 3 tasks complete" })).toBeInTheDocument();
  });

  it("ticks nutrition from any macro on any day, not only from calories", () => {
    useStore.setState({ dailyLogs: [{ date: "2026-01-04", protein: 180 }] });
    render(<GettingStartedCard />);

    expect(screen.getByRole("img", { name: "1 of 3 tasks complete" })).toBeInTheDocument();
  });

  it("ticks steps from a step count, including a real zero", () => {
    useStore.setState({ dailyLogs: [{ date: today, steps: 0 }] });
    render(<GettingStartedCard />);

    expect(screen.getByRole("img", { name: "1 of 3 tasks complete" })).toBeInTheDocument();
  });
});

describe("what a row does", () => {
  it("starts the tutorial from the first row", () => {
    render(<GettingStartedCard />);

    fireEvent.click(screen.getByText("Complete the tutorial"));

    expect(useTutorialStore.getState().active).toBe(true);
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("picks an interrupted tutorial up rather than starting it again", () => {
    saveTutorialState({ joinedAt: 1, startedAt: 2, stepId: "log-bodyweight" });
    render(<GettingStartedCard />);

    fireEvent.click(screen.getByText("Complete the tutorial"));

    const { steps, step } = useTutorialStore.getState();
    expect(steps[step].id).toBe("log-bodyweight");
  });

  it("does not restart a tutorial that is already finished", () => {
    saveTutorialState({ joinedAt: 1, doneAt: 2 });
    render(<GettingStartedCard />);

    fireEvent.click(screen.getByText("Tutorial done"));

    expect(useTutorialStore.getState().active).toBe(false);
  });

  it("sends the other two rows to the field they are about", () => {
    render(<GettingStartedCard />);

    fireEvent.click(screen.getByText("Log a day's nutrition"));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });

    fireEvent.click(screen.getByText("Log a day's steps"));
    expect(navigate).toHaveBeenCalledTimes(2);
  });
});

describe("leaving", () => {
  it("goes when dismissed, and stays gone across a remount", () => {
    const { unmount } = render(<GettingStartedCard />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Complete the tutorial")).not.toBeInTheDocument();

    unmount();
    render(<GettingStartedCard />);
    expect(screen.queryByText("Complete the tutorial")).not.toBeInTheDocument();
  });

  it("removes itself once every task is done, and records that it has", async () => {
    vi.useFakeTimers();
    saveTutorialState({ joinedAt: 1, doneAt: 2 });
    useStore.setState({ dailyLogs: [{ date: today, calories: 2400, steps: 9000 }] });

    render(<GettingStartedCard />);
    expect(screen.getByRole("img", { name: "All tasks complete" })).toBeInTheDocument();
    // It holds first. A card that vanishes on the same frame as the last tick
    // never shows the thing it was counting towards.
    expect(screen.getByText("All set")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(screen.queryByText("All set")).not.toBeInTheDocument();
    expect(loadTutorialState()?.cardDismissedAt).toBeTypeOf("number");
  });

  it("offers no Dismiss once it is about to leave on its own", () => {
    saveTutorialState({ joinedAt: 1, doneAt: 2 });
    useStore.setState({ dailyLogs: [{ date: today, calories: 2400, steps: 9000 }] });

    render(<GettingStartedCard />);
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });
});

describe("the join surface", () => {
  it("shows the same three tasks with no way to dismiss them", () => {
    render(<GettingStartedCard surface="join" />);

    expect(screen.getByText("Complete the tutorial")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("stays put on /join even when everything is already done", async () => {
    // Otherwise re-opening an invite plays a farewell animation on a screen the
    // card has not arrived at yet.
    saveTutorialState({ joinedAt: 1, doneAt: 2 });
    useStore.setState({ dailyLogs: [{ date: today, calories: 2400, steps: 9000 }] });

    render(<GettingStartedCard surface="join" />);

    await waitFor(() => {
      expect(screen.getByText("Log a day's steps")).toBeInTheDocument();
    });
    expect(loadTutorialState()?.cardDismissedAt).toBeUndefined();
  });
});
