import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialBanner } from "../TutorialBanner";
import { useTutorialStore } from "../../lib/tutorial-store";
import { useCoachStore } from "../../lib/coach-store";
import { useStore, type Exercise, type SplitSlot, type WorkoutSession } from "../../lib/store";
import { AppShell } from "../AppShell";
import { ExerciseScreen } from "../ExerciseScreen";
import { Route as WorkoutRoute } from "../../routes/workout";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useRouter: () => ({ navigate: navigateMock, history: { back: vi.fn() } }),
    useLocation: () => ({ pathname: "/" }),
    Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a {...props}>{children}</a>
    ),
  };
});

const WorkoutPage = WorkoutRoute.options.component!;

const MOCK_EXERCISE: Exercise = { id: "e1", name: "Bench Press", type: "main" };
const MOCK_SLOT: SplitSlot = { id: "s1", name: "Chest", rotationOrder: 0 };
const MOCK_SESSION: WorkoutSession = { id: "sess1", splitSlotId: "s1", startedAt: Date.now() };

beforeEach(() => {
  navigateMock.mockReset();
  useTutorialStore.setState({ active: false, step: 0 });
  useCoachStore.setState({ viewing: undefined });
  useStore.setState({
    hydrated: true,
    unit: "lbs",
    exercises: [MOCK_EXERCISE],
    slots: [MOCK_SLOT],
    sessions: [MOCK_SESSION],
    sets: [],
    dailyLogs: [],
    nutritionPhases: [],
    plannedDays: [],
    activeSessionId: undefined,
  });
});

afterEach(() => {
  useTutorialStore.setState({ active: false, step: 0 });
  vi.restoreAllMocks();
});

describe("TutorialBanner standalone", () => {
  it("renders nothing when inactive", () => {
    useTutorialStore.setState({ active: false });
    const { container } = render(<TutorialBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders tutorial mode and skip action when active", () => {
    useTutorialStore.setState({ active: true });
    render(<TutorialBanner />);

    expect(screen.getByText("Tutorial mode")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skip/ })).toBeInTheDocument();
  });

  it("is in flow, never fixed, to avoid sitting beneath translucent status bars", () => {
    useTutorialStore.setState({ active: true });
    const { container } = render(<TutorialBanner />);
    const banner = container.firstElementChild as HTMLElement;

    expect(banner).not.toBeNull();
    expect(banner.className).toContain("relative");
    expect(banner.className).not.toContain("fixed");
    expect(banner.className).toContain("z-40");
    expect(banner.className).toContain("min-h-[44px]");
    // The safe-area inset is deliberately NOT asserted here. jsdom drops CSS
    // values it cannot parse, and `env()` is one of them, so it is absent from
    // both `style.paddingTop` and the serialised style attribute no matter what
    // the component sets - any assertion on it can only ever fail. Being in
    // flow rather than fixed is the claim that matters and the one jsdom can
    // actually see. The inset is the same one ClientBanner uses, and it is the
    // kind of thing a screenshot catches and a unit test cannot.
  });

  it("exits with no confirmation, calls skip(), and navigates to /", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    useTutorialStore.setState({ active: true });

    render(<TutorialBanner />);
    const skipButton = screen.getByRole("button", { name: /Skip/ });
    fireEvent.click(skipButton);

    // No confirmation prompt: skip does not argue with the user
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(useTutorialStore.getState().active).toBe(false);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
  });
});

describe("TutorialBanner mount points", () => {
  it("mounts in AppShell and takes highest priority over coach and active-session banners", () => {
    useStore.setState({ activeSessionId: "sess1" });
    useCoachStore.setState({
      viewing: {
        client: { id: "c1", name: "Client A", kind: "appsScript" },
        pulledAt: Date.now(),
      },
    });

    // 1. When tutorial is active, TutorialBanner wins
    useTutorialStore.setState({ active: true });
    const { rerender } = render(
      <AppShell>
        <div>Content</div>
      </AppShell>,
    );
    expect(screen.getByText("Tutorial mode")).toBeInTheDocument();
    expect(screen.queryByText(/Client A’s Trakt/)).not.toBeInTheDocument();

    // 2. When tutorial is inactive, ClientBanner takes next priority
    useTutorialStore.setState({ active: false });
    rerender(
      <AppShell>
        <div>Content</div>
      </AppShell>,
    );
    expect(screen.queryByText("Tutorial mode")).not.toBeInTheDocument();
    expect(screen.getByText(/Client A’s Trakt/)).toBeInTheDocument();

    // 3. When coach view exits, ActiveSessionBanner appears
    useCoachStore.setState({ viewing: undefined });
    rerender(
      <AppShell>
        <div>Content</div>
      </AppShell>,
    );
    expect(screen.getByText(/Workout in progress/)).toBeInTheDocument();
  });

  it("mounts in workout.tsx as the first child of the outer flex column", () => {
    useStore.setState({ activeSessionId: "sess1" });

    // Inactive tutorial: banner is not rendered
    useTutorialStore.setState({ active: false });
    const { rerender } = render(<WorkoutPage />);
    expect(screen.queryByText("Tutorial mode")).not.toBeInTheDocument();

    // Active tutorial: banner is rendered
    useTutorialStore.setState({ active: true });
    rerender(<WorkoutPage />);
    expect(screen.getByText("Tutorial mode")).toBeInTheDocument();
  });

  it("mounts in ExerciseScreen as the first child of the inner flex column", () => {
    useStore.setState({ activeSessionId: "sess1", currentExerciseId: "e1" });

    // Inactive tutorial: banner is not rendered
    useTutorialStore.setState({ active: false });
    const { rerender } = render(
      <ExerciseScreen exerciseId="e1" stopwatch="1:00" onDone={() => {}} />,
    );
    expect(screen.queryByText("Tutorial mode")).not.toBeInTheDocument();

    // Active tutorial: banner is rendered inside the portal
    useTutorialStore.setState({ active: true });
    rerender(<ExerciseScreen exerciseId="e1" stopwatch="1:00" onDone={() => {}} />);
    expect(screen.getByText("Tutorial mode")).toBeInTheDocument();
  });
});
