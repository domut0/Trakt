import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

/**
 * The demo cursor: a translucent dot that travels to the target control.
 *
 * ## Live screen, no recordings
 *
 * The demo does not replay static images or video captures. Instead, it finds
 * the real interactive element in the DOM via its `data-tutorial` marker and
 * measures its position on the screen right now (`getBoundingClientRect`).
 *
 * This design buys four things:
 * 1. It can never go stale when copy, layouts, or units change.
 * 2. It weighs nothing in cache size (zero image assets).
 * 3. It works across full-screen modals and portalled screens.
 * 4. It survives the soft keyboard pushing elements up the viewport.
 *
 * ## It is drawn in the opposite of whatever it lands on
 *
 * The dot used to be ink-coloured always, which made it invisible on the two
 * places it points at most: the inked "current lift" row and the dark Save
 * button. It now reads the effective background colour under the target -
 * walking up the tree until it finds something that is not transparent -
 * and draws itself black on light and white on dark.
 *
 * ## Shape: a translucent circle, not an arrow
 *
 * The app is mobile-first, designed for touch. A translucent circle mimics a
 * finger tap and matches the convention used in iOS and Android screen
 * recordings. Arrow icons feel desktop-oriented and pointer-like.
 *
 * ## Reduced motion
 *
 * In `src/styles.css`, all CSS animations are clamped to 0.001ms under
 * `prefers-reduced-motion: reduce`. A moving CSS dot would teleport jarringly.
 * Under reduced motion the dot and travel are disabled entirely, and a static
 * ring is drawn around the target instead.
 *
 * ## When it plays
 *
 * - Once, on its own, when a step first puts it on a target. Waiting eight
 *   seconds for the first sign of life meant most people never saw it at all.
 * - Again whenever "Show me" is tapped.
 * - Never while typing: if an input holds focus the animation is suppressed,
 *   so the app never talks over somebody mid-number.
 * - Taps pass through: pointer-events are off, so a tap during the animation
 *   lands on the control underneath it.
 */

interface Point {
  x: number;
  y: number;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function isInputFocused(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return (
    tag === "input" || tag === "textarea" || (active as HTMLElement).isContentEditable === true
  );
}

function checkReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The first ancestor colour that is actually painted, including the element itself. */
function backgroundUnder(el: Element): string | undefined {
  if (typeof window === "undefined") return undefined;
  let node: Element | null = el;
  while (node) {
    const color = window.getComputedStyle(node).backgroundColor;
    if (color && !isTransparent(color)) return color;
    node = node.parentElement;
  }
  return undefined;
}

/**
 * Only a colour with a zero alpha, and only a four-component one.
 *
 * The previous pattern allowed `rgba?` with any number of components and read
 * whatever sat before the closing bracket as the alpha - so `rgb(0, 0, 0)` was
 * "transparent" on the strength of its BLUE channel. Pure black is the ground
 * this whole app is painted on, so the walk never stopped anywhere, every
 * target came back as undefined, and the dot was drawn dark on dark every time.
 */
function isTransparent(color: string): boolean {
  const value = color.trim();
  if (value === "" || value === "transparent") return true;
  const rgba = /^rgba\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+\s*[,/]\s*([\d.]+)\s*\)$/i.exec(value);
  return rgba !== null && Number(rgba[1]) === 0;
}

/**
 * Whether a colour is light enough that black reads better on it than white.
 *
 * Relative luminance with the sRGB coefficients, against the 0.5 midpoint. Not
 * a contrast ratio: there are only two candidate inks and the question is which
 * of them wins, which the midpoint answers exactly.
 */
