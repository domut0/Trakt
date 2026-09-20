import { useRouter } from "@tanstack/react-router";
import { useTutorialStore } from "../lib/tutorial-store";

/**
 * "Tutorial mode", across the top of every screen while the sandbox is active.
 *
 * Modelled on ClientBanner and occupying the same slot, because it says
 * the same KIND of thing: the app is in a mode, and this is the way out.
 *
 * ## Never fixed
 *
 * In flow, not fixed over the top of the page: the app runs under a
 * translucent status bar (apple-mobile-web-app-status-bar-style), so a
 * bar pinned to top-0 sits beneath the clock and its button cannot be
 * tapped. In flow it also needs no reserved gap in <main> to match.
 *
 * ## Skip does not confirm
 *
 * The workout is fake, so skipping loses nothing, and a confirmation on a
 * Skip button is the app arguing with somebody who has already decided.
 * Skip calls skip() and navigates to /.
 */
export function TutorialBanner() {
  const active = useTutorialStore((s) => s.active);
  const skip = useTutorialStore((s) => s.skip);
  const router = useRouter();

  if (!active) return null;

  const handleSkip = () => {
    skip();
    try {
      void router.navigate({ to: "/" });
    } catch {
      // Best-effort navigation when outside an active router context (e.g. tests)
    }
  };

  return (
    <div
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      className="relative z-40 flex min-h-[44px] w-full shrink-0 items-center justify-between gap-3 bg-accent px-4 py-2.5 text-accent-foreground"
    >
      <span className="t-label font-medium">Tutorial mode</span>
      <button
        type="button"
        onClick={handleSkip}
        // Not a min-h-[44px] block: the banner is already 44px tall and the
        // button fills it, so the tap target is the bar's full height.
        className="shrink-0 t-label font-medium opacity-90"
      >
        Skip &rarr;
      </button>
    </div>
  );
}
