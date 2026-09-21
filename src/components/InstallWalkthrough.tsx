import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * iOS Safari home-screen installation walkthrough.
 *
 * ## Why drawn schematic frames
 *
 * On iOS Safari, web apps cannot trigger `beforeinstallprompt` or install
 * programmatically. The user must manually navigate Safari's native share sheet.
 *
 * Because Safari's chrome and share sheet live strictly outside the browser page's
 * DOM, no web app can screenshot it, point at it with a live cursor, or observe
 * taps on it.
 *
 * We show four schematic SVG diagrams drawn in Trakt's own dark palette rather
 * than pixel screenshots:
 *
 * 1. App bundle size: precaching screenshots would add hundreds of kilobytes to
 *    the PWA cache forever; four SVGs weigh just a few kilobytes.
 * 2. Visual harmony: Trakt is true black (#000000). A bright system screenshot
 *    would look alien pasted into the interface.
 * 3. Longevity: schematic illustrations age gracefully across minor iOS design
 *    iterations where an exact screenshot becomes slightly wrong.
 *
 * ## Completion detection
 *
 * Completion is not confirmed in the tab where these steps are read, because
 * `navigator.standalone` remains false here. Next time the user opens the app from
 * their newly created home screen icon, `navigator.standalone` is true and the row
 * ticks permanently. That is expected behavior, not a bug.
 */

export interface InstallWalkthroughProps {
  onClose: () => void;
}

interface StepFrame {
  step: number;
  title: string;
  src: string;
}

const FRAMES: readonly StepFrame[] = [
  {
    step: 1,
    title: "Tap the Share button",
    src: "/install/ios-1.svg",
  },
  {
    step: 2,
    title: "Scroll down the list",
    src: "/install/ios-2.svg",
  },
  {
    step: 3,
    title: "Tap Add to Home Screen",
    src: "/install/ios-3.svg",
  },
  {
    step: 4,
    title: "Tap Add, top right",
    src: "/install/ios-4.svg",
  },
];

export function InstallWalkthrough({ onClose }: InstallWalkthroughProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!mounted || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add to Home Screen"
      // The tutorial's spotlight stands down while this is up. It is opened BY
      // a tutorial step, so the hole would otherwise stay over the row that
      // opened it and none of these frames could be touched.
      data-tutorial-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/85 px-4 py-6 backdrop-blur-sm"
    >
      {/* Backdrop tap dismiss target */}
      <div className="absolute inset-0 -z-10" onClick={onClose} aria-hidden="true" />

      <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-rule bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-4 py-2">
          <h2 className="t-heading text-ink">Add to Home Screen</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 flex min-h-[44px] min-w-[44px] items-center justify-center text-ink-2 hover:text-ink"
          >
            <span className="t-label font-medium">Done</span>
          </button>
        </div>

        {/* Four schematic frames */}
        <div className="space-y-6 overflow-y-auto p-4">
          <ol className="space-y-6">
            {FRAMES.map((frame) => (
              <li key={frame.step} className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink t-label font-semibold text-paper">
                    {frame.step}
                  </span>
                  <span className="t-body font-medium text-ink">{frame.title}</span>
                </div>
                <div className="overflow-hidden rounded-xl border border-rule bg-paper p-2">
                  <img
                    src={frame.src}
                    alt={frame.title}
                    width={320}
                    height={480}
                    className="mx-auto h-auto max-h-[300px] w-full object-contain"
                  />
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-rule p-4">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-ink t-body font-medium text-paper"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
