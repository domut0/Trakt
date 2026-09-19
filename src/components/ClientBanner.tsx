import { useCoachStore } from "../lib/coach-store";

/**
 * "Bob's Trakt", across the top of every screen in coach mode.
 *
 * Modelled on ActiveSessionBanner and occupying the same slot, because it says
 * the same KIND of thing: the app is in a mode, and this is the way out. The
 * two can never both apply -- there is no active session inside a client's
 * view, and `asStoreState` clears it -- but AppShell asserts that rather than
 * assuming it.
 *
 * The timestamp is not decoration. Everything on screen is as fresh as the
 * client's last sync, and a coach is about to make programming decisions from
 * it, so how old it is belongs next to whose it is.
 */
export function ClientBanner() {
  const viewing = useCoachStore((s) => s.viewing);
  const exit = useCoachStore((s) => s.exitClientView);
  if (!viewing) return null;

  return (
    <div
      // Same geometry as ActiveSessionBanner: AppShell reserves exactly pt-11
      // (44px) for whichever of the two is showing.
      className="fixed left-0 right-0 top-0 z-40 flex min-h-[44px] items-center justify-between gap-3 bg-accent px-4 py-2.5 text-accent-foreground"
    >
      <span className="flex min-w-0 items-center gap-2 t-label font-medium">
        <span className="truncate">{viewing.client.name}&rsquo;s Trakt</span>
        <span className="shrink-0 opacity-80">· {freshness(viewing.pulledAt)}</span>
      </span>
      <button
        type="button"
        onClick={exit}
        // Not a min-h-[44px] block: the banner is already 44px tall and the
        // button fills it, so the tap target is the bar's full height.
        className="shrink-0 t-label font-medium opacity-90"
      >
        Done
      </button>
    </div>
  );
}

/**
 * How stale the snapshot is, in the coarsest unit that is still honest.
 *
 * Deliberately not a clock time. "synced 14:02" invites the reader to work out
 * the gap themselves and to get it wrong across a date boundary; the gap is the
 * thing they actually need.
 */
export function freshness(pulledAt: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - pulledAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
