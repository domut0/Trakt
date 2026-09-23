import { useState } from "react";
import { shareWithCoach } from "../lib/sync-client-google";
import { loadPendingCoach, savePendingCoach, type PendingCoach } from "../lib/pending-coach";
import { isLikelyEmail } from "../lib/coach-profile";

/**
 * The client's half of the handshake: give the coach access to the sheet.
 *
 * One tap when the person arrived through a coach's `/join` link, which
 * carries the coach's address; otherwise they type it. After that the coach
 * adds them through the Picker on their own phone.
 */
export function ShareWithCoach({ spreadsheetId }: { spreadsheetId: string }) {
  const [coach, setCoach] = useState<PendingCoach | undefined>(loadPendingCoach);
  const [email, setEmail] = useState(coach?.email ?? "");
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const share = async (address: string) => {
    if (!isLikelyEmail(address)) return setError("That email does not look right");
    setSharing(true);
    setError(undefined);
    const reply = await shareWithCoach(spreadsheetId, address);
    setSharing(false);
    if (!reply.ok) {
      return setError(
        reply.error === "needs-consent"
          ? "Google sign-in was closed before it finished"
          : "Couldn't share the sheet. Try again",
      );
    }
    const next: PendingCoach = {
      name: coach?.name ?? address.trim(),
      email: address.trim(),
      sharedAt: Date.now(),
    };
    savePendingCoach(next);
    setCoach(next);
    setOpen(false);
  };

  if (coach?.sharedAt !== undefined) {
    return (
      <div className="group-row group-row-sep">
        <div className="min-w-0">
          <div className="t-body">Shared with {coach.name}</div>
          {coach.email && coach.email !== coach.name && (
            <div className="truncate t-label text-ink-2">{coach.email}</div>
          )}
        </div>
      </div>
    );
  }

  // Arrived by invite: the address is already known, so this is the one tap.
  if (coach?.email && !open) {
    return (
      <>
        <button
          type="button"
          data-tutorial="share-coach"
          disabled={sharing}
          onClick={() => void share(coach.email!)}
          className="group-row group-row-sep w-full text-left"
        >
          <div className="min-w-0">
            <div className="t-body">{sharing ? "Sharing…" : `Share with ${coach.name}`}</div>
            <div className="truncate t-label text-ink-2">{coach.email}</div>
          </div>
          <span className="t-action" aria-hidden="true">
            →
          </span>
        </button>
        {error && <div className="group-row-sep px-4 py-3 t-label text-signal">{error}</div>}
      </>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        data-tutorial="share-coach"
        onClick={() => setOpen(true)}
        className="group-row group-row-sep w-full text-left"
      >
        <div className="t-body">Share with your coach</div>
        <span className="t-action" aria-hidden="true">
          →
        </span>
      </button>
    );
  }

  return (
    <div data-tutorial="share-coach" className="group-row-sep space-y-3 px-4 py-4">
      <label className="block">
        <span className="block pb-1 t-label text-ink-2">Your coach&rsquo;s Google email</span>
        <input
          type="email"
          inputMode="email"
          value={email}
          placeholder="coach@gmail.com"
          onChange={(e) => setEmail(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-[44px] w-full bg-field px-3 t-body text-ink rounded-md"
        />
      </label>
      {error && <p className="t-label text-signal">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={sharing}
          onClick={() => void share(email)}
          className="min-h-[44px] flex-1 bg-ink t-body font-medium text-paper rounded-md"
        >
          {sharing ? "Sharing…" : "Share"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[44px] flex-1 t-body text-ink-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
