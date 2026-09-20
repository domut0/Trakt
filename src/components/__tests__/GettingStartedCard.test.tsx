import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GettingStartedCard } from "../GettingStartedCard";
import { useSyncStore } from "../../lib/sync-store";
import { useTutorialStore } from "../../lib/tutorial-store";
import type { SyncConfigMeta } from "../../lib/db";
import * as installPrompt from "../../lib/install-prompt";
import * as tutorialState from "../../lib/tutorial-state";
import * as pendingCoach from "../../lib/pending-coach";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useRouter: () => ({ navigate: navigateMock, history: { back: vi.fn() } }),
  };
});

const GOOGLE_CONFIG: SyncConfigMeta = {
  key: "syncConfig",
  kind: "google",
  spreadsheetId: "sheet-123",
  url: "https://script.google.com/macros/s/xyz/exec",
  secret: "secret-123",
  deviceId: "device-123",
  enabled: true,
  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-123",
};

describe("GettingStartedCard", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    localStorage.clear();
    useTutorialStore.setState({ active: false, step: 0 });
    useSyncStore.setState({
      config: undefined,
      status: "off",
      pending: false,
    });
    vi.spyOn(installPrompt, "useInstallMode").mockReturnValue({ kind: "prompt" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("each row's done-state resolves from the right source", () => {
    it("resolves row 1 done-state from installed mode or installedSeen", () => {
      // Not installed initially
      const { rerender } = render(<GettingStartedCard />);
      const row1 = screen.getByText("Add Trakt to your home screen").closest("button")!;
      expect(row1).toHaveAttribute("data-done", "false");

      // Set mode to installed
      vi.spyOn(installPrompt, "useInstallMode").mockReturnValue({ kind: "installed" });
      rerender(<GettingStartedCard />);
      expect(row1).toHaveAttribute("data-done", "true");

      // Alternatively, installedSeen in tutorialState
      vi.spyOn(installPrompt, "useInstallMode").mockReturnValue({ kind: "prompt" });
      tutorialState.saveTutorialState({ joinedAt: Date.now(), installedSeen: true });
      rerender(<GettingStartedCard />);
      expect(row1).toHaveAttribute("data-done", "true");
    });

    it("resolves row 2 done-state from useSyncStore config kind google and spreadsheetId", () => {
      const { rerender } = render(<GettingStartedCard />);
      const row2 = screen.getByText("Connect a Google Sheet").closest("button")!;
      expect(row2).toHaveAttribute("data-done", "false");

      // Google config with spreadsheetId
      useSyncStore.setState({ config: GOOGLE_CONFIG });
      rerender(<GettingStartedCard />);
      expect(row2).toHaveAttribute("data-done", "true");
    });

    it("resolves row 3 done-state from loadPendingCoach sharedAt", () => {
      pendingCoach.savePendingCoach({ name: "Dave", email: "dave@example.com" });
      const { rerender } = render(<GettingStartedCard />);
      const row3 = screen.getByText("Share it with Dave").closest("button")!;
      expect(row3).toHaveAttribute("data-done", "false");

      // Mark shared
      pendingCoach.savePendingCoach({
        name: "Dave",
        email: "dave@example.com",
        sharedAt: Date.now(),
      });
      rerender(<GettingStartedCard />);
      expect(row3).toHaveAttribute("data-done", "true");
    });

    it("resolves row 4 done-state from loadTutorialState doneAt", () => {
      // Row 2 and 3 done to unlock row 4
      useSyncStore.setState({ config: GOOGLE_CONFIG });
      pendingCoach.savePendingCoach({ name: "Dave", sharedAt: Date.now() });

      const { rerender } = render(<GettingStartedCard />);
      const row4 = screen.getByText("Try a tutorial workout").closest("button")!;
      expect(row4).toHaveAttribute("data-done", "false");

      // Mark tutorial done
      tutorialState.saveTutorialState({ joinedAt: Date.now(), doneAt: Date.now() });
      rerender(<GettingStartedCard />);
      // Note: when row 4 is done on Today, the card disappears if all are done,
      // but if checked on join surface, row 4 is marked done:
      rerender(<GettingStartedCard surface="join" />);
      const row4OnJoin = screen.getByText("Try a tutorial workout").closest("button")!;
      expect(row4OnJoin).toHaveAttribute("data-done", "true");
    });
  });

  describe("row 4 locking behavior", () => {
    it("is inert while locked, and live once rows 2 and 3 are done", () => {
      const startSpy = vi.spyOn(useTutorialStore.getState(), "start");

      // Neither 2 nor 3 are done
      render(<GettingStartedCard />);
      const row4 = screen.getByText("Try a tutorial workout").closest("button")!;
      expect(row4).toHaveAttribute("data-locked", "true");
      expect(row4).toBeDisabled();

      // Clicking while locked does nothing
      fireEvent.click(row4);
      expect(startSpy).not.toHaveBeenCalled();
      expect(navigateMock).not.toHaveBeenCalled();

      // Complete row 2 only
      useSyncStore.setState({ config: GOOGLE_CONFIG });
      fireEvent.click(row4);
      expect(startSpy).not.toHaveBeenCalled();
    });

    it("unlocks and starts tutorial once rows 2 and 3 are done", () => {
      const startSpy = vi.spyOn(useTutorialStore.getState(), "start").mockReturnValue(true);

      // Complete rows 2 and 3
      useSyncStore.setState({ config: GOOGLE_CONFIG });
      pendingCoach.savePendingCoach({ name: "Dave", sharedAt: Date.now() });

      render(<GettingStartedCard />);
      const row4 = screen.getByText("Try a tutorial workout").closest("button")!;
      expect(row4).toHaveAttribute("data-locked", "false");
      expect(row4).not.toBeDisabled();

      fireEvent.click(row4);
      expect(startSpy).toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
    });
  });

  describe("visibility and dismissal", () => {
    it("hides row 1 when installMode is unavailable", () => {
      vi.spyOn(installPrompt, "useInstallMode").mockReturnValue({ kind: "unavailable" });
      render(<GettingStartedCard />);
      expect(screen.queryByText("Add Trakt to your home screen")).not.toBeInTheDocument();
      expect(screen.getByText("Connect a Google Sheet")).toBeInTheDocument();
    });

    it("disappears once dismissed, and stays gone across a remount", () => {
      const { unmount } = render(<GettingStartedCard />);
      expect(screen.getByText("Getting started")).toBeInTheDocument();

      const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
      fireEvent.click(dismissBtn);

      // Card disappears immediately
      expect(screen.queryByText("Getting started")).not.toBeInTheDocument();
      expect(tutorialState.loadTutorialState()?.cardDismissedAt).toBeTypeOf("number");

      unmount();

      // Remount check: stays gone
      render(<GettingStartedCard />);
      expect(screen.queryByText("Getting started")).not.toBeInTheDocument();
    });

    it("disappears once all rows are done on Today", () => {
      vi.spyOn(installPrompt, "useInstallMode").mockReturnValue({ kind: "installed" });
      useSyncStore.setState({ config: GOOGLE_CONFIG });
      pendingCoach.savePendingCoach({ name: "Dave", sharedAt: Date.now() });
      tutorialState.saveTutorialState({ joinedAt: Date.now(), doneAt: Date.now() });

      const { container } = render(<GettingStartedCard />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("join surface Continue button", () => {
    it("fires the install prompt while row 1 is the first one outstanding", () => {
      const promptSpy = vi.spyOn(installPrompt, "promptInstall").mockResolvedValue(true);
      render(<GettingStartedCard surface="join" />);

      fireEvent.click(screen.getByRole("button", { name: /continue/i }));
      expect(promptSpy).toHaveBeenCalled();
    });

    it("goes to Settings once row 1 is done and row 2 is the first outstanding", () => {
      // RENDERED FRESH with the new mode, not re-mocked under a mounted
      // component. Changing a spy's return value does not re-render React, so
      // the mounted copy goes on reading the value it captured and the click
      // takes the row 1 branch forever.
      vi.spyOn(installPrompt, "useInstallMode").mockReturnValue({ kind: "installed" });
      render(<GettingStartedCard surface="join" />);

      fireEvent.click(screen.getByRole("button", { name: /continue/i }));
      expect(navigateMock).toHaveBeenCalledWith({ to: "/settings" });
    });
  });
});

describe("GettingStartedCard accessibility", () => {
  it("announces a locked row rather than only dimming it", () => {
    // The dimming is a visual mark, which this app requires, but on its own it
    // says nothing to a screen reader. The row is reachable and readable while
    // locked on purpose: it is the thing you are working towards.
    render(<GettingStartedCard surface="today" />);
    const row4 = screen.getByText("Try a tutorial workout").closest("button")!;
    expect(row4).toHaveAttribute("data-locked", "true");
    expect(row4).toHaveAttribute("aria-disabled", "true");
  });
});
