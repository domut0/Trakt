import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { decodeInvite, type JoinPayload } from "../lib/invite";
import { loadPendingCoach, savePendingCoach } from "../lib/pending-coach";
import { Frame, Primary } from "./connect";

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
  const router = useRouter();
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
      {payload.clientName && <p className="t-body text-ink">Hi {payload.clientName}.</p>}
      <p className="t-body text-ink-2">
        Trakt logs four numbers and a workout. Your data lives on your phone, in a spreadsheet in
        your own Google Drive.
      </p>

      <ol className="space-y-3 py-2">
        <Step n={1} title="Add Trakt to your home screen">
          From your browser&rsquo;s share menu, choose Add to Home Screen.
        </Step>
        <Step n={2} title="Connect a Google Sheet">
          In Settings. It creates one for you, in your own Drive.
        </Step>
        <Step n={3} title={`Share it with ${payload.coachName}`}>
          In Settings, under Sheet sync. One tap, once your sheet exists.
        </Step>
      </ol>

      <Primary onClick={() => router.navigate({ to: "/settings" })}>Get started</Primary>
    </Frame>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-ink t-label font-semibold text-paper rounded-md">
        {n}
      </span>
      <span className="min-w-0">
        <span className="block t-body text-ink">{title}</span>
        <span className="block t-label text-ink-2">{children}</span>
      </span>
    </li>
  );
}
