import { useEffect, useState } from "react";
import { useCoachStore } from "../lib/coach-store";
import { isLikelyExecUrl } from "../lib/sync-client";
import {
  pickerAvailable,
  pickSharedSpreadsheet,
  type PickedSheet,
  type PickFailure,
} from "../lib/google-picker";
import { Chevron } from "./icons";
import { Toggle } from "./Toggle";
import { freshness } from "./ClientBanner";
import type { CoachClient } from "../lib/db";
import { inviteUrl, INVITE_VERSION, type JoinPayload } from "../lib/invite";
import { isLikelyEmail, loadCoachProfile, saveCoachProfile } from "../lib/coach-profile";

/**
 * Coach mode's Settings section: the client list, and the way into a client.
 *
 * What is stored per client is a pointer to their spreadsheet and a name to
 * show it under. Nothing about their training is kept here -- it is pulled when
 * their view opens and dropped when it closes, which is the whole reason this
 * feature needs no database anyone has to protect.
 */
export function CoachSettings() {
  const hydrate = useCoachStore((s) => s.hydrate);
  const enabled = useCoachStore((s) => s.enabled);
  const setEnabled = useCoachStore((s) => s.setEnabled);
  const clients = useCoachStore((s) => s.clients);
  const loading = useCoachStore((s) => s.loading);
  const lastError = useCoachStore((s) => s.lastError);
  const enterClientView = useCoachStore((s) => s.enterClientView);
  const removeClient = useCoachStore((s) => s.removeClient);

  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <>
      <div className="group-row">
        <div className="min-w-0">
          <div className="t-body">Coach mode</div>
          <div className="t-label text-ink-2">Read a client&rsquo;s log and write their plan</div>
        </div>
        <Toggle checked={enabled} onChange={() => setEnabled(!enabled)} label="Coach mode" />
      </div>

      {enabled && (
        <>
          {clients.map((client) => (
            <div key={client.id} className="group-row group-row-sep">
              <button
                type="button"
                disabled={loading}
                onClick={() => void enterClientView(client.id)}
                className="flex min-w-0 flex-1 items-center justify-between text-left"
              >
                <span className="min-w-0">
                  <span className="block t-body text-ink">{client.name}</span>
                  <span className="block t-label text-ink-2">
                    {client.lastPulledAt === undefined
                      ? "Never opened"
                      : `Last opened ${freshness(client.lastPulledAt)}`}
                  </span>
                </span>
                <Chevron className="shrink-0 text-ink-2" size={16} />
              </button>
              <button
                type="button"
                onClick={() => void removeClient(client.id)}
                aria-label={`Remove ${client.name}`}
                className="ml-3 min-h-[44px] shrink-0 t-label text-ink-2"
              >
                Remove
              </button>
            </div>
          ))}

          {lastError && (
            <div className="group-row-sep px-4 py-3 t-label text-signal">
              {lastError === "not-configured"
                ? "This client's sheet cannot be opened yet."
                : lastError === "unreadable"
                  ? "That address did not return the expected reply."
                  : lastError === "needs-consent"
                    ? "Google sign-in was closed before it finished"
                    : "Couldn't reach that client's sheet."}
            </div>
          )}

          {adding ? (
            <AddClientForm onDone={() => setAdding(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="group-row group-row-sep w-full text-left"
            >
              <div className="t-body">Add a client</div>
              <Chevron className="shrink-0 text-ink-2" size={16} />
            </button>
          )}

          {inviting ? (
            <InviteForm onDone={() => setInviting(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setInviting(true)}
              className="group-row group-row-sep w-full text-left"
            >
              <div className="t-body">Invite a client</div>
              <Chevron className="shrink-0 text-ink-2" size={16} />
            </button>
          )}
        </>
      )}
    </>
  );
}

/**
 * Adding a client.
 *
 * The Picker is the way in: the client shares their sheet with the coach, and
 * picking it is what grants this app access to it (see google-picker.ts). The
 * Apps Script form stays for sheets set up by hand, one tap away rather than
 * alongside, since a coach choosing between the two up front is choosing
 * between words they do not know.
 */
function AddClientForm({ onDone }: { onDone: () => void }) {
  const [byLink, setByLink] = useState(!pickerAvailable());
  return byLink ? (
    <AddByLinkForm onDone={onDone} />
  ) : (
    <AddByPickerForm onDone={onDone} onUseLink={() => setByLink(true)} />
  );
}

const PICK_ERRORS: Record<PickFailure, string> = {
  "needs-consent": "Google sign-in was closed before it finished",
  "script-blocked": "Couldn't load Google. Check your connection or content blocker",
  "no-api-key": "This build has no Google API key",
  "no-client-id": "This build has no Google client id",
};

function AddByPickerForm({ onDone, onUseLink }: { onDone: () => void; onUseLink: () => void }) {
  const addClient = useCoachStore((s) => s.addClient);
  const [name, setName] = useState("");
  const [sheet, setSheet] = useState<PickedSheet | undefined>();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const pick = async () => {
    setPicking(true);
    setError(undefined);
    try {
      const picked = await pickSharedSpreadsheet();
      if (picked) {
        setSheet(picked);
        // The sheet's own title is usually the client's name already.
        if (name.trim() === "") setName(picked.name);
      }
    } catch (err) {
      const code = (err instanceof Error ? err.message : "") as PickFailure;
      setError(PICK_ERRORS[code] ?? PICK_ERRORS["script-blocked"]);
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    if (!sheet) return setError("Choose their sheet first");
    if (name.trim() === "") return setError("Give them a name");
    await addClient({
      id: `cc_${crypto.randomUUID()}`,
      name: name.trim(),
      kind: "google",
      spreadsheetId: sheet.id,
    });
    onDone();
  };

  return (
    <div className="group-row-sep space-y-3 px-4 py-4">
      <button
        type="button"
        disabled={picking}
        onClick={() => void pick()}
        className="flex min-h-[44px] w-full items-center justify-between border border-rule px-3 text-left rounded-md"
      >
        <span className="min-w-0 truncate t-body text-ink">
          {picking
            ? "Opening Google…"
            : sheet
              ? sheet.name || "Untitled sheet"
              : "Choose their sheet"}
        </span>
        <span className="shrink-0 pl-3 t-label text-ink-2">{sheet ? "Change" : ""}</span>
      </button>
      <Field label="Name" value={name} onChange={setName} placeholder="Bob" />
      {error && <p className="t-label text-signal">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          className="min-h-[44px] flex-1 bg-ink t-body font-medium text-paper rounded-md"
        >
          Add
        </button>
        <button type="button" onClick={onDone} className="min-h-[44px] flex-1 t-body text-ink-2">
          Cancel
        </button>
      </div>
      <button type="button" onClick={onUseLink} className="min-h-[44px] t-label text-ink-2">
        Use an Apps Script link instead
      </button>
    </div>
  );
}

/** Adding a client by their Apps Script deployment, for sheets set up by hand. */
function AddByLinkForm({ onDone }: { onDone: () => void }) {
  const addClient = useCoachStore((s) => s.addClient);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | undefined>();

  const submit = async () => {
    if (name.trim() === "") return setError("Give them a name.");
    if (!isLikelyExecUrl(url)) {
      // The easy mistake is pasting the editor URL instead of the deployment's.
      return setError("That does not look like a deployment URL. It should end in /exec.");
    }
    if (secret.trim() === "") return setError("Paste their sheet's secret.");

    const client: CoachClient = {
      id: `cc_${crypto.randomUUID()}`,
      name: name.trim(),
      kind: "appsScript",
      url: url.trim(),
      secret: secret.trim(),
    };
    await addClient(client);
    onDone();
  };

  return (
    <div className="group-row-sep space-y-3 px-4 py-4">
      <Field label="Name" value={name} onChange={setName} placeholder="Bob" />
      <Field label="Sheet URL" value={url} onChange={setUrl} placeholder="https://…/exec" />
      <Field label="Secret" value={secret} onChange={setSecret} placeholder="Their sheet secret" />
      {error && <p className="t-label text-signal">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          className="min-h-[44px] flex-1 bg-ink t-body font-medium text-paper rounded-md"
        >
          Add
        </button>
        <button type="button" onClick={onDone} className="min-h-[44px] flex-1 t-body text-ink-2">
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Inviting a new client.
 *
 * The coach's email is the address the client's app will share their sheet
 * with, so it must be the Google account the coach signs in to Trakt with.
 */
function InviteForm({ onDone }: { onDone: () => void }) {
  const [clientName, setClientName] = useState("");
  const [coachName, setCoachName] = useState(() => loadCoachProfile().name);
  const [coachEmail, setCoachEmail] = useState(() => loadCoachProfile().email);
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<"copied" | "manual" | undefined>();
  const [manualUrl, setManualUrl] = useState<string | undefined>();

  const submit = async () => {
    const name = coachName.trim();
    const email = coachEmail.trim();
    const theirName = clientName.trim();

    if (name === "") {
      setError("Add your name");
      setStatus(undefined);
      setManualUrl(undefined);
      return;
    }
    if (!isLikelyEmail(email)) {
      setError("That email does not look right");
      setStatus(undefined);
      setManualUrl(undefined);
      return;
    }
    setError(undefined);

    saveCoachProfile({ name, email });

    const payload: JoinPayload = {
      v: INVITE_VERSION,
      kind: "join",
      coachName: name,
      coachEmail: email,
      ...(theirName ? { clientName: theirName } : {}),
    };
    const url = inviteUrl(window.location.origin, payload);

    let fallthrough = true;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Join me on Trakt", url });
        fallthrough = false;
        setStatus(undefined);
        setManualUrl(undefined);
      } catch (err: unknown) {
        const isAbort =
          (err instanceof Error && err.name === "AbortError") ||
          (typeof err === "object" &&
            err !== null &&
            (err as { name?: unknown }).name === "AbortError");
        if (isAbort) {
          return;
        }
      }
    }

    if (fallthrough) {
      try {
        if (!navigator?.clipboard?.writeText) {
          throw new Error("Clipboard API unavailable");
        }
        await navigator.clipboard.writeText(url);
        setStatus("copied");
        setManualUrl(undefined);
      } catch {
        setStatus("manual");
        setManualUrl(url);
      }
    }
  };

  return (
    <div className="group-row-sep space-y-3 px-4 py-4">
      <Field label="Their name" value={clientName} onChange={setClientName} placeholder="Bob" />
      <Field label="Your name" value={coachName} onChange={setCoachName} placeholder="Marcus" />
      <Field
        label="Your Google email"
        value={coachEmail}
        onChange={setCoachEmail}
        placeholder="you@gmail.com"
      />
      {error && <p className="t-label text-signal">{error}</p>}
      {status === "copied" && <p className="t-label text-ink-2">Link copied</p>}
      {status === "manual" && <p className="t-label text-ink-2">Copy this link</p>}
      {status === "manual" && manualUrl && (
        <input
          type="text"
          readOnly
          value={manualUrl}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.currentTarget.select()}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-[44px] w-full border border-rule bg-transparent px-3 t-body text-ink rounded-md"
        />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          className="min-h-[44px] flex-1 bg-ink t-body font-medium text-paper rounded-md"
        >
          Send invite
        </button>
        <button type="button" onClick={onDone} className="min-h-[44px] flex-1 t-body text-ink-2">
          Done
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="block pb-1 t-label text-ink-2">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="min-h-[44px] w-full border border-rule bg-transparent px-3 t-body text-ink rounded-md"
      />
    </label>
  );
}
