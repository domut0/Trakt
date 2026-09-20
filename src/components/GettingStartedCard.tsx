import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Chevron } from "./icons";
import { Primary } from "./Frame";
import { InstallWalkthrough } from "./InstallWalkthrough";
import { useInstallMode, promptInstall } from "../lib/install-prompt";
import { loadPendingCoach } from "../lib/pending-coach";
import { useSyncStore } from "../lib/sync-store";
import { loadTutorialState, saveTutorialState } from "../lib/tutorial-state";
import { useTutorialStore } from "../lib/tutorial-store";

export { TutorialClosingCard } from "./TutorialClosingCard";

export interface GettingStartedCardProps {
  /**
   * "today" renders the dismissable card with its "Getting started" heading.
   * "join" renders inside Frame on /join with the "Continue" action button.
   */
  surface?: "today" | "join";
}

/**
 * The four-row onboarding checklist.
 *
 * Rendered in two places:
 * 1. Inside `Frame` on `/join` when a new client accepts their invite link.
 * 2. As a dismissable card on Today until completed or dismissed.
 *
 * ## The four rows and their completion sources
 *
 * - Row 1 (Home screen): `installMode().kind === "installed"` or `installedSeen`.
 *   Hidden entirely when installMode is "unavailable" (desktop, or unsupported browsers).
 * - Row 2 (Sheet): `useSyncStore(s => s.config)` has kind "google" and a valid spreadsheetId.
 * - Row 3 (Share): `loadPendingCoach()?.sharedAt !== undefined`.
 * - Row 4 (Tutorial): `loadTutorialState()?.doneAt !== undefined`.
 *
 * ## Locking rule
 *
 * Row 4 is locked until rows 2 and 3 are both done. A locked row is not merely
 * styled differently: tapping it is completely inert.
 *
 * ## The iOS row ticks late, not never
 *
 * On iOS Safari, `navigator.standalone` is false in the browser tab where the
 * instruction is read. Next time the user launches the app from the home screen,
 * it is true, and the row ticks. This is expected behavior.
 */
