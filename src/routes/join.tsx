import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { decodeInvite, type JoinPayload } from "../lib/invite";
import { loadPendingCoach, savePendingCoach } from "../lib/pending-coach";
import { Frame, Primary } from "../components/Frame";
import { GettingStartedCard } from "../components/GettingStartedCard";
import { stageHandoff, stageTutorialStart } from "../lib/onboarding-handoff";
import { loadDisplayName, saveDisplayName, updateTutorialState } from "../lib/tutorial-state";
import { useStore } from "../lib/store";

export const Route = createFileRoute("/join")({
  head: () => ({
    meta: [
      { title: "Join" },
      { name: "description", content: "Start using Trakt with your coach." },
    ],
  }),
  component: JoinPage,
});

/** How long the checklist is shown here before it moves to Today. */
const HANDOFF_MS = 1500;

/**
 * The invite a coach sends, and the way in.
 *
 * Carries NO credential, unlike a connect link. Under the Sheets API flow the
 * client creates their own spreadsheet in their own Drive, so there is nothing
 * to hand over -- this only pre-names them and hands them to the tutorial.
 *
 * ## One question, and it is the one the sheet is named after
 *
 * Every client's sheet used to be called "Trakt — 2026-09-21" unless the coach
 * happened to have typed a name into the invite, so a coach with six clients
 * picked between six identically-named files by date. Asking is one field, it
 * is the first thing anybody expects to be asked, and it makes the file in
 * their Drive say whose it is.
 *
 * The field is prefilled from the invite and still shown: what the coach calls
 * somebody in their own notes is not necessarily what that person would call
 * themselves. What the name is FOR is deliberately not explained under it -
 * nobody asked what the sheet would be called, and the answer was a line of
 * copy on the first screen of the app justifying its own question.
 *
 * ## Then the checklist appears here, and then it leaves
 *
 * The three tasks are shown on this screen, at nought of three, so the shape of
 * what is coming is visible before anything starts. Then the card travels to
 * Today, where it lives, and the tutorial takes over.
 */
function JoinPage() {
  const router = useRouter();
  const hydrated = useStore((s) => s.hydrated);

  const [payload, setPayload] = useState<JoinPayload | undefined>();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<"name" | "checklist">("name");

  useEffect(() => {
    // Client-only: the fragment never reaches the server.
    const decoded = decodeInvite(window.location.hash);
    const join = decoded?.kind === "join" ? decoded : undefined;
    setPayload(join);
    // Remembered so Settings can offer the share as one tap once the sheet
    // exists. Re-opening the same invite keeps the "already shared" mark.
    if (join) {
      const known = loadPendingCoach();
      const same = known?.email !== undefined && known.email === join.coachEmail;
      savePendingCoach({
        name: join.coachName,
        ...(join.coachEmail ? { email: join.coachEmail } : {}),
        ...(join.clientName ? { clientName: join.clientName } : {}),
        ...(same && known.sharedAt !== undefined ? { sharedAt: known.sharedAt } : {}),
      });
    }
    setName(loadDisplayName() ?? join?.clientName ?? "");
    setReady(true);
  }, []);

  /**
   * Show the checklist here, then send it to Today and let it start the
   * tutorial once it has landed.
   *
   * The tutorial used to be started here, before the navigation, so Today
   * painted already in tutorial mode: the spotlight's dim went up over the
   * card while it was still in the air and its auto-scroll moved the page out
   * from under it. The journey this whole animation exists to show happened
   * behind a black sheet, which read as the app skipping straight to Settings.
   */
  useEffect(() => {
    if (phase !== "checklist") return;
    const timer = window.setTimeout(() => {
      const card = document.querySelector("[data-onboarding-card]");
      if (card) stageHandoff(card.getBoundingClientRect());
      // Somebody who dismissed the card on a previous run and then opened a
      // fresh invite has to see it again: it is the thing that is about to
      // travel, and it is what the tutorial hands back to.
      updateTutorialState({ cardDismissedAt: undefined });
      stageTutorialStart();
      void router.navigate({ to: "/" });
    }, HANDOFF_MS);
    return () => window.clearTimeout(timer);
  }, [phase, router]);

  if (!ready) return null;

  if (!payload) {
    return (
      <Frame title="That link did not work">
        <p className="t-body text-ink-2">
          It may have been cut short on the way. Ask your coach for a fresh one.
        </p>
      </Frame>
    );
  }

  if (phase === "checklist") {
    // No heading. The ring says "0/3 tasks complete" directly above three
    // named tasks, and a sentence introducing that is a sentence about a
    // sentence.
    return (
      <Frame>
        <GettingStartedCard surface="join" />
      </Frame>
    );
  }

  const trimmed = name.trim();

  return (
    <Frame title={`${payload.coachName} invited you to Trakt`}>
      <label className="block">
        <span className="block pb-2 t-body text-ink-2">What should we call you?</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          enterKeyHint="go"
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmed.length > 0) {
              saveDisplayName(trimmed);
              setPhase("checklist");
            }
          }}
          className="min-h-[44px] w-full rounded-md border border-rule bg-transparent px-3 t-heading text-ink"
        />
      </label>

      <Primary
        disabled={trimmed.length === 0 || !hydrated}
        onClick={() => {
          saveDisplayName(trimmed);
          setPhase("checklist");
        }}
      >
        Continue
      </Primary>
    </Frame>
  );
}
