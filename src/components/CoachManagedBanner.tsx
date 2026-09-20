import { useState } from "react";
import { useStore } from "../lib/store";
import { usePlanLocked } from "../lib/plan-lock";
import { loadPendingCoach } from "../lib/pending-coach";

/**
 * "Your coach manages your plan", with the way out.
 *
 * A lock rather than a merge, by decision: a three-way merge over a plan is a
 * conflict matrix nobody would remember the rules of. Unlinking is two taps,
 * because the second one is where the person learns what it does not do.
 */
export function CoachManagedBanner() {
  const locked = usePlanLocked();
  const unlinkCoach = useStore((s) => s.unlinkCoach);
  const [confirming, setConfirming] = useState(false);
  // Named where the invite said who they are. "Your coach" is the fallback for
  // anyone who was added by hand rather than through a link.
  const coachName = loadPendingCoach()?.name?.trim();

  if (!locked) return null;

  return (
    <div className="mx-4 mb-4 bg-surface px-4 py-3 rounded-md">
      <div className="flex items-center justify-between gap-3">
        <span className="t-body text-ink">
          {coachName ? `${coachName} manages your plan` : "Your coach manages your plan"}
        </span>
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="-my-3 min-h-[44px] shrink-0 t-label t-action"
          >
            Unlink
          </button>
        )}
      </div>
      {confirming && (
        <div className="space-y-3 pt-2">
          <p className="t-label text-ink-2">
            Your plan becomes yours to edit. {coachName ?? "Your coach"} can still see your sheet
            until you stop sharing it in Google Drive, and a new plan from them will still be
            offered
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                unlinkCoach();
                setConfirming(false);
              }}
              className="min-h-[44px] flex-1 bg-ink t-body font-medium text-paper rounded-md"
            >
              Unlink
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="min-h-[44px] flex-1 t-body text-ink-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
