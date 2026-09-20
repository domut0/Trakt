import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InstallWalkthrough } from "../InstallWalkthrough";

describe("InstallWalkthrough", () => {
  it("renders all four frames and is dismissable", () => {
    const onClose = vi.fn();
    render(<InstallWalkthrough onClose={onClose} />);

    // Renders dialog modal
    expect(screen.getByRole("dialog", { name: "Add to Home Screen" })).toBeInTheDocument();

    // Renders all four step instructions verbatim
    expect(screen.getByText("Tap the Share button")).toBeInTheDocument();
    expect(screen.getByText("Scroll down the list")).toBeInTheDocument();
    expect(screen.getByText("Tap Add to Home Screen")).toBeInTheDocument();
    expect(screen.getByText("Tap Add, top right")).toBeInTheDocument();

    // Renders all four schematic SVG assets
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(4);
    expect(images[0]).toHaveAttribute("src", "/install/ios-1.svg");
    expect(images[1]).toHaveAttribute("src", "/install/ios-2.svg");
    expect(images[2]).toHaveAttribute("src", "/install/ios-3.svg");
    expect(images[3]).toHaveAttribute("src", "/install/ios-4.svg");

    // Dismissable via Close button in header
    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Dismissable via Done button in footer
    const doneBtn = screen.getByRole("button", { name: "Done" });
    fireEvent.click(doneBtn);
    expect(onClose).toHaveBeenCalledTimes(2);

    // Dismissable via Escape key
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
