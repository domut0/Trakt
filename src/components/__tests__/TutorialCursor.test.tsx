import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialCursor } from "../TutorialCursor";

describe("TutorialCursor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders nothing when absent", () => {
    const { container } = render(<TutorialCursor target="absent-target" playImmediately />);
    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector('[data-tutorial-cursor="dot"]')).toBeNull();
    expect(document.querySelector('[data-tutorial-cursor="ring"]')).toBeNull();
  });

  it("finds its target by marker and plays the dot animation", () => {
    const button = document.createElement("button");
    button.setAttribute("data-tutorial", "present-target");
    button.getBoundingClientRect = () => ({
      top: 100,
      left: 100,
      width: 120,
      height: 44,
      right: 220,
      bottom: 144,
      x: 100,
      y: 100,
      toJSON: () => {},
    });
    document.body.appendChild(button);

    render(<TutorialCursor target="present-target" playImmediately />);

    const dot = document.querySelector('[data-tutorial-cursor="dot"]');
    expect(dot).not.toBeNull();

    const ripple = document.querySelector('[data-tutorial-cursor="ripple"]');
    expect(ripple).not.toBeNull();
  });

  it("does not play while an input has focus", () => {
    const button = document.createElement("button");
    button.setAttribute("data-tutorial", "present-target");
    document.body.appendChild(button);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    render(<TutorialCursor target="present-target" playImmediately />);

    expect(document.querySelector('[data-tutorial-cursor="dot"]')).toBeNull();
  });

  it("draws a ring and never moves under reduced motion", () => {
    // DEFINED, not spied on. jsdom does not implement matchMedia at all, so
    // vi.spyOn has no function to wrap and throws "can only spy on a function".
    // The same defineProperty shape install-prompt.test.ts uses.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });

    const button = document.createElement("button");
    button.setAttribute("data-tutorial", "present-target");
    button.getBoundingClientRect = () => ({
      top: 100,
      left: 100,
      width: 120,
      height: 44,
      right: 220,
      bottom: 144,
      x: 100,
      y: 100,
      toJSON: () => {},
    });
    document.body.appendChild(button);

    render(<TutorialCursor target="present-target" />);

    // Renders the static ring
    const ring = document.querySelector('[data-tutorial-cursor="ring"]');
    expect(ring).not.toBeNull();

    // No animated dot, no travel
    expect(document.querySelector('[data-tutorial-cursor="dot"]')).toBeNull();
  });
});
