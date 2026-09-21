import { useState } from "react";
import { InstallWalkthrough } from "./InstallWalkthrough";
import { promptInstall, useInstallMode } from "../lib/install-prompt";
import { markInstallOffered } from "../lib/tutorial-state";
import { useTutorialStore } from "../lib/tutorial-store";

/**
 * "Add Trakt to your home screen", for the one chapter of the tutorial that is
 * about the phone rather than about training.
 *
 * ## Why this is a card and not a checklist row
 *
 * Installing used to be the first of four rows on the Getting started card,
 * where it sat forever on any device that could not install and ticked late on
 * every iPhone that could. It is a chapter of the tutorial now, so it needs a
 * control for exactly as long as that chapter lasts and no longer. This card
 * renders only then.
 *
 * ## Why the step completes on being OFFERED, not on being installed
 *
 * On iOS Safari the app cannot install itself and `navigator.standalone` stays
 * false in the tab where the instructions are read. The row only ticks next
 * time the app is opened from the home screen, which is after the tutorial is
 * over. Waiting for that would stop the tutorial dead on the one step where the
 * user has already done everything they can.
 */
export function TutorialInstallCard() {
  const active = useTutorialStore((s) => s.active);
  const steps = useTutorialStore((s) => s.steps);
  const step = useTutorialStore((s) => s.step);
  const install = useInstallMode();
  const [showWalkthrough, setShowWalkthrough] = useState(false);

  if (!active || steps[step]?.chapter !== "install") return null;

  const handle = () => {
    if (install.kind === "prompt") {
      void promptInstall().finally(markInstallOffered);
      return;
    }
    setShowWalkthrough(true);
  };

  return (
    <div className="mx-4 mb-4 group-list">
      <button
        type="button"
        data-tutorial="install-row"
        onClick={handle}
        className="group-row w-full text-left"
      >
        <span className="min-w-0">
          <span className="block truncate t-body text-ink">Add Trakt to your home screen</span>
          <span className="block truncate t-label text-ink-2">
            {install.kind === "prompt" ? "One tap" : "Share, then Add to Home Screen"}
          </span>
        </span>
        <span className="t-action shrink-0" aria-hidden="true">
          &rarr;
        </span>
      </button>

      {showWalkthrough && (
        <InstallWalkthrough
          onClose={() => {
            setShowWalkthrough(false);
            markInstallOffered();
          }}
        />
      )}
    </div>
  );
}
