import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { decodeInvite, type JoinPayload } from "../lib/invite";
import { loadPendingCoach, savePendingCoach } from "../lib/pending-coach";
import { Frame } from "../components/Frame";
import { GettingStartedCard } from "../components/GettingStartedCard";

export const Route = createFileRoute("/join")({
  head: () => ({
    meta: [
      { title: "Join" },
      { name: "description", content: "Start using Trakt with your coach." },
    ],
  }),
  component: JoinPage,
});

/**
 * The invite a coach sends, and the whole of a client's onboarding.
 *
 * Carries NO credential, unlike a connect link. Under the Sheets API flow the
 * client creates their own spreadsheet in their own Drive, so there is nothing
 * to hand over -- this only pre-names them and scripts the order of the three
 * things they have to do.
 *
 * The sheet step is intentionally not automatic. Creating a file in someone's
 * Drive is not something a link should do on open, and the consent screen is
 * where they get to see exactly what is being asked for.
 */
function JoinPage() {
  const [payload, setPayload] = useState<JoinPayload | undefined>();
  const [ready, setReady] = useState(false);

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
    setReady(true);
  }, []);

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

  return (
    <Frame title={`${payload.coachName} invited you to Trakt`}>
      {payload.clientName && <p className="t-body text-ink">Hi {payload.clientName}</p>}
      <p className="t-body text-ink-2">
        Trakt logs four numbers and a workout. Your data stays on your phone and in your own Google
        Drive.
      </p>

      <GettingStartedCard surface="join" />
    </Frame>
  );
}
