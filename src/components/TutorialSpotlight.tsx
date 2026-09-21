import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

/**
 * Everything except the thing the rail is talking about, dimmed and inert.
 *
 * ## Why the tutorial gates now
 *
 * The old rule was that nothing blocks and nothing scolds: tapping something
 * other than the target just did that thing and the step waited. It read well
 * and it did not survive contact. Someone who wandered got a line of
 * instruction describing a screen they were no longer on, which is worse than
 * being stopped - the app looked broken rather than firm. So the target is the
 * only thing on screen that answers a tap, and the line on the rail is always
 * about something visible.
 *
 * Nothing scolds, still. A tap on the dim does nothing at all: no shake, no
 * message, no sound. It is a closed door, not an argument.
 *
 * ## Four panels, not a cutout
 *
 * The hole is the gap BETWEEN four fixed panels rather than a mask with a
 * transparent middle. A real gap means taps, hovers and the soft keyboard reach
 * the control underneath exactly as they would with nothing on screen, with no
 * pointer-events juggling and nothing to get wrong on iOS.
 *
 * ## The mode bar is never dimmed
 *
 * The dim starts below `[data-tutorial-banner]`. The bar says which mode the
 * app is in and carries the way out of it, and gating that would make a
 * tutorial somebody could not leave.
 *
 * ## Scrolling is locked to the target
 *
 * The panels swallow touch, wheel and keyboard scrolling, so the screen cannot
 * drift away from the thing being pointed at. The target itself is scrolled
 * into view when a step arrives - which is what "the circle is below the
 * screen" was: the demo was playing perfectly, forty pixels under the fold.
 */

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Breathing room around the target, and the radius of the hole's corners. */
const PAD = 8;
const RADIUS = 10;
/** How far out the hole starts when a zoom is asked for. */
const ZOOM_PAD = 56;

function rectsEqual(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TutorialSpotlight({
  target,
  zoomKey,
}: {
  target: string;
  /** Changes when "Show me" is tapped, which plays the hole closing in. */
  zoomKey: number;
}): ReactElement | null {
  const [rect, setRect] = useState<Rect | null>(null);
  const [bannerBottom, setBannerBottom] = useState(0);
  const [pad, setPad] = useState(PAD);
  const rectRef = useRef<Rect | null>(null);
  const bannerRef = useRef(0);

  /**
   * Measured every frame while the tutorial is up.
   *
   * Not on scroll and resize events: the target moves for reasons neither of
   * those fires for - a sheet animating in, a row expanding, the soft keyboard
   * arriving, a route transition's transform. A frame loop costs one
   * getBoundingClientRect per frame for the length of a tutorial and is right
   * in every case, where an event list is right in the cases somebody thought
   * of.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    let raf = 0;

    const tick = () => {
      const el = document.querySelector(`[data-tutorial="${target}"]`);
      const measured = el?.getBoundingClientRect();
      const next: Rect | null =
        measured && measured.width > 0 && measured.height > 0
          ? {
              top: measured.top,
              left: measured.left,
              width: measured.width,
              height: measured.height,
            }
          : null;
      if (!rectsEqual(rectRef.current, next)) {
        rectRef.current = next;
        setRect(next);
      }

      const banner = document.querySelector("[data-tutorial-banner]");
      const bottom = banner ? banner.getBoundingClientRect().bottom : 0;
      if (Math.abs(bannerRef.current - bottom) >= 0.5) {
        bannerRef.current = bottom;
        setBannerBottom(bottom);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  /**
   * Bring the target on screen when a step arrives.
   *
   * Retried, because the element is often inside something still mounting. The
   * first "Show me" on Today pointed at the Add activity button, which on a
   * short phone sits below the fold: the demo played, off screen, and the rail
   * read as a lie.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    let cancelled = false;
    let tries = 0;

    const attempt = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-tutorial="${target}"]`);
      if (el) {
        el.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
        return;
      }
      tries += 1;
      if (tries < 25) window.setTimeout(attempt, 120);
    };

    attempt();
    return () => {
      cancelled = true;
    };
  }, [target]);

  /** "Show me" pulls the hole in from wide open, which reads as a zoom. */
  useEffect(() => {
    if (zoomKey === 0 || prefersReducedMotion()) return;
    setPad(ZOOM_PAD);
    const timer = window.setTimeout(() => setPad(PAD), 30);
    return () => window.clearTimeout(timer);
  }, [zoomKey]);

  useEffect(() => {
    setPad(PAD);
  }, [target]);

  /**
   * Nothing scrolls while the spotlight is up.
   *
   * Wheel and touchmove are cancelled on the panels; a gesture that starts in
   * the hole is the user working the control, which is the one thing that
   * should still move.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const block = (event: Event) => {
      const el = event.target as Element | null;
      if (el?.closest?.("[data-tutorial-dim]")) event.preventDefault();
    };
    document.addEventListener("wheel", block, { passive: false });
    document.addEventListener("touchmove", block, { passive: false });
    return () => {
      document.removeEventListener("wheel", block);
      document.removeEventListener("touchmove", block);
    };
  }, []);

  if (typeof document === "undefined") return null;
  // Nothing to cut a hole for means nothing is dimmed. A tutorial that blacks
  // out the screen because its target has not mounted is a locked app.
  if (!rect) return null;

  // The dim begins under the mode bar, never over it.
  const ceiling = Math.max(0, bannerBottom);
  const top = Math.max(ceiling, rect.top - pad);
  const left = Math.max(0, rect.left - pad);
  const right = rect.left + rect.width + pad;
  const bottom = Math.max(top, rect.top + rect.height + pad);

  const transition = prefersReducedMotion()
    ? undefined
    : "top 320ms cubic-bezier(0.2,0,0.2,1), left 320ms cubic-bezier(0.2,0,0.2,1), width 320ms cubic-bezier(0.2,0,0.2,1), height 320ms cubic-bezier(0.2,0,0.2,1)";

  const panel = "fixed z-[54] bg-black/55";
  const swallow = {
    onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
    onClick: (e: React.MouseEvent) => e.preventDefault(),
    style: { touchAction: "none" as const },
  };

  return createPortal(
    <div aria-hidden="true">
      <div
        data-tutorial-dim="top"
        className={panel}
        {...swallow}
        style={{
          ...swallow.style,
          top: ceiling,
          left: 0,
          right: 0,
          height: Math.max(0, top - ceiling),
          transition,
        }}
      />
      <div
        data-tutorial-dim="bottom"
        className={panel}
        {...swallow}
        style={{ ...swallow.style, top: bottom, left: 0, right: 0, bottom: 0, transition }}
      />
      <div
        data-tutorial-dim="left"
        className={panel}
        {...swallow}
        style={{ ...swallow.style, top, left: 0, width: left, height: bottom - top, transition }}
      />
      <div
        data-tutorial-dim="right"
        className={panel}
        {...swallow}
        style={{ ...swallow.style, top, left: right, right: 0, height: bottom - top, transition }}
      />
      {/* The edge of the hole, so it reads as a frame around something rather
          than as a gap in the dark. */}
      <div
        data-tutorial-spotlight="ring"
        className="pointer-events-none fixed z-[54]"
        style={{
          top,
          left,
          width: right - left,
          height: bottom - top,
          borderRadius: RADIUS,
          boxShadow: "0 0 0 2px rgba(255,255,255,0.35)",
          transition,
        }}
      />
    </div>,
    document.body,
  );
}
