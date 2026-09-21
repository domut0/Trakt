import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TutorialSpotlight } from "../TutorialSpotlight";

const planted: HTMLElement[] = [];

/** A real element with a real-looking rect, which jsdom will not give us. */
function plantTarget(marker: string, rect = { top: 200, left: 40, width: 300, height: 48 }) {
  const el = document.createElement("button");
  el.setAttribute("data-tutorial", marker);
  el.textContent = "Add activity";
  el.getBoundingClientRect = () =>
    ({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  el.scrollIntoView = vi.fn();
  document.body.appendChild(el);
  planted.push(el);
  return el;
}

afterEach(() => {
  // Only what this file planted. Clearing the whole body takes the portal
  // container with it, and Testing Library's own cleanup then cannot find it.
  for (const el of planted.splice(0)) el.remove();
});

describe("TutorialSpotlight", () => {
  it("dims nothing while its target is not on screen", async () => {
    render(<TutorialSpotlight target="add-activity" zoomKey={0} />);

    // A tutorial that blacks out the screen because its target has not mounted
    // yet is an app nobody can use.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.querySelectorAll("[data-tutorial-dim]")).toHaveLength(0);
  });

  it("cuts a hole around the target and dims everything else", async () => {
    plantTarget("add-activity");
    render(<TutorialSpotlight target="add-activity" zoomKey={0} />);

    await waitFor(() => {
      expect(document.querySelectorAll("[data-tutorial-dim]")).toHaveLength(4);
    });

    const top = document.querySelector('[data-tutorial-dim="top"]') as HTMLElement;
    const bottom = document.querySelector('[data-tutorial-dim="bottom"]') as HTMLElement;

    // The hole is the gap between the panels: the target's rect plus padding.
    expect(top.style.height).toBe("192px");
    expect(bottom.style.top).toBe("256px");
  });

  it("brings the target on screen, which is what the demo playing below the fold was", async () => {
    const el = plantTarget("add-activity");
    render(<TutorialSpotlight target="add-activity" zoomKey={0} />);

    await waitFor(() => {
      expect(el.scrollIntoView).toHaveBeenCalled();
    });
  });

  it("swallows a tap on the dim, and swallows it silently", async () => {
    plantTarget("add-activity");
    render(<TutorialSpotlight target="add-activity" zoomKey={0} />);

    await waitFor(() => {
      expect(document.querySelectorAll("[data-tutorial-dim]")).toHaveLength(4);
    });

    const top = document.querySelector('[data-tutorial-dim="top"]') as HTMLElement;
    expect(top.style.touchAction).toBe("none");

    // Nothing to announce and nothing to read: a closed door, not an argument.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("follows the target when it moves, without being told", async () => {
    const el = plantTarget("add-activity");
    render(<TutorialSpotlight target="add-activity" zoomKey={0} />);

    await waitFor(() => {
      expect(document.querySelectorAll("[data-tutorial-dim]")).toHaveLength(4);
    });

    // A sheet animating in, a row expanding, the soft keyboard arriving: none
    // of these fire scroll or resize.
    el.getBoundingClientRect = () =>
      ({ top: 400, left: 40, width: 300, height: 48, right: 340, bottom: 448 }) as DOMRect;

    await waitFor(() => {
      const top = document.querySelector('[data-tutorial-dim="top"]') as HTMLElement;
      expect(top.style.height).toBe("392px");
    });
  });
});
