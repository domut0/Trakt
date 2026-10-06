import { useEffect, useState } from "react";
import { warmGoogleAuth } from "../lib/google-auth";
import { useSyncStore } from "../lib/sync-store";

/** Reconnection is offered in the app instead of opening sign-in on launch. */
export function GoogleSyncNotice() {
  const config = useSyncStore((s) => s.config);
  const reason = useSyncStore((s) => s.blockedReason);
  const reauthorize = useSyncStore((s) => s.reauthorize);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const visible = config?.enabled && (reason === "needs-consent" || reason === "popup-blocked");

  useEffect(() => {
    if (visible) warmGoogleAuth();
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="shrink-0 border-t border-rule bg-surface px-4 py-1">
      <div className="flex items-center justify-between gap-3">
        <span className="t-label text-ink-2" role="status">
          {busy ? "Connecting to Google…" : "Reconnect to keep syncing"}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(undefined);
            void reauthorize().then((result) => {
              setBusy(false);
              if (!result.ok) setError(result.error);
            });
          }}
          className="min-h-[44px] shrink-0 px-2 t-label font-medium text-ink disabled:opacity-40"
        >
          {busy ? "Reconnecting…" : "Reconnect Google"}
        </button>
      </div>
      {error && (
        <p role="alert" className="pb-2 t-label text-signal">
          {error}
        </p>
      )}
    </div>
  );
}
