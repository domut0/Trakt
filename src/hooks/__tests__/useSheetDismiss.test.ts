import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSheetDismiss } from "../useSheetDismiss";

/**
 * The stack behaviour is the part worth testing: it is where a per-component
 * effect would have been wrong, and it is observable through nothing but
 * document.body.style.overflow and a keydown. Layout, animation and the drag
 * handling in the sheets themselves are left to manual QA - a jsdom harness has
 * no viewport to be wrong about.
 */

/** Escape as the browser delivers it: cancelable, so preventDefault means something. */
function pressEscape(init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, ...init });
  document.dispatchEvent(event);
  return event;
}

afterEach(() => {
  // Every test unmounts its own hooks, so the stack is already empty; this only
  // stops a failed assertion mid-test from leaking a lock into the next one.
  document.body.style.overflow = "";
});

describe("useSheetDismiss scroll lock", () => {
  it("locks body scrolling while open and unlocks on close", () => {
    const { rerender, unmount } = renderHook(({ open }) => useSheetDismiss(open, () => {}), {
      initialProps: { open: false },
    });
    expect(document.body.style.overflow).toBe("");

    rerender({ open: true });
    expect(document.body.style.overflow).toBe("hidden");

    rerender({ open: false });
    expect(document.body.style.overflow).toBe("");
    unmount();
  });

  it("releases the lock when an open sheet unmounts without closing first", () => {
    const { unmount } = renderHook(() => useSheetDismiss(true, () => {}));
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("restores the previous inline overflow rather than a hardcoded value", () => {
    // The failure this pins down: restoring "" or "auto" unconditionally would
    // wipe out whatever the app had set before the sheet opened.
    document.body.style.overflow = "clip";

    const { unmount } = renderHook(() => useSheetDismiss(true, () => {}));
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("clip");
    document.body.style.overflow = "";
  });

  it("keeps the lock held when an inner sheet closes and an outer one is still open", () => {
    const outer = renderHook(() => useSheetDismiss(true, () => {}));
    const inner = renderHook(() => useSheetDismiss(true, () => {}));
    expect(document.body.style.overflow).toBe("hidden");

    inner.unmount();
    expect(document.body.style.overflow).toBe("hidden");

    outer.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("saves the pre-lock value once, not once per nested sheet", () => {
    // If the second sheet re-read the overflow on the way in it would save
    // "hidden" as the value to restore, and the page would never scroll again.
    document.body.style.overflow = "clip";

    const outer = renderHook(() => useSheetDismiss(true, () => {}));
    const inner = renderHook(() => useSheetDismiss(true, () => {}));
    inner.unmount();
    outer.unmount();

    expect(document.body.style.overflow).toBe("clip");
    document.body.style.overflow = "";
  });
});

describe("useSheetDismiss escape handling", () => {
  it("closes an open sheet on Escape", () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useSheetDismiss(true, onClose));

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("ignores keys that are not Escape", () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useSheetDismiss(true, onClose));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("does nothing while closed, and nothing after unmount", () => {
    const onClose = vi.fn();
    const { rerender, unmount } = renderHook(({ open }) => useSheetDismiss(open, onClose), {
      initialProps: { open: false },
    });

    pressEscape();
    expect(onClose).not.toHaveBeenCalled();

    rerender({ open: true });
    unmount();
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes only the topmost sheet on a single press", () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    const outer = renderHook(() => useSheetDismiss(true, closeOuter));
    const inner = renderHook(() => useSheetDismiss(true, closeInner));

    pressEscape();
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();

    // With the inner sheet gone the next press falls through to the outer one,
    // rather than needing a press that goes nowhere in between.
    inner.unmount();
    pressEscape();
    expect(closeOuter).toHaveBeenCalledTimes(1);
    expect(closeInner).toHaveBeenCalledTimes(1);
    outer.unmount();
  });

  it("skips a press that something inside the sheet already handled", () => {
    // HabitEditorSheet's rename field relies on this: it calls preventDefault so
    // cancelling a rename does not also close the sheet around it. Dispatched
    // from a real descendant that claims the event on the way up, because that
    // ordering is the whole reason the hook reads defaultPrevented instead of
    // relying on stopPropagation.
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useSheetDismiss(true, onClose));

    const field = document.createElement("input");
    document.body.appendChild(field);
    field.addEventListener("keydown", (e) => e.preventDefault());
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true }),
    );

    expect(onClose).not.toHaveBeenCalled();
    field.remove();
    unmount();
  });

  it("marks the press it consumes as handled", () => {
    const { unmount } = renderHook(() => useSheetDismiss(true, () => {}));

    expect(pressEscape().defaultPrevented).toBe(true);
    unmount();
  });

  it("calls the latest onClose, not the one from the render that opened the sheet", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ onClose }) => useSheetDismiss(true, onClose), {
      initialProps: { onClose: first },
    });

    rerender({ onClose: second });
    pressEscape();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
  });
});
