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
 * ## It stands down for a screen the tutorial itself opened
 *
 * `[data-tutorial-modal]` on screen and the spotlight renders nothing at all.
 * The iOS install walkthrough is the case: the step's target is the row that
 * opens it, so the hole stayed over that row and the four frames of
 * instructions that had just appeared could not be touched. Anything the
 * tutorial puts in front of somebody is, by definition, the thing it wants
 * them looking at.
 *
 * ## Scrolling is locked to the target, so the target is brought to you
 *
 * The panels swallow touch, wheel and keyboard scrolling, so the screen cannot
 * drift away from the thing being pointed at. That makes bringing it on screen
 * the spotlight's job and nobody else's: a step whose control is below the fold
 * with scrolling locked is a step nobody can complete, which is exactly what
 * "Start Tutorial day" was.
 *
 * It is not a one-shot scroll on arrival. That was tried and it is not enough:
 * the target frequently does not exist yet when its step begins - the sandbox
 * is still swapping in, a sheet is still animating - and a scroll aimed at a
 * thing that is not there does nothing. The frame loop below keeps the target
 * inside a band between the mode bar and the rail for as long as the step
 * lasts, so it does not matter when it appears, how tall it is, or what moved
 * underneath it.
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

/** How long to leave a scroll alone before asking for another. */
const SCROLL_COOLDOWN_MS = 500;
/** Smooth scrolling gets two attempts; after that it snaps, and it arrives. */
const SMOOTH_ATTEMPTS = 2;

/**
 * The element that actually scrolls this one.
 *
 * The shell scrolls its own `<main>` and never the document, and the exercise
 * screen scrolls a list inside a portal, so `window.scrollBy` is wrong in both
 * of the places this matters most.
 */
function scrollerFor(el: Element): Element | null {
  let node = el.parentElement;
  while (node) {
    const overflow = window.getComputedStyle(node).overflowY;
    const scrolls = overflow === "auto" || overflow === "scroll" || overflow === "overlay";
    if (scrolls && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Keep `rect` inside the band between the mode bar and the rail.
 *
 * Called every frame, and does nothing on nearly all of them: a scroll is only
 * asked for when the target is actually outside the band, and then not again
 * for half a second, so this never fights a smooth scroll it started itself.
 */
function keepInView(
  el: Element,
  rect: Rect,
  bannerBottom: number,
  scrolledAt: { current: number },
  tries: { current: number },
): void {
  const now = Date.now();
  if (now - scrolledAt.current < SCROLL_COOLDOWN_MS) return;

  const railHeight =
    Number.parseFloat(
      window.getComputedStyle(document.documentElement).getPropertyValue("--rail-h"),
    ) || 0;

  const top = bannerBottom + PAD * 2;
  const bottom = window.innerHeight - railHeight - PAD * 2;
  if (bottom <= top) return;

  const above = rect.top - top;
  const below = rect.top + rect.height - bottom;
  if (above >= 0 && below <= 0) {
    // In view. Reset, so a target that goes off screen later gets the gentle
    // treatment again rather than inheriting a snap.
    tries.current = 0;
    return;
  }

  // Centre it in the band, which reads better than nudging it just inside.
  const delta = rect.top + rect.height / 2 - (top + bottom) / 2;
  const behavior: ScrollBehavior =
    prefersReducedMotion() || tries.current >= SMOOTH_ATTEMPTS ? "auto" : "smooth";

  scrolledAt.current = now;
  tries.current += 1;

  const scroller = scrollerFor(el);
  if (scroller) scroller.scrollBy({ top: delta, behavior });
  else window.scrollBy({ top: delta, behavior });
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
  /** When the last scroll was asked for, and how many have been asked for. */
  const scrolledAt = useRef(0);
  const scrollTries = useRef(0);

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

      if (el && next) keepInView(el, next, bottom, scrolledAt, scrollTries);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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
    scrollTries.current = 0;
    scrolledAt.current = 0;
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
  // See "It stands down" above.
  if (document.querySelector("[data-tutorial-modal]")) return null;

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
