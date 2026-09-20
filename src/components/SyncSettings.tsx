import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useStore } from "@/lib/store";
import { useSyncStore } from "@/lib/sync-store";
import { ShareWithCoach } from "./ShareWithCoach";
import { Toggle } from "./Toggle";

/**
 * The "Google sheet" section of Settings.
 *
 * Extracted from the route the way TargetsEditor is, because the setup flow is
 * a small state machine and settings.tsx is already 600 lines.
 */

/**
 * Whether this config is one this version can sync.
 *
 * An Apps Script connection is not broken data, it is a connection to a
 * transport the app no longer speaks -- so it is offered a reconnect rather
 * than an error.
 */
function isGoogleConfig(config: { kind?: string; spreadsheetId?: string }): boolean {
  return config.kind === "google" && (config.spreadsheetId ?? "") !== "";
}

/** A discarded cell, shown back to the user. Blank must read as blank, not as nothing. */
function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "(blank)";
  return String(value);
}

function statusLine(state: {
  status: string;
  lastSyncedAt?: number;
  lastError?: string;
  pending: boolean;
}): string {
  if (state.status === "syncing") return "Syncing now";
  if (state.status === "blocked" || state.status === "error") {
    return state.lastError ?? "Sync failed";
  }
  if (state.status === "offline") return "Offline, will sync when you reconnect";
  if (!state.lastSyncedAt) return "Not synced yet";
  const relative = formatDistanceToNow(new Date(state.lastSyncedAt), { addSuffix: true });
  return state.pending ? `Changes waiting. Last synced ${relative}.` : `Synced ${relative}.`;
}