export function isLightBackground(color: string | undefined): boolean {
  if (!color) return true;
  const parts = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(color);
  if (!parts) return true;
  const [r, g, b] = [1, 2, 3].map((i) => Number(parts[i]) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
}

export function TutorialCursor({
  target,
  trigger,
  playImmediately,
}: {
  target: string;
  trigger?: number;
  playImmediately?: boolean;
}): ReactElement | null {
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [onLight, setOnLight] = useState(true);
  const prevPosRef = useRef<Point | null>(null);

  useEffect(() => {
    setMounted(true);
    setReducedMotion(checkReducedMotion());
  }, []);

  const findTarget = useCallback((): Element | null => {
    if (typeof document === "undefined") return null;
    return document.querySelector(`[data-tutorial="${target}"]`);
  }, [target]);

  const startAnimation = useCallback(() => {
    if (isInputFocused()) return;
    const el = findTarget();
    if (!el) return;

    setOnLight(isLightBackground(backgroundUnder(el)));

    if (checkReducedMotion()) {
      setReducedMotion(true);
      return;
    }

    const r = el.getBoundingClientRect();
    const dest: Point = { x: r.left + r.width / 2, y: r.top + r.height / 2 };

    // Travel from wherever it last landed, or from down and to the right, which
    // is roughly where a thumb comes from.
    const from: Point = prevPosRef.current ?? {
      x: Math.min(window.innerWidth - 30, dest.x + 50),
      y: Math.min(window.innerHeight - 30, dest.y + 60),
    };

    prevPosRef.current = dest;
    setStartPoint(from);
    setPlaying(true);
  }, [findTarget]);

  /**
   * Play once when the step arrives, retrying until the target exists.
   *
   * A step's target is often inside something that has not mounted yet - a
   * sheet mid-animation, a screen being pushed - and measuring it then gives a
   * zero-sized rect at the top left of the screen, which is where the dot used
   * to fly to.
   */
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    let tries = 0;

    const attempt = () => {
      if (cancelled) return;
      const el = findTarget();
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        startAnimation();
        return;
      }
      tries += 1;
      if (tries < 20) window.setTimeout(attempt, 120);
    };

    // One beat, so a step that arrives with its screen mid-transition measures
    // the destination rather than the doorway.
    const timer = window.setTimeout(attempt, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [target, findTarget, startAnimation]);

  useEffect(() => {
    if (trigger !== undefined && trigger > 0) startAnimation();
  }, [trigger, startAnimation]);

  useEffect(() => {
    if (playImmediately) startAnimation();
  }, [playImmediately, target, startAnimation]);

  useEffect(() => {
    const handleShowMe = () => startAnimation();
    window.addEventListener("tutorial-show-me", handleShowMe);
    return () => window.removeEventListener("tutorial-show-me", handleShowMe);
  }, [startAnimation]);

  // Loop is ~1.5s, plays twice, then stops.
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setPlaying(false), 3000);
    return () => clearTimeout(timer);
  }, [playing]);

  if (!mounted || typeof document === "undefined") return null;

  const el = findTarget();
  if (!el) return null;

  const currentRect: TargetRect = el.getBoundingClientRect();

  // Reduced motion: a static ring around the target, no dot and no travel.
  if (reducedMotion) {
    return createPortal(
      <div
        data-tutorial-cursor="ring"
        aria-hidden="true"
        className="fixed z-[56] pointer-events-none rounded-md"
        style={{
          top: `${Math.round(currentRect.top - 2)}px`,
          left: `${Math.round(currentRect.left - 2)}px`,
          width: `${Math.round(currentRect.width + 4)}px`,
          height: `${Math.round(currentRect.height + 4)}px`,
          boxShadow: `0 0 0 2px ${onLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.75)"}`,
        }}
      />,
      document.body,
    );
  }

  if (!playing || !startPoint) return null;

  const destX = Math.round(currentRect.left + currentRect.width / 2);
  const destY = Math.round(currentRect.top + currentRect.height / 2);
  const fromX = Math.round(startPoint.x);
  const fromY = Math.round(startPoint.y);

  const ink = onLight ? "0, 0, 0" : "255, 255, 255";

  return createPortal(
    <div className="pointer-events-none" aria-hidden="true">
      <style>{`
        @keyframes tutorial-dot-travel {
          0% {
            transform: translate(calc(var(--from-x) - var(--to-x)), calc(var(--from-y) - var(--to-y))) scale(0.9);
            opacity: 0;
          }
          20% { opacity: 0.85; }
          60% { transform: translate(0, 0) scale(1); opacity: 0.95; }
          85% { transform: translate(0, 0) scale(1); opacity: 0.95; }
          100% { transform: translate(0, 0) scale(1); opacity: 0; }
        }
        @keyframes tutorial-ripple-ping {
          0%, 55% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
          60% { transform: translate(-50%, -50%) scale(1); opacity: 0.7; }
          100% { transform: translate(-50%, -50%) scale(2.3); opacity: 0; }
        }
      `}</style>
      {/* Ripple ring on arrival */}
      <div
        data-tutorial-cursor="ripple"
        className="fixed z-[56] pointer-events-none h-7 w-7 rounded-full"
        style={{
          top: `${destY}px`,
          left: `${destX}px`,
          boxShadow: `0 0 0 2px rgba(${ink}, 0.5)`,
          animation: "tutorial-ripple-ping 1.5s cubic-bezier(0.2, 0, 0.2, 1) 2 forwards",
        }}
      />
      {/* The dot itself */}
      <div
        data-tutorial-cursor="dot"
        data-on-light={onLight ? "true" : "false"}
        className="fixed z-[56] pointer-events-none h-7 w-7 rounded-full shadow-sm"
        style={{
          top: `${destY}px`,
          left: `${destX}px`,
          marginTop: "-14px",
          marginLeft: "-14px",
          backgroundColor: `rgba(${ink}, 0.4)`,
          boxShadow: `0 0 0 4px rgba(${ink}, 0.22)`,
          ["--from-x" as string]: `${fromX}px`,
          ["--from-y" as string]: `${fromY}px`,
          ["--to-x" as string]: `${destX}px`,
          ["--to-y" as string]: `${destY}px`,
          animation: "tutorial-dot-travel 1.5s cubic-bezier(0.2, 0, 0.2, 1) 2 forwards",
        }}
      />
    </div>,
    document.body,
  );
}
