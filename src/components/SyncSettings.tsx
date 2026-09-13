import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import scriptSource from "../../google-apps-script/sync.gs?raw";
import { useStore } from "@/lib/store";
import { generateSecret, useSyncStore } from "@/lib/sync-store";
import { Toggle } from "./Toggle";

/**
 * The "Google sheet" section of Settings.
 *
 * Extracted from the route the way TargetsEditor is, because the setup flow is
 * a small state machine and settings.tsx is already 600 lines.
 */

/** The script, with the generated secret substituted in so there is nothing to edit. */
function scriptWithSecret(secret: string): string {
  return scriptSource.replace("__SECRET__", secret);
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
  const connect = useSyncStore((s) => s.connect);
  const disconnect = useSyncStore((s) => s.disconnect);
  const setEnabled = useSyncStore((s) => s.setEnabled);
  const syncNow = useSyncStore((s) => s.syncNow);
  const collisions = useSyncStore((s) => s.collisions);
  const dismissCollisions = useSyncStore((s) => s.dismissCollisions);
  const blockedReason = useSyncStore((s) => s.blockedReason);
  const takeOverSheet = useSyncStore((s) => s.takeOverSheet);
  const setCount = useStore((s) => s.sets.length);
  const dayCount = useStore((s) => s.dailyLogs.length);

  const [showSetup, setShowSetup] = useState(false);
  const [secret, setSecret] = useState("");
  const [url, setUrl] = useState("");
  const [formError, setFormError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [showTakeover, setShowTakeover] = useState(false);

  const openSetup = () => {
    // Generated here rather than at render: crypto is fine on the server, but
    // a value made during SSR would differ from the one the client renders.
    setSecret(generateSecret());
    setShowSetup(true);
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(scriptWithSecret(secret));
      setCopied(true);
    } catch {
      // Clipboard access is refused in plenty of mobile contexts. Showing the
      // text to select by hand beats a dead end.
      setShowScript(true);
    }
  };

  const submit = async () => {
    setConnecting(true);
    setFormError(undefined);
    const result = await connect(url, secret);
    setConnecting(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setShowSetup(false);
    setUrl("");
  };

  if (!config) {
    return (
      <>
        {!showSetup ? (
          <button type="button" onClick={openSetup} className="group-row w-full text-left">
            <div>
              <div className="t-body">Set up sheet sync</div>
              <div className="t-label text-ink-2">
                Keep a Google Sheet up to date with your log.
              </div>
            </div>
            <span className="t-action" aria-hidden="true">
              →
            </span>
          </button>
        ) : (
          <div className="space-y-4 p-4">
            <ol className="space-y-2 t-label text-ink-2">
              <li>1. Open a Google Sheet, then Extensions, then Apps Script.</li>
              <li>2. Delete what is in the editor, then paste the script below.</li>
              <li>3. Deploy, New deployment, Web app. Execute as me, anyone with the link.</li>
              <li>4. Copy the web app URL and paste it here.</li>
            </ol>

            <button
              type="button"
              onClick={copyScript}
              className="min-h-11 w-full bg-wash py-2.5 t-body font-medium text-ink"
            >
              {copied ? "Script copied" : "Copy script"}
            </button>

            {showScript && (
              <textarea
                readOnly
                aria-label="Apps Script source"
                value={scriptWithSecret(secret)}
                className="h-40 w-full bg-wash p-3 t-label text-ink-2"
              />
            )}

            <div>
              <label htmlFor="sync-url" className="t-label text-ink-2">
                Web app URL
              </label>
              <input
                id="sync-url"
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://script.google.com/macros/s/.../exec"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="mt-1 min-h-11 w-full bg-wash px-3 t-body"
              />
            </div>

            {formError && <div className="t-label text-signal">{formError}</div>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowSetup(false)}
                className="min-h-11 flex-1 bg-wash py-2.5 t-body font-medium text-ink-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={connecting}
                className="min-h-11 flex-1 bg-ink py-2.5 t-body font-medium text-paper rounded-md"
              >
                {connecting ? "Connecting" : "Connect"}
              </button>
            </div>
          </div>
        )}
      </>
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

      {blockedReason === "other-device" && (
        <div className="group-row-sep space-y-3 p-4">
          <div className="t-label text-ink-2">
            This sheet belongs to another install. Each one tracks what it last pushed, so two
            writing to one sheet would overwrite each other.
          </div>
          {!showTakeover ? (
            <button
              type="button"
              onClick={() => setShowTakeover(true)}
              className="min-h-11 w-full bg-wash py-2.5 t-body font-medium text-ink"
            >
              Take over this sheet
            </button>
          ) : (
            <>
              {/* The counts are the point. A fresh install taking over replaces
                  the sheet with nothing, and "0 sets" is what makes that
                  obvious before the tap rather than after. */}
              <div className="t-label text-signal">
                This replaces the sheet's contents with this device's data:{" "}
                {setCount.toLocaleString()} {setCount === 1 ? "set" : "sets"} and{" "}
                {dayCount.toLocaleString()} {dayCount === 1 ? "day" : "days"} logged. The other
                install stops syncing to it.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowTakeover(false)}
                  className="min-h-11 flex-1 bg-wash py-2.5 t-body font-medium text-ink-2"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void takeOverSheet();
                    setShowTakeover(false);
                  }}
                  className="min-h-11 flex-1 bg-signal py-2.5 t-body font-medium text-white rounded-md"
                >
                  Take over
                </button>
              </div>
            </>
          )}
        </div>
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
