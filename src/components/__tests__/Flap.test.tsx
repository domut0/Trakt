import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Flap } from "../Flap";

/**
 * The app's one authored motion. What matters is WHEN it fires, because the
 * failure mode is not that it looks wrong, it is that it fires on mount and
 * turns a confirmation into a page-load animation.
 */
describe("Flap", () => {
  it("does not animate on first render", () => {
    render(
      <Flap value={2180}>
        <span data-testid="figure">2,180</span>
      </Flap>,
    );

    const wrapper = screen.getByTestId("figure").parentElement;
    expect(wrapper).not.toHaveClass("anim-flap");
    // The wrapper is present from the very first render even without the
    // animation, so switching it on later cannot shift the layout under it.
    expect(wrapper).toHaveClass("inline-block");
  });

  it("animates once the value changes", () => {
    const { rerender } = render(
      <Flap value={2180}>
        <span data-testid="figure">2,180</span>
      </Flap>,
    );

    rerender(
      <Flap value={2400}>
        <span data-testid="figure">2,400</span>
      </Flap>,
    );

    expect(screen.getByTestId("figure").parentElement).toHaveClass("anim-flap");
  });

  it("does not animate when a re-render leaves the value alone", () => {
    const { rerender } = render(
      <Flap value={2180}>
        <span data-testid="figure">2,180</span>
      </Flap>,
    );

    // Same value, new element: a parent re-rendering for its own reasons must
    // not read as the user having logged something.
    rerender(
      <Flap value={2180}>
        <span data-testid="figure">2,180</span>
      </Flap>,
    );

    expect(screen.getByTestId("figure").parentElement).not.toHaveClass("anim-flap");
  });
});
