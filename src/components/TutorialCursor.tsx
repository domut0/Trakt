import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

/**
 * The demo cursor: a translucent dot that animates to the target control.
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
 * ## Shape: a translucent circle, not an arrow
 *
 * The app is mobile-first, designed for touch interaction. A translucent circle
 * mimics a finger tap and matches the convention used in iOS and Android screen
 * recordings. Arrow icons feel desktop-oriented and pointer-like; a circle is
 * unambiguous on a touch interface.
 *
 * ## Reduced motion
 *
 * In `src/styles.css`, all CSS animations are clamped to 0.001ms under
 * `prefers-reduced-motion: reduce`. A moving CSS dot would teleport jarringly.
 * Under reduced motion, the dot and travel are disabled entirely. Instead, a
 * static, non-moving ring is drawn directly around the target element.
 *
 * ## When it plays
 *
 * - On demand: whenever "Show me" is tapped on the tutorial rail.
 * - Automatically: after 8 seconds stuck on the same step without progressing.
 * - Never while typing: if any input or textarea currently holds focus, the
 *   animation is suppressed so the app never talks over the user.
 * - Taps pass through: pointer-events are disabled so mid-animation taps land
 *   directly on the underlying controls.
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
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const prevPosRef = useRef<Point | null>(null);

  useEffect(() => {
    setMounted(true);
    setReducedMotion(checkReducedMotion());
  }, []);

  // Memoised, along with startAnimation below, because four effects call them.
  // Redefined every render they are a new dependency every render, which is
  // why the exhaustive-deps rule had four complaints here - and the honest fix
  // is to make them stable rather than to silence it.
  const measureTarget = useCallback((): Element | null => {
    if (typeof document === "undefined") return null;
    const el = document.querySelector(`[data-tutorial="${target}"]`);
    if (!el) {
      setTargetRect(null);
      return null;
    }
    const r = el.getBoundingClientRect();
    setTargetRect({
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
    });
    return el;
  }, [target]);

  const startAnimation = useCallback(() => {
    if (isInputFocused()) return;
    const el = measureTarget();
    if (!el) return;

    if (checkReducedMotion()) {
      setReducedMotion(true);
      return;
    }

    const r = el.getBoundingClientRect();
    const dest: Point = {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };

    // Animate from wherever it previously was, or default to an offset down and to the right
    const from: Point = prevPosRef.current ?? {
      x: Math.min(window.innerWidth - 30, dest.x + 50),
      y: Math.min(window.innerHeight - 30, dest.y + 60),
    };

    prevPosRef.current = dest;
    setStartPoint(from);
    setPlaying(true);
  }, [measureTarget]);

  // Auto-play after 8 seconds stuck on the same step
  useEffect(() => {
    if (!target) return;
    measureTarget();

    const timer = setTimeout(() => {
      startAnimation();
    }, 8000);

    return () => clearTimeout(timer);
  }, [target, measureTarget, startAnimation]);

  // Trigger on demand from prop changes or "tutorial-show-me" window events
  useEffect(() => {
    if (trigger !== undefined && trigger > 0) {
      startAnimation();
    }
  }, [trigger, startAnimation]);

  useEffect(() => {
    if (playImmediately) {
      startAnimation();
    }
  }, [playImmediately, target, startAnimation]);

  useEffect(() => {
    const handleShowMe = () => {
      startAnimation();
    };
    window.addEventListener("tutorial-show-me", handleShowMe);
    return () => window.removeEventListener("tutorial-show-me", handleShowMe);
  }, [target, startAnimation]);

  // Loop is ~1.5s, plays twice (3s total), then stops
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      setPlaying(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [playing]);

  if (!mounted || typeof document === "undefined") return null;

  // Always check current DOM state for target
  const el = document.querySelector(`[data-tutorial="${target}"]`);
  if (!el) return null;

  const currentRect = el.getBoundingClientRect();

  // Reduced motion: static ring around the target element, no dot, no travel
  if (reducedMotion) {
    return createPortal(
      <div
        data-tutorial-cursor="ring"
        aria-hidden="true"
        className="fixed z-[56] pointer-events-none rounded-md ring-2 ring-ink/40 ring-offset-2 ring-offset-paper"
        style={{
          top: `${Math.round(currentRect.top - 2)}px`,
          left: `${Math.round(currentRect.left - 2)}px`,
          width: `${Math.round(currentRect.width + 4)}px`,
          height: `${Math.round(currentRect.height + 4)}px`,
        }}
      />,
      document.body,
    );
  }

  // If not currently playing and not reduced motion, render nothing
  if (!playing || !startPoint) return null;

  const destX = Math.round(currentRect.left + currentRect.width / 2);
  const destY = Math.round(currentRect.top + currentRect.height / 2);
  const fromX = Math.round(startPoint.x);
  const fromY = Math.round(startPoint.y);

  return createPortal(
    <div className="pointer-events-none" aria-hidden="true">
      <style>{`
        @keyframes tutorial-dot-travel {
          0% {
            transform: translate(calc(var(--from-x) - var(--to-x)), calc(var(--from-y) - var(--to-y))) scale(0.9);
            opacity: 0;
          }
          20% {
            opacity: 0.85;
          }
          60% {
            transform: translate(0, 0) scale(1);
            opacity: 0.95;
          }
          85% {
            transform: translate(0, 0) scale(1);
            opacity: 0.95;
          }
          100% {
            transform: translate(0, 0) scale(1);
            opacity: 0;
          }
        }
        @keyframes tutorial-ripple-ping {
          0%, 55% {
            transform: translate(-50%, -50%) scale(0.5);
            opacity: 0;
          }
          60% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 0.7;
          }
          100% {
            transform: translate(-50%, -50%) scale(2.3);
            opacity: 0;
          }
        }
      `}</style>
      {/* Ripple ring on arrival */}
      <div
        data-tutorial-cursor="ripple"
        className="fixed z-[56] pointer-events-none h-7 w-7 rounded-full ring-2 ring-ink/40"
        style={{
          top: `${destY}px`,
          left: `${destX}px`,
          animation: "tutorial-ripple-ping 1.5s cubic-bezier(0.2, 0, 0.2, 1) 2 forwards",
        }}
      />
      {/* Translucent circle dot */}
      <div
        data-tutorial-cursor="dot"
        className="fixed z-[56] pointer-events-none h-7 w-7 rounded-full bg-ink/35 ring-4 ring-ink/20 shadow-sm"
        style={{
          top: `${destY}px`,
          left: `${destX}px`,
          marginTop: "-14px",
          marginLeft: "-14px",
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
