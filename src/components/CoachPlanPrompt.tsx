import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useSyncStore } from "../lib/sync-store";
import { useStore } from "../lib/store";
import { diffPlan, planFromStore } from "../lib/plan-tab";
import { useToast } from "./Toast";

/**
 * "Your coach sent a new plan" — the client's side of the handover.
 *
 * Deliberately a review-then-confirm, not an application. A plan rewrites
 * targets and the whole split, which is not a thing to do to someone between
 * them opening the app and looking at it. This is the same shape as the backup
 * import in Settings, for the same reason.
 *
 * Dismissing does NOT mark the plan accepted. It stays in the sheet and is
 * offered again next time, because a client who taps past this by accident has
 * not decided anything.
 */
/** What the pending plan would change, or an empty list when there is none. */
function usePendingChanges() {
  const pending = useSyncStore((s) => s.pendingCoachPlan);
  const phases = useStore((s) => s.nutritionPhases);
  const slots = useStore((s) => s.slots);
  const plannedDays = useStore((s) => s.plannedDays);
  const exercises = useStore((s) => s.exercises);
  const planningMode = useStore((s) => s.planningMode);

  return useMemo(() => {
    if (!pending) return [];
    const current = planFromStore(
      { slots, exercises, nutritionPhases: phases, plannedDays, planningMode },
      // Only the plan's shape is compared; the attribution is not a change.
      { by: "client", at: "" },
    );
    return diffPlan(current, pending);
  }, [pending, slots, exercises, phases, plannedDays, planningMode]);
}

/**
 * The card that says a plan is waiting. Shown on Today and on Plan, because a
 * plan nobody noticed is the failure this feature exists to prevent.
 */
export function CoachPlanCard() {
  const pending = useSyncStore((s) => s.pendingCoachPlan);
  const setOpen = useSyncStore((s) => s.setPlanReviewOpen);
  const changes = usePendingChanges();

  if (!pending) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-4 mb-4 flex w-[calc(100%-2rem)] items-center justify-between bg-accent px-4 py-3 text-left text-accent-foreground rounded-md"
      >
        <span className="min-w-0">
          <span className="block t-body font-medium">Your coach sent a new plan</span>
          <span className="block t-label opacity-90">
            {changes.length === 0
              ? "Nothing would change"
              : changes.length === 1
                ? "1 change to review"
                : `${changes.length} changes to review`}
          </span>
        </span>
        <span className="shrink-0 t-label font-medium">Review →</span>
      </button>
    </>
  );
}

/**
 * The review screen itself, mounted once by the shell so any tab can raise it -
 * including the launch sync, which opens it the moment a plan arrives.
 */
export function CoachPlanPrompt() {
  const pending = useSyncStore((s) => s.pendingCoachPlan);
  const needsUpdate = useSyncStore((s) => s.coachPlanNeedsUpdate);
  const open = useSyncStore((s) => s.planReviewOpen);
  const setOpen = useSyncStore((s) => s.setPlanReviewOpen);
  const acceptCoachPlan = useStore((s) => s.acceptCoachPlan);
  const showToast = useToast();
  const changes = usePendingChanges();

  /**
   * A plan this build is too old to read.
   *
   * Its own screen rather than a variant of the review below, because there is
   * nothing to review: the payload never parsed, so there is no list of changes
   * and no Accept. It says what happened and leaves the sheet alone.
   *
   * No "Not now" either. Dismissing implies a choice, and the only thing that
   * clears this is updating the app - so the way out is the same gesture as
   * leaving any other screen, and it comes straight back on the next sync.
   */
  if (needsUpdate && !pending) {
    if (!open || typeof document === "undefined") return null;
    return createPortal(
      <div className="fixed inset-0 z-50 flex flex-col bg-paper">
        <header className="px-4 pb-3 pt-14">
          <h1 className="t-title text-ink">Update Trakt</h1>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <p className="t-body text-ink">Your coach sent a plan that this version cannot read.</p>
          <p className="mt-3 t-label text-ink-2">
            Close Trakt and open it again to pick up the newest version. The plan stays in your
            sheet until then, and nothing you have logged is affected.
          </p>
        </div>

        <div
          className="px-4 pt-2"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-[44px] w-full bg-ink t-body font-semibold text-paper rounded-md"
          >
            OK
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  if (!pending) return null;

  return (
    <>
      {/* Portalled to the body, like every other overlay here. AppShell leaves a
          transform on <main> after a route animation, and a transformed
          ancestor becomes the containing block for position: fixed -- which put
          this screen inside the scrolling <main> and left its Accept and Not now
          buttons outside the visible box. */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex flex-col bg-paper">
            <header className="px-4 pb-3 pt-14">
              <h1 className="t-title text-ink">New plan</h1>
              <p className="t-label text-ink-2">From your coach</p>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4">
              {changes.length === 0 ? (
                <p className="t-body text-ink-2">
                  This plan matches what you are already following.
                </p>
              ) : (
                <ul className="space-y-3">
                  {changes.map((c, i) => (
                    <li key={i} className="border-b border-rule pb-3">
                      <span className="block t-label text-ink-2">{c.area}</span>
                      <span className="block t-body text-ink">
                        {c.kind === "removed" ? "Remove " : c.kind === "added" ? "Add " : ""}
                        {c.subject}
                      </span>
                      {c.detail && <span className="block t-label text-ink-2">{c.detail}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="py-4 t-label text-ink-2">
                Accepting replaces your plan. Everything you have logged is kept.
              </p>
            </div>

            <div
              className="flex gap-2 px-4 pt-2"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
            >
              <button
                type="button"
                onClick={() => {
                  acceptCoachPlan(pending);
                  // Clearing it here rather than waiting for the next sync means
                  // the prompt goes away the moment the client acts on it.
                  useSyncStore.setState({ pendingCoachPlan: undefined });
                  setOpen(false);
                  showToast({ message: "New plan applied", durationMs: 4000 });
                }}
                className="min-h-[44px] flex-1 bg-ink t-body font-semibold text-paper rounded-md"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-[44px] flex-1 t-body text-ink-2"
              >
                Not now
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
