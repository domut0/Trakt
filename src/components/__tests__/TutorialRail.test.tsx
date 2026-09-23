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

/** A build that can sign in, and a sheet that exists to be shared. */
const CONNECTED = {
  key: "syncConfig" as const,
  kind: "google" as const,
  spreadsheetId: "sheet_1",
  url: "",
  secret: "",
  deviceId: "device_1",
  enabled: true,
};

beforeEach(() => {
  // Without a client id the sheet step is unreachable and the rail passes
  // straight over it, which is exactly what it should do - and not what these
  // tests are about.
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
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
  vi.unstubAllEnvs();
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
    useSyncStore.setState({ config: CONNECTED });
    act(() => {
      useTutorialStore.getState().start({ canInstall: false });
      runTo("share-sheet");
    });

    render(<TutorialRail />);

    expect(screen.getByText("Share it with Marcus.")).toBeInTheDocument();
  });

  it("falls back to 'your coach' when nobody invited them", () => {
    useSyncStore.setState({ config: CONNECTED });
    act(() => {
      useTutorialStore.getState().start({ canInstall: false });
      runTo("share-sheet");
    });

    render(<TutorialRail />);
    expect(screen.getByText("Share it with your coach.")).toBeInTheDocument();
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

  it("moves past a skipped step, and past the one that step made impossible", () => {
    // Skipping the sheet means there is no sheet to share, and Settings
    // renders no share control without one. Stopping there to say "share it
    // with Marcus" would be the rail describing a screen that is not there.
    act(() => {
      useTutorialStore.getState().start({ canInstall: false });
      // Past "open Settings", which is where a run starts.
      useTutorialStore.getState().skipStep();
    });
    render(<TutorialRail />);

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(useTutorialStore.getState().steps[useTutorialStore.getState().step].id).toBe(
      "log-bodyweight",
    );
  });

  it("leaves the trip to Settings to the user, because a gear tapped once is found again", () => {
    act(() => useTutorialStore.getState().start({ canInstall: false }));
    render(<TutorialRail />);

    expect(
      screen.getByText("Your numbers go to a Google Sheet. Open Settings."),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
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
    act(() => {
      useTutorialStore.getState().start({ canInstall: false });
      // On the Connect step, which belongs on Settings, from Today.
      useTutorialStore.getState().skipStep();
    });
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
