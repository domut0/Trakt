import { useState } from "react";
import { loadTutorialState, saveTutorialState } from "../lib/tutorial-state";
import { loadPendingCoach } from "../lib/pending-coach";

/**
 * The card shown on Today after the tutorial workout completes or is skipped.
 *
 * It stays visible until dismissed. The card makes clear that the practice
 * workout was sandboxed fixture data and that nothing touched the client's
 * real database.
 *
 * Deliberately carries no congratulations. PRODUCT.md: "Do not manufacture
 * praise." Tutorial done is a statement of fact, not an achievement the app
 * thanks anyone for.
 */
export function TutorialClosingCard() {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return loadTutorialState()?.closingCardDismissedAt !== undefined;
  });

  if (typeof window === "undefined" || dismissed) {
    return null;
  }

  const state = loadTutorialState();
  if (state?.doneAt === undefined || state.closingCardDismissedAt !== undefined) {
    return null;
  }

  const coach = loadPendingCoach();
  const coachName = coach?.name ?? "your coach";

  const handleDismiss = () => {
    const current = loadTutorialState() ?? { joinedAt: Date.now() };
    saveTutorialState({ ...current, closingCardDismissedAt: Date.now() });
    setDismissed(true);
  };

  return (
    <div className="mx-4 mb-4 group-list p-4">
      <div className="flex items-center justify-between pb-1">
        <h2 className="t-heading text-ink">Tutorial done</h2>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="-mr-2 flex min-h-[44px] min-w-[44px] items-center justify-center text-ink-2 hover:text-ink"
        >
          <span className="t-label">Dismiss</span>
        </button>
      </div>

      <p className="t-body text-ink-2 pb-4">
        Nothing you just logged was saved. Your first real one will be.
      </p>

      <div className="space-y-3 pt-3 hairline-t">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
          <span className="w-36 shrink-0 t-label font-medium text-ink-2">Every morning</span>
          <span className="t-body text-ink">Bodyweight, on Today.</span>
        </div>
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
          <span className="w-36 shrink-0 t-label font-medium text-ink-2">Every night</span>
          <span className="t-body text-ink">
            Calories, protein, carbs, fat, and steps if you count them.
          </span>
        </div>
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
          <span className="w-36 shrink-0 t-label font-medium text-ink-2">When it arrives</span>
          <span className="t-body text-ink">
            A plan from {coachName} shows up as a card. Read it, then accept it.
          </span>
        </div>
      </div>
    </div>
  );
}
