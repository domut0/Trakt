import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TutorialSpotlight } from "../TutorialSpotlight";

const planted: HTMLElement[] = [];

/**
 * A scroller around the target, so the spotlight has something to scroll.
 *
 * The app shell scrolls its own <main> and never the document, which is why
 * window.scrollBy is the wrong instrument in the one place this matters.
 */
function plantScroller() {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2000 });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 600 });
  scroller.scrollBy = vi.fn();
  document.body.appendChild(scroller);
  planted.push(scroller);
  return scroller;
}

/** A real element with a real-looking rect, which jsdom will not give us. */
function plantTarget(
  marker: string,
  rect = { top: 200, left: 40, width: 300, height: 48 },
  parent?: HTMLElement,
) {
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
  (parent ?? document.body).appendChild(el);
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

  it("scrolls a target below the fold into view, because nothing else can", async () => {
    // Scrolling is locked while the spotlight is up, so a control under the
    // fold is a step nobody can finish. This is what "Start Tutorial day" was.
    const scroller = plantScroller();
    plantTarget("start-planned", { top: 1400, left: 40, width: 300, height: 48 }, scroller);

    render(<TutorialSpotlight target="start-planned" zoomKey={0} />);

    await waitFor(() => {
      expect(scroller.scrollBy).toHaveBeenCalled();
    });
    const [{ top }] = (scroller.scrollBy as unknown as { mock: { calls: [{ top: number }][] } })
      .mock.calls[0];
    // Downward, and by roughly the distance that centres it.
    expect(top).toBeGreaterThan(500);
  });

  it("leaves a target that is already in view alone", async () => {
    const scroller = plantScroller();
    plantTarget("add-activity", { top: 300, left: 40, width: 300, height: 48 }, scroller);

    render(<TutorialSpotlight target="add-activity" zoomKey={0} />);

    await waitFor(() => {
      expect(document.querySelectorAll("[data-tutorial-dim]")).toHaveLength(4);
    });
    expect(scroller.scrollBy).not.toHaveBeenCalled();
  });

  it("keeps asking until it arrives, for a target that mounts late", async () => {
    // The sandbox is still swapping in when its step begins, so a single
    // scroll on arrival is aimed at nothing.
    const scroller = plantScroller();
    render(<TutorialSpotlight target="late-target" zoomKey={0} />);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(scroller.scrollBy).not.toHaveBeenCalled();

    plantTarget("late-target", { top: 1400, left: 40, width: 300, height: 48 }, scroller);

    await waitFor(() => {
      expect(scroller.scrollBy).toHaveBeenCalled();
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