export function GettingStartedCard({ surface = "today" }: GettingStartedCardProps) {
  const router = useRouter();
  const install = useInstallMode();
  const syncConfig = useSyncStore((s) => s.config);
  const [showWalkthrough, setShowWalkthrough] = useState(false);

  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return loadTutorialState()?.cardDismissedAt !== undefined;
  });

  const tutorialState = typeof window !== "undefined" ? loadTutorialState() : undefined;
  const pendingCoach = typeof window !== "undefined" ? loadPendingCoach() : undefined;

  // Row 1: Add Trakt to your home screen
  const row1Done = install.kind === "installed" || Boolean(tutorialState?.installedSeen);
  const showRow1 = install.kind !== "unavailable";

  // Row 2: Connect a Google Sheet
  const row2Done = syncConfig?.kind === "google" && Boolean(syncConfig.spreadsheetId);

  // Row 3: Share it with {coach}
  const coachName = pendingCoach?.name ?? "your coach";
  const row3Done = pendingCoach?.sharedAt !== undefined;

  // Row 4: Try a tutorial workout
  const row4Done = tutorialState?.doneAt !== undefined;
  const row4Locked = !row2Done || !row3Done;

  const allDone = (!showRow1 || row1Done) && row2Done && row3Done && row4Done;

  // On Today, the card is hidden once dismissed, or once all rows are done,
  // or once the tutorial itself has completed (at which point the closing card appears).
  if (surface === "today") {
    if (dismissed || allDone || row4Done) {
      return null;
    }
  }

  const handleRow1Click = async () => {
    if (row1Done) return;
    if (install.kind === "prompt") {
      await promptInstall();
    } else if (install.kind === "manual-ios") {
      setShowWalkthrough(true);
    }
  };

  const handleRow4Click = () => {
    if (row4Locked) return;
    const started = useTutorialStore.getState().start();
    if (started) {
      router.navigate({ to: "/" });
    }
  };

  const handleDismiss = () => {
    const current = loadTutorialState() ?? { joinedAt: Date.now() };
    saveTutorialState({ ...current, cardDismissedAt: Date.now() });
    setDismissed(true);
  };

  /**
   * "Continue on /join goes to the first row that is not done, rather than always to Settings."
   */
  const handleContinue = async () => {
    if (showRow1 && !row1Done) {
      if (install.kind === "prompt") {
        await promptInstall();
      } else if (install.kind === "manual-ios") {
        setShowWalkthrough(true);
      }
      return;
    }
    if (!row2Done) {
      router.navigate({ to: "/settings" });
      return;
    }
    if (!row3Done) {
      router.navigate({ to: "/settings" });
      return;
    }
    if (!row4Done) {
      const started = useTutorialStore.getState().start();
      if (started) {
        router.navigate({ to: "/" });
      }
      return;
    }
    router.navigate({ to: "/" });
  };

  interface ChecklistRowItem {
    id: number;
    title: string;
    done: boolean;
    locked: boolean;
    onClick: () => void;
  }

  const visibleRows: ChecklistRowItem[] = [];

  if (showRow1) {
    visibleRows.push({
      id: 1,
      title: "Add Trakt to your home screen",
      done: row1Done,
      locked: false,
      onClick: () => void handleRow1Click(),
    });
  }

  visibleRows.push({
    id: 2,
    title: "Connect a Google Sheet",
    done: row2Done,
    locked: false,
    onClick: () => router.navigate({ to: "/settings" }),
  });

  visibleRows.push({
    id: 3,
    title: `Share it with ${coachName}`,
    done: row3Done,
    locked: false,
    onClick: () => router.navigate({ to: "/settings" }),
  });

  visibleRows.push({
    id: 4,
    title: "Try a tutorial workout",
    done: row4Done,
    locked: row4Locked,
    onClick: handleRow4Click,
  });

  const checklistContent = (
    <div className="group-list">
      {visibleRows.map((row, idx) => {
        const isFirst = idx === 0;
        return (
          <button
            key={row.id}
            type="button"
            disabled={row.locked}
            aria-disabled={row.locked}
            data-done={row.done ? "true" : "false"}
            data-locked={row.locked ? "true" : "false"}
            onClick={row.onClick}
            className={
              "group-row w-full text-left transition-opacity " +
              (!isFirst ? "group-row-sep " : "") +
              (row.locked ? "opacity-40 cursor-not-allowed" : "cursor-pointer")
            }
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="w-4 shrink-0 text-ink-2 t-label tabular-nums">{idx + 1}</span>
              <span className="truncate t-body text-ink">{row.title}</span>
            </div>

            {row.done ? (
              <span
                aria-hidden="true"
                data-testid="status-met"
                className="h-2.5 w-2.5 bg-ink rounded-sm shrink-0"
              />
            ) : row.locked ? null : (
              <Chevron className="shrink-0 text-ink-2" size={16} />
            )}
            {row.done && <span className="sr-only">Done</span>}
          </button>
        );
      })}
    </div>
  );

  if (surface === "join") {
    return (
      <div className="space-y-4 py-2">
        {checklistContent}
        <Primary onClick={() => void handleContinue()}>Continue</Primary>
        {showWalkthrough && <InstallWalkthrough onClose={() => setShowWalkthrough(false)} />}
      </div>
    );
  }

  return (
    <div className="mx-4 mb-4">
      <div className="group-header">
        <span className="t-caption">Getting started</span>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="-mr-2 flex min-h-[44px] min-w-[44px] items-center justify-center text-ink-2 hover:text-ink"
        >
          <span className="t-label">Dismiss</span>
        </button>
      </div>

      {checklistContent}

      {showWalkthrough && <InstallWalkthrough onClose={() => setShowWalkthrough(false)} />}
    </div>
  );
}
