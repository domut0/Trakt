import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialRail } from "../TutorialRail";
import { useStore } from "../../lib/store";
import { useCoachStore } from "../../lib/coach-store";
import { useSyncStore } from "../../lib/sync-store";
import { useTutorialStore } from "../../lib/tutorial-store";
import { savePendingCoach } from "../../lib/pending-coach";
import { saveTutorialState } from "../../lib/tutorial-state";
import { dayKey } from "../../lib/daily-log";

const navigate = vi.fn();
let pathname = "/";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useRouter: () => ({ navigate }),
    useLocation: () => ({ pathname }),
  };
});

vi.mock("../../lib/install-prompt", async () => {
  const actual = await vi.importActual<typeof import("../../lib/install-prompt")>(
    "../../lib/install-prompt",
  );
  return { ...actual, useInstallMode: () => ({ kind: "unavailable" }) };
});

function runTo(stepId: string) {
  for (let i = 0; i < 40; i++) {
    const { steps, step } = useTutorialStore.getState();
    if (steps[step]?.id === stepId) return;
    useTutorialStore.getState().advance();
  }
  throw new Error(`never reached ${stepId}`);
}

beforeEach(() => {
  navigate.mockClear();
  pathname = "/";
  localStorage.clear();
  useCoachStore.setState({ viewing: undefined });
  useTutorialStore.getState().skip();
  useSyncStore.setState({ config: undefined });
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
  localStorage.clear();
  document.documentElement.style.removeProperty("--rail-h");
});

afterEach(() => {
  useTutorialStore.getState().skip();
});

describe("TutorialRail", () => {
  it("renders nothing and leaves --rail-h at zero while no tutorial is running", () => {
    const { container } = render(<TutorialRail />);
    expect(container).toBeEmptyDOMElement();
    expect(document.documentElement.style.getPropertyValue("--rail-h")).toBe("0px");
  });

  it("says the current step's line, with the coach named", () => {
    savePendingCoach({ name: "Marcus", email: "m@example.com" });
    act(() => {
      useTutorialStore.getState().start({ canInstall: false });
      runTo("share-sheet");
    });

    render(<TutorialRail />);

    expect(screen.getByText(/give Marcus access to it/)).toBeInTheDocument();
  });

  it("falls back to 'your coach' when nobody invited them", () => {
    act(() => {
      useTutorialStore.getState().start({ canInstall: false });
      runTo("share-sheet");
    });

    render(<TutorialRail />);
    expect(screen.getByText(/give your coach access to it/)).toBeInTheDocument();
  });

  it("carries an outlined Show me, and offers Skip only where a step allows it", () => {
    act(() => useTutorialStore.getState().start({ canInstall: false }));
    const { rerender } = render(<TutorialRail />);

    // The sheet step depends on Google, so there is a way past it.
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    const showMe = screen.getByRole("button", { name: "Show me" });
    expect(showMe.className).toContain("border");

    act(() => runTo("log-bodyweight"));
    rerender(<TutorialRail />);

    // Typing your own bodyweight is not something the app can fail at for you.
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
  });

  it("moves past a skippable step when Skip is tapped", () => {
    act(() => useTutorialStore.getState().start({ canInstall: false }));
    render(<TutorialRail />);

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(useTutorialStore.getState().steps[useTutorialStore.getState().step].id).toBe(
      "share-sheet",
    );
  });

  it("asks for the demo again when Show me is tapped", () => {
    const heard = vi.fn();
    window.addEventListener("tutorial-show-me", heard);
    act(() => useTutorialStore.getState().start({ canInstall: false }));
    render(<TutorialRail />);

    fireEvent.click(screen.getByRole("button", { name: "Show me" }));

    expect(heard).toHaveBeenCalled();
    window.removeEventListener("tutorial-show-me", heard);
  });

  it("takes the user to the screen the step happens on", () => {
    act(() => useTutorialStore.getState().start({ canInstall: false }));
    render(<TutorialRail />);

    expect(navigate).toHaveBeenCalledWith({ to: "/settings" });
  });

  it("advances as soon as the thing it asked for has happened", async () => {
    act(() => {
      useTutorialStore.getState().start({ canInstall: false });
      runTo("log-bodyweight");
    });
    render(<TutorialRail />);

    act(() => {
      useStore.setState({ dailyLogs: [{ date: dayKey(new Date()), bodyweight: 180 }] });
    });

    await waitFor(() => {
      expect(useTutorialStore.getState().steps[useTutorialStore.getState().step].id).toBe(
        "start-day",
      );
    });
  });

  it("reserves its own height, so nothing pinned to the bottom is covered", async () => {
    // jsdom lays nothing out, so the rail would measure itself as zero and the
    // reservation would look like it worked while reserving nothing.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 64,
    });

    act(() => useTutorialStore.getState().start({ canInstall: false }));
    const { unmount } = render(<TutorialRail />);

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--rail-h")).toBe("64px");
    });

    // And gives it back, or every screen keeps padding for a rail that is gone.
    unmount();
    expect(document.documentElement.style.getPropertyValue("--rail-h")).toBe("0px");

    if (original) Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
  });

  it("picks an interrupted run back up on its own", async () => {
    saveTutorialState({ joinedAt: 1, startedAt: 2, stepId: "log-bodyweight" });

    render(<TutorialRail />);

    await waitFor(() => {
      expect(useTutorialStore.getState().active).toBe(true);
    });
    expect(useTutorialStore.getState().steps[useTutorialStore.getState().step].id).toBe(
      "log-bodyweight",
    );
  });

  it("leaves a finished run alone", async () => {
    saveTutorialState({ joinedAt: 1, startedAt: 2, doneAt: 3 });

    render(<TutorialRail />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useTutorialStore.getState().active).toBe(false);
  });
});
