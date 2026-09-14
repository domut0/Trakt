import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { decodeInvite, type ConnectPayload } from "../lib/invite";
import { useSyncStore } from "../lib/sync-store";

export const Route = createFileRoute("/connect")({
  head: () => ({
    meta: [
      { title: "Connect" },
      { name: "description", content: "Connect a Google Sheet that was set up for you." },
    ],
  }),
  component: ConnectPage,
});

/**
 * One tap to connect a sheet somebody else set up.
 *
 * The Apps Script flow asks a client to create a spreadsheet, paste a script,
 * authorise it, deploy it through four dialogs and copy a URL back. This turns
 * all of that into a link the coach sends after doing it themselves.
 *
 * The link's fragment carries the sheet's url and secret, which together are a
 * bearer capability over that sheet. So this screen CONFIRMS rather than
 * connecting on arrival -- a link that silently reconfigured the app on open
 * would be a nasty thing to be able to send someone.
 */
function ConnectPage() {
  const router = useRouter();
  const connect = useSyncStore((s) => s.connect);
  const existing = useSyncStore((s) => s.config);
  const hydrate = useSyncStore((s) => s.hydrate);

  const [payload, setPayload] = useState<ConnectPayload | undefined>();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    void hydrate();
    // Read on the client only: the fragment never reaches the server, so there
    // is nothing for SSR to render and reading it during render would be a
    // hydration mismatch.
    const decoded = decodeInvite(window.location.hash);
    setPayload(decoded?.kind === "connect" ? decoded : undefined);
    setReady(true);
  }, [hydrate]);

  if (!ready) return null;

  if (!payload) {
    return (
      <Frame title="That link did not work">
        <p className="t-body text-ink-2">
          It may have been cut short on the way. Ask for a fresh one.
        </p>
      </Frame>
    );
  }

  if (existing) {
    // Reconnecting would drop the merge base and could republish over a sheet
    // this device already owns, so it is not something to do behind a tap.
    return (
      <Frame title="Already connected">
        <p className="t-body text-ink-2">
          This app is already syncing to a sheet. Disconnect in Settings first if you mean to
          switch.
        </p>
        <Primary onClick={() => router.navigate({ to: "/settings" })}>Open Settings</Primary>
      </Frame>
    );
  }

  return (
    <Frame title="Connect your sheet">
      <p className="t-body text-ink-2">
        {payload.label
          ? `This connects Trakt to ${payload.label}.`
          : "This connects Trakt to a Google Sheet that was set up for you."}
      </p>
      <p className="t-label text-ink-2">
        Your log stays on this device. The sheet is a copy, in a Drive account you can see.
      </p>
      {error && <p className="t-label text-signal">{error}</p>}
      <Primary
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(undefined);
          void connect(payload.url, payload.secret).then((result) => {
            setBusy(false);
            if (result.ok) router.navigate({ to: "/" });
            else setError(result.error ?? "That sheet could not be reached.");
          });
        }}
      >
        {busy ? "Connecting…" : "Connect"}
      </Primary>
    </Frame>
  );
}

export function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col justify-center gap-4 bg-background px-6">
      <h1 className="t-title text-ink">{title}</h1>
      {children}
    </div>
  );
}

export function Primary({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-[44px] w-full bg-ink t-body font-semibold text-paper rounded-md"
    >
      {children}
    </button>
  );
}
