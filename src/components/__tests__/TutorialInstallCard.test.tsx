import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialInstallCard } from "../TutorialInstallCard";
import { useTutorialStore } from "../../lib/tutorial-store";
import { TUTORIAL_STEPS } from "../../lib/tutorial";

/**
 * The card that offers the install, and the one step it belongs to.
 *
 * The home-screen chapter holds TWO steps: the one that asks a phone to
 * install, and the one that tells a browser which cannot install to go and
 * open the link on a phone. This card answers only the first. Rendering it for
 * the chapter meant the second step showed a row reading "Share, then Add to
 * Home Screen" on a laptop, and tapping it opened the iOS walkthrough there.
 */

vi.mock("../../lib/install-prompt", async () => {
  const actual = await vi.importActual<typeof import("../../lib/install-prompt")>(
    "../../lib/install-prompt",
  );
  return { ...actual, useInstallMode: () => ({ kind: "manual-ios" }) };
});

function showStep(id: string) {
  const step = TUTORIAL_STEPS.findIndex((s) => s.id === id);
  if (step < 0) throw new Error(`no step ${id}`);
  useTutorialStore.setState({ active: true, steps: TUTORIAL_STEPS, step });
}

beforeEach(() => {
  localStorage.clear();
  useTutorialStore.setState({ active: false, steps: [], step: 0 });
});

afterEach(() => {
  cleanup();
  useTutorialStore.setState({ active: false, steps: [], step: 0 });
});

describe("TutorialInstallCard", () => {
  it("offers the install on the step that asks for it", () => {
    showStep("install");
    render(<TutorialInstallCard />);
    expect(screen.getByText("Add Trakt to your home screen")).toBeInTheDocument();
  });

  it("renders nothing on the step for a browser that cannot install", () => {
    showStep("install-elsewhere");
    const { container } = render(<TutorialInstallCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing outside the tutorial", () => {
    const { container } = render(<TutorialInstallCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