export function SyncSettings() {
  const config = useSyncStore((s) => s.config);
  const status = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const lastError = useSyncStore((s) => s.lastError);
  const pending = useSyncStore((s) => s.pending);
  const connectGoogle = useSyncStore((s) => s.connectGoogle);
  const googleAvailable = useSyncStore((s) => s.googleAvailable);
  const disconnect = useSyncStore((s) => s.disconnect);
  const setEnabled = useSyncStore((s) => s.setEnabled);
  const syncNow = useSyncStore((s) => s.syncNow);
  const collisions = useSyncStore((s) => s.collisions);
  const dismissCollisions = useSyncStore((s) => s.dismissCollisions);
  const blockedReason = useSyncStore((s) => s.blockedReason);
  const reauthorize = useSyncStore((s) => s.reauthorize);
  const setCount = useStore((s) => s.sets.length);
  const dayCount = useStore((s) => s.dailyLogs.length);

  const [showSetup, setShowSetup] = useState(false);
  const [googleError, setGoogleError] = useState<string | undefined>();
  const [connecting, setConnecting] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | undefined>();

  if (!config) {
    return (
      <>
        <button
          type="button"
          disabled={connecting || !googleAvailable()}
          onClick={() => {
            setConnecting(true);
            setGoogleError(undefined);
            void connectGoogle().then((result) => {
              setConnecting(false);
              if (!result.ok) setGoogleError(result.error);
            });
          }}
          className="group-row w-full text-left"
        >
          <div>
            <div className="t-body">{connecting ? "Connecting…" : "Connect Google Sheet"}</div>
          </div>
          <span className="t-action" aria-hidden="true">
            →
          </span>
        </button>
        {googleError && (
          <div className="group-row-sep px-4 py-3 t-label text-signal">{googleError}</div>
        )}
      </>
    );
  }

  // A connection made by the Apps Script setup, which this version no longer
  // speaks. Nothing is lost by reconnecting: the device holds every set, and
  // the old sheet stays in Drive untouched.
  if (!isGoogleConfig(config)) {
    return (
      <div className="group-row-sep space-y-3 px-4 py-4">
        <div className="t-body">Sheet sync has moved to Google sign-in</div>
        <p className="t-label text-ink-2">
          Reconnecting makes a new sheet in your Drive from this phone. Your old sheet stays where
          it is
        </p>
        {googleError && <p className="t-label text-signal">{googleError}</p>}
        <button
          type="button"
          disabled={connecting || !googleAvailable()}
          onClick={() => {
            setConnecting(true);
            setGoogleError(undefined);
            void disconnect().then(() =>
              connectGoogle().then((result) => {
                setConnecting(false);
                if (!result.ok) setGoogleError(result.error);
              }),
            );
          }}
          className="min-h-[44px] w-full bg-ink t-body font-medium text-paper rounded-md"
        >
          {connecting ? "Connecting…" : "Reconnect with Google"}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="group-row">
        <div>
          <div className="t-body">Sheet sync</div>
          <div className="t-label text-ink-2">
            {statusLine({ status, lastSyncedAt, lastError, pending })}
          </div>
        </div>
        <Toggle
          checked={config.enabled}
          onChange={() => void setEnabled(!config.enabled)}
          label="Sheet sync"
        />
      </div>

      {/* The status line above says "Reconnect to keep syncing", and until now
          there was nothing on the screen to tap. The instruction was real - a
          browser Google token has no refresh token, so a lapsed grant genuinely
          needs one - but the only Reconnect button in this component was on the
          legacy Apps Script branch, which a normal connection never reaches.

          It calls `reauthorize`, NOT `connectGoogle`. The latter creates a
          spreadsheet, so the obvious wiring would have made a second sheet and
          left the one with the history in it behind, along with the coach's
          share of it. */}
      {blockedReason === "needs-consent" && (
        <div className="group-row-sep space-y-3 px-4 py-4">
          {reconnectError && <p className="t-label text-signal">{reconnectError}</p>}
          <button
            type="button"
            disabled={reconnecting || !googleAvailable()}
            onClick={() => {
              setReconnecting(true);
              setReconnectError(undefined);
              void reauthorize().then((result) => {
                setReconnecting(false);
                if (!result.ok) setReconnectError(result.error);
              });
            }}
            className="min-h-[44px] w-full bg-ink t-body font-medium text-paper rounded-md disabled:opacity-40"
          >
            {reconnecting ? "Reconnecting…" : "Reconnect Google"}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => void syncNow()}
        disabled={status === "syncing" || !config.enabled}
        className="group-row group-row-sep w-full text-left"
      >
        <div className="t-body">Sync now</div>
        <span className="t-action" aria-hidden="true">
          →
        </span>
      </button>

      {config.spreadsheetUrl && (
        <a
          href={config.spreadsheetUrl}
          target="_blank"
          rel="noreferrer"
          className="group-row group-row-sep w-full text-left"
        >
          <div className="t-body">Open sheet</div>
          <span className="t-action" aria-hidden="true">
            →
          </span>
        </a>
      )}

      {config.kind === "google" && config.spreadsheetId && (
        <ShareWithCoach spreadsheetId={config.spreadsheetId} />
      )}

      {collisions.length > 0 && (
        <div className="group-row-sep space-y-3 p-4">
          <div className="t-label text-ink-2">
            These sheet edits were not applied, because the same value had also changed on this
            device. The app's value was kept.
          </div>
          <ul className="space-y-1">
            {collisions.slice(-5).map((c, i) => (
              <li key={`${c.tab}-${c.key}-${c.field}-${i}`} className="t-label text-ink">
                <span className="text-ink-2">
                  {c.tab} · {c.field}:{" "}
                </span>
                sheet had {formatValue(c.sheetValue)}, app kept {formatValue(c.appValue)}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={dismissCollisions}
            className="min-h-11 w-full bg-wash py-2.5 t-body font-medium text-ink-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {!showDisconnect ? (
        <button
          type="button"
          onClick={() => setShowDisconnect(true)}
          className="group-row group-row-sep w-full text-left"
        >
          <div className="t-body text-signal">Disconnect sheet</div>
          <span className="text-signal" aria-hidden="true">
            →
          </span>
        </button>
      ) : (
        <div className="group-row-sep space-y-3 p-4">
          <div className="t-label text-ink-2">
            This stops syncing and forgets the sheet address. Nothing is deleted, from the sheet or
            from this device.
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowDisconnect(false)}
              className="min-h-11 flex-1 bg-wash py-2.5 t-body font-medium text-ink-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void disconnect();
                setShowDisconnect(false);
              }}
              className="min-h-11 flex-1 bg-signal py-2.5 t-body font-medium text-white rounded-md"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </>
  );
}
