import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route as ChartsRoute } from "../charts";
import { Route as HistoryRoute } from "../history";
import { useStore } from "../../lib/store";

let mockCanGoBack = true;
const mockBack = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useRouter: () => ({
      history: { back: mockBack },
      navigate: mockNavigate,
    }),
    useCanGoBack: () => mockCanGoBack,
    useLocation: () => ({ pathname: "/charts" }),
    Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a {...props}>{children}</a>
    ),
  };
});

describe("Back button on Charts and History", () => {
  beforeEach(() => {
    mockCanGoBack = true;
    mockBack.mockClear();
    mockNavigate.mockClear();
    useStore.setState({
      hydrated: true,
      dailyLogs: [],
      sessions: [],
      slots: [],
      exercises: [],
      sets: [],
    });
  });

  it("renders Back button in Charts and calls history.back() when canGoBack is true", () => {
    const Component = ChartsRoute.options.component!;
    render(<Component />);

    const backBtn = screen.getByRole("button", { name: "Back" });
    expect(backBtn).toBeInTheDocument();
    expect(backBtn).toHaveClass("-my-[11px]", "min-h-[44px]", "t-action");

    fireEvent.click(backBtn);
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("navigates to / in Charts when canGoBack is false", () => {
    mockCanGoBack = false;
    const Component = ChartsRoute.options.component!;
    render(<Component />);

    const backBtn = screen.getByRole("button", { name: "Back" });
    fireEvent.click(backBtn);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("renders Back button in History and calls history.back() when canGoBack is true", () => {
    const Component = HistoryRoute.options.component!;
    render(<Component />);

    const backBtn = screen.getByRole("button", { name: "Back" });
    expect(backBtn).toBeInTheDocument();
    expect(backBtn).toHaveClass("-my-[11px]", "min-h-[44px]", "t-action");

    fireEvent.click(backBtn);
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("navigates to / in History when canGoBack is false", () => {
    mockCanGoBack = false;
    const Component = HistoryRoute.options.component!;
    render(<Component />);

    const backBtn = screen.getByRole("button", { name: "Back" });
    fireEvent.click(backBtn);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });
});
